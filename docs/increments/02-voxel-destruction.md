# Increment 02 — Voxel Destruction ("полигоны плюс воксели чтобы они могли разрушаться")

**Author:** VFX / physics-gameplay engineering
**Status:** design + implementation spec (no code shipped by this doc)
**Target:** enemies (geometric shapes + candlesticks) and arena blocks shatter into flying voxel chunks with impact sparks, screen shake, and sound. Hold **60 fps**. Multiplayer-sane (cosmetic-only, server stays authoritative).

---

## 0. What already exists (design AROUND this — do not rewrite it)

From reading the codebase, the wiring is already 60% there. The increment is mostly about **doing what exists, correctly and at scale**, not inventing new plumbing.

| Piece | File | Current state | Verdict |
|---|---|---|---|
| `DebrisChunk` interface (`id,x,y,z,vx,vy,vz,color,size,createdAt`) | `src/store.ts` L29–40 | Exists, exactly the voxel-chunk shape we want | **Keep, extend with a few fields** |
| `addDebris(chunks[])` / `removeDebris(id)` | `src/store.ts` L83, L236–246 | Batch push with id+timestamp; single remove | **Keep** |
| Debris spawned on **candle** death only | `src/store.ts` L170–190 (inside `damageEnemy`) | 12 chunks, radial-ish velocity, color from candle | **Generalize to ALL enemy deaths** |
| Debris **rendered** | `src/components/Enemies.tsx` L120–127 | **One `<RigidBody>` per chunk** with a `boxGeometry` | **Replace — this is the perf bomb** (see §2) |
| Debris **cleanup** | `src/components/Enemies.tsx` L105–113 | `setInterval` every 2s, drops chunks >5s old | **Keep the idea, move to useFrame + hard cap** |
| Impact **sparks** | `src/components/Player.tsx` L258–269 | `THREE.Mesh` per spark, `scene.add` + `setTimeout` remove, shared geo/mat | **Keep for MVP, pool later** |
| Damage → death trigger | `src/store.ts` `damageEnemy` (called from `Player.tsx` L247) | HP subtract, dead filtered out, score +10 | **This is our death hook** |
| Audio | `src/utils/audio.ts` (`playShootSound`, `playJumpSound` used) | Exists; procedural WebAudio | **Add `playExplosionSound` / `playImpactSound`** |
| Arena blocks | `src/components/Arena.tsx` | `RigidBody type="fixed"` boxes, `userData.isFloor/isWall`, candlesticks `isFloor` | **Later polish — add block HP + fragment** |

**Key existing constraint:** enemy meshes carry `userData.isEnemy` + `id` (Enemies.tsx L92); hitscan walks parents to find it (Player.tsx L242–253). Death is decided in the store, not the component. So debris must be emitted **from the store on the death transition**, and the death impact **position** must be threaded in (it already is — `damageEnemy(id, amount, pos)` receives the hit point, Player.tsx L247).

---

## 1. Destruction model — options & recommendation

### (a) Pre-fractured voxel chunks spawned on death
Spawn a fixed budget of box "voxels" at the entity's location on death, colored from the source material, launched radially from the impact point. Deterministic, zero geometry processing, trivially poolable. **This is what the store already does for candles.**

### (b) Runtime voxelization (Teardown-like)
Rasterize the actual mesh into a 3D occupancy grid, instantiate a voxel per filled cell, then break bonds and let them fall. Gives true shape-conforming rubble. Cost: mesh voxelization (raycast/BVH sampling or SDF) per entity + hundreds–thousands of cells + connectivity graph. This is a **native-engine budget**; on a web main thread it will stall on the first big enemy.

### (c) Hybrid
Pre-fractured chunks for the common case (all enemies, small blocks), and an *optional* coarse voxelization pass reserved for a handful of "hero" set-piece destructions (e.g. the central `CORE_EXCHANGE` temple) done offline/at load, not at runtime.

### ✅ Recommendation: **(a) pre-fractured chunks, with the door left open to (c) for arena set-pieces.**

Justification for a web / 60 fps / multiplayer FPS:
- **Determinism-free by design.** Destruction is cosmetic and local (see §5). We never need chunk positions to agree between clients, so we don't pay for a physics-accurate voxel grid.
- **Bounded cost.** Pre-fractured = "spawn N boxes, integrate N positions." N is a knob. Voxelization cost scales with mesh volume and is unbounded per entity.
- **The entities are already blocky/geometric.** Icosahedron/octahedron/candle "exploding into cubes" reads perfectly as juicy at these speeds — nobody parses exact fracture topology on a 200ms burst. Vlambeer's lesson: *the perception of destruction* comes from count, velocity, spin, and screenshake, not from accurate fragmentation.
- **It matches the store.** The `DebrisChunk` shape is literally pre-fractured voxel data. We're finishing an existing design, not fighting it.

Voxelization (b) is explicitly **out of scope** for this increment. If we ever want Teardown-grade temple collapse, do it as a **pre-baked** chunk set authored offline (option c), never a runtime rasterize.

### Chunk generation rules (pre-fractured)

| Property | Rule |
|---|---|
| **Count budget** | Small shape (torus/icosa/octa/dodeca/torusKnot): **8–14 chunks**. Candle (tall, tanky, HP 200): **16–20 chunks**. Arena block (later): **12–24** scaled by block volume. |
| **Size** | Derive from source bounding size: `size = baseHalf * rand(0.25, 0.6)`. Small shapes baseHalf≈1 → chunks 0.25–0.6. Candle box is `1.5×6×1.5` → chunks 0.5–1.5 (matches current candle code). Bigger, fewer chunks read chunkier and cost less than many tiny ones. |
| **Color inheritance** | Take the source `material.color` (enemies build it in Enemies.tsx L33–51; candle uses `#00f5d4`/`#f72585`). Store it as the chunk `color`. Optionally emit ~20% of chunks in an "ember" accent (white/yellow) for spark-like pops. |
| **Initial position** | Jitter around entity center: `pos + (rand-0.5)*bboxExtent`. For candle, bias upward along its height (current code does `y + rand*5`). |
| **Initial velocity** | `v = radial*RADIAL_SPEED + inheritedVel + random*SCATTER`. **radial** = normalize(chunkPos − impactPoint) so chunks blow *away from where the shot landed* (directional, not just up). **inheritedVel** = the enemy's Rapier `linvel()` at death (chunks keep the body's momentum — cheap realism). **random** = `(rand-0.5)*SCATTER` on each axis. Add an upward bias `vy += POP_UP` so the burst lifts before falling. |
| **Angular spin** | `spin = random unit axis * rand(SPIN_MIN, SPIN_MAX)` rad/s. Cosmetic — integrated as Euler on the instance (see §2). |
| **Gravity** | Applied in the CPU integrator: `vy -= GRAVITY * dt` each frame. |
| **Lifetime + cleanup** | `LIFETIME` (default 2.5s). Last `FADE_TIME` (0.6s) scales the chunk down toward 0 and/or drops opacity so it doesn't pop out. Then evicted. Hard cap eviction is **oldest-out** (see §2). |

---

## 2. Physics & performance — the load-bearing decision

### The problem with the current renderer
`Enemies.tsx` L120–127 wraps **every chunk in its own `<RigidBody colliders="cuboid" type="dynamic">`**. Each is a React component, a Rapier dynamic body, a collider, a draw call, and a mount/unmount churn. Twelve candle chunks is survivable; **all enemies dying (up to 20 on screen) × 12–20 chunks = 240–400 simultaneous dynamic bodies + 400 draw calls + 400 React reconciles per wave.** That is the frame-killer. It also thrashes the physics island solver for objects the player never meaningfully interacts with.

### The three tools and when to use each

| Approach | Use for | Cost |
|---|---|---|
| **Real Rapier dynamic RigidBody** | A tiny **"hero" subset** — 0 to ~3 chunks per kill that should tumble on geometry, bounce off a pillar, land on a platform and stay. | High (solver island, collider, body). Cap hard. |
| **CPU particle integration** (position += vel·dt in a `useFrame`, over the existing `DebrisChunk` array) | **The bulk** — 90%+ of chunks. No collisions except an optional cheap floor-plane clamp. | Very low — plain math over a typed array. |
| **`InstancedMesh`** | **Rendering** all CPU chunks in **one draw call** regardless of count. | One geometry, one material, one draw call, a matrix buffer. |

### ✅ Recommendation: **InstancedMesh + CPU integration for the bulk; reserve ≤3 true Rapier bodies per kill for "hero" chunks.**

This is the standard juice-vs-cost trade (see Teardown's approach: most debris is visual, only a fraction is fully simulated). Concretely:

- **One `<Debris/>` component** owns a single `THREE.InstancedMesh` of `CAP` instances (unit box geometry, `meshStandardMaterial` with `instanceColor` for per-chunk color). It reads `store.debris`, integrates motion every frame, writes `instanceMatrix`, sets used-count. **Draw calls for all debris: 1.**
- **Motion is CPU-only** on the `DebrisChunk` data: `x += vx*dt; vy -= G*dt;` plus spin accumulation. No Rapier body per chunk. This is what turns "hundreds of bodies" into "one loop."
- **Optional cheap collision:** a single analytic floor clamp. Arena blocks live at many heights, so a global floor is wrong; instead clamp only against the **void floor at y=-50** (`Arena.tsx` L40) as a catch, and let chunks that fall past it just expire. Do **not** raycast per chunk per frame.
- **Hero chunks (opt-in, off for MVP):** when a kill happens, promote at most `HERO_PER_KILL` (default 2, MVP 0) chunks to actual short-lived `<RigidBody>`s so *some* rubble convincingly interacts with the temple geometry. Keep a **global** hero cap (`HERO_CAP` default 24) — oldest hero body is removed when exceeded.

### Concrete budgets

| Budget | Default | Why |
|---|---|---|
| `DEBRIS_CAP` (max live CPU chunks) | **256** | ~13 full kills of overlap. Instanced → 1 draw call, integration is trivial at 256. |
| Eviction policy | **oldest-out** | On `addDebris`, if `length + incoming > CAP`, drop from the front (oldest `createdAt`). Same pattern the project already trusts (`bomber-game` blood-cell cap). |
| `HERO_CAP` (max live Rapier chunk bodies) | **24** (MVP **0**) | Keeps the solver island small. |
| `HERO_PER_KILL` | **2** (MVP **0**) | Almost all chunks stay on CPU. |
| Chunks per small enemy / candle | **10 / 18** | Reads chunky, stays within cap under wave pressure. |
| `LIFETIME` / `FADE_TIME` | **2.5s / 0.6s** | Shorter than the current 5s → fewer live chunks, snappier feel. |

### Avoiding per-frame allocation & thrash (hard rules)
- **Reuse scratch objects** module-scope (`const _m4 = new THREE.Matrix4()`, `_q`, `_e`, `_v`, `_scale`) exactly like `Player.tsx`/`Enemies.tsx` already do (L7–9, L14–22). Never `new` inside `useFrame`.
- **Integrate in place** — mutate `DebrisChunk` fields; do not map/rebuild the array each frame. The store array is the backing store; the component mutates a **local working copy** (or a parallel Float32 pool) and only touches zustand on spawn and on batched eviction, **not per frame** (zustand `set` every frame would re-render subscribers — forbidden).
- **Better: a ring-buffer pool.** Keep chunk state in preallocated typed arrays (`Float32Array` for pos/vel/spin, `Uint8` for alive, `Float32` for color) sized `DEBRIS_CAP`. Spawning writes into free slots; expiry frees slots. Zero GC, zero array churn. The zustand `debris` array can remain the *event inbox* (store pushes spawn requests; the component drains them into the pool), which keeps store logic unchanged and moves the hot loop out of React state entirely.
- **No mount/unmount churn** — the InstancedMesh is mounted once; chunks appear/vanish by count + matrix, not by React add/remove.
- **`instanceMatrix.needsUpdate = true`** once per frame after writing; set `mesh.count = liveCount` to skip drawing dead tail.

---

## 3. Wiring into THIS codebase

### 3.1 Store — generalize death → debris (extend `damageEnemy`)

Today only candles emit debris (`store.ts` L170–190). Generalize to every dead enemy, thread the **impact point** for radial velocity, and add a **death-event signal** for juice (shake/sound) that components can consume.

**Extend `DebrisChunk`** (additive, backward-compatible):
```ts
interface DebrisChunk {
  id: string;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  color: string;
  size: number;
  createdAt: number;
  // NEW:
  rx?: number; ry?: number; rz?: number;   // current rotation (rad), default 0
  sx?: number; sy?: number; sz?: number;    // spin velocity (rad/s)
  life?: number;                             // seconds to live (default LIFETIME)
}
```

**Add a lightweight death-FX event channel** so juice isn't coupled to debris:
```ts
// store: transient "last death" pulse the juice layer reads and clears
lastDeathFx: { x:number; y:number; z:number; big:boolean; t:number } | null;
// set inside damageEnemy when an enemy dies; big = (type==='candle')
```

**Chunk factory** (pure helper, no per-frame use):
```ts
const SMALL_COUNT = 10, CANDLE_COUNT = 18;
const RADIAL = 12, SCATTER = 8, POP_UP = 6, SPIN_MIN = 4, SPIN_MAX = 14;

function makeChunks(enemy, impact /* [x,y,z] */, inheritedVel /* {x,y,z} */) {
  const isCandle = enemy.type === 'candle';
  const count = isCandle ? CANDLE_COUNT : SMALL_COUNT;
  const [cx, cy, cz] = enemy.position;
  const baseHalf = isCandle ? 1.5 : 1;
  const color = colorForEnemy(enemy); // candle: green/pink; else its hue
  const out = [];
  for (let i = 0; i < count; i++) {
    const px = cx + (Math.random()-0.5)*baseHalf*2;
    const py = cy + (isCandle ? Math.random()*5 : (Math.random()-0.5)*baseHalf*2);
    const pz = cz + (Math.random()-0.5)*baseHalf*2;
    // radial away from impact
    let dx = px-impact[0], dy = py-impact[1], dz = pz-impact[2];
    const len = Math.hypot(dx,dy,dz) || 1; dx/=len; dy/=len; dz/=len;
    out.push({
      x: px, y: py, z: pz,
      vx: dx*RADIAL + (inheritedVel?.x||0) + (Math.random()-0.5)*SCATTER,
      vy: dy*RADIAL + (inheritedVel?.y||0) + (Math.random()-0.5)*SCATTER + POP_UP,
      vz: dz*RADIAL + (inheritedVel?.z||0) + (Math.random()-0.5)*SCATTER,
      color, size: baseHalf * (0.25 + Math.random()*0.35),
      rx:0, ry:0, rz:0,
      sx:(Math.random()-0.5)*2, sy:(Math.random()-0.5)*2, sz:(Math.random()-0.5)*2,
    }); // spin magnitude applied by integrator via SPIN range, or bake here
  }
  return out;
}
```

**In `damageEnemy`,** replace the candle-only block (L166–190) with:
```ts
deadEnemies.forEach(e => {
  const impact = pos ?? e.position;            // hit point already passed in
  const chunks = makeChunks(e, impact, /* inheritedVel */ undefined);
  newDebris = [...newDebris, ...chunks.map(withIdAndTime)];
});
// oldest-out cap
if (newDebris.length > DEBRIS_CAP) newDebris = newDebris.slice(newDebris.length - DEBRIS_CAP);
// death-fx pulse for the juice layer (last dead wins this frame; fine)
const dead = deadEnemies[deadEnemies.length-1];
const lastDeathFx = dead ? { x:dead.position[0], y:dead.position[1], z:dead.position[2], big: dead.type==='candle', t: Date.now() } : state.lastDeathFx;
```
> **Inherited velocity note:** the enemy's live `linvel()` lives on the Rapier body in `Enemies.tsx`, not in the store. Cheapest path: pass it through the damage call. Since `damageEnemy` is invoked from the hitscan in `Player.tsx` (L247), and the killing shot already knows the hit — either (a) accept `undefined` inherited velocity for MVP (radial+random is plenty juicy), or (b) later have `EnemyMesh` write its last `linvel` into `enemy` state on each frame so the store can read it. **MVP: skip inheritance.**

### 3.2 New `<Debris/>` component (InstancedMesh + CPU integration)

Replace the per-chunk `RigidBody` list in `Enemies.tsx` (L120–127) with a single instanced renderer. Mount it once (e.g. inside `Enemies` or `Scene`).

```tsx
// src/components/Debris.tsx
const CAP = 256, GRAVITY = 30, FLOOR_Y = -50, FADE = 0.6, LIFETIME = 2.5;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(),
      _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
const _boxGeo = new THREE.BoxGeometry(1,1,1);
const _mat = new THREE.MeshStandardMaterial({ vertexColors:false, roughness:.4, metalness:.5 });

export function Debris() {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  // local pool mirrors store.debris but is the hot working set (avoids per-frame set())
  const pool = useRef<DebrisChunk[]>([]);
  const seen = useRef(new Set<string>());

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 1/30);           // clamp spikes
    const mesh = meshRef.current; if (!mesh) return;

    // 1) drain new chunks from store into pool (spawn events only)
    const store = useStore.getState().debris;
    for (const c of store) if (!seen.current.has(c.id)) { seen.current.add(c.id); pool.current.push({...c}); }
    if (pool.current.length > CAP) pool.current.splice(0, pool.current.length - CAP);

    // 2) integrate + write matrices
    const now = Date.now(); let n = 0;
    for (let i = pool.current.length - 1; i >= 0; i--) {
      const c = pool.current[i];
      const age = (now - c.createdAt)/1000;
      const life = c.life ?? LIFETIME;
      if (age >= life) { pool.current.splice(i,1); seen.current.delete(c.id); continue; }
      // integrate
      c.vy -= GRAVITY * dt;
      c.x += c.vx*dt; c.y += c.vy*dt; c.z += c.vz*dt;
      c.rx = (c.rx||0) + (c.sx||0)*dt; c.ry = (c.ry||0)+(c.sy||0)*dt; c.rz = (c.rz||0)+(c.sz||0)*dt;
      if (c.y < FLOOR_Y) { pool.current.splice(i,1); seen.current.delete(c.id); continue; }
      // fade: scale down over last FADE seconds
      const remain = life - age;
      const k = remain < FADE ? remain/FADE : 1;
      _v.set(c.x, c.y, c.z);
      _e.set(c.rx||0, c.ry||0, c.rz||0);
      _q.setFromEuler(_e);
      _s.setScalar(c.size * k);
      _m.compose(_v, _q, _s);
      mesh.setMatrixAt(n, _m);
      mesh.setColorAt(n, _tmpColor.set(c.color));
      n++;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return <instancedMesh ref={meshRef} args={[_boxGeo, _mat, CAP]} castShadow frustumCulled={false} />;
}
```
Then in `Enemies.tsx`: **delete** the `debris.map(...RigidBody...)` block (L120–127) and the `setInterval` cleanup (L105–113); render `<Debris/>` once instead. Store cleanup is now driven by the pool's lifetime/floor checks, so the `debris` array in zustand should also be trimmed periodically (a low-frequency `setInterval` dropping `age > LIFETIME` from the store keeps the spawn-inbox from growing unbounded; it no longer drives rendering).

> **Instanced shadows caveat:** instanced casts work but are the most expensive part. If shadows cost too much at 256, set `castShadow={false}` on the debris mesh — flying rubble rarely needs shadows and this is a cheap fps lever.

### 3.3 Arena blocks (LATER polish, not MVP)

Blocks are `RigidBody type="fixed"` boxes with `userData.isFloor/isWall` (`Arena.tsx`). To make them destructible:

1. **Block HP + tagging.** Wrap breakable blocks (candlesticks, pillars — *not* the void floor or arena-defining walls) so their mesh `userData` carries `{ breakable:true, blockId, hp }`. Keep block HP in a store map `blockHp: Record<string, number>`.
2. **Hitscan already reports block hits.** `Player.tsx` L255 detects `isWall`/`isFloor` intersections (currently only for sparks). Add: if `userData.breakable`, call `damageBlock(blockId, damage, hitPoint)`.
3. **`damageBlock`** subtracts HP; on ≤0, emit `makeChunks`-style debris sized from the block's bbox (12–24 chunks, color = block material color), fire a `big` death-fx pulse, and either hide the block mesh or swap it out (removing a fixed body mid-game = React unmount of that block).
4. **Gameplay caution:** candlesticks are `isFloor` — players stand on them (`Player.tsx` ground ray L143–154). Destroying one removes a platform. That's a *feature* (arena mutates) but must be intentional; give breakable platforms high HP (e.g. 400) so they only go under heavy fire, and never make the temple floors breakable.

**MVP explicitly excludes arena destruction.** Ship enemy-death voxels first.

---

## 4. Juice stack (NO time-distortion — online game; owner rejected hit-stop/time-warp)

Reference: Vlambeer *"The Art of Screenshake"* (count + shake + sound sell impact), Jan Willem Nijman / Martin Jonasson *"Juice it or lose it"*, Teardown's split of visual-vs-simulated debris. **Do not** add hit-stop / slow-mo — this is a synced network game (also flagged in owner memory).

### 4.1 Screen shake — camera trauma model
Additive trauma that decays; shake = `trauma²` (quadratic feels better than linear). Applied to the camera **after** `Player`'s camera positioning (L104/L112), as an *offset*, so it never fights the RigidBody-follow logic.

```ts
// store: trauma: number (0..1); addTrauma(amount) => trauma = min(1, trauma+amount)
// component (runs after Player camera update, in its own useFrame or same frame later):
const shake = trauma*trauma;
const t = performance.now()*0.001;
camera.position.x += (noise(t*17)   ) * MAX_ANG * shake;
camera.position.y += (noise(t*17+99)) * MAX_ANG * shake;
// small rotational kick reads better than translation for FPS:
camera.rotation.z += noise(t*23) * MAX_ROLL * shake;
trauma = Math.max(0, trauma - DECAY*dt);   // DECAY ~ 1.5/s
```
Use smooth pseudo-noise (`Math.sin` sum or a 1D value-noise), **not** `Math.random()` (random shake looks like static). Because `PointerLockControls` owns yaw/pitch, restrict shake to a tiny positional offset + `rotation.z` roll so it doesn't desync aim.

**Trauma amounts per event:**
| Event | `addTrauma` |
|---|---|
| Small enemy killed | 0.18 |
| Candle killed (big) | 0.35 |
| Player fires railgun (wpn 4, `thick`) | 0.12 |
| Player takes damage | 0.30 |
| Arena block destroyed (later) | 0.40 |
| (cap) trauma clamps at 1.0; multiple kills stack toward cap |

### 4.2 Sparks / particles
Already implemented in `Player.tsx` L258–269 (shared geo/mat, `scene.add` + `setTimeout` cleanup). Keep for MVP. On **death** (not just hit), emit a bigger one-shot burst — but route it through the **same InstancedMesh debris system** as tiny bright "ember" chunks (short life 0.4s, small size, white/accent color) rather than more `scene.add` meshes. That way sparks + rubble share one draw call. Later, migrate the per-hit sparks in `Player.tsx` into an instanced spark pool too (removes the `setTimeout`/`scene.add` churn).

### 4.3 Flash
Cheap muzzle/impact pop: a brief additive point-light or an emissive scale-pulse at the death point, ≤80ms. Optional for MVP; a screen-edge vignette flash on player-damage is higher value than a world flash on kills.

### 4.4 Sound hooks (`src/utils/audio.ts`)
Add procedural one-shots matching the existing WebAudio style (`playShootSound(freq, dur)` already exists):

| Event | New fn | Character |
|---|---|---|
| Small enemy shatter | `playImpactSound()` | short noisy burst, ~120ms, mid crunch |
| Candle / big shatter | `playExplosionSound()` | lower, longer (~300ms), body + tail |
| Spark / bullet impact on wall | (reuse a light `playShootSound(200,0.03)` tick) | subtle |
| Arena block break (later) | `playExplosionSound()` (heavier variant) | |

Fire them from the juice layer that consumes `lastDeathFx` (so one code path owns shake **and** sound: read pulse → `addTrauma(big?0.35:0.18)` + `big ? playExplosionSound() : playImpactSound()` → clear pulse).

---

## 5. Multiplayer — destruction is COSMETIC and LOCAL-ONLY

**Server stays authoritative on HP and death** via the existing messages: `Player.tsx` emits `socket.emit("hit", {targetId, damage})` (L275) and the server owns `player_died`/HP. Debris, sparks, shake, and sound are **pure client-side render candy** derived from state each client already has.

- **Local enemies:** `damageEnemy` runs in each client's own store when *that client* lands a shot (single-player-style AI enemies today). Debris is emitted locally at the moment the store transitions the enemy to dead. No network involvement at all.
- **Remote player deaths:** when a `player_died` / kill event arrives from the server, the receiving client spawns *its own* debris/shake/sound at the reported position. Each client independently reproduces the fireworks from the authoritative event — the same way each client draws its own damage numbers.
- **No chunk sync — ever.** Chunk positions, spins, and lifetimes never travel over the wire. Every client rolls its own `Math.random()` scatter; clients will show *different* rubble trajectories, and **that is correct and unnoticeable** — nobody can compare two clients' 200ms confetti, and it saves the entire bandwidth/interpolation cost.
- **Determinism is a non-issue** precisely because nothing gameplay-relevant depends on chunk state: chunks have no colliders that affect players (CPU chunks don't collide; hero chunks are few and don't damage anyone), so a chunk landing at a slightly different spot on client A vs B changes nothing authoritative. The only shared truth — who died, where, and when — already comes from the server.

**Rule of thumb:** if removing the debris system entirely would change a single HP number or hit result, it's wired wrong. It must be a pure function of already-synced events.

---

## 6. Tuning table

| Param | Default | Range | Effect |
|---|---|---|---|
| `SMALL_COUNT` | 10 | 6–16 | Chunks per small enemy. Higher = juicier, more fill toward CAP. |
| `CANDLE_COUNT` | 18 | 12–24 | Chunks per candle (big kill). |
| `DEBRIS_CAP` | 256 | 128–512 | Max live CPU chunks. Ceiling on cost; oldest-out beyond it. |
| `LIFETIME` | 2.5 s | 1.5–4 | How long chunks live. Longer = more onscreen at once. |
| `FADE_TIME` | 0.6 s | 0.3–1.0 | Scale-down tail so chunks don't pop out. |
| `GRAVITY` | 30 | 15–45 | Fall speed. High = snappy settle; low = floaty. |
| `RADIAL` | 12 | 6–20 | Outward-from-impact speed. Directional punch. |
| `SCATTER` | 8 | 3–14 | Random velocity spread. Higher = chaotic. |
| `POP_UP` | 6 | 0–12 | Upward bias so burst lifts before falling. |
| `SPIN_MIN/MAX` | 4 / 14 | 0–24 | Chunk tumble rate (rad/s). |
| `HERO_PER_KILL` | 2 (MVP 0) | 0–4 | Chunks promoted to real Rapier bodies per kill. |
| `HERO_CAP` | 24 (MVP 0) | 0–48 | Global live hero-body cap. |
| Trauma: small kill | 0.18 | 0.1–0.3 | Shake per small kill. |
| Trauma: big kill | 0.35 | 0.2–0.5 | Shake per candle/block. |
| `TRAUMA_DECAY` | 1.5 /s | 1–3 | How fast shake settles. |
| `MAX_ANG` (shake pos) | 0.15 | 0.05–0.4 | Peak positional shake. |
| `MAX_ROLL` (shake z) | 0.05 rad | 0.02–0.12 | Peak camera roll. Too high = nausea. |

### Playtester feel-checklist
- [ ] A kill feels like it *hits* — shake + sound + chunks land within the same 2 frames.
- [ ] Chunks fly **away from where I shot**, not just straight up.
- [ ] Candle deaths feel bigger than shape deaths (more chunks, more shake, deeper sound).
- [ ] Killing 5+ enemies at once does **not** drop below 60 fps (watch the cap kick in).
- [ ] Chunks fade/shrink out — no visible pop-out.
- [ ] Shake never makes aiming feel broken or makes me motion-sick (roll is subtle).
- [ ] No rubble lingers > ~3s cluttering the arena.
- [ ] In multiplayer, a remote kill produces debris on my screen at the right place, with no hitching.
- [ ] Sound doesn't clip/overlap into mush during a wave (consider a per-frame SFX budget).

---

## 7. MVP for increment 2 (the minimal satisfying slice — ship THIS first)

**Goal:** *Enemy death → instanced voxel burst + screen shake + sfx.* Nothing else.

1. **Store:** generalize `damageEnemy` so **every** dead enemy (not only candles) emits `makeChunks(...)` debris with radial-from-impact velocity, color inheritance, spin fields, and oldest-out cap at `DEBRIS_CAP`. Set `lastDeathFx` pulse. (Extend `DebrisChunk` with `rx/ry/rz/sx/sy/sz/life`.)
2. **`<Debris/>` component:** single `InstancedMesh`, CPU integration in one `useFrame`, lifetime + fade + floor-catch cleanup, no per-frame allocations. **Delete the per-chunk `RigidBody` list and the `setInterval`** in `Enemies.tsx`.
3. **Juice layer:** consume `lastDeathFx` → `addTrauma(big?0.35:0.18)` + `playImpactSound()`/`playExplosionSound()`. Camera trauma shake applied as an offset **after** Player's camera update.
4. **Audio:** add `playImpactSound()` + `playExplosionSound()` to `src/utils/audio.ts`.

**Explicitly deferred to later polish (not MVP):**
- Arena block HP + fragmentation (`Arena.tsx` candlesticks/pillars).
- Hero Rapier chunks (`HERO_PER_KILL`/`HERO_CAP` > 0).
- Migrating per-hit sparks in `Player.tsx` into the instanced pool.
- World flash / point-light pops.
- Inherited enemy velocity in chunk launch.

**Definition of done for MVP:** shooting any enemy to death produces a one-draw-call voxel burst that flies away from the hit, the screen kicks, a crunch plays, rubble fades out within ~2.5s, and 5+ simultaneous kills hold 60 fps.
