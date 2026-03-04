import { WebSocketServer, WebSocket } from 'ws';
import type {
    ProtocolAdapter,
    AdapterConfig,
    HealthStatus,
    SerializableState,
    MessageHandler,
    UME,
    AdapterCapabilities,
} from '@kalpa/core';
import { TransportClass, createUME, createLifecycleEvent, LIFECYCLE_EVENTS } from '@kalpa/core';

// ─── WebSocket Server Adapter ──────────────────────────────────────
// Bi-directional streaming adapter. Supports broadcast to all clients.

export interface WebSocketAdapterConfig extends AdapterConfig {
    port?: number;
    host?: string;
}

export class WebSocketAdapter implements ProtocolAdapter {
    readonly protocol = 'websocket';
    readonly name = 'websocket';
    readonly version = '0.1.0';
    readonly capabilities: AdapterCapabilities = {
        supportedClasses: [TransportClass.STREAM, TransportClass.PUBLISH_SUBSCRIBE],
        supportsClient: false,
        supportsServer: true,
        supportsBinary: true,
        supportsStreaming: true,
    };

    private wss: WebSocketServer | null = null;
    private port: number = 3001;
    private host: string = '0.0.0.0';
    private handler: MessageHandler | null = null;
    private clients: Set<WebSocket> = new Set();
    private clientIdCounter: number = 0;

    async initialize(config: AdapterConfig): Promise<void> {
        const wsConfig = config as WebSocketAdapterConfig;
        this.port = wsConfig.port ?? 3001;
        this.host = wsConfig.host ?? '0.0.0.0';
    }

    async start(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.wss = new WebSocketServer({
                port: this.port,
                host: this.host,
            });

            this.wss.on('error', reject);

            this.wss.on('listening', () => {
                resolve();
            });

            this.wss.on('connection', (ws, req) => {
                this.handleConnection(ws, req);
            });
        });
    }

    async stop(): Promise<void> {
        return new Promise<void>((resolve) => {
            // Close all client connections
            for (const client of this.clients) {
                client.close(1001, 'Server shutting down');
            }
            this.clients.clear();

            if (this.wss) {
                this.wss.close(() => resolve());
            } else {
                resolve();
            }
        });
    }

    async destroy(): Promise<void> {
        this.wss = null;
        this.clients.clear();
    }

    async send(envelope: UME): Promise<void> {
        const action = envelope.context?.routeAction ?? envelope.destination?.address ?? 'broadcast';

        const payload = typeof envelope.body === 'object' && !(envelope.body instanceof Buffer)
            ? JSON.stringify(envelope.body)
            : String(envelope.body);

        if (action === 'broadcast') {
            // Send to all connected clients
            for (const client of this.clients) {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(payload);
                }
            }
        }
    }

    onReceive(handler: MessageHandler): void {
        this.handler = handler;
    }

    async healthCheck(): Promise<HealthStatus> {
        return {
            healthy: this.wss !== null,
            message: this.wss ? `WebSocket server running, ${this.clients.size} clients` : 'Not running',
            details: { port: this.port, clients: this.clients.size },
        };
    }

    async getState(): Promise<SerializableState> {
        return { port: this.port, host: this.host, clientCount: this.clients.size };
    }

    async restoreState(state: SerializableState): Promise<void> {
        this.port = state.port ?? this.port;
        this.host = state.host ?? this.host;
    }

    /**
     * Get the actual port the server is listening on (useful when port=0).
     */
    getPort(): number {
        const addr = this.wss?.address();
        if (addr && typeof addr === 'object') {
            return addr.port;
        }
        return this.port;
    }

    /**
     * Number of connected clients.
     */
    get clientCount(): number {
        return this.clients.size;
    }

    // ── Private ────────────────────────────────────────────────────

    private handleConnection(ws: WebSocket, req: import('http').IncomingMessage): void {
        const clientId = `ws-client-${++this.clientIdCounter}`;
        this.clients.add(ws);

        const source = {
            protocol: 'websocket' as const,
            adapter: this.name,
            address: clientId,
        };

        // Emit connect lifecycle event
        if (this.handler) {
            const connectEvent = createLifecycleEvent({
                source,
                event: LIFECYCLE_EVENTS.CONNECT,
                details: {
                    clientId,
                    remoteAddress: req.socket.remoteAddress,
                    headers: req.headers,
                },
            });
            this.handler(connectEvent);
        }

        // Handle incoming messages
        ws.on('message', async (data, isBinary) => {
            if (!this.handler) return;

            let body: any;
            const raw = data.toString('utf-8');

            try {
                body = JSON.parse(raw);
            } catch {
                body = raw;
            }

            const envelope = createUME({
                source,
                headers: {
                    clientId,
                    isBinary,
                },
                body,
                encoding: typeof body === 'object' ? 'json' : 'text',
                pattern: TransportClass.STREAM,
            });

            await this.handler(envelope);
        });

        // Handle disconnect
        ws.on('close', (code, reason) => {
            this.clients.delete(ws);

            if (this.handler) {
                const disconnectEvent = createLifecycleEvent({
                    source,
                    event: LIFECYCLE_EVENTS.DISCONNECT,
                    details: { clientId, code, reason: reason.toString() },
                });
                this.handler(disconnectEvent);
            }
        });

        // Handle errors
        ws.on('error', (error) => {
            if (this.handler) {
                const errorEvent = createLifecycleEvent({
                    source,
                    event: LIFECYCLE_EVENTS.ERROR,
                    details: { clientId, error: error.message },
                });
                this.handler(errorEvent);
            }
        });
    }
}

// ─── WebSocket Client Adapter ──────────────────────────────────────
// Connects to a remote WebSocket server. Messages from server → UME → engine.
// Auto-reconnects on disconnect.

export interface WebSocketClientAdapterConfig extends AdapterConfig {
    /** Remote WebSocket URL to connect to (e.g. "ws://localhost:3001") */
    url: string;
    /** Auto-reconnect on disconnect. Default: true */
    autoReconnect?: boolean;
    /** Reconnect delay in ms. Default: 2000 */
    reconnectDelay?: number;
    /** Max reconnect attempts. Default: Infinity */
    maxReconnectAttempts?: number;
}

export class WebSocketClientAdapter implements ProtocolAdapter {
    readonly protocol = 'websocket';
    readonly name = 'websocket-client';
    readonly version = '0.1.0';
    readonly capabilities: AdapterCapabilities = {
        supportedClasses: [TransportClass.STREAM],
        supportsClient: true,
        supportsServer: false,
        supportsBinary: true,
        supportsStreaming: true,
    };

    private ws: WebSocket | null = null;
    private url: string = '';
    private autoReconnect: boolean = true;
    private reconnectDelay: number = 2000;
    private maxReconnectAttempts: number = Infinity;
    private reconnectAttempts: number = 0;
    private handler: MessageHandler | null = null;
    private running: boolean = false;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    async initialize(config: AdapterConfig): Promise<void> {
        const clientConfig = config as WebSocketClientAdapterConfig;
        this.url = clientConfig.url;
        this.autoReconnect = clientConfig.autoReconnect ?? true;
        this.reconnectDelay = clientConfig.reconnectDelay ?? 2000;
        this.maxReconnectAttempts = clientConfig.maxReconnectAttempts ?? Infinity;
    }

    async start(): Promise<void> {
        this.running = true;
        await this.connect();
    }

    async stop(): Promise<void> {
        this.running = false;
        this.autoReconnect = false;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.ws) {
            this.ws.close(1000, 'Client stopping');
            this.ws = null;
        }
    }

    async destroy(): Promise<void> {
        this.ws = null;
        this.running = false;
    }

    async send(envelope: UME): Promise<void> {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            throw new Error('WebSocket client not connected');
        }

        const payload = typeof envelope.body === 'object' && !(envelope.body instanceof Buffer)
            ? JSON.stringify(envelope.body)
            : String(envelope.body);

        this.ws.send(payload);
    }

    onReceive(handler: MessageHandler): void {
        this.handler = handler;
    }

    async healthCheck(): Promise<HealthStatus> {
        const connected = this.ws !== null && this.ws.readyState === WebSocket.OPEN;
        return {
            healthy: connected,
            message: connected ? `Connected to ${this.url}` : 'Disconnected',
            details: { url: this.url, reconnectAttempts: this.reconnectAttempts },
        };
    }

    async getState(): Promise<SerializableState> {
        return { url: this.url, reconnectDelay: this.reconnectDelay };
    }

    async restoreState(state: SerializableState): Promise<void> {
        this.url = state.url ?? this.url;
        this.reconnectDelay = state.reconnectDelay ?? this.reconnectDelay;
    }

    /** Whether the client is currently connected */
    get isConnected(): boolean {
        return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
    }

    // ── Private ────────────────────────────────────────────────────

    private connect(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.ws = new WebSocket(this.url);

            const source = {
                protocol: 'websocket' as const,
                adapter: this.name,
                address: this.url,
            };

            this.ws.on('open', () => {
                this.reconnectAttempts = 0;

                if (this.handler) {
                    const connectEvent = createLifecycleEvent({
                        source,
                        event: LIFECYCLE_EVENTS.CONNECT,
                        details: { url: this.url },
                    });
                    this.handler(connectEvent);
                }

                resolve();
            });

            this.ws.on('message', async (data, isBinary) => {
                if (!this.handler) return;

                let body: any;
                const raw = data.toString('utf-8');

                try {
                    body = JSON.parse(raw);
                } catch {
                    body = raw;
                }

                const envelope = createUME({
                    source,
                    headers: { isBinary },
                    body,
                    encoding: typeof body === 'object' ? 'json' : 'text',
                    pattern: TransportClass.STREAM,
                });

                await this.handler(envelope);
            });

            this.ws.on('close', (code, reason) => {
                if (this.handler) {
                    const disconnectEvent = createLifecycleEvent({
                        source,
                        event: LIFECYCLE_EVENTS.DISCONNECT,
                        details: { code, reason: reason.toString(), url: this.url },
                    });
                    this.handler(disconnectEvent);
                }

                // Auto-reconnect
                if (this.running && this.autoReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
                    this.reconnectAttempts++;
                    this.reconnectTimer = setTimeout(() => {
                        this.connect().catch(() => { });
                    }, this.reconnectDelay);
                }
            });

            this.ws.on('error', (error) => {
                if (this.handler) {
                    const errorEvent = createLifecycleEvent({
                        source,
                        event: LIFECYCLE_EVENTS.ERROR,
                        details: { error: error.message, url: this.url },
                    });
                    this.handler(errorEvent);
                }

                // Only reject on initial connection, not reconnects
                if (this.reconnectAttempts === 0 && !this.running) {
                    reject(error);
                }
            });
        });
    }
}
