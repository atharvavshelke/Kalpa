import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import dgram from 'node:dgram';

const { TcpServerAdapter, TcpClientAdapter, UdpAdapter } = await import('@kalpa/adapter-tcp');

// ─── Helper: frame a message (4-byte BE length prefix) ────────────

function frameMessage(data: Buffer): Buffer {
    const header = Buffer.alloc(4);
    header.writeUInt32BE(data.length, 0);
    return Buffer.concat([header, data]);
}

// ─── TCP Tests ────────────────────────────────────────────────────

describe('TCP Server + Client Adapter', () => {
    let server: InstanceType<typeof TcpServerAdapter>;
    let client: InstanceType<typeof TcpClientAdapter>;

    it('establishes connection between server and client', async () => {
        server = new TcpServerAdapter();
        await server.initialize({ name: 'tcp-server', port: 0 });
        await server.start();
        const port = server.getPort();

        client = new TcpClientAdapter();
        await client.initialize({ name: 'tcp-client', host: 'localhost', port, autoReconnect: false });
        await client.start();

        assert.ok(client.isConnected);
    });

    it('sends JSON from client → server', async () => {
        const received: any[] = [];
        server.onReceive(async (envelope) => {
            if (!envelope.systemEvent) {
                received.push(envelope.body);
            }
        });

        const { createUME, TransportClass } = await import('@kalpa/core');
        const ume = createUME({
            source: { protocol: 'tcp', adapter: 'tcp-client', address: 'local' },
            body: { message: 'hello from TCP client' },
            encoding: 'json',
            pattern: TransportClass.STREAM,
        });

        await client.send(ume);

        // Wait for message
        await new Promise(resolve => setTimeout(resolve, 100));

        assert.equal(received.length, 1);
        assert.deepEqual(received[0], { message: 'hello from TCP client' });
    });

    it('sends JSON from server → client (broadcast)', async () => {
        const received: any[] = [];
        client.onReceive(async (envelope) => {
            if (!envelope.systemEvent) {
                received.push(envelope.body);
            }
        });

        const { createUME, TransportClass } = await import('@kalpa/core');
        const ume = createUME({
            source: { protocol: 'tcp', adapter: 'tcp-server', address: 'local' },
            body: { message: 'hello from TCP server' },
            encoding: 'json',
            pattern: TransportClass.STREAM,
            context: { routeAction: 'broadcast' },
        });

        await server.send(ume);

        await new Promise(resolve => setTimeout(resolve, 100));

        assert.equal(received.length, 1);
        assert.deepEqual(received[0], { message: 'hello from TCP server' });
    });

    after(async () => {
        if (client) await client.stop();
        if (server) await server.stop();
        await client?.destroy();
        await server?.destroy();
    });
});

// ─── UDP Tests ────────────────────────────────────────────────────

describe('UDP Adapter', () => {
    let sender: InstanceType<typeof UdpAdapter>;
    let receiver: InstanceType<typeof UdpAdapter>;

    it('sends and receives fire-and-forget datagrams', async () => {
        receiver = new UdpAdapter();
        await receiver.initialize({ name: 'udp-receiver', port: 0 });
        await receiver.start();
        const receiverPort = receiver.getPort();

        sender = new UdpAdapter();
        await sender.initialize({ name: 'udp-sender', port: 0, remoteHost: '127.0.0.1', remotePort: receiverPort });
        await sender.start();

        const received: any[] = [];
        receiver.onReceive(async (envelope) => {
            received.push(envelope.body);
        });

        const { createUME, TransportClass } = await import('@kalpa/core');
        const ume = createUME({
            source: { protocol: 'udp', adapter: 'udp-sender', address: 'local' },
            body: { data: 'fire and forget' },
            encoding: 'json',
            pattern: TransportClass.FIRE_AND_FORGET,
        });

        await sender.send(ume);

        // Wait for datagram to arrive
        await new Promise(resolve => setTimeout(resolve, 100));

        assert.equal(received.length, 1);
        assert.deepEqual(received[0], { data: 'fire and forget' });
    });

    after(async () => {
        if (sender) await sender.stop();
        if (receiver) await receiver.stop();
        await sender?.destroy();
        await receiver?.destroy();
    });
});
