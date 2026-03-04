import { randomUUID } from 'node:crypto';
import { TransportClass } from './transport.js';

// ─── Universal Message Envelope ────────────────────────────────────
// Every message flowing through Kalpa is normalized into a UME.
// This is THE canonical internal format — protocol-agnostic.

export interface UMESource {
    /** Protocol name, e.g. "http", "websocket", "mqtt" */
    protocol: string;
    /** Adapter instance identifier */
    adapter: string;
    /** Origin address/topic/channel/path */
    address: string;
}

export interface UMEDestination {
    /** Protocol name */
    protocol: string;
    /** Adapter instance identifier */
    adapter: string;
    /** Destination address/topic/channel/path */
    address: string;
}

export type Encoding = 'json' | 'protobuf' | 'xml' | 'binary' | 'text' | string;

export interface UniversalMessageEnvelope {
    /** Unique message ID */
    id: string;
    /** Unix timestamp in milliseconds */
    timestamp: number;
    /** Where this message came from */
    source: UMESource;
    /** Where this message should go (optional — router may fill this in) */
    destination?: UMEDestination;
    /** Protocol-agnostic metadata (headers, properties, attributes) */
    headers: Record<string, any>;
    /** Payload — supports streaming via ReadableStream */
    body: Buffer | string | object | ReadableStream;
    /** Encoding of the body */
    encoding: Encoding;
    /** Transport pattern for this message */
    pattern: TransportClass;
    /** Arbitrary context: tracing IDs, auth tokens, custom data */
    context: Record<string, any>;
    /** For request-response correlation */
    replyTo?: string;
    /** System lifecycle event type (if this UME represents a lifecycle event) */
    systemEvent?: string;
}

// ─── Shorthand alias ───────────────────────────────────────────────
export type UME = UniversalMessageEnvelope;

// ─── Factory ───────────────────────────────────────────────────────

export interface CreateUMEOptions {
    source: UMESource;
    destination?: UMEDestination;
    headers?: Record<string, any>;
    body?: Buffer | string | object | ReadableStream;
    encoding?: Encoding;
    pattern?: TransportClass;
    context?: Record<string, any>;
    replyTo?: string;
    systemEvent?: string;
}

/**
 * Create a new Universal Message Envelope with sensible defaults.
 */
export function createUME(options: CreateUMEOptions): UME {
    return {
        id: randomUUID(),
        timestamp: Date.now(),
        source: options.source,
        destination: options.destination,
        headers: options.headers ?? {},
        body: options.body ?? '',
        encoding: options.encoding ?? 'json',
        pattern: options.pattern ?? TransportClass.REQUEST_RESPONSE,
        context: options.context ?? {},
        replyTo: options.replyTo,
        systemEvent: options.systemEvent,
    };
}

// ─── Helpers ───────────────────────────────────────────────────────

/**
 * Returns true if this UME represents a system lifecycle event.
 */
export function isSystemEvent(envelope: UME): boolean {
    return envelope.systemEvent !== undefined && envelope.systemEvent !== null;
}

/**
 * Clone a UME, generating a new ID and timestamp.
 * Useful for forwarding/transforming without mutating the original.
 */
export function cloneUME(envelope: UME, overrides?: Partial<UME>): UME {
    return {
        ...envelope,
        id: randomUUID(),
        timestamp: Date.now(),
        ...overrides,
    };
}
