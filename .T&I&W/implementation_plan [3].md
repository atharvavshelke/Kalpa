# Kalpa Phase 2 — Validate + Harden

Harden the core abstraction. Add client-mode, TCP/UDP, and backpressure before expanding to more protocols.

## Proposed Changes

### 2.1 Client-Mode Adapters

#### [MODIFY] [index.ts](file:///home/privateproperty/Downloads/Kalpa/packages/adapters/http/src/index.ts)
Add `HttpClientAdapter` alongside existing [HttpAdapter](file:///home/privateproperty/Downloads/Kalpa/packages/adapters/http/src/index.ts#22-208):
- [send(ume)](file:///home/privateproperty/Downloads/Kalpa/packages/core/src/adapter.ts#48-50) → makes outbound `fetch()` call, converts response → UME
- Supports all HTTP methods
- Target URL derived from UME destination address
- Capabilities: `REQUEST_RESPONSE`, `supportsClient: true`

#### [MODIFY] [index.ts](file:///home/privateproperty/Downloads/Kalpa/packages/adapters/websocket/src/index.ts)
Add `WebSocketClientAdapter`:
- Connects to a remote WS server
- Incoming messages from remote server → UME → engine
- [send(ume)](file:///home/privateproperty/Downloads/Kalpa/packages/core/src/adapter.ts#48-50) → sends to remote server
- Auto-reconnect on disconnect
- Capabilities: `STREAM`, `supportsClient: true`

---

### 2.2 TCP/UDP Adapter

#### [NEW] TCP adapter (`packages/adapters/tcp/`)
- `TcpServerAdapter`: listens on a TCP port, converts raw binary streams → UME
- `TcpClientAdapter`: connects to remote TCP server
- Binary framing: length-prefixed messages (4-byte header + payload)
- Capabilities: `STREAM`, `FIRE_AND_FORGET`, binary support
- Tests fire-and-forget transport class + binary UME body

#### [NEW] UDP adapter (`packages/adapters/udp/`)
- `UdpAdapter`: sends/receives UDP datagrams → UME
- Capabilities: `FIRE_AND_FORGET` only (UDP is connectionless)
- Tests the most constrained transport class

---

### 2.3 Backpressure Handling

#### [MODIFY] [engine.ts](file:///home/privateproperty/Downloads/Kalpa/packages/core/src/engine.ts)
- Add message queue with configurable max size per adapter
- When queue is full: drop oldest, drop newest, or block (configurable)
- Emit `kalpa:backpressure` system event when queue exceeds threshold

#### [NEW] [backpressure.ts](file:///home/privateproperty/Downloads/Kalpa/packages/core/src/backpressure.ts)
- `MessageQueue` class: bounded queue with overflow strategies
- `BackpressureStrategy` enum: `DROP_OLDEST`, `DROP_NEWEST`, `BLOCK`
- Pause/resume support for streaming adapters

#### [MODIFY] [adapter.ts](file:///home/privateproperty/Downloads/Kalpa/packages/core/src/adapter.ts)
- Add optional `pause()` / `resume()` to [ProtocolAdapter](file:///home/privateproperty/Downloads/Kalpa/packages/core/src/adapter.ts#25-65) for flow control

---

### 2.4 Tests

#### [NEW] Client-mode tests
- HTTP client: send UME → verify outbound HTTP request is made
- WS client: connect to server, verify bidirectional message flow

#### [NEW] TCP/UDP tests
- TCP: binary message roundtrip, multiple concurrent connections
- UDP: fire-and-forget delivery, transport class enforcement

#### [NEW] Backpressure tests
- Queue full → correct overflow strategy applied
- Pause/resume flow control works
- `kalpa:backpressure` event fires

#### [NEW] Cross-protocol integration tests
- TCP → HTTP bridge
- WS client → WS server relay
- UDP fire-and-forget → log adapter

---

## Verification Plan

```bash
# All tests
cd /home/privateproperty/Downloads/Kalpa
npm test

# Specific
npx tsx --test packages/core/tests/core.test.ts
npx tsx --test packages/core/tests/integration.test.ts
npx tsx --test packages/core/tests/backpressure.test.ts
npx tsx --test packages/core/tests/tcp.test.ts
```
