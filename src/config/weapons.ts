/**
 * Single source of truth for weapon tuning + feel. Cold-path config — pure
 * data, no framework imports. V2: the arsenal is 5 PERFECT weapons instead of
 * 20 crooked ones. Visibility is SYSTEMIC, not hand-tuned: WeaponModel measures
 * each FBX with a bounding box and scales it so its longest dimension equals
 * `vLen` (meters in view space) — a weapon can never be invisible again,
 * regardless of the FBX's native units. `mScale` is now a pose MULTIPLIER on
 * top of that normalization (1 = exactly vLen long).
 *
 * Colors drive the juice pass: tracer + muzzle + a colored point light glow on
 * the viewmodel itself. `anim` picks the procedural fire animation class.
 */
export type WeaponAnim = 'slash' | 'pump' | 'thrust' | 'swing';

export interface WeaponSpec {
  name: string;
  rate: number; // ms between shots
  damage: number;
  recoil: number;
  sound: number; // base osc frequency for the shot blip
  spread?: number; // hitscan cone half-angle (shotgun)
  rays?: number; // pellets per trigger pull
  type?: 'projectile';
  thick?: boolean; // fat tracer (railgun)
  tracer: number; // laser/tracer line color (three hex)
  muzzle: string; // muzzle-flash color (css hex)
  // First-person 3D viewmodel (Synty FBX, re-shaded neon). Path is relative to
  // BASE_URL. `vLen` = normalized longest dimension in view units (the systemic
  // visibility guarantee). Pose (mPos/mRot + mScale multiplier) is tunable live
  // via window.__wpn, then baked here.
  model: string;
  vLen: number; // target longest dimension after bbox normalization
  anim: WeaponAnim; // procedural fire-animation class
  mScale: number; // pose scale MULTIPLIER on the normalized model (1 = vLen)
  mPos: [number, number, number];
  mRot: [number, number, number];
  // V4 CS gunfeel:
  spray?: [number, number][]; // fixed CS-style spray pattern (NDC offsets, climbs up); index resets after 260ms
  heat?: boolean; // minigun: spread+rate scale with a spin-up heat 0..1
  slow?: number;  // movement speed multiplier while firing (minigun stomp)
}

export const WEAPONS: WeaponSpec[] = [
  // 1 — GLITCH WAND: fast auto hitscan, cyan. The starter that never stops.
  { name: 'GLITCH WAND', rate: 110, damage: 14, recoil: 0.1, sound: 800,
    tracer: 0x00f5d4, muzzle: '#bff9ff', anim: 'thrust',
    model: 'weapons/wand_01.fbx', vLen: 0.7, mScale: 1,
    mPos: [0.34, -0.42, -0.68], mRot: [0.2, 0.1, 0] },

  // 2 — SCATTER SHOT: shotgun spread, amber. 8 pellets of margin call.
  { name: 'SCATTER SHOT', rate: 800, damage: 10, recoil: 0.4, sound: 200,
    spread: 0.1, rays: 8, tracer: 0xffb703, muzzle: '#ffd27a', anim: 'pump',
    model: 'weapons/SM_Wep_Shotgun_01.fbx', vLen: 0.8, mScale: 1,
    mPos: [0.32, -0.38, -0.62], mRot: [0, -1.5, 0] },

  // 3 — PLASMA STAFF: projectile caster, magenta. The workhorse bolt-thrower.
  { name: 'PLASMA STAFF', rate: 400, damage: 40, recoil: 0.2, sound: 400,
    type: 'projectile', tracer: 0xb5179e, muzzle: '#ff8be0', anim: 'thrust',
    model: 'weapons/SM_Wep_Staff_02.fbx', vLen: 0.95, mScale: 1,
    mPos: [0.36, -0.46, -0.72], mRot: [0.2, 0.1, 0] },

  // 4 — RAIL BLADE: slow thick railgun, mint. One swing, one delete.
  { name: 'RAIL BLADE', rate: 1500, damage: 120, recoil: 0.6, sound: 100,
    thick: true, tracer: 0x9bffc4, muzzle: '#e8ffe8', anim: 'swing',
    model: 'weapons/SM_Wep_Sword_Large_01.fbx', vLen: 0.9, mScale: 1,
    mPos: [0.32, -0.4, -0.7], mRot: [0.1, 0, 0.12] },

  // 5 — DELTA DAGGER: the owner's favorite. Fastest fire in the matrix, aqua.
  { name: 'DELTA DAGGER', rate: 70, damage: 12, recoil: 0.05, sound: 820,
    tracer: 0x64dfdf, muzzle: '#c8fafa', anim: 'slash',
    model: 'weapons/dagger_01.fbx', vLen: 0.55, mScale: 1,
    mPos: [0.3, -0.38, -0.56], mRot: [0.1, 0, 0.1] },

  // ── V4 БРУТАЛ: the gun rack ────────────────────────────────────────────────
  // 6 — KALASH GLITCH: the тратата. Hard CS spray — first 2 true, then it
  // climbs and snakes. Learn the pattern or die spraying.
  { name: 'KALASH GLITCH', rate: 105, damage: 30, recoil: 0.16, sound: 300,
    tracer: 0xff7b00, muzzle: '#ffc999', anim: 'pump',
    model: 'weapons/SM_Wep_Shotgun_01.fbx', vLen: 0.9, mScale: 1,
    mPos: [0.3, -0.36, -0.66], mRot: [0, -1.5, 0],
    spray: [[0, 0], [0, 0], [0, 0.006], [0.002, 0.014], [-0.003, 0.023],
      [0.006, 0.031], [-0.008, 0.037], [0.011, 0.041], [-0.012, 0.044],
      [0.013, 0.046], [-0.013, 0.047], [0.014, 0.048]] },

  // 7 — SALARY SHREDDER: the minigun. Spin it up and hold the trigger —
  // тататататата. You walk slow because the barrel owns you now.
  { name: 'SALARY SHREDDER', rate: 55, damage: 9, recoil: 0.07, sound: 240,
    spread: 0.055, tracer: 0xffd166, muzzle: '#ffe9b0', anim: 'pump',
    model: 'weapons/SM_Wep_Shotgun_01.fbx', vLen: 1.15, mScale: 1,
    mPos: [0.3, -0.42, -0.7], mRot: [0, -1.5, 0.06],
    heat: true, slow: 0.6 },

  // 8 — MARGIN CALL: the deagle. One golden answer per question.
  { name: 'MARGIN CALL', rate: 320, damage: 62, recoil: 0.34, sound: 150,
    tracer: 0xe9c46a, muzzle: '#fff1c0', anim: 'slash',
    model: 'weapons/dagger_01.fbx', vLen: 0.5, mScale: 1,
    mPos: [0.3, -0.36, -0.55], mRot: [0.35, 0.15, 0.1],
    spray: [[0, 0], [0.004, 0.02], [-0.006, 0.034], [0.008, 0.042]] },
];

export const weaponName = (i: number): string => WEAPONS[i]?.name ?? 'UNKNOWN';
