# Kalpa Phase 3 — Protocol Expansion

Add three high-value protocols that prove Kalpa handles fundamentally different communication patterns.

## Protocol Selection Rationale

| Protocol | Pattern | Why It Matters |
|---|---|---|
| **MQTT** | PUBLISH_SUBSCRIBE | IoT pub/sub, QoS levels, topic-based routing — proves Kalpa handles message brokers |
| **SSE** | STREAM | HTTP-based one-way push — simpler WS alternative, completes the HTTP family |
| **gRPC** | REQUEST_RESPONSE + STREAM | Protobuf encoding, bidirectional streaming, service definitions — proves schema-driven protocols |

## Proposed Changes

### 3.1 MQTT Adapter

#### [NEW] `packages/adapters/mqtt/`
- **Dependency**: `mqtt` npm package
- `MqttAdapter` — connects to an MQTT broker (Mosquitto, HiveMQ, etc.)
- Subscribe to topics → incoming messages → UME → engine
- [send(ume)](file:///home/privateproperty/Downloads/Kalpa/packages/adapters/http/src/index.ts#83-105) → publish to topic (from `destination.address`)
- QoS support via UME headers: `{ qos: 0 | 1 | 2 }`
- Capabilities: `PUBLISH_SUBSCRIBE`, `FIRE_AND_FORGET`
- Topic-based routing maps naturally to Kalpa's path matching

---

### 3.2 SSE Adapter (Server-Sent Events)

#### [NEW] `packages/adapters/sse/`
- **No external deps** — uses Node.js built-in `http`
- `SseServerAdapter` — HTTP server that holds open connections and pushes events
- Clients connect via `GET /events` → connection kept alive
- [send(ume)](file:///home/privateproperty/Downloads/Kalpa/packages/adapters/http/src/index.ts#83-105) → pushes `data:` events to all connected clients
- Capabilities: `STREAM` (server → client only)
- Killer use case: HTTP POST → SSE broadcast (like HTTP→WS but simpler)

---

### 3.3 gRPC Adapter

#### [NEW] `packages/adapters/grpc/`
- **Dependencies**: `@grpc/grpc-js`, `@grpc/proto-loader`
- `GrpcServerAdapter` — hosts a gRPC server with a generic message relay service
- `GrpcClientAdapter` — connects to a remote gRPC server
- Protobuf ↔ UME conversion
- Supports unary RPC (REQUEST_RESPONSE) and server streaming (STREAM)
- Capabilities: `REQUEST_RESPONSE`, `STREAM`

---

## Verification Plan

```bash
npx tsx --test packages/core/tests/mqtt.test.ts
npx tsx --test packages/core/tests/sse.test.ts
npx tsx --test packages/core/tests/grpc.test.ts
```

Tests per adapter:
- Connect / subscribe / publish roundtrip
- UME conversion correctness
- Transport class enforcement
- Integration: cross-protocol bridge (e.g. HTTP POST → MQTT publish)
