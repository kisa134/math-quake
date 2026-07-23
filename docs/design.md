# Math Quake — Design (target architecture)

> RDPI Phase 2. Target state in C4 + Data-Flow + Sequence, the Clean-Arch↔engine
> reconciliation, risks, and test strategy. Depth of the migration lives in
> `architecture.md` (R0–R11); this doc is the approvable design contract.
> **Status: awaiting owner approval before implementation.**

## C4 — Level 1: Context
```
[Player] ──HTTP──► [GitHub Pages: static SPA]         (game code, cacheable)
[Player] ◄─WSS──► [Supabase Realtime]  ◄─WSS──► [Player 2]   (room broadcast)
[Dev] ──push──► [GitHub Actions] ──build+deploy──► [GitHub Pages]
(FUTURE) [Players] ◄──► [Dedicated authoritative server] (when anti-cheat needed)
```
The SPA is self-contained; Supabase Realtime is the only backend (broadcast pub/
sub, no DB writes). Authority is peer/host today; a dedicated server is a future
container that slots behind the same `net/protocol.ts` contract.

## C4 — Level 2: Containers (client-internal)
```
┌ SPA (browser) ───────────────────────────────────────────────┐
│  React/DOM (UI)  │  R3F scene (render)  │  Rapier (physics)   │
│         └──────────── zustand store (slices) ────────────┘    │
│  net/ (transport + interpolation + protocol)  →  Supabase RT  │
│  game/ (pure domain: movement, voxel, radial, ga, protocol)   │
│  systems/ (local-player system-hooks)  config/ (tuning)       │
└───────────────────────────────────────────────────────────────┘
```

## C4 — Level 3: Components = the 4 truth-contours (dependency rule)
Dependencies point inward → `game/` (pure domain, imports nothing framework-y)
is the core; `net/`, `store/`, `systems/`, `components/` are outer; Supabase/
Rapier/React are the outermost detail.
```
(A) NET-AUTHORITATIVE   net/worldBuffer + net/protocol + worldSlice(structure)
(B) LOCAL COSMETIC      cosmeticSlice(inbox) + Debris/Ragdoll pools + game/voxel
(C) LOCAL-PLAYER SIM    systems/use*(hooks) + game/movement + config/weapons
(D) REACT / DOM UI      components/UI + game/eventBus (3D→DOM, no per-frame store)
```
Cross-contour law (hard): A never per-frame through zustand; B never synced;
C is the only writer of local `setLinvel`/camera + intents; D never drives the
hot loop.

## C4 — Level 4: Code (key structures)
- **Store slices** (`store/`): `player | combat | cosmetic | net | world | enemy`
  combined into one `useStore` (public `useStore(s=>s.x)` unchanged).
- **System-hooks** (`systems/`): `useInput, useGroundProbe, usePlayerMovement,
  useJetpack, useGrapple, useWeapons, useCameraRig, useNetSync` — each a pure
  `step(ctx, dt)` over a shared mutable `PlayerCtx` ref; ordered by `FRAME.*`.
- **World-entity pattern** (one, reused by train/creatures/minions/ragdoll):
  structure reactive (id list) → poses imperative (`sampleWorld()`→ref-mesh,
  `FRAME.WORLD_INTERP`) → cosmetic local (`stepCosmetic`).
- **Factories (cold path, Clean-Arch):** `makeChunks`/prop/genome/snapshot
  builders return valid-at-creation values; `net/protocol.ts` = the one message
  contract (quant/dequant shared server+client) with `PROTOCOL_VERSION`.
- **Hit contract:** `game/hitTags.ts` — typed `userData` + one `findTag()` walk.

## Data-Flow Diagram
```
INTENTS (C→S, imperative)        SNAPSHOTS/EVENTS (S→C, facts)
  update, shoot, hit,              world_snapshot (poses, lossy),
  train_input, minion_command  →   world_event (spawn/died/taken)
        │                                    │
   local-player sim (C)              net/worldBuffer ring → sampleWorld()
        │                                    │
   Rapier setLinvel + camera          ref-mesh poses (A) + local cosmetic (B)
        │                                    │
   HUD reads store selectors (D) ◄── structure (id lists) in worldSlice
```
Rule: continuous (poses) → snapshot (droppable, interpolation hides loss);
discrete (born/died/picked) → event (the fact matters, not the pose).

## Sequence — "player kills a candle" (host-authoritative)
```
Non-host P2 shoots candle C:
  P2.useWeapons ──emit('ehit',{id,dmg,pt})──► Supabase ──► Host P1
  P1: damageEnemy(C) [use-case orchestrator]
        ├─ applyDamage → C dies
        ├─ addDebris(makeChunks(C))   (B, P1 local shatter)
        ├─ pulseDeathFx / score        (B/player slice)
        └─ HostEnemySync drops C from next 'enemies' snapshot
  Supabase ──'enemies'(without C)──► P2
  P2.NetEnemies: C gone from snapshot → spawnDeathFx(C.pos)  (B, P2 local shatter)
⇒ both clients shatter C; only the host mutates authoritative HP.
```

## Clean-Arch ↔ real-time reconciliation (the boundary)
- **HOT path** (`useFrame`/physics/render): data-oriented, **zero-alloc**,
  data-in-refs/pools. No rich-object-with-methods, no per-frame zustand. This is
  correctness for 60fps. The 4 contours ARE the dependency rule here.
- **COLD path** (domain outside the frame): Clean-Arch by the letter — factories
  (valid-at-creation), rich invariants, server-side validation of damage/limits,
  isolated `net/protocol.ts`, use-case orchestrators (thin `damageEnemy`).
- One explicit line in code/reviews marks which path a module is on.

## Risks & mitigations
| Risk | Mitigation |
|---|---|
| Refactor breaks the LIVE game | R0–R6 are small `tsc`-green steps; game plays after each; ErrorBoundary; deploy only green. |
| Store slices change behavior | Public `useStore(s=>s.x)` API unchanged (combine); full playthrough + net-smoke per step. |
| Hot-loop regressions from "clean" objects | Hard zero-alloc rule (§5 CLAUDE.md); factories only on cold path. |
| Client-trust HP/kills (cheating) | Marked `// TRUST-CLIENT DEBT` in `net/handlers.ts`; closes when a server owns damage. |
| Protocol drift server↔client | Single `net/protocol.ts` + `PROTOCOL_VERSION` reject. |
| I can't playtest visually | Owner is the eyes; I gate on tsc + console/network probes + 2-tab logic probes. |

## Test strategy
- **Static:** `npx tsc --noEmit` green after every step/substep (primary gate).
- **Unit:** pure `game/*` (voxel factory, movement accelerate/friction, future
  ga operators) — deterministic, cheap. No render/net unit tests.
- **Integration (manual/agent-driven headless):** 2-tab net-smoke (same `?room=`:
  entities sync, one tab closing doesn't break the other, Slow-3G smooths not
  teleports); logic probes via a temporary `window.__mqStore` when needed.
- **Owner playtest:** feel (movement/juice), 2-player sync, sandbox — after deploy.

## Migration = architecture.md §7, R0→R6 first
R0 net-mutation fix · R1 `game/voxel.ts` · R2 `game/hitTags.ts` · R3
`net/protocol.ts`+`handlers.ts`+version · R4 store slices · R5 eventBus+input-ref
· R6 Player→system-hooks + FRAME priority. Then Phase-1 features on the clean base.
