import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { Kalpa } from '../src/engine.js';

// Dynamically import adapters (they depend on @kalpa/core via workspace link)
const { HttpAdapter } = await import('@kalpa/adapter-http');
const { WebSocketAdapter } = await import('@kalpa/adapter-websocket');

// ─── Integration Test: HTTP → WebSocket Bridge ────────────────────

describe('HTTP → WebSocket Bridge (Integration)', () => {
    let kalpa: InstanceType<typeof Kalpa>;
    let httpPort: number;
    let wsPort: number;

    it('sets up Kalpa with HTTP and WebSocket adapters', async () => {
        kalpa = new Kalpa({ logLevel: 'error' });

        const httpAdapter = new HttpAdapter();
        const wsAdapter = new WebSocketAdapter();

        // Use port 0 for random available ports
        await kalpa.register(httpAdapter, { name: 'http', port: 0 });
        await kalpa.register(wsAdapter, { name: 'websocket', port: 0 });

        // Route: HTTP POST /messages → broadcast via WebSocket
        kalpa.route({
            id: 'http-to-ws',
            from: {
                protocol: 'http',
                match: { method: 'POST', path: '/messages' },
            },
            to: {
                protocol: 'websocket',
                action: 'broadcast',
            },
        });

        await kalpa.start();

        // Get actual ports
        httpPort = (httpAdapter as any).getPort();
        wsPort = (wsAdapter as any).getPort();

        assert.ok(kalpa.isRunning);
        assert.ok(httpPort > 0);
        assert.ok(wsPort > 0);
    });

    it('HTTP POST /messages broadcasts to WebSocket clients', async () => {
        // Connect a WebSocket client using the ws package
        const { default: WebSocket } = await import('ws');

        const received: string[] = [];
        const ws = new WebSocket(`ws://localhost:${wsPort}`);

        await new Promise<void>((resolve, reject) => {
            ws.on('open', resolve);
            ws.on('error', reject);
        });

        // Set up message listener
        const messagePromise = new Promise<void>((resolve) => {
            ws.on('message', (data) => {
                received.push(data.toString());
                resolve();
            });
        });

        // Brief delay for the connect lifecycle event to propagate
        await new Promise(resolve => setTimeout(resolve, 50));

        // Send HTTP POST
        const response = await fetch(`http://localhost:${httpPort}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: 'Hello from HTTP!' }),
        });

        assert.ok(response.ok || response.status === 202);

        // Wait for WebSocket to receive the message
        await messagePromise;

        assert.equal(received.length, 1);
        const parsed = JSON.parse(received[0]);
        assert.equal(parsed.text, 'Hello from HTTP!');

        ws.close();
    });

    it('emits lifecycle events on WebSocket connect/disconnect', async () => {
        const events: string[] = [];

        kalpa.on('kalpa:connect', () => events.push('connect'));
        kalpa.on('kalpa:disconnect', () => events.push('disconnect'));

        const { default: WebSocket } = await import('ws');
        const ws = new WebSocket(`ws://localhost:${wsPort}`);

        await new Promise<void>((resolve) => {
            ws.on('open', () => setTimeout(resolve, 50));
        });

        ws.close();

        // Wait for disconnect event to propagate
        await new Promise(resolve => setTimeout(resolve, 100));

        assert.ok(events.includes('connect'), 'Should have received connect event');
        assert.ok(events.includes('disconnect'), 'Should have received disconnect event');
    });

    after(async () => {
        if (kalpa) {
            await kalpa.stop();
            await kalpa.destroy();
        }
    });
});
