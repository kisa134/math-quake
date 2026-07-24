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
  voxel?: 'smg' | 'shotgun' | 'ak' | 'rail' | 'minigun' | 'deagle'
    | 'db' | 'printer' | 'harpoon' | 'swan'; // V6/V7.5: procedural voxel gun instead of FBX
  portal?: boolean; // V6 Ш4: LMB places portals A/B instead of shooting
  heat?: boolean; // minigun: spread+rate scale with a spin-up heat 0..1
  slow?: number;  // movement speed multiplier while firing (minigun stomp)
}

export const WEAPONS: WeaponSpec[] = [
  // 1 — GLITCH WAND: fast auto hitscan, cyan. The starter that never stops.
  { name: 'GLITCH WAND', rate: 110, damage: 14, recoil: 0.1, sound: 800,
    tracer: 0x00f5d4, muzzle: '#bff9ff', anim: 'thrust',
    model: 'weapons/wand_01.fbx', vLen: 0.62, mScale: 1, voxel: 'smg',
    mPos: [0.29, -0.34, -0.52], mRot: [0.12, 0.06, 0] },

  // 2 — SCATTER SHOT: shotgun spread, amber. 8 pellets of margin call.
  { name: 'SCATTER SHOT', rate: 800, damage: 10, recoil: 0.4, sound: 200,
    spread: 0.1, rays: 8, tracer: 0xffb703, muzzle: '#ffd27a', anim: 'pump',
    model: 'weapons/SM_Wep_Shotgun_01.fbx', vLen: 0.78, mScale: 1, voxel: 'shotgun',
    mPos: [0.29, -0.31, -0.5], mRot: [0, -1.5, 0] },

  // 3 — PLASMA STAFF: projectile caster, magenta. The workhorse bolt-thrower.
  { name: 'PLASMA STAFF', rate: 400, damage: 40, recoil: 0.2, sound: 400,
    type: 'projectile', tracer: 0xb5179e, muzzle: '#ff8be0', anim: 'thrust',
    model: 'weapons/SM_Wep_Staff_02.fbx', vLen: 0.95, mScale: 1,
    mPos: [0.31, -0.38, -0.56], mRot: [0.12, 0.06, 0] },

  // 4 — RAIL BLADE: slow thick railgun, mint. One swing, one delete.
  { name: 'RAIL BLADE', rate: 1500, damage: 120, recoil: 0.6, sound: 100,
    thick: true, tracer: 0x9bffc4, muzzle: '#e8ffe8', anim: 'swing',
    model: 'weapons/SM_Wep_Sword_Large_01.fbx', vLen: 0.88, mScale: 1, voxel: 'rail',
    mPos: [0.29, -0.35, -0.54], mRot: [0.08, 0, 0.1] },

  // 5 — DELTA DAGGER: the owner's favorite. Fastest fire in the matrix, aqua.
  { name: 'DELTA DAGGER', rate: 70, damage: 12, recoil: 0.05, sound: 820,
    tracer: 0x64dfdf, muzzle: '#c8fafa', anim: 'slash',
    model: 'weapons/dagger_01.fbx', vLen: 0.55, mScale: 1,
    mPos: [0.27, -0.33, -0.46], mRot: [0.08, 0, 0.08] },

  // ── V4 БРУТАЛ: the gun rack ────────────────────────────────────────────────
  // 6 — KALASH GLITCH: the тратата. Hard CS spray — first 2 true, then it
  // climbs and snakes. Learn the pattern or die spraying.
  { name: 'KALASH GLITCH', rate: 105, damage: 30, recoil: 0.16, sound: 300,
    tracer: 0xff7b00, muzzle: '#ffc999', anim: 'pump',
    model: 'weapons/SM_Wep_Shotgun_01.fbx', vLen: 0.82, mScale: 1, voxel: 'ak',
    mPos: [0.28, -0.3, -0.52], mRot: [0, -1.5, 0],
    spray: [[0, 0], [0, 0], [0, 0.006], [0.002, 0.014], [-0.003, 0.023],
      [0.006, 0.031], [-0.008, 0.037], [0.011, 0.041], [-0.012, 0.044],
      [0.013, 0.046], [-0.013, 0.047], [0.014, 0.048]] },

  // 7 — SALARY SHREDDER: the minigun. Spin it up and hold the trigger —
  // тататататата. You walk slow because the barrel owns you now.
  { name: 'SALARY SHREDDER', rate: 55, damage: 9, recoil: 0.07, sound: 240,
    spread: 0.055, tracer: 0xffd166, muzzle: '#ffe9b0', anim: 'pump',
    model: 'weapons/SM_Wep_Shotgun_01.fbx', vLen: 0.95, mScale: 1, voxel: 'minigun',
    mPos: [0.3, -0.36, -0.56], mRot: [0, -1.5, 0.05],
    heat: true, slow: 0.6 },

  // 8 — MARGIN CALL: the deagle. One golden answer per question.
  { name: 'MARGIN CALL', rate: 320, damage: 62, recoil: 0.34, sound: 150,
    tracer: 0xe9c46a, muzzle: '#fff1c0', anim: 'slash',
    model: 'weapons/dagger_01.fbx', vLen: 0.42, mScale: 1, voxel: 'deagle',
    mPos: [0.27, -0.32, -0.46], mRot: [0.3, 0.12, 0.08],
    spray: [[0, 0], [0.004, 0.02], [-0.006, 0.034], [0.008, 0.042]] },

  // 9 — PORTAL RIG: как в Portal. ЛКМ ставит порталы поочерёдно (синий A /
  // оранжевый B) на пол и стены; вход в один — вылет из другого с импульсом.
  { name: 'PORTAL RIG', rate: 350, damage: 0, recoil: 0.12, sound: 620,
    tracer: 0x00b4d8, muzzle: '#9ee8ff', anim: 'thrust', portal: true,
    model: 'weapons/wand_01.fbx', vLen: 0.55, mScale: 1, voxel: 'deagle',
    mPos: [0.27, -0.32, -0.46], mRot: [0.2, 0.1, 0] },

  // ── V7.5 ЦИРК: the second rack (slots 10-16, wheel-only past 9) ────────────
  // 10 — BEAR TRAP: двустволка. One break-action wall of death, then you break
  // it open and think about your choices.
  { name: 'BEAR TRAP', rate: 1150, damage: 9, recoil: 0.8, sound: 130,
    spread: 0.13, rays: 16, tracer: 0xff5714, muzzle: '#ffb499', anim: 'pump',
    model: 'weapons/SM_Wep_Shotgun_01.fbx', vLen: 0.85, mScale: 1, voxel: 'db',
    mPos: [0.29, -0.31, -0.5], mRot: [0, -1.5, 0] },

  // 11 — HFT STITCHER: high-frequency trading в форме ствола. Быстрее кинжала;
  // спрей — длинная мелкая змейка, шьёт как швейная машинка.
  { name: 'HFT STITCHER', rate: 45, damage: 7, recoil: 0.04, sound: 950,
    tracer: 0xff4dc4, muzzle: '#ffc2ea', anim: 'thrust',
    model: 'weapons/wand_01.fbx', vLen: 0.6, mScale: 1, voxel: 'smg',
    mPos: [0.29, -0.34, -0.52], mRot: [0.12, 0.06, 0],
    spray: [[0, 0], [0, 0.002], [0.002, 0.004], [-0.002, 0.007], [0.003, 0.009],
      [-0.003, 0.012], [0.004, 0.014], [-0.004, 0.016], [0.003, 0.018],
      [-0.003, 0.019], [0.004, 0.02], [-0.004, 0.02], [0.003, 0.021],
      [-0.003, 0.021], [0.004, 0.022], [-0.004, 0.022]] },

  // 12 — FED PRINTER: брррр. Долларово-зелёные болты из станка, каретка ездит.
  { name: 'FED PRINTER', rate: 150, damage: 20, recoil: 0.1, sound: 500,
    type: 'projectile', tracer: 0x2fbf71, muzzle: '#b7f7d4', anim: 'pump',
    model: 'weapons/SM_Wep_Shotgun_01.fbx', vLen: 0.7, mScale: 1, voxel: 'printer',
    mPos: [0.29, -0.33, -0.52], mRot: [0, -1.5, 0] },

  // 13 — WHALE HARPOON: нюк-копьё на китов. Медленно, толсто, окончательно.
  { name: 'WHALE HARPOON', rate: 1000, damage: 170, recoil: 0.7, sound: 90,
    type: 'projectile', thick: true, tracer: 0x4cc9f0, muzzle: '#c9f2ff', anim: 'thrust',
    model: 'weapons/SM_Wep_Staff_02.fbx', vLen: 1.05, mScale: 1, voxel: 'harpoon',
    mPos: [0.3, -0.36, -0.56], mRot: [0.08, 0, 0] },

  // 14 — INSIDER TIP: тихий точный «псст». Белый DMR почти без спрея —
  // информация, которой не должно у тебя быть.
  { name: 'INSIDER TIP', rate: 230, damage: 48, recoil: 0.12, sound: 1250,
    tracer: 0xffffff, muzzle: '#ffffff', anim: 'slash',
    model: 'weapons/dagger_01.fbx', vLen: 0.48, mScale: 1.15, voxel: 'deagle',
    mPos: [0.27, -0.32, -0.46], mRot: [0.3, 0.12, 0.08],
    spray: [[0, 0], [0, 0], [0.002, 0.008]] },

  // 15 — LIQUIDATOR: авто-дробовик. Каскадная распродажа в упор.
  { name: 'LIQUIDATOR', rate: 340, damage: 8, recoil: 0.3, sound: 210,
    spread: 0.08, rays: 6, tracer: 0xffa62b, muzzle: '#ffd9a0', anim: 'pump',
    model: 'weapons/SM_Wep_Shotgun_01.fbx', vLen: 0.8, mScale: 1, voxel: 'shotgun',
    mPos: [0.29, -0.31, -0.5], mRot: [0, -1.5, 0] },

  // 16 — BLACK SWAN: судный день. Один белый выстрел раз в две секунды —
  // и что угодно перестаёт существовать. Никто его не предсказывает.
  { name: 'BLACK SWAN', rate: 2000, damage: 300, recoil: 1.0, sound: 60,
    thick: true, tracer: 0xffffff, muzzle: '#ffffff', anim: 'swing',
    model: 'weapons/SM_Wep_Sword_Large_01.fbx', vLen: 1.0, mScale: 1, voxel: 'swan',
    mPos: [0.29, -0.35, -0.54], mRot: [0.08, 0, 0.1] },
];

export const weaponName = (i: number): string => WEAPONS[i]?.name ?? 'UNKNOWN';
