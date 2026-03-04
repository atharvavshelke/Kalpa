# Kalpa Configuration Guide (`kalpa.yml`)

When running Kalpa via the CLI, the behavior of the entire runtime is defined declaratively using a single YAML configuration file, typically named `kalpa.yml`.

## Overview

The `kalpa.yml` file is divided into two primary sections:
1.  **`adapters`**: Definitions for the various protocol handlers (servers or clients) that Kalpa should spawn and manage.
2.  **`routes`**: The rules defining how messages flow *from* one adapter *to* another, including matching criteria and transformations.

---

## 1. Adapters

An adapter is a long-running process that either listens for incoming connections (like an HTTP server) or connects to an external service (like an MQTT client).

```yaml
adapters:
  # The ID of the adapter (used later in routes)
  sensor-api:
    # The protocol type (must match a registered adapter, e.g., 'http-server', 'mqtt-client')
    type: http-server
    # Protocol-specific configuration variables (e.g., port for HTTP, url for MQTT)
    port: 3000
    host: 0.0.0.0
    
  live-feed:
    type: websocket-server
    port: 3001
```

### Common Adapter Types

*   `http-server`: Listens for incoming HTTP requests (GET, POST, etc.). Requires `port`.
*   `websocket-server`: Hosts a persistent WebSocket server. Requires `port`.
*   `mqtt-client`: Connects to an external MQTT broker. Requires `url`.
*   `tcp-server`: Listens for raw TCP streams. Requires `port`.
*   `grpc-server`: Hosts a gRPC service defined by Protobuf. Requires `port`, `protoFile`.

---

## 2. Routes

Routes define the circulatory system of Kalpa. They instruct the central engine on how to filter, transform, and map incoming Universal Message Envelopes (UMEs) to destination adapters.

```yaml
routes:
  - id: sensor-to-dashboard
    # 1. Source Criteria (Where does the message come from?)
    from: 
      protocol: http
      match: 
        method: POST      # Only match HTTP POST requests
        path: /messages   # Only match this specific URL path

    # 2. Transformation (Optional: Modify the payload before sending)
    transform:
      - type: json-parse          # Parse the incoming string into a JSON object
      - type: template            # Format the payload based on a template string
        template: "New sensor reading: {{payload.temperature}}°C"

    # 3. Destination (Where does the message go?)
    to: 
      protocol: websocket
      adapter: live-feed          # Must match an adapter ID defined above
      action: broadcast           # The specific action the destination adapter should take
```

### Route Components

#### `from` (Source Matching)
Filter messages based on protocol-specific metadata.
*   **`protocol`**: Matches the `protocol` property of the `Adapter` class.
*   **`match`**: A key-value map of criteria. For HTTP, this is usually `method` and `path`. For MQTT, it might be `topic`. Kalpa ensures the incoming message metadata precisely matches these values.

#### `transform` (Data Manipulation)
An array of sequential steps to modify the `payload` or `metadata` of the UME before it reaches the destination.
*   `json-parse`: Converts a string payload into a JavaScript object.
*   `json-stringify`: Converts a JavaScript object into a JSON string.
*   `template`: Uses Handlebars-style syntax (e.g., `{{payload.key}}`) to create a new string payload.
*   *(More complex transforms can be registered programmatically via `Kalpa.registerTransform()`)*.

#### `to` (Destination Routing)
Instructions for the target adapter.
*   **`protocol`**: The target protocol. Kalpa uses this to ensure compatibility (e.g., preventing routing a stream directly to an HTTP response).
*   **`adapter`**: The ID of the adapter defined in the `adapters` section.
*   **`action`**: Protocol-specific behavior. 
    *   For HTTP, it's usually implicitly handling a request-response cycle.
    *   For WebSockets, actions could be `broadcast` (send to all connected clients) or `send` (send to a specific client ID).

---

## Complete Example (`kalpa.yml`)

This configuration creates a classic IoT Gateway pattern: Sensors publish JSON data to an MQTT broker. Kalpa subscribes to that broker, parses the JSON, and broadcasts the temperature readings instantly to all connected WebSocket clients (like a browser-based dashboard).

```yaml
adapters:
  # Connect to a public test MQTT broker
  sensor-network:
    type: mqtt-client
    url: mqtt://test.mosquitto.org:1883
    
  # Host our own WebSocket server for the dashboard
  browser-dashboard:
    type: websocket-server
    port: 8080

routes:
  - id: mqtt-to-ws-dashboard
    from: 
      protocol: mqtt
      match: 
        topic: mycompany/sensors/+/telemetry  # Matches e.g. mycompany/sensors/1/telemetry
    transform:
      - type: json-parse
    to: 
      protocol: websocket
      adapter: browser-dashboard
      action: broadcast
```
