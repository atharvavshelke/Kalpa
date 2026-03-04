import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
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

// ─── gRPC Adapter ─────────────────────────────────────────────────
// Uses a generic KalpaRelay service definition to forward messages.
// Supports unary RPC (REQUEST_RESPONSE) and server streaming (STREAM).

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROTO_PATH = path.join(__dirname, 'kalpa.proto');

// Load proto definition
function loadProto() {
    const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
    });
    return grpc.loadPackageDefinition(packageDefinition);
}

// ─── gRPC Server Adapter ──────────────────────────────────────────

export interface GrpcServerAdapterConfig extends AdapterConfig {
    port?: number;
    host?: string;
}

export class GrpcServerAdapter implements ProtocolAdapter {
    readonly protocol = 'grpc';
    readonly name = 'grpc-server';
    readonly version = '0.1.0';
    readonly capabilities: AdapterCapabilities = {
        supportedClasses: [TransportClass.REQUEST_RESPONSE, TransportClass.STREAM],
        supportsClient: false,
        supportsServer: true,
        supportsBinary: true,
        supportsStreaming: true,
    };

    private server: grpc.Server | null = null;
    private port: number = 50051;
    private host: string = '0.0.0.0';
    private handler: MessageHandler | null = null;
    /** Active server-streaming calls indexed by subscription topic */
    private streamSubscribers: Map<string, grpc.ServerWritableStream<any, any>[]> = new Map();

    async initialize(config: AdapterConfig): Promise<void> {
        const grpcConfig = config as GrpcServerAdapterConfig;
        this.port = grpcConfig.port ?? 50051;
        this.host = grpcConfig.host ?? '0.0.0.0';
    }

    async start(): Promise<void> {
        const proto: any = loadProto();
        const kalpaService = proto.kalpa.KalpaRelay.service;

        this.server = new grpc.Server();

        this.server.addService(kalpaService, {
            Send: this.handleUnaryRpc.bind(this),
            Subscribe: this.handleStreamRpc.bind(this),
        });

        return new Promise<void>((resolve, reject) => {
            this.server!.bindAsync(
                `${this.host}:${this.port}`,
                grpc.ServerCredentials.createInsecure(),
                (err, boundPort) => {
                    if (err) return reject(err);
                    this.port = boundPort;
                    resolve();
                },
            );
        });
    }

    async stop(): Promise<void> {
        // Close all streaming subscriptions
        for (const [, streams] of this.streamSubscribers) {
            for (const stream of streams) {
                stream.end();
            }
        }
        this.streamSubscribers.clear();

        return new Promise<void>((resolve) => {
            if (this.server) {
                this.server.tryShutdown(() => resolve());
            } else {
                resolve();
            }
        });
    }

    async destroy(): Promise<void> {
        if (this.server) {
            this.server.forceShutdown();
        }
        this.server = null;
        this.streamSubscribers.clear();
    }

    async send(envelope: UME): Promise<void> {
        // Broadcast to streaming subscribers matching the topic
        const topic = envelope.destination?.address
            ?? (envelope.headers['topic'] as string)
            ?? 'default';

        const message = this.umeToGrpcMessage(envelope, topic);

        // Send to topic-specific subscribers
        const subscribers = this.streamSubscribers.get(topic) ?? [];
        // Also send to wildcard ("*") subscribers
        const wildcardSubs = this.streamSubscribers.get('*') ?? [];

        for (const stream of [...subscribers, ...wildcardSubs]) {
            if (!stream.destroyed) {
                stream.write(message);
            }
        }
    }

    onReceive(handler: MessageHandler): void {
        this.handler = handler;
    }

    async healthCheck(): Promise<HealthStatus> {
        return {
            healthy: this.server !== null,
            message: this.server ? `gRPC server on port ${this.port}` : 'Not running',
            details: { port: this.port },
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
        return this.port;
    }

    // ── Private ────────────────────────────────────────────────────

    private handleUnaryRpc(
        call: grpc.ServerUnaryCall<any, any>,
        callback: grpc.sendUnaryData<any>,
    ): void {
        const msg = call.request;

        let body: any;
        try {
            body = JSON.parse(Buffer.from(msg.payload).toString('utf-8'));
        } catch {
            body = Buffer.from(msg.payload);
        }

        const envelope = createUME({
            source: {
                protocol: 'grpc',
                adapter: this.name,
                address: msg.topic || 'rpc',
            },
            headers: {
                grpcMethod: 'Send',
                topic: msg.topic,
                ...msg.metadata,
            },
            body,
            encoding: typeof body === 'object' && !(body instanceof Buffer) ? 'json' : 'binary',
            pattern: TransportClass.REQUEST_RESPONSE,
        });

        if (this.handler) {
            this.handler(envelope).then(() => {
                callback(null, {
                    id: envelope.id,
                    success: true,
                    payload: Buffer.from(JSON.stringify({ received: true, id: envelope.id })),
                    metadata: {},
                });
            }).catch((err) => {
                callback({
                    code: grpc.status.INTERNAL,
                    message: err instanceof Error ? err.message : String(err),
                });
            });
        } else {
            callback(null, {
                id: msg.id,
                success: true,
                payload: Buffer.from('{}'),
                metadata: {},
            });
        }
    }

    private handleStreamRpc(call: grpc.ServerWritableStream<any, any>): void {
        const msg = call.request;
        const topic = msg.topic || '*';

        // Register subscriber
        if (!this.streamSubscribers.has(topic)) {
            this.streamSubscribers.set(topic, []);
        }
        this.streamSubscribers.get(topic)!.push(call);

        // Emit lifecycle event
        if (this.handler) {
            this.handler(createLifecycleEvent({
                source: { protocol: 'grpc', adapter: this.name, address: topic },
                event: LIFECYCLE_EVENTS.CONNECT,
                details: { topic, method: 'Subscribe' },
            }));
        }

        call.on('cancelled', () => {
            const subs = this.streamSubscribers.get(topic);
            if (subs) {
                const idx = subs.indexOf(call);
                if (idx >= 0) subs.splice(idx, 1);
            }

            if (this.handler) {
                this.handler(createLifecycleEvent({
                    source: { protocol: 'grpc', adapter: this.name, address: topic },
                    event: LIFECYCLE_EVENTS.DISCONNECT,
                    details: { topic },
                }));
            }
        });
    }

    private umeToGrpcMessage(envelope: UME, topic: string): any {
        let payload: Buffer;
        if (envelope.body instanceof Buffer) {
            payload = envelope.body;
        } else if (typeof envelope.body === 'object') {
            payload = Buffer.from(JSON.stringify(envelope.body), 'utf-8');
        } else {
            payload = Buffer.from(String(envelope.body), 'utf-8');
        }

        return {
            id: envelope.id,
            source: envelope.source.adapter,
            topic,
            payload,
            metadata: {},
        };
    }
}

// ─── gRPC Client Adapter ──────────────────────────────────────────

export interface GrpcClientAdapterConfig extends AdapterConfig {
    /** Remote gRPC server address (e.g. "localhost:50051") */
    address: string;
}

export class GrpcClientAdapter implements ProtocolAdapter {
    readonly protocol = 'grpc';
    readonly name = 'grpc-client';
    readonly version = '0.1.0';
    readonly capabilities: AdapterCapabilities = {
        supportedClasses: [TransportClass.REQUEST_RESPONSE, TransportClass.STREAM],
        supportsClient: true,
        supportsServer: false,
        supportsBinary: true,
        supportsStreaming: true,
    };

    private client: any = null;
    private address: string = 'localhost:50051';
    private handler: MessageHandler | null = null;
    private running: boolean = false;

    async initialize(config: AdapterConfig): Promise<void> {
        const grpcConfig = config as GrpcClientAdapterConfig;
        this.address = grpcConfig.address ?? 'localhost:50051';
    }

    async start(): Promise<void> {
        const proto: any = loadProto();
        this.client = new proto.kalpa.KalpaRelay(
            this.address,
            grpc.credentials.createInsecure(),
        );
        this.running = true;
    }

    async stop(): Promise<void> {
        if (this.client) {
            this.client.close();
        }
        this.running = false;
    }

    async destroy(): Promise<void> {
        this.client = null;
        this.running = false;
    }

    /**
     * Send UME as a gRPC unary RPC call.
     */
    async send(envelope: UME): Promise<UME | void> {
        if (!this.client) throw new Error('gRPC client not connected');

        const topic = envelope.destination?.address
            ?? (envelope.headers['topic'] as string)
            ?? 'rpc';

        let payload: Buffer;
        if (envelope.body instanceof Buffer) {
            payload = envelope.body;
        } else if (typeof envelope.body === 'object') {
            payload = Buffer.from(JSON.stringify(envelope.body), 'utf-8');
        } else {
            payload = Buffer.from(String(envelope.body), 'utf-8');
        }

        const request = {
            id: envelope.id,
            source: envelope.source?.adapter ?? this.name,
            topic,
            payload,
            metadata: {},
        };

        return new Promise<UME | void>((resolve, reject) => {
            this.client.Send(request, (err: any, response: any) => {
                if (err) return reject(err);

                let body: any;
                try {
                    body = JSON.parse(Buffer.from(response.payload).toString('utf-8'));
                } catch {
                    body = Buffer.from(response.payload);
                }

                const responseUME = createUME({
                    source: {
                        protocol: 'grpc',
                        adapter: this.name,
                        address: this.address,
                    },
                    headers: {
                        grpcMethod: 'Send',
                        success: response.success,
                        ...response.metadata,
                    },
                    body,
                    encoding: typeof body === 'object' && !(body instanceof Buffer) ? 'json' : 'binary',
                    pattern: TransportClass.REQUEST_RESPONSE,
                    replyTo: envelope.id,
                });

                if (this.handler) {
                    this.handler(responseUME);
                }

                resolve(responseUME);
            });
        });
    }

    /**
     * Subscribe to a server-streaming RPC.
     * Incoming messages → UME → engine.
     */
    async subscribeStream(topic: string = '*'): Promise<void> {
        if (!this.client) throw new Error('gRPC client not connected');

        const request = {
            id: `sub-${Date.now()}`,
            source: this.name,
            topic,
            payload: Buffer.alloc(0),
            metadata: {},
        };

        const stream = this.client.Subscribe(request);

        stream.on('data', (msg: any) => {
            if (!this.handler) return;

            let body: any;
            try {
                body = JSON.parse(Buffer.from(msg.payload).toString('utf-8'));
            } catch {
                body = Buffer.from(msg.payload);
            }

            const envelope = createUME({
                source: {
                    protocol: 'grpc',
                    adapter: this.name,
                    address: msg.topic || topic,
                },
                headers: {
                    grpcMethod: 'Subscribe',
                    topic: msg.topic,
                },
                body,
                encoding: typeof body === 'object' && !(body instanceof Buffer) ? 'json' : 'binary',
                pattern: TransportClass.STREAM,
            });

            this.handler(envelope);
        });

        stream.on('error', (err: any) => {
            if (this.handler && err.code !== grpc.status.CANCELLED) {
                this.handler(createLifecycleEvent({
                    source: { protocol: 'grpc', adapter: this.name, address: this.address },
                    event: LIFECYCLE_EVENTS.ERROR,
                    details: { error: err.message, topic },
                }));
            }
        });
    }

    onReceive(handler: MessageHandler): void {
        this.handler = handler;
    }

    async healthCheck(): Promise<HealthStatus> {
        return {
            healthy: this.running,
            message: this.running ? `Connected to ${this.address}` : 'Disconnected',
            details: { address: this.address },
        };
    }

    async getState(): Promise<SerializableState> {
        return { address: this.address };
    }

    async restoreState(state: SerializableState): Promise<void> {
        this.address = state.address ?? this.address;
    }

    get isConnected(): boolean {
        return this.running && this.client !== null;
    }
}
