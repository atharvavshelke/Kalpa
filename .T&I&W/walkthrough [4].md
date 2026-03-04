# Kalpa — Complete Walkthrough

## Architecture
```
adapter → UME → global transform → route → per-route transform → deliver
                                                              ↕
                                               drain queue (during hot-swap)
```

## Protocol Coverage — 8 Adapters

| Protocol | Mode | Transport Classes | External Deps |
|---|---|---|---|
| **HTTP** | Server + Client | REQUEST_RESPONSE | None |
| **WebSocket** | Server + Client | STREAM, PUBLISH_SUBSCRIBE | `ws` |
| **TCP** | Server + Client | STREAM, FIRE_AND_FORGET | None |
| **UDP** | Both | FIRE_AND_FORGET | None |
| **SSE** | Server | STREAM, PUBLISH_SUBSCRIBE | None |
| **MQTT** | Client | PUBLISH_SUBSCRIBE, FIRE_AND_FORGET | `mqtt` |
| **gRPC** | Server + Client | REQUEST_RESPONSE, STREAM | `@grpc/grpc-js` |

## Core Features

- **UME** — Universal message format: JSON, text, binary, ReadableStream
- **Transport classes** — Compatibility matrix prevents impossible routes
- **Router** — Pattern-aware, glob matching, fan-out, priority ordering
- **Transformer** — Middleware pipeline, per-route transforms
- **Backpressure** — MessageQueue with DROP_OLDEST / DROP_NEWEST / BLOCK
- **Hot-swap** — `engine.replace()` zero-downtime adapter replacement with drain queue
- **Lifecycle events** — connect/disconnect/error flow as UME through the engine

## Test Results — 66/66 ✅

```
Core + Backpressure:     47 ✅
Hot-Swap:                 5 ✅
TCP/UDP:                  4 ✅
Integration (HTTP→WS):    3 ✅
SSE:                      4 ✅
gRPC:                     3 ✅
```

## Run

```bash
cd /home/privateproperty/Downloads/Kalpa

# All tests
npx tsx --test packages/core/tests/core.test.ts packages/core/tests/backpressure.test.ts packages/core/tests/hotswap.test.ts packages/core/tests/integration.test.ts packages/core/tests/tcp.test.ts
npx tsx --test packages/core/tests/sse.test.ts
npx tsx --test packages/core/tests/grpc.test.ts
```
