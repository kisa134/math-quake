import * as THREE from 'three';

/**
 * Quake/CS-style movement core for Math Quake.
 *
 * The feel we want (owner's brief): Counter-Strike bunny-hopping (bhop),
 * Quake air-strafing / strafe-jumping, and "Chained Together" style vertical
 * chaining. The trick that makes all of this work is the classic
 * source-engine air-acceleration model: in the air we only ever add speed
 * ALONG the wish direction, capped by a very small "air cap". When you turn
 * the mouse and hold a strafe key, your velocity vector and your wish vector
 * stay under that cap, so `addSpeed` stays positive and you gain speed every
 * frame — that is air-strafing. Horizontal momentum is never lerp-reset, so
 * a well-timed jump (bhop) preserves and compounds speed.
 *
 * These are pure helpers (no allocations); the caller owns velocity + raycasts.
 */
export const MOVE = {
  // --- ground ---
  maxGroundSpeed: 30,   // top speed under your own steam on the ground (V2 feel pass: 26→30)
  groundAccel: 135,     // how hard we reach maxGroundSpeed (snappier starts)
  friction: 8,          // ground deceleration when not accelerating
  stopSpeed: 4,         // floor for friction so slow speeds still stop crisply

  // --- air (the strafe-jump engine) ---
  airAccel: 150,        // air acceleration coefficient
  airAccelCap: 3.5,     // the low wish-speed cap that enables strafe speed-gain
                        // (kept small on purpose — this IS the Quake magic)

  // --- jumping ---
  jumpVelocity: 16,     // upward velocity of a normal jump
  airJumps: 1,          // extra mid-air jumps (double-jump) → vertical chaining
  coyoteMs: 90,         // grace window to still jump just after leaving ground
  bufferMs: 130,        // press-jump-slightly-early window (feels responsive)

  // --- safety ---
  hardSpeedCap: 220,  // V6: гига-масштаб = гига-скорости    // absolute horizontal speed clamp (raised for km-city flings)

  // --- jetpack (double-tap space) ---
  jetThrust: 80,        // upward acceleration while thrusting (units/s^2)
  jetMaxUp: 22,         // cap on upward velocity from the jetpack
  jetFuelMax: 100,
  jetDrain: 45,         // fuel per second while thrusting
  jetRegen: 24,         // fuel per second when grounded (×0.3 in the air)
  doubleTapMs: 300,     // window for the second Space tap to engage the pack

  // --- grappling hook (right mouse) — Spider-Man swing pass (V3.1) ---
  grapplePull: 120,      // acceleration toward the anchor while reeling (harder yank)
  grappleRange: 900,  // V6: полгорода в досягаемости    // max latch distance — city-scale, skyscrapers in reach
  grappleRelease: 4,    // auto-detach when this close to the anchor
  grappleReel: 26,      // rope shortens this fast while holding (units/s)
  grappleBoost: 1.14,   // velocity multiplier the instant you let go (the FLING)
  swingDamp: 0.92,      // how much of the outward radial velocity the rope kills
};

const UP = new THREE.Vector3(0, 1, 0);
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');

/** Yaw (heading) of a camera, ignoring pitch/roll — for ground-plane wish dir. */
export function cameraYaw(cam: THREE.Camera): number {
  _euler.setFromQuaternion(cam.quaternion, 'YXZ');
  return _euler.y;
}

/**
 * Build a horizontal (y=0) unit wish-direction from WASD flags + camera yaw.
 * Writes into `out` and returns whether there was any input.
 */
export function wishDirection(
  out: THREE.Vector3,
  forward: boolean, backward: boolean, left: boolean, right: boolean,
  yaw: number,
): boolean {
  // camera-local: forward = -Z, right = +X
  const z = Number(backward) - Number(forward);
  const x = Number(right) - Number(left);
  out.set(x, 0, z);
  const has = out.lengthSq() > 1e-6;
  if (has) {
    out.normalize();
    out.applyAxisAngle(UP, yaw);
    out.y = 0;
    out.normalize();
  }
  return has;
}

/**
 * Source-style ground friction applied in-place to a horizontal velocity.
 * `friction` defaults to MOVE.friction; per-surface overrides (WS-4: ice = ~1)
 * let slippery decks bleed speed far more slowly than normal ground.
 */
export function applyFriction(vel: THREE.Vector3, dt: number, friction = MOVE.friction) {
  const speed = Math.hypot(vel.x, vel.z);
  if (speed < 1e-3) { vel.x = 0; vel.z = 0; return; }
  const control = speed < MOVE.stopSpeed ? MOVE.stopSpeed : speed;
  const drop = control * friction * dt;
  const scale = Math.max(speed - drop, 0) / speed;
  vel.x *= scale;
  vel.z *= scale;
}

/**
 * Quake `PM_Accelerate`: add speed along `wishDir` toward `wishSpeed`, but no
 * more than the remaining headroom (`wishSpeed - currentSpeedAlongWish`). This
 * single function powers BOTH ground accel and air-strafing — the only
 * difference is the `wishSpeed`/`accel` you pass in (air uses a tiny cap).
 */
export function accelerate(
  vel: THREE.Vector3, wishDir: THREE.Vector3, wishSpeed: number, accel: number, dt: number,
) {
  if (wishSpeed <= 0) return;
  const currentSpeed = vel.x * wishDir.x + vel.z * wishDir.z; // dot(vel, wishDir)
  const addSpeed = wishSpeed - currentSpeed;
  if (addSpeed <= 0) return;
  let accelSpeed = accel * wishSpeed * dt;
  if (accelSpeed > addSpeed) accelSpeed = addSpeed;
  vel.x += wishDir.x * accelSpeed;
  vel.z += wishDir.z * accelSpeed;
}

/** Clamp horizontal speed to the safety cap, in-place. */
export function clampHorizontal(vel: THREE.Vector3) {
  const s = Math.hypot(vel.x, vel.z);
  if (s > MOVE.hardSpeedCap) {
    const k = MOVE.hardSpeedCap / s;
    vel.x *= k;
    vel.z *= k;
  }
}
