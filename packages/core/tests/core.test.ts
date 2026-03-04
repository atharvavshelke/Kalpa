import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
    createUME,
    isSystemEvent,
    cloneUME,
    TransportClass,
    isTransportCompatible,
    areAdaptersCompatible,
    PluginRegistry,
    Router,
    TransformerPipeline,
    headerInjection,
    createLifecycleEvent,
    isLifecycleEvent,
    LIFECYCLE_EVENTS,
    KalpaError,
    AdapterError,
    RoutingError,
    TransformError,
    RegistryError,
    Logger,
} from '../src/index.js';
import type { ProtocolAdapter, AdapterCapabilities, UME } from '../src/index.js';

// ─── Helper: Mock Adapter ──────────────────────────────────────────

function createMockAdapter(overrides: Partial<ProtocolAdapter> = {}): ProtocolAdapter {
    return {
        protocol: 'mock',
        name: 'mock',
        version: '0.1.0',
        capabilities: {
            supportedClasses: [TransportClass.REQUEST_RESPONSE],
            supportsClient: false,
            supportsServer: true,
            supportsBinary: false,
            supportsStreaming: false,
        },
        initialize: async () => { },
        start: async () => { },
        stop: async () => { },
        destroy: async () => { },
        send: async () => { },
        onReceive: () => { },
        healthCheck: async () => ({ healthy: true }),
        getState: async () => ({}),
        restoreState: async () => { },
        ...overrides,
    };
}

// ─── UME Tests ─────────────────────────────────────────────────────

describe('UniversalMessageEnvelope', () => {
    it('createUME generates unique IDs', () => {
        const a = createUME({ source: { protocol: 'test', adapter: 'test', address: '/' } });
        const b = createUME({ source: { protocol: 'test', adapter: 'test', address: '/' } });
        assert.notEqual(a.id, b.id);
    });

    it('createUME sets timestamp', () => {
        const before = Date.now();
        const ume = createUME({ source: { protocol: 'test', adapter: 'test', address: '/' } });
        const after = Date.now();
        assert.ok(ume.timestamp >= before && ume.timestamp <= after);
    });

    it('createUME uses defaults', () => {
        const ume = createUME({ source: { protocol: 'test', adapter: 'test', address: '/' } });
        assert.equal(ume.encoding, 'json');
        assert.equal(ume.pattern, TransportClass.REQUEST_RESPONSE);
        assert.deepEqual(ume.headers, {});
        assert.deepEqual(ume.context, {});
        assert.equal(ume.body, '');
    });

    it('createUME accepts custom values', () => {
        const ume = createUME({
            source: { protocol: 'http', adapter: 'http', address: '/api' },
            body: { hello: 'world' },
            encoding: 'json',
            pattern: TransportClass.STREAM,
            headers: { 'x-test': true },
        });
        assert.equal(ume.source.protocol, 'http');
        assert.deepEqual(ume.body, { hello: 'world' });
        assert.equal(ume.pattern, TransportClass.STREAM);
        assert.equal(ume.headers['x-test'], true);
    });

    it('isSystemEvent returns true for system events', () => {
        const ume = createUME({
            source: { protocol: 'test', adapter: 'test', address: '/' },
            systemEvent: 'kalpa:connect',
        });
        assert.ok(isSystemEvent(ume));
    });

    it('isSystemEvent returns false for regular messages', () => {
        const ume = createUME({ source: { protocol: 'test', adapter: 'test', address: '/' } });
        assert.ok(!isSystemEvent(ume));
    });

    it('cloneUME creates a new ID but preserves content', () => {
        const original = createUME({
            source: { protocol: 'test', adapter: 'test', address: '/' },
            body: { data: 123 },
        });
        const clone = cloneUME(original);
        assert.notEqual(clone.id, original.id);
        assert.deepEqual(clone.body, original.body);
        assert.equal(clone.source.protocol, original.source.protocol);
    });

    it('cloneUME applies overrides', () => {
        const original = createUME({
            source: { protocol: 'test', adapter: 'test', address: '/' },
        });
        const clone = cloneUME(original, { encoding: 'binary' });
        assert.equal(clone.encoding, 'binary');
    });
});

// ─── Transport Tests ───────────────────────────────────────────────

describe('TransportClass', () => {
    it('same class is always compatible', () => {
        for (const tc of Object.values(TransportClass)) {
            assert.ok(isTransportCompatible(tc, tc), `${tc} should be compatible with itself`);
        }
    });

    it('FIRE_AND_FORGET cannot route to REQUEST_RESPONSE', () => {
        assert.ok(!isTransportCompatible(TransportClass.FIRE_AND_FORGET, TransportClass.REQUEST_RESPONSE));
    });

    it('REQUEST_RESPONSE can route to STREAM', () => {
        assert.ok(isTransportCompatible(TransportClass.REQUEST_RESPONSE, TransportClass.STREAM));
    });

    it('STREAM can route to REQUEST_RESPONSE', () => {
        assert.ok(isTransportCompatible(TransportClass.STREAM, TransportClass.REQUEST_RESPONSE));
    });

    it('areAdaptersCompatible checks all class combinations', () => {
        const httpCaps: AdapterCapabilities = {
            supportedClasses: [TransportClass.REQUEST_RESPONSE],
            supportsClient: false, supportsServer: true, supportsBinary: false, supportsStreaming: false,
        };
        const wsCaps: AdapterCapabilities = {
            supportedClasses: [TransportClass.STREAM],
            supportsClient: false, supportsServer: true, supportsBinary: true, supportsStreaming: true,
        };
        assert.ok(areAdaptersCompatible(httpCaps, wsCaps));
    });

    it('areAdaptersCompatible returns false for incompatible adapters', () => {
        const ff: AdapterCapabilities = {
            supportedClasses: [TransportClass.FIRE_AND_FORGET],
            supportsClient: false, supportsServer: true, supportsBinary: false, supportsStreaming: false,
        };
        const rr: AdapterCapabilities = {
            supportedClasses: [TransportClass.REQUEST_RESPONSE],
            supportsClient: false, supportsServer: true, supportsBinary: false, supportsStreaming: false,
        };
        assert.ok(!areAdaptersCompatible(ff, rr));
    });
});

// ─── Registry Tests ────────────────────────────────────────────────

describe('PluginRegistry', () => {
    it('registers and retrieves an adapter', async () => {
        const registry = new PluginRegistry(new Logger({ level: 'error' }));
        const adapter = createMockAdapter();
        await registry.register(adapter, { name: 'test-adapter' });
        assert.ok(registry.has('test-adapter'));
        assert.equal(registry.get('test-adapter'), adapter);
    });

    it('throws on duplicate registration', async () => {
        const registry = new PluginRegistry(new Logger({ level: 'error' }));
        await registry.register(createMockAdapter(), { name: 'dup' });
        await assert.rejects(() => registry.register(createMockAdapter(), { name: 'dup' }), RegistryError);
    });

    it('unregisters an adapter', async () => {
        const registry = new PluginRegistry(new Logger({ level: 'error' }));
        await registry.register(createMockAdapter(), { name: 'removeme' });
        await registry.unregister('removeme');
        assert.ok(!registry.has('removeme'));
    });

    it('throws on unregistering non-existent adapter', async () => {
        const registry = new PluginRegistry(new Logger({ level: 'error' }));
        await assert.rejects(() => registry.unregister('nope'), RegistryError);
    });

    it('lists registered adapters', async () => {
        const registry = new PluginRegistry(new Logger({ level: 'error' }));
        await registry.register(createMockAdapter({ protocol: 'a' }), { name: 'a' });
        await registry.register(createMockAdapter({ protocol: 'b' }), { name: 'b' });
        const list = registry.list();
        assert.ok(list.includes('a'));
        assert.ok(list.includes('b'));
        assert.equal(registry.size, 2);
    });

    it('getByProtocol finds adapter by protocol name', async () => {
        const registry = new PluginRegistry(new Logger({ level: 'error' }));
        const adapter = createMockAdapter({ protocol: 'mqtt' });
        await registry.register(adapter, { name: 'my-mqtt' });
        assert.equal(registry.getByProtocol('mqtt'), adapter);
    });

    it('emits adapter:registered event', async () => {
        const registry = new PluginRegistry(new Logger({ level: 'error' }));
        let emitted = false;
        registry.on('adapter:registered', () => { emitted = true; });
        await registry.register(createMockAdapter(), { name: 'evt-test' });
        assert.ok(emitted);
    });
});

// ─── Router Tests ──────────────────────────────────────────────────

describe('Router', () => {
    it('matches routes by protocol', () => {
        const router = new Router(new Logger({ level: 'error' }));
        router.addRoute({
            from: { protocol: 'http' },
            to: { protocol: 'websocket', action: 'broadcast' },
        });

        const ume = createUME({
            source: { protocol: 'http', adapter: 'http', address: '/test' },
        });
        const resolved = router.resolve(ume);
        assert.equal(resolved.length, 1);
        assert.equal(resolved[0].rule.to.protocol, 'websocket');
    });

    it('matches routes with additional criteria', () => {
        const router = new Router(new Logger({ level: 'error' }));
        router.addRoute({
            from: { protocol: 'http', match: { method: 'POST', path: '/messages' } },
            to: { protocol: 'websocket', action: 'broadcast' },
        });

        const matchUME = createUME({
            source: { protocol: 'http', adapter: 'http', address: '/messages' },
            headers: { method: 'POST', path: '/messages' },
        });
        const noMatchUME = createUME({
            source: { protocol: 'http', adapter: 'http', address: '/other' },
            headers: { method: 'GET', path: '/other' },
        });

        assert.equal(router.resolve(matchUME).length, 1);
        assert.equal(router.resolve(noMatchUME).length, 0);
    });

    it('supports fan-out (multiple matching routes)', () => {
        const router = new Router(new Logger({ level: 'error' }));
        router.addRoute({ from: { protocol: 'http' }, to: { protocol: 'ws1' } });
        router.addRoute({ from: { protocol: 'http' }, to: { protocol: 'ws2' } });

        const ume = createUME({
            source: { protocol: 'http', adapter: 'http', address: '/' },
        });
        assert.equal(router.resolve(ume).length, 2);
    });

    it('respects priority ordering', () => {
        const router = new Router(new Logger({ level: 'error' }));
        router.addRoute({ id: 'low', from: { protocol: 'http' }, to: { protocol: 'a' }, priority: 1 });
        router.addRoute({ id: 'high', from: { protocol: 'http' }, to: { protocol: 'b' }, priority: 10 });

        const ume = createUME({ source: { protocol: 'http', adapter: 'http', address: '/' } });
        const resolved = router.resolve(ume);
        assert.equal(resolved[0].rule.id, 'high');
    });

    it('validates transport class compatibility', () => {
        const router = new Router(new Logger({ level: 'error' }));
        assert.throws(
            () => router.validateTransportCompatibility(TransportClass.FIRE_AND_FORGET, TransportClass.REQUEST_RESPONSE),
            RoutingError,
        );
    });

    it('supports glob matching in paths', () => {
        const router = new Router(new Logger({ level: 'error' }));
        router.addRoute({
            from: { protocol: 'http', match: { path: '/api/*' } },
            to: { protocol: 'grpc' },
        });

        const match = createUME({
            source: { protocol: 'http', adapter: 'http', address: '/api/users' },
            headers: { path: '/api/users' },
        });
        const noMatch = createUME({
            source: { protocol: 'http', adapter: 'http', address: '/health' },
            headers: { path: '/health' },
        });

        assert.equal(router.resolve(match).length, 1);
        assert.equal(router.resolve(noMatch).length, 0);
    });

    it('removes routes by ID', () => {
        const router = new Router(new Logger({ level: 'error' }));
        router.addRoute({ id: 'removable', from: { protocol: 'http' }, to: { protocol: 'ws' } });
        assert.ok(router.removeRoute('removable'));
        assert.equal(router.getRoutes().length, 0);
    });
});

// ─── Transformer Tests ─────────────────────────────────────────────

describe('TransformerPipeline', () => {
    it('executes transforms in order', async () => {
        const pipeline = new TransformerPipeline(new Logger({ level: 'error' }));
        const calls: number[] = [];

        pipeline.use('first', (ume) => { calls.push(1); return ume; });
        pipeline.use('second', (ume) => { calls.push(2); return ume; });

        const ume = createUME({ source: { protocol: 'test', adapter: 'test', address: '/' } });
        await pipeline.execute(ume);
        assert.deepEqual(calls, [1, 2]);
    });

    it('supports async transforms', async () => {
        const pipeline = new TransformerPipeline(new Logger({ level: 'error' }));

        pipeline.use('async-transform', async (ume) => {
            await new Promise(resolve => setTimeout(resolve, 10));
            return { ...ume, headers: { ...ume.headers, async: true } };
        });

        const ume = createUME({ source: { protocol: 'test', adapter: 'test', address: '/' } });
        const result = await pipeline.execute(ume);
        assert.equal(result.headers.async, true);
    });

    it('headerInjection transform works', async () => {
        const pipeline = new TransformerPipeline(new Logger({ level: 'error' }));
        pipeline.use('inject', headerInjection({ 'x-custom': 'hello', 'x-version': '1.0' }));

        const ume = createUME({ source: { protocol: 'test', adapter: 'test', address: '/' } });
        const result = await pipeline.execute(ume);
        assert.equal(result.headers['x-custom'], 'hello');
        assert.equal(result.headers['x-version'], '1.0');
    });

    it('throws TransformError on failure', async () => {
        const pipeline = new TransformerPipeline(new Logger({ level: 'error' }));
        pipeline.use('bad-transform', () => { throw new Error('boom'); });

        const ume = createUME({ source: { protocol: 'test', adapter: 'test', address: '/' } });
        await assert.rejects(() => pipeline.execute(ume), TransformError);
    });

    it('executeList runs ad-hoc transforms', async () => {
        const pipeline = new TransformerPipeline(new Logger({ level: 'error' }));
        const ume = createUME({ source: { protocol: 'test', adapter: 'test', address: '/' } });

        const result = await pipeline.executeList(ume, [
            (e) => ({ ...e, headers: { ...e.headers, step: 1 } }),
            (e) => ({ ...e, headers: { ...e.headers, step: 2 } }),
        ]);
        assert.equal(result.headers.step, 2);
    });
});

// ─── Lifecycle Tests ───────────────────────────────────────────────

describe('Lifecycle Events', () => {
    it('createLifecycleEvent creates a system UME', () => {
        const event = createLifecycleEvent({
            source: { protocol: 'websocket', adapter: 'ws', address: 'client-1' },
            event: LIFECYCLE_EVENTS.CONNECT,
            details: { clientId: 'client-1' },
        });
        assert.ok(isSystemEvent(event));
        assert.equal(event.systemEvent, 'kalpa:connect');
        assert.equal(event.pattern, TransportClass.FIRE_AND_FORGET);
    });

    it('isLifecycleEvent detects lifecycle events', () => {
        const connect = createLifecycleEvent({
            source: { protocol: 'ws', adapter: 'ws', address: '/' },
            event: LIFECYCLE_EVENTS.CONNECT,
        });
        assert.ok(isLifecycleEvent(connect));
        assert.ok(isLifecycleEvent(connect, LIFECYCLE_EVENTS.CONNECT));
        assert.ok(!isLifecycleEvent(connect, LIFECYCLE_EVENTS.DISCONNECT));
    });

    it('regular UME is not a lifecycle event', () => {
        const ume = createUME({ source: { protocol: 'test', adapter: 'test', address: '/' } });
        assert.ok(!isLifecycleEvent(ume));
    });
});

// ─── Error Tests ───────────────────────────────────────────────────

describe('Error Hierarchy', () => {
    it('KalpaError has code', () => {
        const err = new KalpaError('test', 'TEST_CODE');
        assert.equal(err.code, 'TEST_CODE');
        assert.ok(err instanceof Error);
    });

    it('AdapterError has adapterName', () => {
        const err = new AdapterError('failed', 'http-adapter');
        assert.equal(err.adapterName, 'http-adapter');
        assert.ok(err instanceof KalpaError);
    });

    it('RoutingError has routeId', () => {
        const err = new RoutingError('no match', 'route-1');
        assert.equal(err.routeId, 'route-1');
        assert.ok(err instanceof KalpaError);
    });
});
