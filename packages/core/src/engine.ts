import { EventEmitter } from 'node:events';
import type { ProtocolAdapter, AdapterConfig, MessageHandler } from './adapter.js';
import type { UME } from './ume.js';
import type { RouteRule } from './router.js';
import type { TransformFn } from './transformer.js';
import { PluginRegistry } from './registry.js';
import { Router } from './router.js';
import { TransformerPipeline } from './transformer.js';
import { Logger } from './logger.js';
import { isSystemEvent } from './ume.js';
import { AdapterError } from './errors.js';
import { HotSwapManager } from './hotswap.js';
import type { HotSwapResult } from './hotswap.js';

// ─── Engine Orchestrator ───────────────────────────────────────────
// The main entry point. Ties together Registry, Router, Transformer.

export interface KalpaOptions {
    /** Log level */
    logLevel?: 'debug' | 'info' | 'warn' | 'error';
}

export class Kalpa extends EventEmitter {
    private registry: PluginRegistry;
    private router: Router;
    private transformer: TransformerPipeline;
    private logger: Logger;
    private running: boolean = false;
    private hotSwapManager: HotSwapManager;

    constructor(options?: KalpaOptions) {
        super();
        this.logger = new Logger({
            level: options?.logLevel ?? 'info',
            context: { component: 'kalpa' },
        });
        this.registry = new PluginRegistry(this.logger.child({ component: 'registry' }));
        this.router = new Router(this.logger.child({ component: 'router' }));
        this.transformer = new TransformerPipeline(this.logger.child({ component: 'transformer' }));
        this.hotSwapManager = new HotSwapManager(this.logger.child({ component: 'hotswap' }));

        // Forward hot-swap events to engine listeners
        this.hotSwapManager.on('kalpa:hotswap:start', (data) => this.emit('kalpa:hotswap:start', data));
        this.hotSwapManager.on('kalpa:hotswap:complete', (data) => this.emit('kalpa:hotswap:complete', data));
        this.hotSwapManager.on('kalpa:hotswap:error', (data) => this.emit('kalpa:hotswap:error', data));
    }

    // ── Adapter Management ─────────────────────────────────────────

    /**
     * Register a protocol adapter.
     */
    async register(adapter: ProtocolAdapter, config?: AdapterConfig): Promise<void> {
        // Wire up the adapter to push messages into the engine
        adapter.onReceive(this.createIngressHandler(adapter));
        await this.registry.register(adapter, config);
    }

    /**
     * Unregister a protocol adapter by name.
     */
    async unregister(name: string): Promise<void> {
        await this.registry.unregister(name);
    }

    /**
     * Hot-swap: replace a running adapter with a new one.
     * Zero downtime — messages are queued during the swap and flushed after.
     */
    async replace(name: string, newAdapter: ProtocolAdapter, config?: AdapterConfig): Promise<HotSwapResult> {
        const oldAdapter = this.registry.get(name);
        if (!oldAdapter) {
            throw new AdapterError(`Adapter "${name}" is not registered — cannot replace.`, name);
        }

        const adapterConfig: AdapterConfig = config ?? { name };

        return this.hotSwapManager.replace(
            name,
            oldAdapter,
            newAdapter,
            adapterConfig,
            async (swappedAdapter: ProtocolAdapter) => {
                // Wire up the new adapter's message handler
                swappedAdapter.onReceive(this.createIngressHandler(swappedAdapter));
                // Atomically swap in registry
                this.registry.replaceAdapter(name, swappedAdapter);
            },
        );
    }

    // ── Routing ────────────────────────────────────────────────────

    /**
     * Add a routing rule.
     */
    route(rule: RouteRule): void {
        this.router.addRoute(rule);
    }

    // ── Global Transforms ──────────────────────────────────────────

    /**
     * Add a global transform that applies to all messages before routing.
     */
    transform(name: string, fn: TransformFn): void {
        this.transformer.use(name, fn);
    }

    // ── Lifecycle ──────────────────────────────────────────────────

    /**
     * Start the engine and all registered adapters.
     */
    async start(): Promise<void> {
        if (this.running) return;
        this.logger.info('Kalpa starting...');

        await this.registry.startAll();
        this.running = true;

        this.logger.info('Kalpa started', {
            adapters: this.registry.list(),
            routes: this.router.getRoutes().length,
        });
    }

    /**
     * Stop the engine and all registered adapters.
     */
    async stop(): Promise<void> {
        if (!this.running) return;
        this.logger.info('Kalpa stopping...');

        await this.registry.stopAll();
        this.running = false;

        this.logger.info('Kalpa stopped');
    }

    /**
     * Destroy the engine and all adapters.
     */
    async destroy(): Promise<void> {
        await this.registry.destroyAll();
        this.running = false;
        this.removeAllListeners();
        this.logger.info('Kalpa destroyed');
    }

    // ── Accessors ──────────────────────────────────────────────────

    get isRunning(): boolean {
        return this.running;
    }

    getRegistry(): PluginRegistry {
        return this.registry;
    }

    getRouter(): Router {
        return this.router;
    }

    // ── Internal Message Loop ──────────────────────────────────────

    /**
     * Creates an ingress handler for an adapter.
     * This is what connects adapter → engine → router → destination adapter.
     */
    private createIngressHandler(_sourceAdapter: ProtocolAdapter): MessageHandler {
        return async (envelope: UME): Promise<void> => {
            try {
                // 1. Emit system events to listeners (lifecycle events)
                if (isSystemEvent(envelope)) {
                    this.emit(envelope.systemEvent!, envelope);
                    return;
                }

                // 2. Apply global transforms
                let transformed = await this.transformer.execute(envelope);

                // 3. Route to destination(s)
                const routes = this.router.resolve(transformed);

                if (routes.length === 0) {
                    this.logger.debug('No routes matched for message', {
                        id: envelope.id,
                        source: envelope.source.protocol,
                    });
                    return;
                }

                // 4. Deliver to each matched destination (fan-out)
                for (const resolved of routes) {
                    const destAdapterName = resolved.adapterName;

                    // Hot-swap aware: if destination is being swapped, queue the message
                    if (this.hotSwapManager.isSwapping(destAdapterName)) {
                        // Apply per-route transforms before queuing
                        let routeTransformed = transformed;
                        if (resolved.rule.transform && resolved.rule.transform.length > 0) {
                            routeTransformed = await this.transformer.executeList(
                                routeTransformed,
                                resolved.rule.transform,
                            );
                        }
                        routeTransformed = {
                            ...routeTransformed,
                            destination: {
                                protocol: resolved.rule.to.protocol,
                                adapter: destAdapterName,
                                address: resolved.rule.to.action ?? '',
                            },
                            context: {
                                ...routeTransformed.context,
                                routeId: resolved.rule.id,
                                routeAction: resolved.rule.to.action,
                            },
                        };
                        this.hotSwapManager.queueMessage(destAdapterName, routeTransformed);
                        continue;
                    }

                    const destAdapter = this.registry.get(destAdapterName)
                        ?? this.registry.getByProtocol(resolved.rule.to.protocol);

                    if (!destAdapter) {
                        this.logger.warn(`Destination adapter not found: ${destAdapterName}`, {
                            routeId: resolved.rule.id,
                        });
                        continue;
                    }

                    // Apply per-route transforms
                    let routeTransformed = transformed;
                    if (resolved.rule.transform && resolved.rule.transform.length > 0) {
                        routeTransformed = await this.transformer.executeList(
                            routeTransformed,
                            resolved.rule.transform,
                        );
                    }

                    // Attach routing metadata to the UME
                    routeTransformed = {
                        ...routeTransformed,
                        destination: {
                            protocol: resolved.rule.to.protocol,
                            adapter: destAdapterName,
                            address: resolved.rule.to.action ?? '',
                        },
                        context: {
                            ...routeTransformed.context,
                            routeId: resolved.rule.id,
                            routeAction: resolved.rule.to.action,
                        },
                    };

                    // 5. Send to destination adapter
                    await destAdapter.send(routeTransformed);
                }
            } catch (err) {
                this.logger.error('Message processing failed', {
                    messageId: envelope.id,
                    error: err instanceof Error ? err.message : String(err),
                });
                this.emit('error', new AdapterError(
                    `Failed processing message ${envelope.id}: ${err instanceof Error ? err.message : String(err)}`,
                    _sourceAdapter.name,
                ));
            }
        };
    }
}

