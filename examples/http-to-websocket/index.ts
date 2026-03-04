import { Kalpa } from '@kalpa/core';
import { HttpAdapter } from '@kalpa/adapter-http';
import { WebSocketAdapter } from '@kalpa/adapter-websocket';

// ─── Kalpa Phase 1 Demo: HTTP → WebSocket Bridge ──────────────────
// 
// This example starts an HTTP server and a WebSocket server.
// When you POST JSON to http://localhost:3000/messages,
// it broadcasts to all connected WebSocket clients.
//
// Try it:
//   1. Open index.html in a browser (or connect via wscat)
//   2. curl -X POST http://localhost:3000/messages \
//        -H "Content-Type: application/json" \
//        -d '{"text": "Hello from HTTP!"}'
//   3. See the message appear in the browser / wscat

const kalpa = new Kalpa({ logLevel: 'debug' });

// Register adapters
await kalpa.register(
    new HttpAdapter({ port: 3000 }),
    { name: 'http', port: 3000 }
);

await kalpa.register(
    new WebSocketAdapter({ port: 3001 }),
    { name: 'websocket', port: 3001 }
);

// Route: HTTP POST /messages → broadcast to all WebSocket clients
kalpa.route({
    id: 'http-to-ws-broadcast',
    from: {
        protocol: 'http',
        match: { method: 'POST', path: '/messages' },
    },
    to: {
        protocol: 'websocket',
        action: 'broadcast',
    },
    transform: [
        (ume) => ({
            ...ume,
            headers: { ...ume.headers, 'x-routed-by': 'kalpa' },
        }),
    ],
});

// Listen for WebSocket lifecycle events
kalpa.on('kalpa:connect', (event) => {
    const details = event.body as Record<string, any>;
    console.log(`\n🔌 Client connected: ${details.clientId} from ${details.remoteAddress}`);
});

kalpa.on('kalpa:disconnect', (event) => {
    const details = event.body as Record<string, any>;
    console.log(`\n🔌 Client disconnected: ${details.clientId}`);
});

// Start
await kalpa.start();

console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   🔱  Kalpa — HTTP → WebSocket Bridge Demo                    ║
║                                                               ║
║   HTTP Server:      http://localhost:3000                     ║
║   WebSocket Server: ws://localhost:3001                       ║
║                                                               ║
║   Send a message:                                             ║
║   curl -X POST http://localhost:3000/messages \\               ║
║     -H "Content-Type: application/json" \\                     ║
║     -d '{"text": "Hello from HTTP!"}'                         ║
║                                                               ║
║   Open index.html in a browser to see messages live.          ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
`);
