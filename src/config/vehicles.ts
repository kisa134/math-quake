/**
 * V2 WS-B — all vehicle tuning in one place (train speed profile + car feel).
 * Numbers here are THE knobs; Train.tsx / Cars.tsx contain no magic constants.
 */

// ---------------------------------------------------------------- TRAIN -----
export const TRAIN = {
  baseSpeed: 26,    // u/s on flat track
  diveGain: 60,     // extra u/s per unit of downward tangent (dive = screaming)
  climbLoss: 18,    // u/s lost per unit of upward tangent (climb = grinding)
  minSpeed: 10,
  maxSpeed: 72,
  accelRate: 20,    // how fast actual speed chases the profile target (u/s²)
  carSpacing: 15,   // arc-length between car centers (loco + wagons)
  carCount: 4,      // 1 locomotive + 3 wagons
  railRadius: 0.6,  // visual tube thickness
  bodyLift: 1.7,    // car center height above the rail line
} as const;

/**
 * Speed profile: sampled from the track tangent each frame.
 * tangentY < 0 → diving → speed piles on; tangentY > 0 → climbing → bleed off.
 */
export function trainTargetSpeed(tangentY: number): number {
  const s =
    TRAIN.baseSpeed +
    (tangentY < 0 ? -tangentY * TRAIN.diveGain : -tangentY * TRAIN.climbLoss);
  return Math.max(TRAIN.minSpeed, Math.min(TRAIN.maxSpeed, s));
}

// ----------------------------------------------------------------- CARS -----
export const CAR = {
  accel: 48,          // u/s² forward push while W held
  reverseAccel: 26,   // u/s² while S held (braking / reversing)
  maxSpeed: 42,       // horizontal speed clamp
  maxReverse: 14,     // reverse speed clamp (along -forward)
  turnRate: 2.7,      // rad/s yaw at full steer (scaled down at low speed)
  driftTurnBonus: 1.4,  // extra steering authority while the handbrake is down
  gripNormal: 0.9,    // fraction of LATERAL velocity killed per 1/60 s — planted
  gripDrift: 0.15,    // same, with handbrake — the car slides = дрифт
  idleDrag: 2.2,      // u/s² rolling drag with no throttle (cars settle, no creep)
  enterRadius: 4,     // T works within this distance of a car
  // physics body
  mass: 3,
  linearDamping: 0.5,
  angularDamping: 2,
} as const;
