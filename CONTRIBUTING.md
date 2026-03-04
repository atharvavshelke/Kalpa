# Contributing to Kalpa

First off, thank you for considering contributing to Kalpa! It's people like you that make Kalpa a great universal meta-protocol framework.

## How Can I Contribute?

### Reporting Bugs
If you find a bug in the source code or a mistake in the documentation, you can help us by submitting an issue to our [GitHub Repository](https://github.com/atharvavshelke/Kalpa/issues). Even better, you can submit a Pull Request with a fix.

### Suggesting Enhancements
If you have an idea for a core engine feature or a new protocol adapter, please submit a Feature Request issue first to discuss the implementation details.

### Pull Requests
We gladly review Pull Requests!

1.  **Fork** the repo on GitHub.
2.  **Clone** the project to your own machine.
3.  **Commit** changes to your own branch following conventional commits.
4.  **Push** your work back to your fork.
5.  Submit a **Pull Request** so that we can review your changes.

---

## Local Development Setup

Kalpa uses standard Node.js and npm workspaces to manage its monorepo.

### Prerequisites
-   Node.js >= `v20.0.0`
-   npm

### Installation

1.  Clone your fork:
    ```bash
    git clone https://github.com/YOUR_USERNAME/Kalpa.git
    cd Kalpa
    ```
2.  Install dependencies across all workspaces:
    ```bash
    npm install
    ```

### Running Tests (Mandatory)

Kalpa has a rigorous automated testing suite ensuring zero regressions for core routing logic, backpressure, and hot-swaps. 

Before opening a PR, ensure all tests pass:

```bash
npm run test
```

Currently, the master branch must maintain its perfect `66/66` passing test record. 

If you are adding a new core feature, you **must include unit tests** covering the new behavior in `packages/core/tests/`.

---

## Architecture Context

If you are modifying the core, please familiarize yourself with the UME (Universal Message Envelope) format in `packages/core/src/ume.ts`. The cardinal rule of Kalpa is that all incoming messages are translated to UME, routed, and translated back at the destination adapter without losing data integrity or exhausting the event loop.

## Code Style

-   We utilize TypeScript `strict: true`.
-   Avoid `any` wherever possible. Define concise interfaces for adapter payloads.
-   Ensure no unhandled promise rejections exist in asynchronous streams.

Thanks again for helping build Kalpa!
