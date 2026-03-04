import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Kalpa, createUME, TransportClass, HOTSWAP_EVENTS } from '../src/index.js';
import type { ProtocolAdapter, AdapterConfig, HealthStatus, SerializableState, MessageHandler, UME, AdapterCapabilities } from '../src/index.js';

// ─── Mock Adapter ──────────────────────────────────────────────────
// A simple in-memory adapter for testing hot-swap without real network I/O.

function createMockAdapter(name: string, version: string = '1.0.0'): ProtocolAdapter & {
    sent: UME[];
    state: Record<string, any>;
    started: boolean;
    stopped: boolean;
    destroyed: boolean;
} {
    const adapter = {
        protocol: 'mock',
        name,
        version,
        capabilities: {
            supportedClasses: [TransportClass.STREAM, TransportClass.FIRE_AND_FORGET],
            supportsClient: false,
            supportsServer: true,
            supportsBinary: false,
            supportsStreaming: false,
        } as AdapterCapabilities,

        handler: null as MessageHandler | null,
        sent: [] as UME[],
        state: {} as Record<string, any>,
        started: false,
        stopped: false,
        destroyed: false,

        async initialize(config: AdapterConfig) {
            adapter.state = { ...config };
        },
        async start() {
            adapter.started = true;
            adapter.stopped = false;
        },
        async stop() {
            adapter.stopped = true;
            adapter.started = false;
        },
        async destroy() {
            adapter.destroyed = true;
        },
        async send(envelope: UME) {
            adapter.sent.push(envelope);
        },
        onReceive(handler: MessageHandler) {
            adapter.handler = handler;
        },
        async healthCheck(): Promise<HealthStatus> {
            return { healthy: adapter.started, message: adapter.started ? 'OK' : 'Stopped' };
        },
        async getState(): Promise<SerializableState> {
            return { ...adapter.state, customData: 'preserved' };
        },
        async restoreState(state: SerializableState) {
            adapter.state = { ...state };
        },
    };
    return adapter;
}

// ─── Tests ─────────────────────────────────────────────────────────

describe('Hot-Swap', () => {
    let engine: Kalpa;

    after(async () => {
        if (engine) {
            await engine.stop();
            await engine.destroy();
        }
    });

    it('replaces a running adapter with a new one', async () => {
        engine = new Kalpa({ logLevel: 'error' });
        const oldAdapter = createMockAdapter('mock-v1', '1.0.0');
        const newAdapter = createMockAdapter('mock-v2', '2.0.0');

        await engine.register(oldAdapter, { name: 'mock' });
        await engine.start();

        assert.ok(oldAdapter.started);

        const result = await engine.replace('mock', newAdapter, { name: 'mock' });

        assert.equal(result.adapterName, 'mock');
        assert.ok(result.stateTransferred);
        assert.ok(newAdapter.started);
        assert.ok(oldAdapter.stopped || oldAdapter.destroyed);

        // New adapter should be in registry
        const current = engine.getRegistry().get('mock');
        assert.equal(current, newAdapter);
    });

    it('transfers state from old adapter to new adapter', async () => {
        engine = new Kalpa({ logLevel: 'error' });
        const oldAdapter = createMockAdapter('mock-v1', '1.0.0');
        const newAdapter = createMockAdapter('mock-v2', '2.0.0');

        await engine.register(oldAdapter, { name: 'stateful', port: 8080, host: 'localhost' });
        await engine.start();

        await engine.replace('stateful', newAdapter, { name: 'stateful' });

        // New adapter should have received state from old
        assert.equal(newAdapter.state.customData, 'preserved');
    });

    it('emits hotswap lifecycle events', async () => {
        engine = new Kalpa({ logLevel: 'error' });
        const oldAdapter = createMockAdapter('mock-v1', '1.0.0');
        const newAdapter = createMockAdapter('mock-v2', '2.0.0');

        await engine.register(oldAdapter, { name: 'evented' });
        await engine.start();

        const events: string[] = [];
        engine.on('kalpa:hotswap:start', () => events.push('start'));
        engine.on('kalpa:hotswap:complete', () => events.push('complete'));

        await engine.replace('evented', newAdapter, { name: 'evented' });

        assert.deepEqual(events, ['start', 'complete']);
    });

    it('queues messages during swap and flushes them to new adapter', async () => {
        engine = new Kalpa({ logLevel: 'error' });

        // Source adapter that generates messages
        const sourceAdapter = createMockAdapter('src', '1.0.0');
        // Target adapter (will be swapped)
        const oldTarget = createMockAdapter('target-v1', '1.0.0');
        const newTarget = createMockAdapter('target-v2', '2.0.0');

        await engine.register(sourceAdapter, { name: 'source' });
        await engine.register(oldTarget, { name: 'target' });

        engine.route({
            id: 'drain-test',
            from: { protocol: 'mock' },
            to: { protocol: 'mock', adapter: 'target', action: 'deliver' },
        });

        await engine.start();

        // Start the swap — this puts the target in drain mode.
        // We need to send messages while swap is in progress.
        // To test this, we'll make the new adapter's start() take some time.
        const originalStart = newTarget.start.bind(newTarget);
        newTarget.start = async () => {
            // While new adapter is starting, send messages through system
            if (sourceAdapter.handler) {
                const msg = createUME({
                    source: { protocol: 'mock', adapter: 'source', address: '/' },
                    body: { text: 'during-swap' },
                    pattern: TransportClass.STREAM,
                });
                await sourceAdapter.handler(msg);
            }
            await originalStart();
        };

        const result = await engine.replace('target', newTarget, { name: 'target' });

        // The message sent during swap should have been drained to new adapter
        assert.ok(result.drainedMessages >= 1, `Expected drained messages >= 1, got ${result.drainedMessages}`);
        assert.ok(newTarget.sent.length >= 1, `Expected new target to receive >= 1 message, got ${newTarget.sent.length}`);
        assert.equal((newTarget.sent[0].body as any).text, 'during-swap');
    });

    it('throws on replacing non-existent adapter', async () => {
        engine = new Kalpa({ logLevel: 'error' });
        await engine.start();

        const newAdapter = createMockAdapter('mock-v2', '2.0.0');
        await assert.rejects(
            () => engine.replace('nonexistent', newAdapter),
            /not registered/,
        );
    });
});
