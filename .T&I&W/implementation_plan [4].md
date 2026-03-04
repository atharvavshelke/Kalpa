# Kalpa — Hot-Swap Implementation Plan

Zero-downtime adapter replacement at runtime. Replace a running adapter without dropping messages.

## How It Works

```
1. Engine receives replace(name, newAdapter) call
2. Old adapter: getState() → serialize current state
3. Old adapter: stop accepting NEW messages (drain mode)
4. Drain queue captures any in-flight messages for the old adapter
5. New adapter: initialize(config) → restoreState(state) → start()
6. New adapter: wired into engine's message loop
7. Drain queue flushed through new adapter
8. Old adapter: destroy()
```

> [!IMPORTANT]
> We're NOT using Worker threads. The AI reviewers were right that worker-thread isolation adds massive complexity for minimal Phase 2 benefit. Instead we use an **in-process drain queue** approach — simpler, testable, zero messages dropped.

## Proposed Changes

### Core

#### [NEW] [hotswap.ts](file:///home/privateproperty/Downloads/Kalpa/packages/core/src/hotswap.ts)
`HotSwapManager` class:
- `replace(name, newAdapter, config?)` — orchestrates the full swap sequence
- Internal `DrainQueue` — captures messages destined for the adapter being swapped
- Emits events: `kalpa:hotswap:start`, `kalpa:hotswap:complete`, `kalpa:hotswap:error`
- State transfer: `oldAdapter.getState()` → `newAdapter.restoreState(state)`

#### [MODIFY] [engine.ts](file:///home/privateproperty/Downloads/Kalpa/packages/core/src/engine.ts)
- Add `replace(name, newAdapter, config?)` method to [Kalpa](file:///home/privateproperty/Downloads/Kalpa/packages/core/src/engine.ts#21-211) class
- During swap: route messages for the swapping adapter into the drain queue instead of the old adapter
- After swap: flush drain queue through new adapter

#### [MODIFY] [registry.ts](file:///home/privateproperty/Downloads/Kalpa/packages/core/src/registry.ts)
- Add `replace(name, newAdapter, config?)` — atomic swap in the adapter map
- Emits `adapter:replaced` event

#### [MODIFY] [index.ts](file:///home/privateproperty/Downloads/Kalpa/packages/core/src/index.ts)
- Export `HotSwapManager` and related types

---

## Verification Plan

```bash
npx tsx --test packages/core/tests/hotswap.test.ts
```

Tests:
1. **Basic swap** — replace running HTTP adapter with new one; verify new adapter handles requests
2. **State preservation** — old adapter state transfers to new adapter
3. **Zero message loss** — send messages during swap; verify all delivered after swap completes
4. **Lifecycle events** — `kalpa:hotswap:start` and `kalpa:hotswap:complete` fire
5. **Error handling** — swap fails if new adapter fails to start; old adapter stays running
