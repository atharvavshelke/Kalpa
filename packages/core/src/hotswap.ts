import { EventEmitter } from 'node:events';
import type { ProtocolAdapter, AdapterConfig, SerializableState } from './adapter.js';
import type { UME } from './ume.js';
import { Logger } from './logger.js';

// ─── Hot-Swap Manager ──────────────────────────────────────────────
// Zero-downtime adapter replacement at runtime.
//
// Sequence:
//   1. Old adapter: getState()
//   2. Old adapter enters drain mode (messages queue instead of deliver)
//   3. New adapter: initialize() → restoreState() → start()
//   4. Swap reference in registry
//   5. Flush drain queue through new adapter
//   6. Old adapter: stop() → destroy()

export const HOTSWAP_EVENTS = {
    START: 'kalpa:hotswap:start',
    COMPLETE: 'kalpa:hotswap:complete',
    ERROR: 'kalpa:hotswap:error',
} as const;

export interface HotSwapResult {
    adapterName: string;
    stateTransferred: boolean;
    drainedMessages: number;
    durationMs: number;
}

export class HotSwapManager extends EventEmitter {
    private logger: Logger;
    /** Adapters currently being swapped — messages are queued */
    private swapping: Map<string, UME[]> = new Map();

    constructor(logger?: Logger) {
        super();
        this.logger = logger ?? new Logger({ context: { component: 'hotswap' } });
    }

    /**
     * Returns true if the named adapter is currently being swapped.
     * The engine uses this to queue messages instead of delivering.
     */
    isSwapping(adapterName: string): boolean {
        return this.swapping.has(adapterName);
    }

    /**
     * Queue a message during a swap. Called by the engine when a message
     * is destined for an adapter that's mid-swap.
     */
    queueMessage(adapterName: string, envelope: UME): void {
        const queue = this.swapping.get(adapterName);
        if (queue) {
            queue.push(envelope);
        }
    }

    /**
     * Execute a hot-swap: replace oldAdapter with newAdapter.
     *
     * @param name       - Registry name of the adapter to replace
     * @param oldAdapter - The currently running adapter
     * @param newAdapter - The new adapter to swap in
     * @param config     - Config for the new adapter
     * @param onSwapped  - Callback to atomically swap the adapter in the registry
     */
    async replace(
        name: string,
        oldAdapter: ProtocolAdapter,
        newAdapter: ProtocolAdapter,
        config: AdapterConfig,
        onSwapped: (newAdapter: ProtocolAdapter) => Promise<void>,
    ): Promise<HotSwapResult> {
        const startTime = Date.now();

        this.logger.info(`Hot-swap starting: ${name}`, {
            oldVersion: oldAdapter.version,
            newProtocol: newAdapter.protocol,
        });

        this.emit(HOTSWAP_EVENTS.START, { adapterName: name });

        // 1. Start drain queue — messages for this adapter will be captured
        this.swapping.set(name, []);

        try {
            // 2. Get state from old adapter
            let state: SerializableState = {};
            let stateTransferred = false;
            try {
                state = await oldAdapter.getState();
                stateTransferred = true;
                this.logger.debug(`State captured from old adapter: ${name}`, { stateKeys: Object.keys(state) });
            } catch (err) {
                this.logger.warn(`Failed to get state from old adapter: ${name}`, {
                    error: err instanceof Error ? err.message : String(err),
                });
            }

            // 3. Stop old adapter (drain in-flight messages)
            await oldAdapter.stop();

            // 4. Initialize new adapter
            await newAdapter.initialize(config);

            // 5. Restore state into new adapter
            if (stateTransferred && Object.keys(state).length > 0) {
                try {
                    await newAdapter.restoreState(state);
                    this.logger.debug(`State restored to new adapter: ${name}`);
                } catch (err) {
                    this.logger.warn(`Failed to restore state to new adapter: ${name}`, {
                        error: err instanceof Error ? err.message : String(err),
                    });
                    stateTransferred = false;
                }
            }

            // 6. Start new adapter
            await newAdapter.start();

            // 7. Atomically swap in registry + wire up engine message handler
            await onSwapped(newAdapter);

            // 8. Flush drain queue through new adapter
            const drainQueue = this.swapping.get(name) ?? [];
            this.swapping.delete(name); // Stop capturing

            for (const envelope of drainQueue) {
                try {
                    await newAdapter.send(envelope);
                } catch (err) {
                    this.logger.warn(`Failed to deliver drained message: ${envelope.id}`, {
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
            }

            // 9. Destroy old adapter
            await oldAdapter.destroy();

            const result: HotSwapResult = {
                adapterName: name,
                stateTransferred,
                drainedMessages: drainQueue.length,
                durationMs: Date.now() - startTime,
            };

            this.logger.info(`Hot-swap complete: ${name}`, result);
            this.emit(HOTSWAP_EVENTS.COMPLETE, result);

            return result;

        } catch (err) {
            // Swap failed — remove drain queue, old adapter may still be running
            this.swapping.delete(name);

            const error = err instanceof Error ? err : new Error(String(err));
            this.logger.error(`Hot-swap failed: ${name}`, { error: error.message });
            this.emit(HOTSWAP_EVENTS.ERROR, { adapterName: name, error });

            throw error;
        }
    }
}
