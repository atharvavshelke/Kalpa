import type { UME } from './ume.js';
import type { AdapterCapabilities, TransportClass } from './transport.js';

// ─── Protocol Adapter Interface ────────────────────────────────────
// Every protocol plugin must implement this contract.
// Adapters are the bridge between a specific protocol and Kalpa's UME system.

export interface AdapterConfig {
    /** Adapter instance name (used as identifier in registry) */
    name?: string;
    /** Any adapter-specific configuration */
    [key: string]: any;
}

export interface HealthStatus {
    healthy: boolean;
    message?: string;
    details?: Record<string, any>;
}

export type SerializableState = Record<string, any>;

export type MessageHandler = (envelope: UME) => Promise<void>;

export interface ProtocolAdapter {
    /** Unique protocol name, e.g. "http", "websocket", "mqtt" */
    readonly protocol: string;
    /** Human-readable adapter name */
    readonly name: string;
    /** Adapter version */
    readonly version: string;
    /** Declares what this adapter can do */
    readonly capabilities: AdapterCapabilities;

    // ── Lifecycle ──────────────────────────────────────────────────

    /** Initialize the adapter with configuration */
    initialize(config: AdapterConfig): Promise<void>;
    /** Start accepting/sending messages */
    start(): Promise<void>;
    /** Stop gracefully (drain in-flight messages) */
    stop(): Promise<void>;
    /** Destroy and clean up all resources */
    destroy(): Promise<void>;

    // ── Messaging ──────────────────────────────────────────────────

    /** Send an outgoing UME through this adapter */
    send(envelope: UME): Promise<UME | void>;
    /** Register a handler for incoming messages (adapter → engine) */
    onReceive(handler: MessageHandler): void;

    // ── Health ─────────────────────────────────────────────────────

    /** Check adapter health */
    healthCheck(): Promise<HealthStatus>;

    // ── State (for future hot-swap) ────────────────────────────────

    /** Serialize current state for migration */
    getState(): Promise<SerializableState>;
    /** Restore state from a previous adapter instance */
    restoreState(state: SerializableState): Promise<void>;
}
