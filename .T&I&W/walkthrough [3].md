# Kalpa — Walkthrough

## Architecture

```
adapter → UME → global transform → route → per-route transform → deliver
                                                              ↕
                                               drain queue (during hot-swap)
```

## What's Built

| Component | Files |
|---|---|
| **Core** | [engine.ts](file:///home/privateproperty/Downloads/Kalpa/packages/core/src/engine.ts), [ume.ts](file:///home/privateproperty/Downloads/Kalpa/packages/core/src/ume.ts), [transport.ts](file:///home/privateproperty/Downloads/Kalpa/packages/core/src/transport.ts), [adapter.ts](file:///home/privateproperty/Downloads/Kalpa/packages/core/src/adapter.ts), [registry.ts](file:///home/privateproperty/Downloads/Kalpa/packages/core/src/registry.ts), [router.ts](file:///home/privateproperty/Downloads/Kalpa/packages/core/src/router.ts), [transformer.ts](file:///home/privateproperty/Downloads/Kalpa/packages/core/src/transformer.ts), [lifecycle.ts](file:///home/privateproperty/Downloads/Kalpa/packages/core/src/lifecycle.ts), [backpressure.ts](file:///home/privateproperty/Downloads/Kalpa/packages/core/src/backpressure.ts), [hotswap.ts](file:///home/privateproperty/Downloads/Kalpa/packages/core/src/hotswap.ts), [errors.ts](file:///home/privateproperty/Downloads/Kalpa/packages/core/src/errors.ts), [logger.ts](file:///home/privateproperty/Downloads/Kalpa/packages/core/src/logger.ts) |
| **HTTP** (server + client) | [packages/adapters/http/src/index.ts](file:///home/privateproperty/Downloads/Kalpa/packages/adapters/http/src/index.ts) |
| **WebSocket** (server + client) | [packages/adapters/websocket/src/index.ts](file:///home/privateproperty/Downloads/Kalpa/packages/adapters/websocket/src/index.ts) |
| **TCP** (server + client) | [packages/adapters/tcp/src/index.ts](file:///home/privateproperty/Downloads/Kalpa/packages/adapters/tcp/src/index.ts) |
| **UDP** | [packages/adapters/tcp/src/index.ts](file:///home/privateproperty/Downloads/Kalpa/packages/adapters/tcp/src/index.ts) |
| **Example** | `examples/http-to-websocket/` |

## Key Features

- **5 protocols**: HTTP, WebSocket, TCP, UDP — both server & client modes
- **4 transport classes**: REQUEST_RESPONSE, STREAM, PUBLISH_SUBSCRIBE, FIRE_AND_FORGET
- **Backpressure**: MessageQueue with DROP_OLDEST, DROP_NEWEST, BLOCK strategies
- **Hot-swap**: `engine.replace()` — zero-downtime adapter replacement with drain queue
- **Binary framing**: TCP uses 4-byte length-prefixed frames
- **Auto-reconnect**: WebSocket + TCP client adapters
- **Fan-out routing**: one message → multiple destinations

## Hot-Swap Flow

```
1. engine.replace("http", newHttpAdapter)
2. Old adapter: getState() → capture config/state
3. Drain mode ON — messages queue instead of deliver
4. Old adapter: stop()
5. New adapter: initialize() → restoreState() → start()
6. Atomic swap in registry + re-wire message handler
7. Drain queue flushed through new adapter
8. Old adapter: destroy()
```

## Test Results — 59/59 ✅

```
Core + Backpressure:     47 tests ✅
Hot-Swap:                 5 tests ✅
TCP/UDP:                  4 tests ✅
Integration (HTTP→WS):    3 tests ✅
```

## Run

```bash
cd /home/privateproperty/Downloads/Kalpa
npx tsx --test packages/core/tests/core.test.ts packages/core/tests/backpressure.test.ts
npx tsx --test packages/core/tests/hotswap.test.ts
npx tsx --test packages/core/tests/tcp.test.ts
npx tsx --test packages/core/tests/integration.test.ts
```
