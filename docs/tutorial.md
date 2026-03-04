# Kalpa Quickstart Tutorial

Welcome to Kalpa! In this tutorial, we will build a "Zero-Code Live Dashboard Backend." 

**The Goal:** We want to be able to send an HTTP POST request to a server (simulating a webhook or an IoT sensor publishing data), and have that data instantly appear in our browser via WebSockets.

Before Kalpa, you would need to write a Node.js Express server, integrate `socket.io` or `ws`, handle the connections, parse the incoming HTTP body, and iterate over connected web socket clients to broadcast the message.

With Kalpa, we will do this in 0 lines of code, using just one YAML file.

## Prerequisites

Ensure you have Node.js (v20+) installed.

## Step 1: Install Kalpa

Create a new directory for your project and initialize it:

```bash
mkdir kalpa-tutorial
cd kalpa-tutorial
npm init -y
```

Install the Kalpa CLI and the necessary adapters. Since we are connecting HTTP to WebSockets, we need those specific adapter packages:

```bash
npm install @kalpa/cli @kalpa/adapter-http @kalpa/adapter-websocket
```

## Step 2: Create the Configuration

Kalpa needs to know what servers to start and how to route the messages. Create a file named `kalpa.yml` in your project directory:

```yaml
# kalpa.yml

adapters:
  # 1. We define an HTTP server to receive POST requests
  incoming-webhook:
    type: http-server
    port: 3000
    
  # 2. We define a WebSocket server for browsers to connect to
  dashboard-feed:
    type: websocket-server
    port: 3001

routes:
  # 3. We define the rule connecting them
  - id: webhook-to-ws
    
    # Catch messages arriving on the HTTP server at /alerts
    from: 
      protocol: http
      match: 
        method: POST
        path: /alerts
        
    # Send them to the WebSocket server, instructing it to broadcast
    to: 
      protocol: websocket
      adapter: dashboard-feed
      action: broadcast
```

## Step 3: Start the Engine

Run the Kalpa CLI, pointing it to your configuration file:

```bash
npx kalpa start --config kalpa.yml
```

You should see output similar to this:
```
[KALPA] Starting Engine...
[KALPA] Registered adapter: http-server (incoming-webhook) on port 3000
[KALPA] Registered adapter: websocket-server (dashboard-feed) on port 3001
[KALPA] Active Routes: 1
```

## Step 4: Test it Out!

Kalpa is running. Now we need to act as both the "Dashboard" (listening on WebSockets) and the "Sensor" (Sending HTTP POSTs).

### Connect a WebSocket Client

You can use a tool like [Postman](https://www.postman.com/), [wscat](https://github.com/websockets/wscat), or just a simple browser console.

If using a browser, open a blank tab, open the Developer Console (F12), and paste:

```javascript
const ws = new WebSocket('ws://localhost:3001');
ws.onmessage = (event) => console.log('🔔 NEW ALERT Received:', event.data);
```

### Send an HTTP POST

Open a new terminal window and use `curl` to send a POST request to the HTTP adapter Kalpa is hosting:

```bash
curl -X POST http://localhost:3000/alerts \
     -H "Content-Type: application/json" \
     -d '{"message": "Temperature Exceeded 45C!", "sensorId": "A12"}'
```

Look back at your browser console (or WebSocket client). **You should instantly see the message appear!** 

```
🔔 NEW ALERT Received: {"message":"Temperature Exceeded 45C!","sensorId":"A12"}
```

## What Just Happened?

1. Your terminal sent an HTTP POST payload.
2. Kalpa's `http-server` adapter received it, wrapped the HTTP Body and URL metadata into a standardized `UME` (Universal Message Envelope).
3. The routing engine saw that the UME metadata matched the `path: /alerts` and `method: POST` rule defined in your YAML.
4. The router forwarded the UME to the `dashboard-feed` adapter.
5. The `websocket-server` adapter unwrapped the UME payload and executed the `broadcast` action, pushing the raw JSON to all connected clients.

All handled by Kalpa's internal resilient messaging queue without writing a single drop of glue code.
