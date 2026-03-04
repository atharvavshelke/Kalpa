import { EventEmitter } from 'node:events';
import type { ProtocolAdapter, AdapterConfig } from './adapter.js';
import { RegistryError } from './errors.js';
import { Logger } from './logger.js';

// ─── Plugin Registry ───────────────────────────────────────────────
// Manages adapter lifecycle: register, unregister, list, get.
// Emits events when adapters are added/removed.

export interface RegistryEvents {
    'adapter:registered': (adapter: ProtocolAdapter) => void;
    'adapter:unregistered': (name: string) => void;
}

export class PluginRegistry extends EventEmitter {
    private adapters: Map<string, ProtocolAdapter> = new Map();
    private logger: Logger;

    constructor(logger?: Logger) {
        super();
        this.logger = logger ?? new Logger({ context: { component: 'registry' } });
    }

    /**
     * Register an adapter. Throws if an adapter with the same name already exists.
     */
    async register(adapter: ProtocolAdapter, config?: AdapterConfig): Promise<void> {
        const name = config?.name ?? adapter.protocol;

        if (this.adapters.has(name)) {
            throw new RegistryError(
                `Adapter "${name}" is already registered. Unregister it first or use a different name.`
            );
        }

        await adapter.initialize(config ?? { name });
        this.adapters.set(name, adapter);
        this.logger.info(`Adapter registered: ${name}`, { protocol: adapter.protocol, version: adapter.version });
        this.emit('adapter:registered', adapter);
    }

    /**
     * Unregister an adapter by name. Stops and destroys it.
     */
    async unregister(name: string): Promise<void> {
        const adapter = this.adapters.get(name);
        if (!adapter) {
            throw new RegistryError(`Adapter "${name}" is not registered.`);
        }

        await adapter.stop();
        await adapter.destroy();
        this.adapters.delete(name);
        this.logger.info(`Adapter unregistered: ${name}`);
        this.emit('adapter:unregistered', name);
    }

    /**
     * Get an adapter by name.
     */
    get(name: string): ProtocolAdapter | undefined {
        return this.adapters.get(name);
    }

    /**
     * Get an adapter by protocol name. Returns the first match.
     */
    getByProtocol(protocol: string): ProtocolAdapter | undefined {
        for (const adapter of this.adapters.values()) {
            if (adapter.protocol === protocol) {
                return adapter;
            }
        }
        return undefined;
    }

    /**
     * List all registered adapter names.
     */
    list(): string[] {
        return Array.from(this.adapters.keys());
    }

    /**
     * Get all registered adapters.
     */
    all(): ProtocolAdapter[] {
        return Array.from(this.adapters.values());
    }

    /**
     * Check if an adapter is registered.
     */
    has(name: string): boolean {
        return this.adapters.has(name);
    }

    /**
     * Number of registered adapters.
     */
    get size(): number {
        return this.adapters.size;
    }

    /**
     * Start all registered adapters.
     */
    async startAll(): Promise<void> {
        for (const [name, adapter] of this.adapters) {
            this.logger.info(`Starting adapter: ${name}`);
            await adapter.start();
        }
    }

    /**
     * Stop all registered adapters.
     */
    async stopAll(): Promise<void> {
        for (const [name, adapter] of this.adapters) {
            this.logger.info(`Stopping adapter: ${name}`);
            await adapter.stop();
        }
    }

    /**
     * Destroy all registered adapters (stop + cleanup).
     */
    async destroyAll(): Promise<void> {
        for (const [name, adapter] of this.adapters) {
            this.logger.info(`Destroying adapter: ${name}`);
            await adapter.stop();
            await adapter.destroy();
        }
        this.adapters.clear();
    }

    /**
     * Atomically replace an adapter in the registry.
     * Called by HotSwapManager after the new adapter is initialized and started.
     */
    replaceAdapter(name: string, newAdapter: ProtocolAdapter): void {
        if (!this.adapters.has(name)) {
            throw new RegistryError(`Adapter "${name}" is not registered — cannot replace.`);
        }
        this.adapters.set(name, newAdapter);
        this.logger.info(`Adapter replaced: ${name}`, { protocol: newAdapter.protocol, version: newAdapter.version });
        this.emit('adapter:replaced', newAdapter);
    }
}
