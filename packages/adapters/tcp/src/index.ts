import net from 'node:net';
import dgram from 'node:dgram';
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

// ─── Binary Framing ───────────────────────────────────────────────
// Length-prefixed framing: [4-byte BE length][payload]
// This allows us to reliably delimit messages over a TCP stream.

function frameMessage(data: Buffer): Buffer {
    const header = Buffer.alloc(4);
    header.writeUInt32BE(data.length, 0);
    return Buffer.concat([header, data]);
}

// ─── TCP Server Adapter ───────────────────────────────────────────

export interface TcpAdapterConfig extends AdapterConfig {
    port?: number;
    host?: string;
}

export class TcpServerAdapter implements ProtocolAdapter {
    readonly protocol = 'tcp';
    readonly name = 'tcp-server';
    readonly version = '0.1.0';
    readonly capabilities: AdapterCapabilities = {
        supportedClasses: [TransportClass.STREAM, TransportClass.FIRE_AND_FORGET],
        supportsClient: false,
        supportsServer: true,
        supportsBinary: true,
        supportsStreaming: true,
    };

    private server: net.Server | null = null;
    private port: number = 4000;
    private host: string = '0.0.0.0';
    private handler: MessageHandler | null = null;
    private clients: Map<string, net.Socket> = new Map();
    private clientIdCounter: number = 0;

    async initialize(config: AdapterConfig): Promise<void> {
        const tcpConfig = config as TcpAdapterConfig;
        this.port = tcpConfig.port ?? 4000;
        this.host = tcpConfig.host ?? '0.0.0.0';
    }

    async start(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.server = net.createServer((socket) => {
                this.handleConnection(socket);
            });

            this.server.on('error', reject);
            this.server.listen(this.port, this.host, () => {
                resolve();
            });
        });
    }

    async stop(): Promise<void> {
        return new Promise<void>((resolve) => {
            for (const [, socket] of this.clients) {
                socket.destroy();
            }
            this.clients.clear();
            if (this.server) {
                this.server.close(() => resolve());
            } else {
                resolve();
            }
        });
    }

    async destroy(): Promise<void> {
        this.server = null;
        this.clients.clear();
    }

    async send(envelope: UME): Promise<void> {
        const action = envelope.context?.routeAction ?? envelope.destination?.address ?? 'broadcast';

        let payload: Buffer;
        if (envelope.body instanceof Buffer) {
            payload = envelope.body;
        } else if (typeof envelope.body === 'object') {
            payload = Buffer.from(JSON.stringify(envelope.body), 'utf-8');
        } else {
            payload = Buffer.from(String(envelope.body), 'utf-8');
        }

        const framed = frameMessage(payload);

        if (action === 'broadcast') {
            for (const [, socket] of this.clients) {
                if (!socket.destroyed) {
                    socket.write(framed);
                }
            }
        } else {
            // Send to specific client by ID
            const socket = this.clients.get(action);
            if (socket && !socket.destroyed) {
                socket.write(framed);
            }
        }
    }

    onReceive(handler: MessageHandler): void {
        this.handler = handler;
    }

    async healthCheck(): Promise<HealthStatus> {
        return {
            healthy: this.server !== null && this.server.listening,
            message: this.server?.listening
                ? `TCP server listening, ${this.clients.size} clients`
                : 'Not running',
            details: { port: this.port, clients: this.clients.size },
        };
    }

    async getState(): Promise<SerializableState> {
        return { port: this.port, host: this.host };
    }

    async restoreState(state: SerializableState): Promise<void> {
        this.port = state.port ?? this.port;
        this.host = state.host ?? this.host;
    }

    getPort(): number {
        const addr = this.server?.address();
        if (addr && typeof addr === 'object') {
            return addr.port;
        }
        return this.port;
    }

    // ── Private ────────────────────────────────────────────────────

    private handleConnection(socket: net.Socket): void {
        const clientId = `tcp-client-${++this.clientIdCounter}`;
        this.clients.set(clientId, socket);

        const source = {
            protocol: 'tcp' as const,
            adapter: this.name,
            address: clientId,
        };

        // Emit connect
        if (this.handler) {
            this.handler(createLifecycleEvent({
                source,
                event: LIFECYCLE_EVENTS.CONNECT,
                details: {
                    clientId,
                    remoteAddress: socket.remoteAddress,
                    remotePort: socket.remotePort,
                },
            }));
        }

        // Length-prefixed frame parser
        let buffer = Buffer.alloc(0);

        socket.on('data', async (chunk: Buffer) => {
            if (!this.handler) return;

            buffer = Buffer.concat([buffer, chunk]);

            // Parse complete frames
            while (buffer.length >= 4) {
                const msgLength = buffer.readUInt32BE(0);
                if (buffer.length < 4 + msgLength) break; // Wait for more data

                const payload = buffer.subarray(4, 4 + msgLength);
                buffer = buffer.subarray(4 + msgLength);

                // Try to parse as JSON, fall back to raw buffer
                let body: any = payload;
                let encoding: string = 'binary';
                try {
                    body = JSON.parse(payload.toString('utf-8'));
                    encoding = 'json';
                } catch {
                    // Keep as Buffer
                }

                const envelope = createUME({
                    source,
                    headers: { clientId },
                    body,
                    encoding,
                    pattern: TransportClass.STREAM,
                });

                await this.handler(envelope);
            }
        });

        socket.on('close', () => {
            this.clients.delete(clientId);
            if (this.handler) {
                this.handler(createLifecycleEvent({
                    source,
                    event: LIFECYCLE_EVENTS.DISCONNECT,
                    details: { clientId },
                }));
            }
        });

        socket.on('error', (error) => {
            if (this.handler) {
                this.handler(createLifecycleEvent({
                    source,
                    event: LIFECYCLE_EVENTS.ERROR,
                    details: { clientId, error: error.message },
                }));
            }
        });
    }
}

// ─── TCP Client Adapter ───────────────────────────────────────────

export interface TcpClientAdapterConfig extends AdapterConfig {
    host: string;
    port: number;
    /** Auto-reconnect on disconnect. Default: true */
    autoReconnect?: boolean;
    /** Reconnect delay in ms. Default: 2000 */
    reconnectDelay?: number;
}

export class TcpClientAdapter implements ProtocolAdapter {
    readonly protocol = 'tcp';
    readonly name = 'tcp-client';
    readonly version = '0.1.0';
    readonly capabilities: AdapterCapabilities = {
        supportedClasses: [TransportClass.STREAM, TransportClass.FIRE_AND_FORGET],
        supportsClient: true,
        supportsServer: false,
        supportsBinary: true,
        supportsStreaming: true,
    };

    private socket: net.Socket | null = null;
    private remoteHost: string = 'localhost';
    private remotePort: number = 4000;
    private autoReconnect: boolean = true;
    private reconnectDelay: number = 2000;
    private handler: MessageHandler | null = null;
    private running: boolean = false;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    async initialize(config: AdapterConfig): Promise<void> {
        const tcpConfig = config as TcpClientAdapterConfig;
        this.remoteHost = tcpConfig.host ?? 'localhost';
        this.remotePort = tcpConfig.port ?? 4000;
        this.autoReconnect = tcpConfig.autoReconnect ?? true;
        this.reconnectDelay = tcpConfig.reconnectDelay ?? 2000;
    }

    async start(): Promise<void> {
        this.running = true;
        await this.connect();
    }

    async stop(): Promise<void> {
        this.running = false;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.socket) {
            this.socket.destroy();
            this.socket = null;
        }
    }

    async destroy(): Promise<void> {
        this.socket = null;
        this.running = false;
    }

    async send(envelope: UME): Promise<void> {
        if (!this.socket || this.socket.destroyed) {
            throw new Error('TCP client not connected');
        }

        let payload: Buffer;
        if (envelope.body instanceof Buffer) {
            payload = envelope.body;
        } else if (typeof envelope.body === 'object') {
            payload = Buffer.from(JSON.stringify(envelope.body), 'utf-8');
        } else {
            payload = Buffer.from(String(envelope.body), 'utf-8');
        }

        this.socket.write(frameMessage(payload));
    }

    onReceive(handler: MessageHandler): void {
        this.handler = handler;
    }

    async healthCheck(): Promise<HealthStatus> {
        const connected = this.socket !== null && !this.socket.destroyed;
        return {
            healthy: connected,
            message: connected ? `Connected to ${this.remoteHost}:${this.remotePort}` : 'Disconnected',
        };
    }

    async getState(): Promise<SerializableState> {
        return { host: this.remoteHost, port: this.remotePort };
    }

    async restoreState(state: SerializableState): Promise<void> {
        this.remoteHost = state.host ?? this.remoteHost;
        this.remotePort = state.port ?? this.remotePort;
    }

    get isConnected(): boolean {
        return this.socket !== null && !this.socket.destroyed;
    }

    // ── Private ────────────────────────────────────────────────────

    private connect(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.socket = net.createConnection({
                host: this.remoteHost,
                port: this.remotePort,
            });

            const source = {
                protocol: 'tcp' as const,
                adapter: this.name,
                address: `${this.remoteHost}:${this.remotePort}`,
            };

            this.socket.on('connect', () => {
                if (this.handler) {
                    this.handler(createLifecycleEvent({
                        source,
                        event: LIFECYCLE_EVENTS.CONNECT,
                        details: { host: this.remoteHost, port: this.remotePort },
                    }));
                }
                resolve();
            });

            // Frame parser
            let buffer = Buffer.alloc(0);

            this.socket.on('data', async (chunk: Buffer) => {
                if (!this.handler) return;
                buffer = Buffer.concat([buffer, chunk]);

                while (buffer.length >= 4) {
                    const msgLength = buffer.readUInt32BE(0);
                    if (buffer.length < 4 + msgLength) break;

                    const payload = buffer.subarray(4, 4 + msgLength);
                    buffer = buffer.subarray(4 + msgLength);

                    let body: any = payload;
                    let encoding: string = 'binary';
                    try {
                        body = JSON.parse(payload.toString('utf-8'));
                        encoding = 'json';
                    } catch {
                        // Keep as Buffer
                    }

                    const envelope = createUME({
                        source,
                        headers: {},
                        body,
                        encoding,
                        pattern: TransportClass.STREAM,
                    });

                    await this.handler(envelope);
                }
            });

            this.socket.on('close', () => {
                if (this.handler) {
                    this.handler(createLifecycleEvent({
                        source,
                        event: LIFECYCLE_EVENTS.DISCONNECT,
                        details: { host: this.remoteHost, port: this.remotePort },
                    }));
                }

                if (this.running && this.autoReconnect) {
                    this.reconnectTimer = setTimeout(() => {
                        this.connect().catch(() => { });
                    }, this.reconnectDelay);
                }
            });

            this.socket.on('error', (error) => {
                if (this.handler) {
                    this.handler(createLifecycleEvent({
                        source,
                        event: LIFECYCLE_EVENTS.ERROR,
                        details: { error: error.message },
                    }));
                }
                reject(error);
            });
        });
    }
}

// ─── UDP Adapter ──────────────────────────────────────────────────
// Fire-and-forget datagrams. UDP is connectionless — no streams.

export interface UdpAdapterConfig extends AdapterConfig {
    port?: number;
    host?: string;
    /** Remote host for sending (client mode) */
    remoteHost?: string;
    /** Remote port for sending (client mode) */
    remotePort?: number;
}

export class UdpAdapter implements ProtocolAdapter {
    readonly protocol = 'udp';
    readonly name = 'udp';
    readonly version = '0.1.0';
    readonly capabilities: AdapterCapabilities = {
        supportedClasses: [TransportClass.FIRE_AND_FORGET],
        supportsClient: true,
        supportsServer: true,
        supportsBinary: true,
        supportsStreaming: false,
    };

    private socket: dgram.Socket | null = null;
    private port: number = 5000;
    private host: string = '0.0.0.0';
    private remoteHost: string = '';
    private remotePort: number = 0;
    private handler: MessageHandler | null = null;

    async initialize(config: AdapterConfig): Promise<void> {
        const udpConfig = config as UdpAdapterConfig;
        this.port = udpConfig.port ?? 5000;
        this.host = udpConfig.host ?? '0.0.0.0';
        this.remoteHost = udpConfig.remoteHost ?? '';
        this.remotePort = udpConfig.remotePort ?? 0;
    }

    async start(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.socket = dgram.createSocket('udp4');
            this.socket.on('error', reject);

            this.socket.on('message', async (msg, rinfo) => {
                if (!this.handler) return;

                let body: any = msg;
                let encoding: string = 'binary';
                try {
                    body = JSON.parse(msg.toString('utf-8'));
                    encoding = 'json';
                } catch {
                    // Keep as Buffer
                }

                const envelope = createUME({
                    source: {
                        protocol: 'udp',
                        adapter: this.name,
                        address: `${rinfo.address}:${rinfo.port}`,
                    },
                    headers: {
                        remoteAddress: rinfo.address,
                        remotePort: rinfo.port,
                        size: rinfo.size,
                    },
                    body,
                    encoding,
                    pattern: TransportClass.FIRE_AND_FORGET,
                });

                await this.handler(envelope);
            });

            this.socket.bind(this.port, this.host, () => {
                resolve();
            });
        });
    }

    async stop(): Promise<void> {
        return new Promise<void>((resolve) => {
            if (this.socket) {
                this.socket.close(() => resolve());
            } else {
                resolve();
            }
        });
    }

    async destroy(): Promise<void> {
        this.socket = null;
    }

    async send(envelope: UME): Promise<void> {
        if (!this.socket) {
            throw new Error('UDP socket not initialized');
        }

        const targetHost = envelope.destination?.address?.split(':')[0] ?? this.remoteHost;
        const targetPort = parseInt(envelope.destination?.address?.split(':')[1] ?? '', 10) || this.remotePort;

        if (!targetHost || !targetPort) {
            throw new Error('No target host/port for UDP send');
        }

        let payload: Buffer;
        if (envelope.body instanceof Buffer) {
            payload = envelope.body;
        } else if (typeof envelope.body === 'object') {
            payload = Buffer.from(JSON.stringify(envelope.body), 'utf-8');
        } else {
            payload = Buffer.from(String(envelope.body), 'utf-8');
        }

        return new Promise<void>((resolve, reject) => {
            this.socket!.send(payload, targetPort, targetHost, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    onReceive(handler: MessageHandler): void {
        this.handler = handler;
    }

    async healthCheck(): Promise<HealthStatus> {
        return {
            healthy: this.socket !== null,
            message: this.socket ? 'UDP socket bound' : 'Not initialized',
            details: { port: this.port },
        };
    }

    async getState(): Promise<SerializableState> {
        return { port: this.port, host: this.host, remoteHost: this.remoteHost, remotePort: this.remotePort };
    }

    async restoreState(state: SerializableState): Promise<void> {
        this.port = state.port ?? this.port;
        this.host = state.host ?? this.host;
        this.remoteHost = state.remoteHost ?? this.remoteHost;
        this.remotePort = state.remotePort ?? this.remotePort;
    }

    getPort(): number {
        const addr = this.socket?.address();
        if (addr && typeof addr === 'object') {
            return addr.port;
        }
        return this.port;
    }
}
