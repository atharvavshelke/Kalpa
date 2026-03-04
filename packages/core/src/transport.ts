// ─── Transport Classes ─────────────────────────────────────────────
// Every adapter declares which transport patterns it supports.
// The engine enforces compatibility at routing time.

export enum TransportClass {
    REQUEST_RESPONSE = 'request-response',   // HTTP, gRPC unary
    PUBLISH_SUBSCRIBE = 'pub-sub',           // MQTT, Redis, Kafka
    STREAM = 'stream',                       // WebSocket, gRPC stream, TCP
    FIRE_AND_FORGET = 'fire-and-forget',     // UDP, logging
}

export interface AdapterCapabilities {
    /** Which transport patterns this adapter supports */
    supportedClasses: TransportClass[];
    /** Can act as a client (connect outward) */
    supportsClient: boolean;
    /** Can act as a server (accept connections) */
    supportsServer: boolean;
    /** Can handle binary payloads */
    supportsBinary: boolean;
    /** Can handle streaming bodies (ReadableStream) */
    supportsStreaming: boolean;
    /** Optional max message size in bytes */
    maxMessageSize?: number;
}

// ─── Compatibility Check ───────────────────────────────────────────

/**
 * Check whether a source transport class can route to a destination class.
 * 
 * Rules:
 * - Same class → always compatible
 * - REQUEST_RESPONSE → STREAM: allowed (response can be streamed)
 * - STREAM → REQUEST_RESPONSE: allowed (stream message can trigger a req/res)
 * - FIRE_AND_FORGET → REQUEST_RESPONSE: NOT allowed (no reply channel)
 * - Anything → FIRE_AND_FORGET: allowed (just drop the response)
 * - PUB_SUB ↔ STREAM: allowed (fan-out / fan-in semantics)
 */
const COMPATIBILITY_MATRIX: Record<TransportClass, Set<TransportClass>> = {
    [TransportClass.REQUEST_RESPONSE]: new Set([
        TransportClass.REQUEST_RESPONSE,
        TransportClass.STREAM,
        TransportClass.FIRE_AND_FORGET,
        TransportClass.PUBLISH_SUBSCRIBE,
    ]),
    [TransportClass.PUBLISH_SUBSCRIBE]: new Set([
        TransportClass.PUBLISH_SUBSCRIBE,
        TransportClass.STREAM,
        TransportClass.FIRE_AND_FORGET,
    ]),
    [TransportClass.STREAM]: new Set([
        TransportClass.STREAM,
        TransportClass.REQUEST_RESPONSE,
        TransportClass.FIRE_AND_FORGET,
        TransportClass.PUBLISH_SUBSCRIBE,
    ]),
    [TransportClass.FIRE_AND_FORGET]: new Set([
        TransportClass.FIRE_AND_FORGET,
    ]),
};

/**
 * Returns true if `from` transport class can route to `to` transport class.
 */
export function isTransportCompatible(
    from: TransportClass,
    to: TransportClass
): boolean {
    return COMPATIBILITY_MATRIX[from]?.has(to) ?? false;
}

/**
 * Returns true if the source adapter capabilities are compatible with
 * the destination adapter capabilities (at least one overlapping route exists).
 */
export function areAdaptersCompatible(
    source: AdapterCapabilities,
    destination: AdapterCapabilities
): boolean {
    for (const fromClass of source.supportedClasses) {
        for (const toClass of destination.supportedClasses) {
            if (isTransportCompatible(fromClass, toClass)) {
                return true;
            }
        }
    }
    return false;
}
