import { createUME } from './ume.js';
import type { UME, UMESource } from './ume.js';
import { TransportClass } from './transport.js';

// ─── Lifecycle Event Constants ─────────────────────────────────────

export const LIFECYCLE_EVENTS = {
    CONNECT: 'kalpa:connect',
    DISCONNECT: 'kalpa:disconnect',
    ERROR: 'kalpa:error',
} as const;

export type LifecycleEventType = typeof LIFECYCLE_EVENTS[keyof typeof LIFECYCLE_EVENTS];

// ─── Lifecycle Event Factory ───────────────────────────────────────

export interface LifecycleEventOptions {
    /** The source adapter that generated this event */
    source: UMESource;
    /** Which lifecycle event */
    event: LifecycleEventType;
    /** Event-specific details (e.g. error message, client info) */
    details?: Record<string, any>;
}

/**
 * Create a UME that represents a system lifecycle event.
 * These flow through the engine like normal messages but are
 * identifiable via the `systemEvent` field.
 */
export function createLifecycleEvent(options: LifecycleEventOptions): UME {
    return createUME({
        source: options.source,
        body: options.details ?? {},
        encoding: 'json',
        pattern: TransportClass.FIRE_AND_FORGET,
        systemEvent: options.event,
        context: {
            lifecycleEvent: true,
            eventType: options.event,
        },
    });
}

/**
 * Check if a UME is a lifecycle event of a specific type.
 */
export function isLifecycleEvent(envelope: UME, event?: LifecycleEventType): boolean {
    if (event) {
        return envelope.systemEvent === event;
    }
    return envelope.systemEvent !== undefined &&
        Object.values(LIFECYCLE_EVENTS).includes(envelope.systemEvent as LifecycleEventType);
}
