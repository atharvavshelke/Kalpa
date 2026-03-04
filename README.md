# कल्प Kalpa

**Universal Meta-Protocol Framework** — Bridge any protocol to any protocol.

Kalpa is a programmable protocol router runtime. It connects HTTP, WebSocket, TCP, UDP, SSE, MQTT, and gRPC through a single unified message format (UME) with intelligent routing, backpressure, and zero-downtime hot-swap.

## Quick Start

### As a Library
```typescript
import { Kalpa } from '@kalpa/core';
import { HttpAdapter } from '@kalpa/adapter-http';
import { WebSocketAdapter } from '@kalpa/adapter-websocket';

const kalpa = new Kalpa();

await kalpa.register(new HttpAdapter(), { name: 'http', port: 3000 });
await kalpa.register(new WebSocketAdapter(), { name: 'ws', port: 3001 });

kalpa.route({
  id: 'http-to-ws',
  from: { protocol: 'http', match: { method: 'POST', path: '/messages' } },
  to: { protocol: 'websocket', adapter: 'ws', action: 'broadcast' },
});

await kalpa.start();
```

### From YAML Config
```bash
npx tsx packages/cli/src/cli.ts start --config examples/configs/http-to-ws.yml
```

```yaml
# kalpa.yml
adapters:
  http:
    type: http-server
    port: 3000
  websocket:
    type: websocket-server
    port: 3001

routes:
  - from:
      protocol: http
      match: { method: POST, path: /messages }
    to:
      protocol: websocket
      adapter: websocket
      action: broadcast
```

## Protocol Adapters

| Adapter | Type | Transport Classes |
|---|---|---|
| **HTTP** | Server + Client | REQUEST_RESPONSE |
| **WebSocket** | Server + Client | STREAM, PUBLISH_SUBSCRIBE |
| **TCP** | Server + Client | STREAM, FIRE_AND_FORGET |
| **UDP** | Both | FIRE_AND_FORGET |
| **SSE** | Server | STREAM, PUBLISH_SUBSCRIBE |
| **MQTT** | Client | PUBLISH_SUBSCRIBE, FIRE_AND_FORGET |
| **gRPC** | Server + Client | REQUEST_RESPONSE, STREAM |

## Key Features

### Universal Message Envelope (UME)
Every message is normalized into a protocol-agnostic envelope:
```typescript
{
  id: "uuid",
  timestamp: 1709558400000,
  source: { protocol: "http", adapter: "api", address: "/messages" },
  body: { text: "Hello" },
  headers: { "content-type": "application/json" },
  pattern: "REQUEST_RESPONSE"
}
```

### Transport Class Enforcement
Routes are validated against a compatibility matrix. You can't route a fire-and-forget UDP datagram to a request-response HTTP endpoint.

### Hot-Swap
Replace running adapters with zero downtime:
```typescript
await kalpa.replace('http', newHttpAdapter, { name: 'http', port: 3000 });
// Messages queued during swap → flushed to new adapter
```

### Backpressure
```typescript
import { MessageQueue, BackpressureStrategy } from '@kalpa/core';

const queue = new MessageQueue({
  maxSize: 1000,
  strategy: BackpressureStrategy.DROP_OLDEST, // or DROP_NEWEST, BLOCK
});
```

## Architecture

```
Adapter (HTTP, WS, TCP, ...) 
    → UME 
    → Global Transforms 
    → Router (pattern match, fan-out) 
    → Per-Route Transforms 
    → Destination Adapter
```

## Project Structure

```
packages/
├── core/          Engine, UME, Router, Registry, Backpressure, Hot-Swap
├── cli/           YAML config CLI
├── adapters/
│   ├── http/      HTTP server + client
│   ├── websocket/ WebSocket server + client
│   ├── tcp/       TCP server + client + UDP
│   ├── sse/       Server-Sent Events
│   ├── mqtt/      MQTT pub/sub
│   └── grpc/      gRPC server + client (Protobuf)
└── examples/
    ├── configs/   YAML config examples
    └── http-to-websocket/  Programmatic demo
```

## Tests

```bash
# All tests (66 passing)
npx tsx --test packages/core/tests/core.test.ts packages/core/tests/backpressure.test.ts packages/core/tests/hotswap.test.ts packages/core/tests/integration.test.ts packages/core/tests/tcp.test.ts
npx tsx --test packages/core/tests/sse.test.ts
npx tsx --test packages/core/tests/grpc.test.ts
```

## License

MIT
