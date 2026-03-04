# Kalpa — Walkthrough (Phase 1 + 2)

## What's Built

| Component | Status | Files |
|---|---|---|
| **Core Engine** | ✅ | [engine.ts](file:///home/privateproperty/Downloads/Kalpa/packages/core/src/engine.ts), [ume.ts](file:///home/privateproperty/Downloads/Kalpa/packages/core/src/ume.ts), [transport.ts](file:///home/privateproperty/Downloads/Kalpa/packages/core/src/transport.ts), [adapter.ts](file:///home/privateproperty/Downloads/Kalpa/packages/core/src/adapter.ts), [registry.ts](file:///home/privateproperty/Downloads/Kalpa/packages/core/src/registry.ts), [router.ts](file:///home/privateproperty/Downloads/Kalpa/packages/core/src/router.ts), [transformer.ts](file:///home/privateproperty/Downloads/Kalpa/packages/core/src/transformer.ts), [lifecycle.ts](file:///home/privateproperty/Downloads/Kalpa/packages/core/src/lifecycle.ts), [backpressure.ts](file:///home/privateproperty/Downloads/Kalpa/packages/core/src/backpressure.ts), [errors.ts](file:///home/privateproperty/Downloads/Kalpa/packages/core/src/errors.ts), [logger.ts](file:///home/privateproperty/Downloads/Kalpa/packages/core/src/logger.ts) |
| **HTTP Adapter** | ✅ Server + Client | [packages/adapters/http/src/index.ts](file:///home/privateproperty/Downloads/Kalpa/packages/adapters/http/src/index.ts) |
| **WebSocket Adapter** | ✅ Server + Client | [packages/adapters/websocket/src/index.ts](file:///home/privateproperty/Downloads/Kalpa/packages/adapters/websocket/src/index.ts) |
| **TCP Adapter** | ✅ Server + Client | [packages/adapters/tcp/src/index.ts](file:///home/privateproperty/Downloads/Kalpa/packages/adapters/tcp/src/index.ts) |
| **UDP Adapter** | ✅ | [packages/adapters/tcp/src/index.ts](file:///home/privateproperty/Downloads/Kalpa/packages/adapters/tcp/src/index.ts) |
| **Backpressure** | ✅ | [packages/core/src/backpressure.ts](file:///home/privateproperty/Downloads/Kalpa/packages/core/src/backpressure.ts) |
| **Example** | ✅ | `examples/http-to-websocket/` |

## Phase 2 Additions

- **`HttpClientAdapter`** — outbound `fetch()` with JSON/text/binary, configurable base URL, timeout, default headers
- **`WebSocketClientAdapter`** — connects to remote WS server, auto-reconnect with configurable delay/max retries
- **`TcpServerAdapter` + `TcpClientAdapter`** — length-prefixed binary framing (4-byte header), auto-reconnect, lifecycle events
- **`UdpAdapter`** — fire-and-forget datagrams via `dgram`, both send/receive
- **`MessageQueue`** — bounded queue with 3 overflow strategies: `DROP_OLDEST`, `DROP_NEWEST`, `BLOCK`. Pause/resume, backpressure events, metrics (`totalEnqueued`, `totalDropped`)

## Test Results — 54/54 ✅

```
Core + Backpressure:  47 tests ✅ (238ms)
TCP/UDP:               4 tests ✅ (501ms)
Integration (HTTP→WS): 3 tests ✅ (586ms)
```

## How to Run

```bash
cd /home/privateproperty/Downloads/Kalpa
npm test                                                  # All core + backpressure
npx tsx --test packages/core/tests/tcp.test.ts            # TCP/UDP
npx tsx --test packages/core/tests/integration.test.ts    # HTTP→WS bridge
```
