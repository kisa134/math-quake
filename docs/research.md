# Math Quake — Research (AS-IS facts)

> RDPI Phase 1. Facts only — what the system IS today. No recommendations
> (those live in `design.md` / `architecture.md`). Grounded in the actual code.

## 1. Runtime & deployment
- Static SPA. `vite build` → `dist/`; served by GitHub Pages (`base:/math-quake/`
  when `GH_PAGES=true`). `.github/workflows/deploy.yml` builds + deploys on push
  to `main`. Live: https://kisa134.github.io/math-quake/.
- Local dev: `server.ts` (Express + Vite middleware + a legacy socket.io server
  with a 20Hz `world` tick) runs via `tsx server.ts`. In production the client
  does NOT use this server — multiplayer is Supabase Realtime. `server.ts` is
  dev-serve + dead-for-prod.
- Node engine ≥20. Deps of note: `@react-three/{fiber,drei,rapier,postprocessing}`,
  `three`, `zustand`, `@supabase/supabase-js`, `socket.io(-client)` (legacy).

## 2. Module inventory (responsibility as-is)
- `src/main.tsx` → `App.tsx` (ErrorBoundary → `<Game/>` + `<UI/>`).
- `src/store.ts` — single zustand `create<GameState>`. Holds: score, health,
  enemies[], projectiles[], damageNumbers[], debris[], lastDeathFx, jetpackFuel,
  jetpackStunUntil, god, editorMode, editorSelect, placedProps[], isHost,
  netEnemies[], remotePlayers, currentWeapon, commandTarget, localMinions,
  roomId, playerId, isPlaying + ~35 actions. Also CONTAINS domain logic:
  `makeChunks`, `colorForEnemy`, `SHAPES`, `NEON`, `DEBRIS_CAP`, `spawnDeathFx`.
- `src/socket.ts` — Supabase Realtime transport with a socket.io-compatible
  surface (`socket.emit/on/id`, `initMultiplayer`). Room = channel `mq-<room>`.
  Presence: host election (lowest id) + prune leavers. Broadcast events:
  `update`(player transform), `shoot`, `hit`, `enemies`(host snapshot),
  `ehit`(hit relay to host), `place`/`remove`(props). Client-trust HP/score.
- `src/net/worldBuffer.ts` — ring buffer + interpolation (`pushSnapshot`,
  `sampleWorld`, `serverNow`, clock-offset). Currently unused by prod netcode
  (built for the server-tick backbone; kept for future host-authoritative world).
- `src/net/supabaseConfig.ts` — `VITE_SUPABASE_*` env accessors.
- `src/game/movement.ts` — pure movement math (`MOVE` config, friction,
  Quake-accelerate, wishDir, jetpack/grapple constants). No React.
- `src/game/shake.ts` — trauma screen-shake singleton. `src/game/fx.ts` —
  hitmarker event bus (3D→DOM). `src/game/enemyNet.ts` — `enemyLive` position map.
- `src/components/Player.tsx` — the local player. ONE `useFrame` (~400+ lines)
  does: camera (1st/3rd) + shake + recoil, ground/jump-pad raycast, bhop/coyote/
  buffer/air-jump, jetpack thrust+fuel+stun, air/ground accelerate, grapple
  (raycast+reel+rope), `setLinvel`, muzzle/laser fade, shooting (4 weapons,
  hitscan/projectile, sparks via `scene.add`+setTimeout, `socket.emit`), editor
  gating, fall-respawn, netsync `emit('update')`. Also a keydown effect (weapons/
  camera/editor keys). Renders weapon/muzzle/3rd-person/laser/rope.
- `src/components/Enemies.tsx` — host-only enemy sim (EnemyMesh: dynamic Rapier
  body, chase/shoot AI, contact damage; writes `enemyLive`), `HostEnemySync`
  (broadcasts snapshot ~8Hz), `<Debris/>`. Gated on `isHost`.
- `src/components/NetEnemies.tsx` — non-host renderer of `netEnemies` (shootable
  meshes) + snapshot-diff → `spawnDeathFx` (replays shatter).
- `src/components/Debris.tsx` — InstancedMesh voxel pool, CPU integration,
  spawn-inbox drain, death-fx (shake+sound) trigger.
- `src/components/{Arena,MatrixRain,PostFX}.tsx` — world: void floor, temples
  (CORE spire + 4 nodes), candlestick platforms, jump pads, grid, matrix-rain
  shader, Bloom/Vignette/SMAA. `theme.ts` = locked PALETTE.
- `src/components/{PlacedProps,Editor}.tsx` — build editor: raycast+ghost, LMB
  place / RMB delete pad/candle/atm (functional userData), broadcast sync.
- `src/components/{Projectiles,DamageNumbers,RemotePlayers,Minions,WorldEntities,
  UI,ErrorBoundary}.tsx` — projectiles, floating numbers, remote-player boxes,
  3 fixed local minions (steer to commandTarget), interpolated dummy renderer,
  DOM HUD (auto-enter, click-to-lock overlay, GOD/BUILD HUD, jet-fuel bar,
  hitmarker), crash boundary.
- `src/hooks/useKeyboard.ts` — input as React `useState` (setKeys per key +
  mouse buttons: LMB shoot, RMB grapple; contextmenu suppressed).
- `src/config/` — does not exist yet. `src/systems/` — does not exist yet.

## 3. Data flow (as-is)
- **Input:** `useKeyboard` (useState) → `keys` → `Player.useFrame` reads.
- **Local player:** `Player.useFrame` → Rapier `setLinvel` + camera; `emit('update')`
  ~20Hz → peers' `RemotePlayers`.
- **Enemies:** host `GameManager` spawns → `store.enemies` → `EnemyMesh` sim →
  `enemyLive` → `HostEnemySync` broadcast `enemies` → non-host `store.netEnemies`
  → `NetEnemies` render; death = disappear from snapshot → `spawnDeathFx`.
- **Shooting:** `Player` hitscan → host: `store.damageEnemy` (→ debris + damage#
  + lastDeathFx + score, all in one `set`); non-host: `emit('ehit')` → host
  applies. `hit` on players → `socket` → target `takeDamage`.
- **Cosmetic:** `damageEnemy`/`spawnDeathFx` push to `store.debris` (inbox) →
  `Debris` drains → InstancedMesh; `lastDeathFx` → shake + sound.
- **Props:** `Editor` → `store.addProp` + `emit('place')` → peers `addProp` →
  `PlacedProps` render.

## 4. State ownership (as-is)
- Server-authoritative: player HP/death/score is client-trust today (no persistent
  server); enemies are HOST-authoritative (peer election). No dedicated game server.
- The single store mixes: sync-structure (`remotePlayers`, `netEnemies`),
  local cosmetic (`debris`, `lastDeathFx`), local-player/HUD (`health`, `score`,
  `jetpackFuel`), and domain logic (`makeChunks`). Boundaries are not expressed
  in types/files.

## 5. Known correctness facts
- `worldBuffer.ts` + `server.ts` world-tick exist but are unused by the prod
  (Supabase) netcode.
- `Player.tsx` weapon config (`WEAPON_CONFIG`) is inline; tuning numbers across
  the codebase are inline (movement in `game/movement.ts` `MOVE`, others inline).
- No `src/config/` or `src/systems/`; no `net/protocol.ts` (quantization for the
  legacy snapshot is duplicated in `server.ts` and `worldBuffer.ts`).
- Multiplayer HP/kills are client-trusted (`hit`, `ehit`, `claim`-style) — a known
  temporary posture until a server owns damage.
- ErrorBoundary wraps the app; losing pointer-lock shows a click-to-play overlay
  (no longer ejects); falling respawns.
