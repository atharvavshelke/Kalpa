# Kalpa API Reference

The Kalpa programmatic API allows you to embed the framework directly into your Node.js or TypeScript application, offering full control over adapters, routes, and lifecycle events.

## Installation

```bash
npm install @kalpa/core @kalpa/adapter-http @kalpa/adapter-websocket
```

## Core Concepts

### Universal Message Envelope (UME)
Every message flowing through Kalpa is standardized into a `UME` (Universal Message Envelope). This ensures that a message originating from HTTP looks identical to a message originating from MQTT by the time it reaches the routing engine.

```typescript
interface UME {
  id: string;               // Unique message identifier
  source: {
    protocol: string;       // e.g., 'http', 'websocket', 'mqtt'
    adapter: string;        // ID of the adapter that generated the message
    connectionId?: string;  // ID of the specific client connection
  };
  metadata: Record<string, any>; // Protocol-specific metadata (headers, topics, etc.)
  payload: any;             // The actual message body (parsed JSON, string, Buffer)
  timestamp: number;        // Epoch timestamp of ingestion
}
```

---

## The `Kalpa` Class

The main entry point for the framework. It manages the registry of adapters and handles the routing engine.

### Initialization

```typescript
import { Kalpa } from '@kalpa/core';

const kalpa = new Kalpa();
```

### Methods

#### `register(adapter: Adapter, defaultOptions?: AppAdapterConfig)`
Registers a new adapter instance with the Kalpa runtime.

- **`adapter`**: An instance of a class implementing the `Adapter` interface.
- **`defaultOptions`**: (Optional) Default configuration for the adapter, such as the `name` or `port`. Can be overridden by the YAML config.

```typescript
await kalpa.register(new HttpAdapter(), { name: 'http', port: 3000 });
```

#### `route(config: RouteConfig)`
Programmatically defines a route. (If using YAML, the CLI handles this for you).

- **`config`**: The routing configuration object.

```typescript
kalpa.route({
  id: 'sensor-to-dashboard',
  from: { 
    protocol: 'http', 
    match: { method: 'POST', path: '/messages' } 
  },
  to: { 
    protocol: 'websocket', 
    adapter: 'live-feed', 
    action: 'broadcast' 
  },
});
```

#### `start()`
Initializes all registered adapters and begins listening for incoming messages.

```typescript
await kalpa.start();
```

#### `stop()`
Gracefully shuts down the routing engine and calls `shutdown()` on all registered adapters.

```typescript
await kalpa.stop();
```

---

## Creating Custom Adapters

You can build custom adapters to support proprietary protocols, databases, or third-party APIs by implementing the `Adapter` interface.

### The `Adapter` Interface

```typescript
import { Adapter, UME, KalpaPluginContext } from '@kalpa/core';

export class MyCustomAdapter implements Adapter {
  // 1. Define the protocol name this adapter handles
  protocol = 'my-custom-protocol';

  // 2. Initialization logic
  async initialize(context: KalpaPluginContext): Promise<void> {
    const { 
      config,   // Configuration passed to this adapter instance
      emit,     // Function to send a UME into the Kalpa routing engine
      logger    // Built-in logger instance
    } = context;

    logger.info(`Starting custom adapter on port ${config.port}`);
    
    // Example: Listen for incoming connections
    // When a message arrives, format it as a UME and call emit()
    // emit({ id: '...', source: { protocol: this.protocol, ... }, payload: ... });
  }

  // 3. Outbound message handling
  async send(message: UME, action: string, connectionId?: string): Promise<void> {
    // Logic to translate the standardized UME back into your protocol's format
    // and send it out based on the requested 'action' (e.g., 'broadcast', 'reply').
  }

  // 4. Graceful shutdown
  async shutdown(): Promise<void> {
    // Close connections, clear timeouts, etc.
  }
}
```

### Using Your Custom Adapter

```typescript
const kalpa = new Kalpa();
await kalpa.register(new MyCustomAdapter(), { name: 'custom', port: 8080 });
await kalpa.start();
```
