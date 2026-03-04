import mqtt from 'mqtt';
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

// ─── MQTT Adapter ─────────────────────────────────────────────────
// Connects to an MQTT broker (Mosquitto, HiveMQ, AWS IoT, etc.)
// Subscribe to topics → messages → UME → engine.
// send(ume) → publish to topic from destination.address.

export interface MqttAdapterConfig extends AdapterConfig {
    /** MQTT broker URL (e.g. "mqtt://localhost:1883") */
    brokerUrl: string;
    /** Topics to subscribe to on connect */
    topics?: string[];
    /** Default QoS level (0, 1, or 2). Default: 0 */
    defaultQos?: 0 | 1 | 2;
    /** Client ID. Auto-generated if not provided */
    clientId?: string;
    /** Username for broker auth */
    username?: string;
    /** Password for broker auth */
    password?: string;
    /** Clean session flag. Default: true */
    cleanSession?: boolean;
}

export class MqttAdapter implements ProtocolAdapter {
    readonly protocol = 'mqtt';
    readonly name = 'mqtt';
    readonly version = '0.1.0';
    readonly capabilities: AdapterCapabilities = {
        supportedClasses: [TransportClass.PUBLISH_SUBSCRIBE, TransportClass.FIRE_AND_FORGET],
        supportsClient: true,
        supportsServer: false,
        supportsBinary: true,
        supportsStreaming: false,
    };

    private client: mqtt.MqttClient | null = null;
    private brokerUrl: string = 'mqtt://localhost:1883';
    private topics: string[] = [];
    private defaultQos: 0 | 1 | 2 = 0;
    private clientId: string = '';
    private username: string = '';
    private password: string = '';
    private cleanSession: boolean = true;
    private handler: MessageHandler | null = null;

    async initialize(config: AdapterConfig): Promise<void> {
        const mqttConfig = config as MqttAdapterConfig;
        this.brokerUrl = mqttConfig.brokerUrl ?? 'mqtt://localhost:1883';
        this.topics = mqttConfig.topics ?? [];
        this.defaultQos = mqttConfig.defaultQos ?? 0;
        this.clientId = mqttConfig.clientId ?? `kalpa-mqtt-${Date.now()}`;
        this.username = mqttConfig.username ?? '';
        this.password = mqttConfig.password ?? '';
        this.cleanSession = mqttConfig.cleanSession ?? true;
    }

    async start(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const opts: mqtt.IClientOptions = {
                clientId: this.clientId,
                clean: this.cleanSession,
            };

            if (this.username) opts.username = this.username;
            if (this.password) opts.password = this.password;

            this.client = mqtt.connect(this.brokerUrl, opts);

            this.client.on('connect', () => {
                // Subscribe to configured topics
                if (this.topics.length > 0 && this.client) {
                    const subMap: Record<string, { qos: 0 | 1 | 2 }> = {};
                    for (const topic of this.topics) {
                        subMap[topic] = { qos: this.defaultQos };
                    }
                    this.client.subscribe(subMap);
                }

                // Emit connect lifecycle event
                if (this.handler) {
                    this.handler(createLifecycleEvent({
                        source: { protocol: 'mqtt', adapter: this.name, address: this.brokerUrl },
                        event: LIFECYCLE_EVENTS.CONNECT,
                        details: { brokerUrl: this.brokerUrl, clientId: this.clientId },
                    }));
                }

                resolve();
            });

            this.client.on('message', (topic, payload, packet) => {
                if (!this.handler) return;

                let body: any;
                let encoding: string = 'binary';

                try {
                    body = JSON.parse(payload.toString('utf-8'));
                    encoding = 'json';
                } catch {
                    // Try as text
                    const text = payload.toString('utf-8');
                    // Check if it looks like text (not random binary)
                    if (/^[\x20-\x7E\s]+$/.test(text)) {
                        body = text;
                        encoding = 'text';
                    } else {
                        body = payload;
                        encoding = 'binary';
                    }
                }

                const envelope = createUME({
                    source: {
                        protocol: 'mqtt',
                        adapter: this.name,
                        address: topic,
                    },
                    headers: {
                        topic,
                        qos: packet.qos,
                        retain: packet.retain,
                        dup: packet.dup,
                        'content-type': encoding === 'json' ? 'application/json' : 'text/plain',
                    },
                    body,
                    encoding,
                    pattern: TransportClass.PUBLISH_SUBSCRIBE,
                });

                this.handler(envelope);
            });

            this.client.on('error', (err) => {
                if (this.handler) {
                    this.handler(createLifecycleEvent({
                        source: { protocol: 'mqtt', adapter: this.name, address: this.brokerUrl },
                        event: LIFECYCLE_EVENTS.ERROR,
                        details: { error: err.message },
                    }));
                }
                reject(err);
            });

            this.client.on('close', () => {
                if (this.handler) {
                    this.handler(createLifecycleEvent({
                        source: { protocol: 'mqtt', adapter: this.name, address: this.brokerUrl },
                        event: LIFECYCLE_EVENTS.DISCONNECT,
                        details: { brokerUrl: this.brokerUrl },
                    }));
                }
            });
        });
    }

    async stop(): Promise<void> {
        return new Promise<void>((resolve) => {
            if (this.client) {
                this.client.end(false, () => resolve());
            } else {
                resolve();
            }
        });
    }

    async destroy(): Promise<void> {
        this.client = null;
    }

    /**
     * Publish a UME to an MQTT topic.
     * Topic is derived from: destination.address > headers.topic > "kalpa/default"
     */
    async send(envelope: UME): Promise<void> {
        if (!this.client || !this.client.connected) {
            throw new Error('MQTT client not connected');
        }

        const topic = envelope.destination?.address
            ?? (envelope.headers['topic'] as string)
            ?? 'kalpa/default';

        const qos = (envelope.headers['qos'] as 0 | 1 | 2) ?? this.defaultQos;
        const retain = (envelope.headers['retain'] as boolean) ?? false;

        let payload: string | Buffer;
        if (typeof envelope.body === 'object' && !(envelope.body instanceof Buffer)) {
            payload = JSON.stringify(envelope.body);
        } else if (envelope.body instanceof Buffer) {
            payload = envelope.body;
        } else {
            payload = String(envelope.body);
        }

        return new Promise<void>((resolve, reject) => {
            this.client!.publish(topic, payload, { qos, retain }, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    /**
     * Subscribe to additional topics at runtime.
     */
    async subscribe(topics: string | string[], qos?: 0 | 1 | 2): Promise<void> {
        if (!this.client) throw new Error('MQTT client not connected');

        const topicList = Array.isArray(topics) ? topics : [topics];
        const q = qos ?? this.defaultQos;

        const subMap: Record<string, { qos: 0 | 1 | 2 }> = {};
        for (const t of topicList) {
            subMap[t] = { qos: q };
            if (!this.topics.includes(t)) this.topics.push(t);
        }

        return new Promise<void>((resolve, reject) => {
            this.client!.subscribe(subMap, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    /**
     * Unsubscribe from topics.
     */
    async unsubscribe(topics: string | string[]): Promise<void> {
        if (!this.client) throw new Error('MQTT client not connected');

        const topicList = Array.isArray(topics) ? topics : [topics];
        this.topics = this.topics.filter(t => !topicList.includes(t));

        return new Promise<void>((resolve, reject) => {
            this.client!.unsubscribe(topicList, (err?: Error) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    onReceive(handler: MessageHandler): void {
        this.handler = handler;
    }

    async healthCheck(): Promise<HealthStatus> {
        const connected = this.client?.connected ?? false;
        return {
            healthy: connected,
            message: connected
                ? `Connected to ${this.brokerUrl}`
                : 'Disconnected',
            details: {
                brokerUrl: this.brokerUrl,
                topics: this.topics,
                clientId: this.clientId,
            },
        };
    }

    async getState(): Promise<SerializableState> {
        return {
            brokerUrl: this.brokerUrl,
            topics: this.topics,
            defaultQos: this.defaultQos,
            clientId: this.clientId,
        };
    }

    async restoreState(state: SerializableState): Promise<void> {
        this.brokerUrl = state.brokerUrl ?? this.brokerUrl;
        this.topics = state.topics ?? this.topics;
        this.defaultQos = state.defaultQos ?? this.defaultQos;
        this.clientId = state.clientId ?? this.clientId;
    }

    get isConnected(): boolean {
        return this.client?.connected ?? false;
    }
}
