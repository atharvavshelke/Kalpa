# Kalpa Phase 1 — Walkthrough

## What Was Built

Kalpa Phase 1: core engine + HTTP adapter + WebSocket adapter + working HTTP→WS bridge.

### Project Structure
```
kalpa/
├── packages/
│   ├── core/src/
│   │   ├── transport.ts     # TransportClass enum + compatibility matrix
│   │   ├── ume.ts           # Universal Message Envelope + factory
│   │   ├── adapter.ts       # ProtocolAdapter interface
│   │   ├── lifecycle.ts     # System events (connect/disconnect/error)
│   │   ├── registry.ts      # Plugin Registry (register/unregister)
│   │   ├── router.ts        # Pattern-aware message routing
│   │   ├── transformer.ts   # Middleware pipeline + header injection
│   │   ├── engine.ts        # Kalpa engine orchestrator
│   │   ├── errors.ts        # Error hierarchy
│   │   ├── logger.ts        # Structured logger
│   │   └── index.ts         # Public API
│   └── adapters/
│       ├── http/src/index.ts       # HTTP server adapter
│       └── websocket/src/index.ts  # WebSocket server adapter
├── examples/
│   └── http-to-websocket/
│       ├── index.ts         # Demo script
│       └── index.html       # Browser client
└── package.json             # Monorepo root
```

### Key Design Highlights

| Feature | Implementation |
|---|---|
| **Transport Classes** | Enum + compatibility matrix enforcing valid routes |
| **UME** | Streaming body support, factory with auto-ID/timestamp |
| **Lifecycle Events** | Wrapped as UME system events, flow through the engine |
| **Message Loop** | adapter → UME → global transform → route → per-route transform → deliver |
| **Fan-out** | One message can match multiple routes → delivered to all |

## Test Results

### Unit Tests — 39/39 ✅
```
✔ UniversalMessageEnvelope (8 tests)
✔ TransportClass (6 tests)
✔ PluginRegistry (7 tests)
✔ Router (7 tests)
✔ TransformerPipeline (5 tests)
✔ Lifecycle Events (3 tests)
✔ Error Hierarchy (3 tests)
```

### Integration Tests — 3/3 ✅
```
✔ sets up Kalpa with HTTP and WebSocket adapters
✔ HTTP POST /messages broadcasts to WebSocket clients
✔ emits lifecycle events on WebSocket connect/disconnect
```

## How to Run

**Tests:**
```bash
cd /home/privateproperty/Downloads/Kalpa
npm test                    # All tests
npm run test:integration    # Integration only
```

**Demo:**
```bash
cd /home/privateproperty/Downloads/Kalpa/examples/http-to-websocket
npx tsx index.ts
# Open index.html in browser, then:
# curl -X POST http://localhost:3000/messages -H "Content-Type: application/json" -d '{"text":"Hello!"}'
```
