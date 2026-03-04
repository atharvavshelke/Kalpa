import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';

const { GrpcServerAdapter, GrpcClientAdapter } = await import('@kalpa/adapter-grpc');

describe('gRPC Server + Client Adapter', () => {
    let server: InstanceType<typeof GrpcServerAdapter>;
    let client: InstanceType<typeof GrpcClientAdapter>;

    it('starts gRPC server and client connects', async () => {
        server = new GrpcServerAdapter();
        await server.initialize({ name: 'grpc-server', port: 0 });
        await server.start();

        const port = server.getPort();
        assert.ok(port > 0);

        client = new GrpcClientAdapter();
        await client.initialize({ name: 'grpc-client', address: `localhost:${port}` });
        await client.start();

        assert.ok(client.isConnected);
    });

    it('sends unary RPC (request-response)', async () => {
        const received: any[] = [];
        server.onReceive(async (envelope) => {
            if (!envelope.systemEvent) {
                received.push(envelope.body);
            }
        });

        const { createUME, TransportClass } = await import('@kalpa/core');
        const response = await client.send(createUME({
            source: { protocol: 'grpc', adapter: 'grpc-client', address: 'rpc' },
            body: { action: 'test', value: 42 },
            encoding: 'json',
            pattern: TransportClass.REQUEST_RESPONSE,
            headers: { topic: 'test-rpc' },
        }));

        assert.ok(response, 'Should return a response UME');
        assert.equal(received.length, 1);
        assert.deepEqual(received[0], { action: 'test', value: 42 });
    });

    it('supports server streaming subscription', async () => {
        const streamReceived: any[] = [];
        client.onReceive(async (envelope) => {
            if (!envelope.systemEvent) {
                streamReceived.push(envelope.body);
            }
        });

        // Client subscribes to stream
        await client.subscribeStream('notifications');

        // Wait a beat for subscription to register
        await new Promise(resolve => setTimeout(resolve, 100));

        // Server pushes a message
        const { createUME, TransportClass } = await import('@kalpa/core');
        await server.send(createUME({
            source: { protocol: 'grpc', adapter: 'grpc-server', address: 'notifications' },
            destination: { protocol: 'grpc', adapter: 'grpc-server', address: 'notifications' },
            body: { event: 'user_joined', name: 'Alice' },
            encoding: 'json',
            pattern: TransportClass.STREAM,
        }));

        // Wait for delivery
        await new Promise(resolve => setTimeout(resolve, 200));

        assert.ok(streamReceived.length >= 1, `Expected stream message, got ${streamReceived.length}`);
        assert.deepEqual(streamReceived[0], { event: 'user_joined', name: 'Alice' });
    });

    after(async () => {
        if (client) await client.stop();
        if (server) await server.stop();
        await client?.destroy();
        await server?.destroy();
    });
});
