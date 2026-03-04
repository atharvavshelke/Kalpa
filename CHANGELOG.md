# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Core routing engine (`@kalpa/core`) with UME standardization.
- Hot-swap capability for zero-downtime adapter reloads.
- Backpressure queueing (`DROP_OLDEST`, `DROP_NEWEST`, `BLOCK`).
- HTTP Server & Client Adapters (`@kalpa/adapter-http`).
- WebSocket Server & Client Adapters (`@kalpa/adapter-websocket`).
- MQTT Client Adapter (`@kalpa/adapter-mqtt`).
- TCP Server & Client Adapters (`@kalpa/adapter-tcp`).
- Universal CLI tool (`@kalpa/cli`) for YAML-driven execution.

### Changed
- Comprehensive documentation added including API references and tutorials.

### Fixed
- TCP chunk buffering under high load configurations.
