import fs from 'node:fs';
import YAML from 'yaml';
import type { ProtocolAdapter, AdapterConfig } from '@kalpa/core';
import type { TransformFn } from '@kalpa/core';
import { headerInjection } from '@kalpa/core';

// ─── Config Schema ────────────────────────────────────────────────

export interface KalpaConfig {
    /** Log level: debug | info | warn | error */
    logLevel?: 'debug' | 'info' | 'warn' | 'error';

    /** Adapter definitions */
    adapters: Record<string, AdapterDefinition>;

    /** Route definitions */
    routes?: RouteDefinition[];
}

export interface AdapterDefinition {
    /** Adapter type: http-server, http-client, websocket-server, websocket-client,
     *  tcp-server, tcp-client, udp, sse-server, mqtt, grpc-server, grpc-client */
    type: string;
    /** Adapter-specific config (port, host, url, etc.) */
    [key: string]: any;
}

export interface RouteDefinition {
    /** Optional route ID */
    id?: string;
    /** Source matching */
    from: {
        protocol: string;
        adapter?: string;
        match?: Record<string, any>;
    };
    /** Destination */
    to: {
        protocol: string;
        adapter?: string;
        action?: string;
    };
    /** Priority (higher = matched first) */
    priority?: number;
    /** Transform definitions */
    transforms?: TransformDefinition[];
}

export interface TransformDefinition {
    type: string;
    [key: string]: any;
}

// ─── Config Loader ────────────────────────────────────────────────

export function loadConfig(filePath: string): KalpaConfig {
    const raw = fs.readFileSync(filePath, 'utf-8');

    let config: KalpaConfig;
    if (filePath.endsWith('.json')) {
        config = JSON.parse(raw);
    } else {
        config = YAML.parse(raw);
    }

    // Validate
    if (!config.adapters || Object.keys(config.adapters).length === 0) {
        throw new Error('Config must define at least one adapter');
    }

    return config;
}

// ─── Adapter Factory ──────────────────────────────────────────────

export async function createAdapter(
    name: string,
    definition: AdapterDefinition,
): Promise<{ adapter: ProtocolAdapter; config: AdapterConfig }> {
    const { type, ...rest } = definition;
    const config: AdapterConfig = { name, ...rest };

    let adapter: ProtocolAdapter;

    switch (type) {
        case 'http-server': {
            const { HttpAdapter } = await import('@kalpa/adapter-http');
            adapter = new HttpAdapter();
            break;
        }
        case 'http-client': {
            const { HttpClientAdapter } = await import('@kalpa/adapter-http');
            adapter = new HttpClientAdapter();
            break;
        }
        case 'websocket-server': {
            const { WebSocketAdapter } = await import('@kalpa/adapter-websocket');
            adapter = new WebSocketAdapter();
            break;
        }
        case 'websocket-client': {
            const { WebSocketClientAdapter } = await import('@kalpa/adapter-websocket');
            adapter = new WebSocketClientAdapter();
            break;
        }
        case 'tcp-server': {
            const { TcpServerAdapter } = await import('@kalpa/adapter-tcp');
            adapter = new TcpServerAdapter();
            break;
        }
        case 'tcp-client': {
            const { TcpClientAdapter } = await import('@kalpa/adapter-tcp');
            adapter = new TcpClientAdapter();
            break;
        }
        case 'udp': {
            const { UdpAdapter } = await import('@kalpa/adapter-tcp');
            adapter = new UdpAdapter();
            break;
        }
        case 'sse-server': {
            const { SseServerAdapter } = await import('@kalpa/adapter-sse');
            adapter = new SseServerAdapter();
            break;
        }
        case 'mqtt': {
            const { MqttAdapter } = await import('@kalpa/adapter-mqtt');
            adapter = new MqttAdapter();
            break;
        }
        case 'grpc-server': {
            const { GrpcServerAdapter } = await import('@kalpa/adapter-grpc');
            adapter = new GrpcServerAdapter();
            break;
        }
        case 'grpc-client': {
            const { GrpcClientAdapter } = await import('@kalpa/adapter-grpc');
            adapter = new GrpcClientAdapter();
            break;
        }
        default:
            throw new Error(`Unknown adapter type: ${type}`);
    }

    return { adapter, config };
}

// ─── Transform Factory ────────────────────────────────────────────

export function createTransform(definition: TransformDefinition): TransformFn {
    switch (definition.type) {
        case 'inject-header':
        case 'header-injection': {
            const { headers, ...rest } = definition;
            return headerInjection(headers ?? rest);
        }
        default:
            throw new Error(`Unknown transform type: ${definition.type}`);
    }
}
