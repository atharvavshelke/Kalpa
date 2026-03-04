# Kalpa — Phase 1 Implementation

## Planning
- [x] Review existing implementation plan and task files
- [x] Create detailed implementation plan for Phase 1
- [x] Get user approval on plan

## Phase 1 Implementation

### Project Scaffolding
- [x] Initialize monorepo with npm workspaces + TypeScript
- [x] Set up [tsconfig.base.json](file:///home/privateproperty/Downloads/Kalpa/tsconfig.base.json) and package configs
- [x] Set up build scripts

### Core Types & Interfaces
- [x] [transport.ts](file:///home/privateproperty/Downloads/Kalpa/packages/core/src/transport.ts) — Transport Classes enum + AdapterCapabilities
- [x] [ume.ts](file:///home/privateproperty/Downloads/Kalpa/packages/core/src/ume.ts) — Universal Message Envelope types + factory + helpers
- [x] [adapter.ts](file:///home/privateproperty/Downloads/Kalpa/packages/core/src/adapter.ts) — Protocol Adapter interface
- [x] [errors.ts](file:///home/privateproperty/Downloads/Kalpa/packages/core/src/errors.ts) — Error hierarchy
- [x] [logger.ts](file:///home/privateproperty/Downloads/Kalpa/packages/core/src/logger.ts) — Structured logger
- [x] [lifecycle.ts](file:///home/privateproperty/Downloads/Kalpa/packages/core/src/lifecycle.ts) — Connection lifecycle events

### Core Engine Components
- [x] [registry.ts](file:///home/privateproperty/Downloads/Kalpa/packages/core/src/registry.ts) — Plugin Registry (load/unload)
- [x] [router.ts](file:///home/privateproperty/Downloads/Kalpa/packages/core/src/router.ts) — Pattern-aware message Router
- [x] [transformer.ts](file:///home/privateproperty/Downloads/Kalpa/packages/core/src/transformer.ts) — Stream-aware Transformer Pipeline
- [x] [engine.ts](file:///home/privateproperty/Downloads/Kalpa/packages/core/src/engine.ts) — Engine Orchestrator
- [x] [index.ts](file:///home/privateproperty/Downloads/Kalpa/packages/core/src/index.ts) — Public API exports

### Protocol Adapters
- [x] HTTP server adapter
- [x] WebSocket server adapter

### Example & Integration
- [x] HTTP → WebSocket bridge example

### Verification
- [x] Core unit tests (39 passing)
- [x] Integration test (3 passing — HTTP→WS bridge, lifecycle events)
- [ ] Browser demo test (manual — open [index.html](file:///home/privateproperty/Downloads/Kalpa/examples/http-to-websocket/index.html))

## Phase 2: Validate + Harden

### 2.1 Client-Mode Adapters
- [ ] `HttpClientAdapter` — outbound fetch() → UME
- [ ] `WebSocketClientAdapter` — connect to remote WS, auto-reconnect

### 2.2 TCP/UDP Adapter
- [ ] TCP server + client adapter (binary framing)
- [ ] UDP adapter (fire-and-forget datagrams)

### 2.3 Backpressure
- [ ] `MessageQueue` with overflow strategies
- [ ] `pause()`/`resume()` flow control on adapters
- [ ] `kalpa:backpressure` system event

### 2.4 Tests
- [ ] Client-mode tests
- [ ] TCP/UDP tests
- [ ] Backpressure tests
- [ ] Cross-protocol integration tests
