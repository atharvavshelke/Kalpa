// ─── Kalpa Core — Public API ───────────────────────────────────────

// Engine
export { Kalpa } from './engine.js';
export type { KalpaOptions } from './engine.js';

// Universal Message Envelope
export { createUME, isSystemEvent, cloneUME } from './ume.js';
export type { UniversalMessageEnvelope, UME, UMESource, UMEDestination, Encoding, CreateUMEOptions } from './ume.js';

// Transport Classes
export { TransportClass, isTransportCompatible, areAdaptersCompatible } from './transport.js';
export type { AdapterCapabilities } from './transport.js';

// Protocol Adapter Interface
export type { ProtocolAdapter, AdapterConfig, HealthStatus, SerializableState, MessageHandler } from './adapter.js';

// Plugin Registry
export { PluginRegistry } from './registry.js';

// Router
export { Router } from './router.js';
export type { RouteRule, RouteSource, RouteDestination, RouteMatchCriteria, ResolvedRoute } from './router.js';

// Transformer
export { TransformerPipeline, headerInjection } from './transformer.js';
export type { TransformFn } from './transformer.js';

// Lifecycle
export { LIFECYCLE_EVENTS, createLifecycleEvent, isLifecycleEvent } from './lifecycle.js';
export type { LifecycleEventType, LifecycleEventOptions } from './lifecycle.js';

// Errors
export { KalpaError, AdapterError, RoutingError, TransformError, RegistryError } from './errors.js';

// Logger
export { Logger } from './logger.js';
export type { LogLevel, LogEntry, LoggerOptions } from './logger.js';

// Backpressure
export { MessageQueue, BackpressureStrategy } from './backpressure.js';
export type { MessageQueueOptions, BackpressureEventHandler } from './backpressure.js';

// Hot-Swap
export { HotSwapManager, HOTSWAP_EVENTS } from './hotswap.js';
export type { HotSwapResult } from './hotswap.js';
