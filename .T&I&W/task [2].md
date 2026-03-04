# Kalpa (कल्प) — Universal Meta-Protocol Framework

## Planning
- [/] Design core architecture
- [/] Incorporate review feedback (Gemini, ChatGPT, Claude)
- [ ] Get user approval on revised architecture

## Phase 1: Core Engine (Minimal Viable Architecture)
- [ ] Project scaffolding (TypeScript monorepo)
- [ ] Transport Classes (Request/Response, Pub/Sub, Stream, Fire-and-Forget)
- [ ] Universal Message Envelope (UME) — with streaming body support
- [ ] Connection Lifecycle Events (connect/disconnect/error as UME system events)
- [ ] Protocol Adapter Interface + Capability Flags
- [ ] Plugin Registry (load/unload — hot-swap prep, no full hot-swap yet)
- [ ] Router (rule-based, pattern-aware)
- [ ] Transformer Pipeline (stream-aware middleware)
- [ ] Engine Orchestrator
- [ ] HTTP Adapter (server-only)
- [ ] WebSocket Adapter (server-only)
- [ ] **Proof: HTTP → WebSocket bridge working end-to-end**

## Phase 2: Validate + Harden
- [ ] Client-mode for HTTP + WebSocket adapters
- [ ] Hot-swap implementation (Worker threads + cache busting)
- [ ] TCP/UDP raw socket adapter
- [ ] Backpressure handling
- [ ] Unit + integration tests

## Phase 3: Protocol Expansion
- [ ] gRPC adapter
- [ ] GraphQL adapter
- [ ] MQTT adapter
- [ ] Redis Pub/Sub adapter
- [ ] Kafka adapter
- [ ] SSE adapter

## Phase 4: Extended Protocols + Service Mode
- [ ] SMTP/IMAP, FTP/SFTP, DNS, WebRTC, SOAP adapters
- [ ] CLI standalone service
- [ ] YAML/JSON config file support
- [ ] Admin dashboard
- [ ] Docker packaging

## Phase 5: Production Features
- [ ] Protocol auto-detection
- [ ] Load balancing / failover
- [ ] Rate limiting / circuit breaker
- [ ] OpenTelemetry metrics
