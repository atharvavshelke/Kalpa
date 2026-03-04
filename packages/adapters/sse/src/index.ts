import http from 'node:http';
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

// ─── SSE Server Adapter ───────────────────────────────────────────
// Server-Sent Events: HTTP-based one-way streaming (server → client).
// Clients connect via GET, server pushes events.
// No external dependencies — uses Node.js built-in http.

export interface SseAdapterConfig extends AdapterConfig {
    port?: number;
    host?: string;
    /** Path clients connect to for SSE stream. Default: "/events" */
    path?: string;
    /** Interval (ms) for keep-alive comments. Default: 15000 */
    keepAliveInterval?: number;
}

export class SseServerAdapter implements ProtocolAdapter {
    readonly protocol = 'sse';
    readonly name = 'sse';
    readonly version = '0.1.0';
    readonly capabilities: AdapterCapabilities = {
        supportedClasses: [TransportClass.STREAM, TransportClass.PUBLISH_SUBSCRIBE],
        supportsClient: false,
        supportsServer: true,
        supportsBinary: false,
        supportsStreaming: true,
    };

    private server: http.Server | null = null;
    private port: number = 3002;
    private host: string = '0.0.0.0';
    private path: string = '/events';
    private keepAliveInterval: number = 15000;
    private handler: MessageHandler | null = null;
    private clients: Map<string, http.ServerResponse> = new Map();
    private clientIdCounter: number = 0;
    private keepAliveTimers: Map<string, ReturnType<typeof setInterval>> = new Map();

    async initialize(config: AdapterConfig): Promise<void> {
        const sseConfig = config as SseAdapterConfig;
        this.port = sseConfig.port ?? 3002;
        this.host = sseConfig.host ?? '0.0.0.0';
        this.path = sseConfig.path ?? '/events';
        this.keepAliveInterval = sseConfig.keepAliveInterval ?? 15000;
    }

    async start(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.server = http.createServer((req, res) => {
                this.handleRequest(req, res);
            });

            this.server.on('error', reject);
            this.server.listen(this.port, this.host, () => {
                resolve();
            });
        });
    }

    async stop(): Promise<void> {
        // Close all SSE connections
        for (const [clientId, res] of this.clients) {
            res.end();
            const timer = this.keepAliveTimers.get(clientId);
            if (timer) clearInterval(timer);
        }
        this.clients.clear();
        this.keepAliveTimers.clear();

        return new Promise<void>((resolve) => {
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
        this.keepAliveTimers.clear();
    }

    async send(envelope: UME): Promise<void> {
        const eventType = (envelope.headers['eventType'] as string)
            ?? envelope.context?.routeAction
            ?? 'message';

        let data: string;
        if (typeof envelope.body === 'object' && !(envelope.body instanceof Buffer)) {
            data = JSON.stringify(envelope.body);
        } else {
            data = String(envelope.body);
        }

        // Format as SSE: "event: type\ndata: payload\nid: id\n\n"
        const sseMessage = [
            `event: ${eventType}`,
            `data: ${data}`,
            `id: ${envelope.id}`,
            '',
            '',
        ].join('\n');

        // Broadcast to all connected clients
        for (const [clientId, res] of this.clients) {
            if (!res.destroyed) {
                res.write(sseMessage);
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
                ? `SSE server listening, ${this.clients.size} clients`
                : 'Not running',
            details: { port: this.port, clients: this.clients.size, path: this.path },
        };
    }

    async getState(): Promise<SerializableState> {
        return { port: this.port, host: this.host, path: this.path };
    }

    async restoreState(state: SerializableState): Promise<void> {
        this.port = state.port ?? this.port;
        this.host = state.host ?? this.host;
        this.path = state.path ?? this.path;
    }

    getPort(): number {
        const addr = this.server?.address();
        if (addr && typeof addr === 'object') {
            return addr.port;
        }
        return this.port;
    }

    get clientCount(): number {
        return this.clients.size;
    }

    // ── Private ────────────────────────────────────────────────────

    private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
        const url = req.url ?? '/';

        // SSE connection request
        if (req.method === 'GET' && url === this.path) {
            this.handleSseConnection(req, res);
            return;
        }

        // POST to same path → ingest as UME (allows HTTP POST → SSE broadcast)
        if (req.method === 'POST') {
            this.handlePost(req, res);
            return;
        }

        // 404 for everything else
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
    }

    private handleSseConnection(req: http.IncomingMessage, res: http.ServerResponse): void {
        const clientId = `sse-client-${++this.clientIdCounter}`;

        // SSE headers
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
        });

        // Send initial comment
        res.write(': connected\n\n');

        this.clients.set(clientId, res);

        // Keep-alive to prevent proxy timeouts
        const timer = setInterval(() => {
            if (!res.destroyed) {
                res.write(': keepalive\n\n');
            }
        }, this.keepAliveInterval);
        this.keepAliveTimers.set(clientId, timer);

        // Emit connect lifecycle event
        if (this.handler) {
            const connectEvent = createLifecycleEvent({
                source: { protocol: 'sse', adapter: this.name, address: clientId },
                event: LIFECYCLE_EVENTS.CONNECT,
                details: {
                    clientId,
                    remoteAddress: req.socket.remoteAddress,
                },
            });
            this.handler(connectEvent);
        }

        // Handle disconnect
        req.on('close', () => {
            this.clients.delete(clientId);
            clearInterval(timer);
            this.keepAliveTimers.delete(clientId);

            if (this.handler) {
                const disconnectEvent = createLifecycleEvent({
                    source: { protocol: 'sse', adapter: this.name, address: clientId },
                    event: LIFECYCLE_EVENTS.DISCONNECT,
                    details: { clientId },
                });
                this.handler(disconnectEvent);
            }
        });
    }

    private handlePost(req: http.IncomingMessage, res: http.ServerResponse): void {
        const chunks: Buffer[] = [];

        req.on('data', (chunk: Buffer) => {
            chunks.push(chunk);
        });

        req.on('end', async () => {
            const rawBody = Buffer.concat(chunks);
            let body: any;

            const contentType = req.headers['content-type'] ?? '';
            if (contentType.includes('application/json')) {
                try {
                    body = JSON.parse(rawBody.toString('utf-8'));
                } catch {
                    body = rawBody.toString('utf-8');
                }
            } else {
                body = rawBody.toString('utf-8');
            }

            const envelope = createUME({
                source: {
                    protocol: 'sse',
                    adapter: this.name,
                    address: req.url ?? '/',
                },
                headers: {
                    method: 'POST',
                    path: req.url ?? '/',
                    'content-type': contentType || 'text/plain',
                },
                body,
                encoding: typeof body === 'object' ? 'json' : 'text',
                pattern: TransportClass.STREAM,
            });

            if (this.handler) {
                await this.handler(envelope);
            }

            res.writeHead(202, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'accepted', id: envelope.id }));
        });
    }
}
