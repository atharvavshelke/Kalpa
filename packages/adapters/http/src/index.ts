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
import { TransportClass, createUME } from '@kalpa/core';

// ─── HTTP Server Adapter ───────────────────────────────────────────
// Converts incoming HTTP requests → UME (REQUEST_RESPONSE pattern)
// and sends outgoing UME → HTTP responses.

export interface HttpAdapterConfig extends AdapterConfig {
    port?: number;
    host?: string;
}

export class HttpAdapter implements ProtocolAdapter {
    readonly protocol = 'http';
    readonly name = 'http';
    readonly version = '0.1.0';
    readonly capabilities: AdapterCapabilities = {
        supportedClasses: [TransportClass.REQUEST_RESPONSE],
        supportsClient: false,
        supportsServer: true,
        supportsBinary: true,
        supportsStreaming: false,
    };

    private server: http.Server | null = null;
    private port: number = 3000;
    private host: string = '0.0.0.0';
    private handler: MessageHandler | null = null;
    /** Map of pending request-response correlations: replyTo ID → http.ServerResponse */
    private pendingResponses: Map<string, http.ServerResponse> = new Map();

    async initialize(config: AdapterConfig): Promise<void> {
        const httpConfig = config as HttpAdapterConfig;
        this.port = httpConfig.port ?? 3000;
        this.host = httpConfig.host ?? '0.0.0.0';
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
        return new Promise<void>((resolve) => {
            if (this.server) {
                // Respond to all pending requests
                for (const [id, res] of this.pendingResponses) {
                    if (!res.headersSent) {
                        res.writeHead(503, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Server shutting down' }));
                    }
                    this.pendingResponses.delete(id);
                }
                this.server.close(() => resolve());
            } else {
                resolve();
            }
        });
    }

    async destroy(): Promise<void> {
        this.server = null;
        this.pendingResponses.clear();
    }

    async send(envelope: UME): Promise<void> {
        // For request-response: we look up the pending HTTP response by replyTo
        if (envelope.replyTo && this.pendingResponses.has(envelope.replyTo)) {
            const res = this.pendingResponses.get(envelope.replyTo)!;
            this.pendingResponses.delete(envelope.replyTo);

            const statusCode = (envelope.headers['statusCode'] as number) ?? 200;
            const contentType = (envelope.headers['content-type'] as string) ?? 'application/json';

            res.writeHead(statusCode, { 'Content-Type': contentType });

            if (typeof envelope.body === 'object' && !(envelope.body instanceof Buffer)) {
                res.end(JSON.stringify(envelope.body));
            } else {
                res.end(envelope.body);
            }
            return;
        }

        // If this message was routed TO http but isn't a reply, just ignore
        // (HTTP server adapter can only respond, not initiate in Phase 1)
    }

    onReceive(handler: MessageHandler): void {
        this.handler = handler;
    }

    async healthCheck(): Promise<HealthStatus> {
        return {
            healthy: this.server !== null && this.server.listening,
            message: this.server?.listening ? 'HTTP server listening' : 'HTTP server not running',
            details: { port: this.port, host: this.host },
        };
    }

    async getState(): Promise<SerializableState> {
        return { port: this.port, host: this.host };
    }

    async restoreState(state: SerializableState): Promise<void> {
        this.port = state.port ?? this.port;
        this.host = state.host ?? this.host;
    }

    /**
     * Get the actual port the server is listening on (useful when port=0).
     */
    getPort(): number {
        const addr = this.server?.address();
        if (addr && typeof addr === 'object') {
            return addr.port;
        }
        return this.port;
    }

    // ── Private ────────────────────────────────────────────────────

    private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
        const chunks: Buffer[] = [];

        req.on('data', (chunk: Buffer) => {
            chunks.push(chunk);
        });

        req.on('end', async () => {
            const rawBody = Buffer.concat(chunks);
            let body: any = rawBody;

            // Try to parse JSON
            const contentType = req.headers['content-type'] ?? '';
            if (contentType.includes('application/json')) {
                try {
                    body = JSON.parse(rawBody.toString('utf-8'));
                } catch {
                    body = rawBody.toString('utf-8');
                }
            } else if (contentType.includes('text/')) {
                body = rawBody.toString('utf-8');
            }

            const envelope = createUME({
                source: {
                    protocol: 'http',
                    adapter: this.name,
                    address: req.url ?? '/',
                },
                headers: {
                    method: req.method ?? 'GET',
                    path: req.url ?? '/',
                    httpHeaders: req.headers,
                    'content-type': contentType || 'application/octet-stream',
                },
                body,
                encoding: contentType.includes('json') ? 'json' : 'text',
                pattern: TransportClass.REQUEST_RESPONSE,
            });

            // Store pending response for request-response correlation
            this.pendingResponses.set(envelope.id, res);

            if (this.handler) {
                await this.handler(envelope);
            }

            // If handler did not send a response through the routing system,
            // reply with 202 Accepted after a brief delay (fire-and-forget)
            setTimeout(() => {
                if (this.pendingResponses.has(envelope.id)) {
                    this.pendingResponses.delete(envelope.id);
                    if (!res.headersSent) {
                        res.writeHead(202, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ status: 'accepted', id: envelope.id }));
                    }
                }
            }, 100);
        });

        req.on('error', (err) => {
            if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
    }
}

// ─── HTTP Client Adapter ───────────────────────────────────────────
// Makes outbound HTTP requests. Converts UME → HTTP request, response → UME.

export interface HttpClientAdapterConfig extends AdapterConfig {
    /** Base URL for outbound requests (e.g. "http://api.example.com") */
    baseUrl?: string;
    /** Default headers applied to every outbound request */
    defaultHeaders?: Record<string, string>;
    /** Request timeout in ms */
    timeout?: number;
}

export class HttpClientAdapter implements ProtocolAdapter {
    readonly protocol = 'http';
    readonly name = 'http-client';
    readonly version = '0.1.0';
    readonly capabilities: AdapterCapabilities = {
        supportedClasses: [TransportClass.REQUEST_RESPONSE],
        supportsClient: true,
        supportsServer: false,
        supportsBinary: true,
        supportsStreaming: false,
    };

    private baseUrl: string = '';
    private defaultHeaders: Record<string, string> = {};
    private timeout: number = 30_000;
    private handler: MessageHandler | null = null;
    private running: boolean = false;

    async initialize(config: AdapterConfig): Promise<void> {
        const clientConfig = config as HttpClientAdapterConfig;
        this.baseUrl = clientConfig.baseUrl ?? '';
        this.defaultHeaders = clientConfig.defaultHeaders ?? {};
        this.timeout = clientConfig.timeout ?? 30_000;
    }

    async start(): Promise<void> {
        this.running = true;
    }

    async stop(): Promise<void> {
        this.running = false;
    }

    async destroy(): Promise<void> {
        this.running = false;
    }

    /**
     * Send a UME as an outbound HTTP request.
     * Returns a UME containing the HTTP response.
     */
    async send(envelope: UME): Promise<UME | void> {
        const method = (envelope.headers['method'] as string) ?? 'POST';
        const path = envelope.destination?.address ?? envelope.headers['path'] ?? '/';
        const url = this.baseUrl ? `${this.baseUrl}${path}` : path;

        const headers: Record<string, string> = {
            ...this.defaultHeaders,
        };

        // Set content-type from UME
        const contentType = envelope.headers['content-type'] as string;
        if (contentType) {
            headers['Content-Type'] = contentType;
        } else if (envelope.encoding === 'json') {
            headers['Content-Type'] = 'application/json';
        }

        // Copy any custom headers from the UME
        const umeHeaders = envelope.headers['httpHeaders'] as Record<string, string> | undefined;
        if (umeHeaders) {
            Object.assign(headers, umeHeaders);
        }

        // Build request body
        let requestBody: BodyInit | undefined;
        if (method !== 'GET' && method !== 'HEAD') {
            if (typeof envelope.body === 'object' && !(envelope.body instanceof Buffer) && !(envelope.body instanceof ReadableStream)) {
                requestBody = JSON.stringify(envelope.body);
            } else if (envelope.body instanceof Buffer) {
                requestBody = new Uint8Array(envelope.body);
            } else if (typeof envelope.body === 'string') {
                requestBody = envelope.body;
            }
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        try {
            const response = await fetch(url, {
                method,
                headers,
                body: requestBody,
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            // Parse response body
            const respContentType = response.headers.get('content-type') ?? '';
            let respBody: any;
            let encoding: string = 'text';

            if (respContentType.includes('application/json')) {
                respBody = await response.json();
                encoding = 'json';
            } else if (respContentType.includes('text/')) {
                respBody = await response.text();
                encoding = 'text';
            } else {
                const arrayBuf = await response.arrayBuffer();
                respBody = Buffer.from(arrayBuf);
                encoding = 'binary';
            }

            // Build response headers
            const respHeaders: Record<string, string> = {};
            response.headers.forEach((value, key) => {
                respHeaders[key] = value;
            });

            const responseUME = createUME({
                source: {
                    protocol: 'http',
                    adapter: this.name,
                    address: url,
                },
                headers: {
                    statusCode: response.status,
                    statusText: response.statusText,
                    httpHeaders: respHeaders,
                    'content-type': respContentType,
                },
                body: respBody,
                encoding,
                pattern: TransportClass.REQUEST_RESPONSE,
                replyTo: envelope.id,
                context: {
                    ...envelope.context,
                    requestId: envelope.id,
                },
            });

            // Push response into engine via handler
            if (this.handler) {
                await this.handler(responseUME);
            }

            return responseUME;
        } catch (err) {
            clearTimeout(timeoutId);
            throw err;
        }
    }

    onReceive(handler: MessageHandler): void {
        this.handler = handler;
    }

    async healthCheck(): Promise<HealthStatus> {
        return {
            healthy: this.running,
            message: this.running ? 'HTTP client ready' : 'HTTP client not running',
            details: { baseUrl: this.baseUrl },
        };
    }

    async getState(): Promise<SerializableState> {
        return { baseUrl: this.baseUrl, timeout: this.timeout };
    }

    async restoreState(state: SerializableState): Promise<void> {
        this.baseUrl = state.baseUrl ?? this.baseUrl;
        this.timeout = state.timeout ?? this.timeout;
    }
}
