# Increment 01 — Movement: Bhop + Air-Strafe + Vertical Climb

**Project:** Math Quake (React + @react-three/fiber + @react-three/rapier + three.js + zustand + socket.io)
**Author:** movement/gameplay engineering
**Status:** SPEC — implementation-ready
**Target:** 60 fps, multiplayer-safe, client-local prediction, skill-expressive.

> Design north star: take the **best** of three lineages and fuse them into one coherent, readable model:
> - **Quake 3 / CPMA air-control** — strafe-jumping and air-strafing that *rewards* mouse+key coordination with real speed gain.
> - **CS 1.6 / Source bhop** — chained jumps that preserve momentum; near-frictionless surfing on ramps.
> - **"Chained Together"** — satisfying, skill-based, near-infinite *vertical* climbing (here: wall-jumps + stacked pads + an air-jump budget).
> - Flavor of **Titanfall/Apex** air feel for generosity (coyote/buffer windows) without killing the skill ceiling.

Everything below is concrete: real numbers, real formulas, and a drop-in pseudocode step keyed to the actual `Player.tsx`.

---

## 0. Что сейчас есть (current state — the thing we are replacing)

In `src/components/Player.tsx`, inside `useFrame`, movement is:

```
_direction = normalize(front - side) * SPEED (=30) rotated by camera.rotation
_currentHorizontalVel = lerp(currentHV, targetVel, 12 * delta)   // <-- kills momentum
setLinvel({ x, y: velocity.y, z }, true)
// grounded via THREE.Raycaster down from camera, range 2.2
// jump: if grounded && jump -> setLinvel.y = JUMP_FORCE (=15)
// jump pad: userData.isJumpPad -> setLinvel.y = customJumpForce
```

**Why this is wrong for our goals:**
1. The `lerp(currentHV, target, 12*delta)` **overwrites** horizontal velocity every frame toward a `SPEED=30` target. On the ground this is fine-ish, but **in the air it destroys strafe-jump speed gain** — you can never exceed 30, and any velocity you built is dragged back to the target instantly. Air-strafing is mathematically impossible under a lerp-to-target model.
2. On landing, horizontal velocity is *also* lerped to target → **momentum is not preserved across jumps**, so bhop gives nothing. Bhop must carry velocity through the airborne frames untouched and land without friction.
3. Grounding uses a `THREE.Raycaster` against **all** `scene.children` every frame (expensive, and a single center ray misses ledges/edges). We will switch to a **Rapier shapecast**.
4. Ground and air use the *same* code path. They must be **two different models** (friction+ground-accel vs. air-accel).

We keep: PointerLockControls, the Rapier `RigidBody` + `CapsuleCollider`, jump pads via `userData.isJumpPad`, the FPS/TPS toggle, the 50 ms socket sync, and all shooting code. **Only the movement block (roughly lines 97–162) changes.**

---

## 1. Каноническая физическая модель (the canonical model)

We adopt the **Quake/Source acceleration model** verbatim, because it is the proven basis for both bhop and air-strafing. It has exactly two states — **grounded** and **airborne** — driven by one shared "accelerate" primitive plus a friction step that only runs on the ground.

### 1.1 Units & frame

- Coordinate: three.js meters. Physics via Rapier.
- `dt` = clamped frame delta: `dt = min(delta, 1/30)` (never integrate a >33 ms frame; prevents tunneling/quantum leaps on a stutter). All formulas below use this clamped `dt`.
- We operate on the **horizontal** velocity `(vx, vz)` as a 2D vector; `vy` (vertical) is handled separately (gravity from Rapier + jump impulses). Gravity stays Rapier-owned.
- `wishDir` = desired horizontal move direction (unit vector, or zero if no keys). `wishSpeed` = the magnitude we *want* along it (the ground max speed, scaled by input).

### 1.2 wishDir — where the desired direction comes from

Build it from WASD **in camera-yaw space** (yaw only — never pitch; looking down must not slow you):

```
forwardInput = Number(keys.forward) - Number(keys.backward)   // W=+1, S=-1
strafeInput  = Number(keys.right)   - Number(keys.left)       // D=+1, A=-1

yaw = camera yaw (Euler 'YXZ' .y)     // horizontal look angle
// forward on XZ plane for yaw: (-sin yaw, -cos yaw) matches three.js -Z forward
wishDir.x = forwardInput * (-sin yaw) + strafeInput * ( cos yaw)
wishDir.z = forwardInput * (-cos yaw) + strafeInput * (-sin yaw)
len = hypot(wishDir.x, wishDir.z)
if (len > 0) { wishDir.x /= len; wishDir.z /= len }   // normalize; else wishDir = 0
wishSpeed = (len > 0 ? 1 : 0) * MAX_GROUND_SPEED
```

> **Critical:** normalize wishDir but keep `wishSpeed` **capped at the ground max**, NOT scaled up by diagonal input. The air model's speed gain comes from the geometry of the dot-product cap (§1.4), not from a bigger wishSpeed. (This is the classic Quake nuance: diagonal WASD doesn't go faster; *mouse-steered strafing* does.)

### 1.3 Ground movement — friction + accelerate

Run **friction first**, then **accelerate**, only while grounded.

**Friction** (Quake `PM_Friction`):
```
speed = hypot(vx, vz)
if (speed > 0) {
  control = max(speed, STOP_SPEED)          // below STOP_SPEED, friction is constant, not proportional -> crisp stops
  drop    = control * FRICTION * dt
  newSpeed = max(speed - drop, 0)
  scale = newSpeed / speed
  vx *= scale;  vz *= scale
}
```

**Accelerate toward wishSpeed** (shared primitive, `GROUND_ACCEL`):
```
currentSpeedAlongWish = vx*wishDir.x + vz*wishDir.z     // dot(vel, wishDir)
addSpeed   = wishSpeed - currentSpeedAlongWish
if (addSpeed > 0) {
  accelSpeed = min(GROUND_ACCEL * wishSpeed * dt, addSpeed)   // note clamp to addSpeed
  vx += accelSpeed * wishDir.x
  vz += accelSpeed * wishDir.z
}
```

Because ground friction is high and `addSpeed` is clamped to `wishSpeed - currentSpeed`, ground speed **converges to `MAX_GROUND_SPEED`** and no further — exactly the CS/Quake ground feel. Fast, snappy, no lerp.

### 1.4 Air movement — THE air-strafe model (why speed builds)

**Airborne: NO friction. Same accelerate primitive, but with a tiny `AIR_MAX_SPEED` cap in place of `wishSpeed`, and `AIR_ACCEL`:**

```
// airborne
currentSpeedAlongWish = vx*wishDir.x + vz*wishDir.z
addSpeed = AIR_MAX_SPEED - currentSpeedAlongWish          // <-- cap is TINY (~2-3 m/s), not 30
if (addSpeed > 0) {
  accelSpeed = min(AIR_ACCEL * wishSpeed * dt, addSpeed)
  vx += accelSpeed * wishDir.x
  vz += accelSpeed * wishDir.z
}
```

**Why this produces speed gain (the whole trick):**
The cap is on **`dot(vel, wishDir)`**, i.e. the component of your velocity *in the direction you're pushing* — NOT on your total speed. When you hold a strafe key (say A) and simultaneously **turn the mouse the same way**, `wishDir` is nearly **perpendicular** to your current velocity. The perpendicular component of your velocity is ~0, so `addSpeed = AIR_MAX_SPEED - ~0 ≈ AIR_MAX_SPEED > 0`, and you get to add `accelSpeed` **sideways**. Adding a vector perpendicular to your velocity **rotates** your velocity and **increases its magnitude** (Pythagoras: |v_new| = √(|v|² + Δ²) > |v|). Repeat every frame while smoothly turning → your speed vector curves to follow your aim and its length grows. That is air-strafing.

- **Single-key + mouse turn (air-strafe):** hold A, sweep mouse left → continuous gain. The optimal angle keeps `wishDir` just ahead of the velocity so the dot stays below the cap.
- **Alternating-key strafe-jump (Quake style):** A+mouse-left on one hop, D+mouse-right on the next; each hop adds a curved boost. This is what lets Quake maps be run at 2–3× base speed.
- **Straight W in air:** `wishDir` ≈ parallel to velocity → `dot ≈ your speed` which already exceeds `AIR_MAX_SPEED` → `addSpeed ≤ 0` → **no gain**. Correct: you cannot accelerate by holding forward; you must *strafe*. This is the skill.

> **CS vs Quake dial:** CS/Source uses a very low air cap (`airMaxSpeed ≈ 30 ups ≈ 0.76 m/s` after the 30-unit clamp) giving tight, subtle air control; Quake3 gives a bigger air cap → looser, faster-building. CPMA blends (adds a dedicated air-control term when only forward+mouse). **We ship the Source-style low cap by default** (predictable, readable, pairs perfectly with bhop) and expose it as a tunable so we can taste-test toward Quake later. See tuning table §4.

### 1.5 Preserved momentum across jumps (the bhop core)

**Rule:** the horizontal accelerate/friction step **must not lerp toward a target and must not run friction while airborne or during the landing-jump frame.** Concretely:

- While airborne: only the air-accel step touches `(vx, vz)`. Gravity (Rapier) touches `vy`.
- On the frame the player jumps: apply the jump to `vy` and **do NOT apply ground friction that frame** — i.e., if a buffered jump fires, skip friction so a perfectly-timed hop carries 100% of horizontal speed. (In Source this is why bhop preserves speed: you leave the ground before friction is applied.)
- On landing: do **nothing** special to `(vx, vz)`. No reset, no lerp. If the player immediately jumps again (within the buffer window), they never spend a grounded frame with friction → speed is preserved and can keep climbing via air-strafes.

This single change (delete the `lerp`, split ground/air, gate friction on the jump frame) is what turns the current "capped-at-30, momentum-killed" feel into real bhop.

### 1.6 Bhop timing — autohop, buffer, coyote

We support **jump buffering** and **coyote time** so bhop is *learnable* but still skill-gated. Two configs; ship **assisted** by default, expose a toggle for **pro**:

- **Jump buffer** `JUMP_BUFFER_MS = 120 ms`: if the player presses/holds jump up to 120 ms *before* landing, the jump fires on the first grounded frame. Implemented by recording `lastJumpPressedTime`; on becoming grounded, if `now - lastJumpPressedTime < JUMP_BUFFER_MS`, jump immediately.
- **Coyote time** `COYOTE_MS = 90 ms`: you may still jump up to 90 ms *after* leaving a ledge (feels forgiving, standard Titanfall/Celeste value). Track `lastGroundedTime`; allow a jump if `now - lastGroundedTime < COYOTE_MS`.
- **Autohop (assist mode, default ON):** if `keys.jump` is *held*, auto-fire a jump every time you're grounded (buffer makes this frame-perfect for free). This is the friendly CS-surf-server behavior; great for new players and for "Chained Together" vertical flow.
- **Pro mode (autohop OFF):** jump only fires on the *rising edge* of the key press. The 120 ms buffer still helps, but perfect chaining requires rhythm. This is the CS 1.6 skill expression. Store the flag in zustand (`bhopAssist: boolean`, default `true`).

**Runaway control — soft cap, not hard wall.** Uncapped air-strafing on a big map can reach absurd speeds. We use a **soft cap with gentle scaling** rather than a hard clamp (a hard clamp feels like hitting a wall and kills flow):

```
SOFT_CAP = 42   // ~1.4x ground max; free speed up to here
HARD_CAP = 90   // absolute ceiling
speed = hypot(vx, vz)
if (speed > SOFT_CAP) {
  over = speed - SOFT_CAP
  // bleed the excess a little each frame (only the part above soft cap)
  excessDrag = over * SOFTCAP_DRAG * dt      // SOFTCAP_DRAG ~ 1.5
  newSpeed = max(speed - excessDrag, SOFT_CAP)
  newSpeed = min(newSpeed, HARD_CAP)
  scale = newSpeed / speed
  vx *= scale; vz *= scale
}
```

This lets skilled players push past the ground max and *feel* the reward, while asymptotically resisting infinite runaway. Applied **after** the air-accel step, airborne only. (Set `SOFTCAP_DRAG = 0` to get pure uncapped Quake for testing.)

### 1.7 "Chained Together" — vertical climbing design

Goal: repeated, skill-based *upward* progress that feels as satisfying as the horizontal flow. We already have **jump pads** (`userData.isJumpPad`, `userData.jumpForce`). We add a coherent trio of **momentum-preserving vertical mechanics**:

**(a) Air-jump budget (double/triple jump).**
Give the player `AIR_JUMPS = 1` (tunable up to 2) mid-air jumps, refilled on landing OR on a wall-touch (see below). An air-jump sets `vy = max(vy, AIR_JUMP_FORCE)` (`AIR_JUMP_FORCE = 13`, slightly below ground jump) and **does not touch horizontal velocity** — so you keep your strafe speed while gaining height. Uses the same buffer/rising-edge logic. This is the primary "chain upward" verb.

- `vy = max(vy, force)` (not `vy = force`) so an upward air-jump while already rising **adds usable height** but a downward air-jump **arrests the fall and relaunches** — both feel good, neither lets you cheese infinite hover (budget is finite until you touch something).

**(b) Wall-jump (the Chained-Together climb).**
When airborne and a **shapecast/short ray in the horizontal move direction** detects a wall within `WALL_DETECT_DIST = 0.7 m`, pressing jump performs a wall-jump:
```
vy = WALL_JUMP_UP            // = 14, strong upward
// push away from wall along wall normal, preserving tangential speed:
vx += wallNormal.x * WALL_JUMP_PUSH   // WALL_JUMP_PUSH = 8
vz += wallNormal.z * WALL_JUMP_PUSH
refill AIR_JUMPS               // wall-touch restores air-jump budget
```
Chaining wall-jumps up a shaft of candlestick pillars = the "Chained Together" vertical climb. Because tangential horizontal speed is preserved and only the wall-normal component is boosted, a skilled player can **spiral up a column** carrying speed. Add a short `WALL_JUMP_LOCKOUT = 150 ms` so you can't double-fire on the same contact.

**(c) Stacked / momentum-preserving jump pads.**
Current pads hard-set `vy = customJumpForce` (kills downward speed but also ignores incoming vertical). Change to **additive with a floor**:
```
vy = max(vy + PAD_BONUS, customJumpForce)   // PAD_BONUS = 6
```
So hitting a pad while already moving up (e.g., mid-air-jump) **stacks** into a bigger launch, enabling pad-ladders where each pad throws you higher than the last if you arrive with upward momentum. Horizontal velocity is **never touched by pads** (currently it isn't — keep that).

Together (a)+(b)+(c) give a readable vertical skill curve: pad → air-jump at apex → wall-jump off a pillar → land on a higher pad. No timers, no hit-stop, all momentum-based.

### 1.8 (Recommended, cheap) Surf / ramp-slide

Source surf falls out almost for free from this model **if** we don't zero velocity into ramps. On a steep ramp (angle > `SURF_MIN_ANGLE ≈ 45°`), treat the surface as **non-grounding** (don't set `grounded=true`) and let the player **slide**: project gravity along the ramp and apply the **air-accel** model (so you can strafe to steer and gain speed along the incline). The only requirement is a "clip velocity into the plane" step so you don't stick:
```
into = dot(vel, surfaceNormal)
if (into < 0) { vel -= surfaceNormal * into }   // remove the into-surface component; keep tangential
```
On the angled **candlestick platforms** this yields real Source-style surfing at near-zero extra cost — it reuses the air model. **Ship it as a stretch goal in this increment** (it's ~15 lines) but it's not required for the MVP slice (§6). Rapier note: give ramp colliders low friction, or better, keep the player kinematic-velocity-based (see §2.1) so we fully own the response.

---

## 2. Как это реализовать в ЭТОМ коде (implementation in this codebase)

### 2.1 RigidBody strategy — keep dynamic, drive via setLinvel

Keep the existing `RigidBody type="dynamic"` + `CapsuleCollider args={[0.5,0.5]}` with `enabledRotations={[false,false,false]}`. We continue to **read** velocity with `playerRef.current.linvel()` and **write** it with `playerRef.current.setLinvel({x,y,z}, true)` — same API the current code uses. We let Rapier own **gravity and collision response** for `vy` and wall stops; we own `(vx,vz)` and jump impulses. This is the least invasive path and Rapier's solver already handles capsule-vs-wall so we don't clip through geometry.

> Alternative considered: `type="kinematicVelocity"` + manual gravity + manual collide-and-slide. Cleaner for surf but re-implements collision response and is riskier. **Recommendation: stay dynamic for increment 1;** revisit only if wall interactions feel mushy.

### 2.2 Grounding — replace the THREE.Raycaster with a Rapier shapecast

The current down-`THREE.Raycaster` over `scene.children` is slow (tests every mesh) and single-point (misses edges). Replace with a **Rapier cast** which tests only physics colliders and, as a shape cast, matches the capsule footprint so ledges ground correctly.

Use the already-imported `useRapier()` → `world` and `rapier`. Cast a small ball/capsule straight down from the player's feet:

```
// grounded check (once per frame), reusing preallocated shapes
const pos = playerRef.current.translation();
const shape = groundShape;                 // preallocate: new rapier.Ball(0.45) or Capsule
const shapePos = { x: pos.x, y: pos.y - 0.05, z: pos.z };
const shapeRot = { x:0, y:0, z:0, w:1 };
const castDir = DOWN;                       // {x:0,y:-1,z:0}
const maxToi = 0.25;                        // how far below feet counts as ground (~capsule half + skin)
const hit = world.castShape(shapePos, shapeRot, castDir, shape, maxToi, true,
                            undefined, undefined, playerColliderHandleToExclude);
grounded = !!hit && (hit.normal1.y > 0.5 || hit.collider.userData?.isFloor || ...);
```

- Read `hit.collider.userData` for `isJumpPad` / `jumpForce` / `isFloor` / `isWall` (mirror the flags currently on the mesh `userData` — ensure the **collider** carries them; if flags live only on the visual mesh, also set `userData` on the `<RigidBody>`/collider, or keep a small map from collider handle → flags).
- Wall detection for wall-jump (§1.7b): a second horizontal `world.castRay` from the player center along `wishDir` (or along horizontal velocity) with `maxToi = WALL_DETECT_DIST`; the wall normal = `hit.normal`. Only when airborne.
- **If shapecast wiring is not ready on day 1**, a Rapier **downward `castRay`** from feet is an acceptable interim (still colliders-only, still cheaper than the scene raycast) — but the shapecast is the recommended target because it grounds on ledges.

### 2.3 No per-frame allocations

Preallocate at module scope (next to the existing `_frontVector` etc.):
```
const _wishDir = new THREE.Vector3();
const _horizVel = new THREE.Vector3();
const DOWN = { x: 0, y: -1, z: 0 };            // plain object, reused
const groundShape = new rapier.Ball(0.45);     // created once after rapier is available (lazily in a ref)
const _shapePos = { x:0, y:0, z:0 };           // mutate fields, don't realloc
```
Mutate `.x/.y/.z` fields in place; never `new` inside `useFrame`. The current code already follows this discipline for vectors — extend it to the new ones and to the Rapier query structs (reuse a single mutable pos object).

### 2.4 The new movement step — full pseudocode (drop-in replacement for lines ~97–162)

```
// ---- read state ----
const lin = playerRef.current.linvel();
const pos = playerRef.current.translation();
let vx = lin.x, vy = lin.y, vz = lin.z;
const dt = Math.min(delta, 1/30);
const now = performance.now();

// ---- camera / TPS block stays as-is (uses pos) ----

// ---- 1. build wishDir from yaw + WASD (see §1.2) ----
const eul = _euler.setFromQuaternion(camera.quaternion, 'YXZ');
const yaw = eul.y;
const f = Number(keys.forward) - Number(keys.backward);
const s = Number(keys.right)   - Number(keys.left);
let wx = f * (-Math.sin(yaw)) + s * ( Math.cos(yaw));
let wz = f * (-Math.cos(yaw)) + s * (-Math.sin(yaw));
const wlen = Math.hypot(wx, wz);
let wishSpeed = 0;
if (wlen > 1e-4) { wx /= wlen; wz /= wlen; wishSpeed = MAX_GROUND_SPEED; }

// ---- 2. grounded via Rapier shapecast (§2.2) ----
const groundHit = castDownShape(pos);          // returns {grounded, isJumpPad, jumpForce} or null
const grounded = groundHit?.grounded ?? false;
if (grounded) lastGroundedTime = now;

// ---- 3. jump intent (buffer + coyote + autohop) ----
if (keys.jump && !jumpHeldLastFrame) lastJumpPressedTime = now;   // rising edge
const wantJump =
   bhopAssist ? keys.jump                                          // autohop: held = want
              : (keys.jump && !jumpHeldLastFrame);                 // pro: rising edge only
const buffered = (now - lastJumpPressedTime) < JUMP_BUFFER_MS;
const canGroundJump = grounded || (now - lastGroundedTime) < COYOTE_MS;

// ---- 4. horizontal integrate ----
let jumpedThisFrame = false;

if (grounded && !( (wantJump || buffered) && canGroundJump )) {
   // ---- GROUND: friction THEN accelerate (§1.3). Skip friction if we're about to jump. ----
   applyFriction();            // mutates vx,vz  (STOP_SPEED, FRICTION)
   accelerate(GROUND_ACCEL, wishSpeed, /*cap*/ wishSpeed);   // toward wishSpeed
} else {
   // ---- AIR: accelerate only, tiny cap (§1.4). No friction. ----
   accelerate(AIR_ACCEL, wishSpeed, /*cap*/ AIR_MAX_SPEED);
   applySoftCap();             // §1.6, airborne runaway control
}

// accelerate(accel, wSpeed, cap):
//   const cur = vx*wx + vz*wz;
//   const add = cap - cur;
//   if (add > 0) { const a = Math.min(accel * wSpeed * dt, add); vx += a*wx; vz += a*wz; }

// ---- 5. resolve jumps (ground / coyote / air / wall / pad) ----
if ((wantJump || buffered) && canGroundJump) {
   vy = JUMP_FORCE;                         // = 15, momentum in vx/vz untouched -> bhop
   airJumpsLeft = AIR_JUMPS;                // refill
   lastJumpPressedTime = -Infinity;         // consume buffer
   jumpedThisFrame = true;
   playJumpSound();
} else if (wantJump && !grounded) {
   const wall = castWall(pos, wx, wz);      // §1.7b, only if moving toward a wall
   if (wall && (now - lastWallJumpTime) > WALL_JUMP_LOCKOUT) {
       vy = WALL_JUMP_UP;                    // = 14
       vx += wall.nx * WALL_JUMP_PUSH; vz += wall.nz * WALL_JUMP_PUSH;
       airJumpsLeft = AIR_JUMPS;             // wall-touch refills
       lastWallJumpTime = now;
       lastJumpPressedTime = -Infinity;
       playJumpSound();
   } else if (airJumpsLeft > 0 && !jumpHeldLastFrame) {   // rising-edge air-jump
       vy = Math.max(vy, AIR_JUMP_FORCE);    // = 13
       airJumpsLeft--;
       lastJumpPressedTime = -Infinity;
       playJumpSound();
   }
}

// ---- 6. jump pad (additive/stacking, §1.7c) ----
if (groundHit?.isJumpPad) {
   const base = groundHit.jumpForce ?? JUMP_FORCE * 1.8;
   vy = Math.max(vy + PAD_BONUS, base);      // stack if arriving with up-momentum
   airJumpsLeft = AIR_JUMPS;
   playJumpSound();
}

// ---- 7. write back ----
playerRef.current.setLinvel({ x: vx, y: vy, z: vz }, true);
jumpHeldLastFrame = keys.jump;
```

All the `let` state that must survive across frames (`lastJumpPressedTime`, `lastGroundedTime`, `lastWallJumpTime`, `airJumpsLeft`, `jumpHeldLastFrame`) lives in `useRef`s (numbers), reset on `startGame`. `_euler` is a preallocated `THREE.Euler`.

### 2.5 Input plumbing notes

- `useKeyboard.ts` already exposes `forward/backward/left/right/jump/shoot/command`. **No change required** for the movement model. Optional: it uses React `setState` per keypress — fine (low frequency), but if we later want per-frame determinism we could switch to a mutable ref map. Not needed for increment 1.
- `store.ts`: add two fields — `bhopAssist: boolean` (default `true`) and (optional) `moveSpeedHud: number` for a speedometer readout. Add a setter `setBhopAssist`. Keep the movement math **out** of the store (store is React state; movement is per-frame local — see §3).

---

## 3. Multiplayer safety

- **Movement is 100% client-local & client-predicted.** Each client simulates its own player with the model above and Rapier. This is the correct architecture for a fast arena FPS — you cannot air-strafe with server-authoritative round-trips at 20 Hz.
- **What syncs (unchanged):** the existing `socket.emit("update", { x, y, z, rotation, isShooting, currentWeapon, minions })` every 50 ms. That is the player's **resulting transform**, which is all remotes need to render you. Nothing about the *movement algorithm* needs to cross the wire.
- **No server authority needed here.** Hits already go through `socket.emit("hit"/"shoot")`; that's the security-relevant channel, out of scope for this increment. Movement exploits (speedhack) are a later anti-cheat concern; for now the same soft/hard cap (§1.6) bounds worst-case observed speed, and remotes are purely visual.
- **Divergence risks to note:**
  1. *Interpolation vs. real motion:* remotes see 50 ms-quantized positions; interpolate remote players (lerp toward last `update`, ~100 ms buffer) so fast bhoppers don't teleport-stutter. (Remote render, separate component — flag for the netcode increment.)
  2. *dt determinism:* because each client uses its own frame `dt`, two clients won't produce byte-identical paths — **irrelevant** since we sync transforms, not inputs. Just don't build lockstep assumptions on this model.
  3. *Buffer/coyote are local feel only* — never gated on network state, so lag never eats a jump.
- **Sync cadence:** keep 50 ms (20 Hz). If fast movement looks choppy on remotes, the fix is remote-side interpolation, not a higher send rate.

---

## 4. Таблица тюнинга (tuning table)

| Constant | Default | Range | Feel effect |
|---|---:|---|---|
| `MAX_GROUND_SPEED` | 30 | 20–40 | Base run speed (keep current 30). |
| `GROUND_ACCEL` | 12 | 6–16 | How snappily you reach top ground speed. Higher = twitchier. |
| `FRICTION` | 6 | 3–10 | Ground stop sharpness. High = CS-crisp; low = slidey. |
| `STOP_SPEED` | 3 | 1–5 | Below this, constant friction → clean full stops (no creep). |
| `AIR_ACCEL` | 12 | 8–100 | Strength of air steering. CS≈10, Quake≈? higher. Bigger = faster speed-build & easier strafe. |
| `AIR_MAX_SPEED` | 2.0 | 0.7–8 | **The magic cap.** Small (Source ~0.76) = tight/subtle; larger (Quake) = looser, more gain. Start 2.0. |
| `JUMP_FORCE` | 15 | 10–20 | Ground jump vy (keep current 15). |
| `AIR_JUMP_FORCE` | 13 | 10–16 | Mid-air (double-jump) launch; ≤ ground jump. |
| `AIR_JUMPS` | 1 | 0–2 | Mid-air jump budget. 1 = double-jump; 2 = triple for big climbs. |
| `WALL_JUMP_UP` | 14 | 10–18 | Upward kick of a wall-jump. |
| `WALL_JUMP_PUSH` | 8 | 4–12 | Away-from-wall shove; higher = easier shaft-spiral, harder to hug. |
| `WALL_DETECT_DIST` | 0.7 | 0.5–1.2 | How close to a wall you must be to wall-jump. |
| `WALL_JUMP_LOCKOUT` | 150 | 80–300 | ms between wall-jumps off one contact; stops double-fire. |
| `PAD_BONUS` | 6 | 0–12 | Extra vy stacked onto pads when arriving with up-momentum. |
| `JUMP_BUFFER_MS` | 120 | 60–180 | Pre-land jump grace. Higher = easier bhop chains. |
| `COYOTE_MS` | 90 | 0–150 | Post-ledge jump grace. |
| `bhopAssist` | true | bool | ON = autohop (hold space). OFF = pro rising-edge timing. |
| `SOFT_CAP` | 42 | 30–60 | Free horizontal speed ceiling before bleed. |
| `HARD_CAP` | 90 | 60–150 | Absolute max horizontal speed. |
| `SOFTCAP_DRAG` | 1.5 | 0–4 | How fast excess-over-soft bleeds. 0 = pure uncapped Quake. |
| `dt clamp` | 1/30 | fixed | Max integrated step; anti-stutter. Don't raise. |

**Two named presets to A/B:**
- **"Source/CS" (default ship):** `AIR_MAX_SPEED=2.0, AIR_ACCEL=12, FRICTION=6` — tight, predictable, forgiving bhop.
- **"Quake/CPMA" (skill-ceiling):** `AIR_MAX_SPEED=6, AIR_ACCEL=40, FRICTION=6, SOFTCAP_DRAG=0` — big, fast, loose air-strafes.

---

## 5. Feel checklist (что должен проверить плейтестер)

Run in a room with a floor, a few candlestick pillars, and at least one jump pad.

1. **Ground stop is crisp.** Release keys at full run → you halt in well under a second, no ice-skating creep. (FRICTION/STOP_SPEED.)
2. **Air-strafe gains speed.** In the air, hold **A and steadily turn the mouse left** (or D + turn right) → on-screen speed **climbs past `MAX_GROUND_SPEED` (30)**. Holding **W only** in the air adds **no** speed. (This is the core proof of §1.4.)
3. **Bhop preserves momentum.** Build speed, then chain jumps with `bhopAssist` ON (hold space). Speed **does not drop** on landings; with good air-strafes it **rises** across the chain. Confirm you **don't** get yanked back to 30 on touchdown (the old lerp bug is gone).
4. **Chain 5 jumps without losing speed.** Five consecutive hops across flat ground while air-strafing → speed at hop 5 ≥ speed at hop 1.
5. **Soft cap, not a wall.** Push a long strafe-jump run → speed keeps rising but **decelerates its gain** approaching `SOFT_CAP` (42) and never exceeds `HARD_CAP` (90). It should feel like a ceiling you *lean into*, not a brick wall.
6. **Vertical climb (Chained Together).** Pad → at apex press space for the **air-jump** → toward a pillar press space for a **wall-jump** → land higher. You can gain net height repeatedly and it feels like climbing, not floating.
7. **Wall-jump keeps horizontal speed.** Approach a wall fast, wall-jump → you kick up and away **without** losing your along-wall speed.
8. **Pad stacking.** Hit a pad while already rising (e.g., right after an air-jump) → launch is **higher** than hitting it from standing.
9. **Buffer/coyote forgiveness.** Pressing space a hair early (before landing) still hops; running off a ledge and pressing space just after still jumps. Neither eats the input.
10. **Pro mode is harder.** Toggle `bhopAssist` OFF → mashing space randomly loses speed; only rhythmic, rising-edge timing chains cleanly. The skill gap is felt.
11. **60 fps hold.** With shapecast grounding (not the scene raycast), frame time is stable during heavy movement; no per-frame GC spikes (no `new` in `useFrame`).
12. **No time-distortion.** Nothing slows or freezes time on jumps/hits — motion is continuous. (Explicit owner constraint.)

---

## 6. MVP for increment 1 (минимальный играбельный срез)

**Ship FIRST (the satisfying core — do these, in order):**
1. **Split ground/air + delete the lerp.** Implement `applyFriction()` + `accelerate()` primitive; ground = friction+accel, air = accel-with-`AIR_MAX_SPEED`-cap. This alone unlocks air-strafing and momentum preservation. *(§1.3, §1.4, §1.5)*
2. **Jump without momentum reset** + **buffer (120 ms) + coyote (90 ms) + autohop** (`bhopAssist=true`). Bhop works. *(§1.5, §1.6)*
3. **Rapier down-cast grounding** (ray is acceptable day-1, shapecast preferred) replacing the `THREE.Raycaster` scene scan. *(§2.2)*
4. **Soft/hard speed cap** so runaway is bounded. *(§1.6)*
5. **Additive jump pads** (`vy = max(vy+PAD_BONUS, base)`) — one-line change to existing pad code. *(§1.7c)*
6. Wire a tiny **speedometer HUD** (horizontal speed number) — essential for tuning and for the player to *see* their skill. *(store `moveSpeedHud`)*

That subset = a genuinely fun, elite-feeling horizontal bhop/air-strafe slice with working pads. Fully playable and multiplayer-safe.

**Later polish (next increments):**
- **Air-jump budget** and **wall-jump** (the full "Chained Together" vertical). *(§1.7a, §1.7b)* — high value, do right after MVP.
- **Surf/ramp-slide** on angled candlesticks. *(§1.8)* — cheap, but sequence after wall-jump.
- **Pro/assist toggle UI** + preset switch (Source vs Quake). *(§4)*
- **Remote-player interpolation** for smooth fast-mover rendering. *(§3, netcode increment)*
- Shapecast (if MVP shipped with ray) + collider `userData` flag plumbing polish.
- Juice (owner taste, keep subtle, **no** time-warp): landing dust puff, speed-lines/FOV-kick above soft cap, jump SFX pitch scaling with chain length.

---

### References (brief)
- **Quake 3 / CPMA** — `PM_Accelerate` / `PM_AirAccelerate`, the `min(accel*wishSpeed*dt, addspeed)` with a low air cap; strafe-jumping & CPM air-control. (id Tech `bg_pmove.c`.)
- **CS 1.6 / Source (GoldSrc/Source `sv_airaccelerate`)** — low air-accel clamp (`30 ups` air cap) → bhop & surf; friction + `sv_stopspeed`. Source surf = clip-velocity-into-plane on steep ramps.
- **Titanfall 2 / Apex** — generous jump-buffer/coyote windows and wall-run/wall-jump feel; source of our forgiveness values and the wall-jump-preserves-tangent idea.
- **"Chained Together"** — satisfying skill-based vertical chaining; mapped here to air-jump budget + wall-jump + stacking pads.
