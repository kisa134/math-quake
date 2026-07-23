/**
 * Single source of truth for weapon tuning + feel (was duplicated: numbers in
 * Player.tsx WEAPON_CONFIG, names in UI.tsx WEAPON_NAMES). Cold-path config —
 * pure data, no framework imports. Colors drive the juice pass: each weapon has
 * its own tracer + muzzle-flash color so the four guns read differently.
 */
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
  // BASE_URL; transform is the held pose (tunable live via window.__wpn, then
  // baked here). Matrix eclectic: 3 magic casters + the one real gun.
  model: string;
  mScale: number;
  mPos: [number, number, number];
  mRot: [number, number, number];
}

export const WEAPONS: WeaponSpec[] = [
  // ── magic casters ──────────────────────────────────────────────────────────
  { name: 'GLITCH WAND', rate: 120, damage: 15, recoil: 0.1, sound: 800, tracer: 0x00f5d4, muzzle: '#bff9ff',
    model: 'weapons/SM_Wep_Staff_01.fbx', mScale: 0.006, mPos: [0.35, -0.5, -0.7], mRot: [0.2, 0.1, 0] },
  { name: 'SCATTER SHOT', rate: 800, damage: 10, recoil: 0.4, sound: 200, spread: 0.1, rays: 8, tracer: 0xffb703, muzzle: '#ffd27a',
    model: 'weapons/SM_Wep_Shotgun_01.fbx', mScale: 0.01, mPos: [0.32, -0.35, -0.6], mRot: [0, -1.5, 0] },
  { name: 'PLASMA STAFF', rate: 400, damage: 40, recoil: 0.2, sound: 400, type: 'projectile', tracer: 0xb5179e, muzzle: '#ff8be0',
    model: 'weapons/SM_Wep_Staff_02.fbx', mScale: 0.006, mPos: [0.35, -0.5, -0.7], mRot: [0.2, 0.1, 0] },
  { name: 'RAIL BLADE', rate: 1500, damage: 120, recoil: 0.6, sound: 100, thick: true, tracer: 0x9bffc4, muzzle: '#e8ffe8',
    model: 'weapons/SM_Wep_Sword_Large_01.fbx', mScale: 0.01, mPos: [0.3, -0.4, -0.7], mRot: [0.1, 0, 0.1] },

  // ── more casters (staffs / wands / orbs / tomes) ───────────────────────────
  { name: 'HEX WAND', rate: 90, damage: 12, recoil: 0.08, sound: 900, tracer: 0x9d4edd, muzzle: '#d9b8ff',
    model: 'weapons/wand_01.fbx', mScale: 0.008, mPos: [0.34, -0.46, -0.66], mRot: [0.2, 0.1, 0] },
  { name: 'ARCH STAFF', rate: 260, damage: 34, recoil: 0.18, sound: 520, tracer: 0x48cae4, muzzle: '#b8f0ff',
    model: 'weapons/wizardstaff_01.fbx', mScale: 0.006, mPos: [0.35, -0.5, -0.72], mRot: [0.2, 0.1, 0] },
  { name: 'GOLD SCEPTRE', rate: 500, damage: 55, recoil: 0.25, sound: 440, tracer: 0xffd60a, muzzle: '#fff1a8',
    model: 'weapons/sceptre_01.fbx', mScale: 0.007, mPos: [0.34, -0.48, -0.68], mRot: [0.2, 0.1, 0] },
  { name: 'DRUID ROD', rate: 180, damage: 22, recoil: 0.12, sound: 640, tracer: 0x52b788, muzzle: '#bff5d6',
    model: 'weapons/druid_staff_01.fbx', mScale: 0.006, mPos: [0.35, -0.5, -0.72], mRot: [0.2, 0.1, 0] },
  { name: 'ORACLE ORB', rate: 350, damage: 40, recoil: 0.15, sound: 700, type: 'projectile', tracer: 0xff5d8f, muzzle: '#ffc2d6',
    model: 'weapons/crystal_ball_01.fbx', mScale: 0.012, mPos: [0.3, -0.4, -0.6], mRot: [0, 0, 0] },
  { name: 'TOME OF FORK', rate: 600, damage: 20, recoil: 0.3, sound: 300, spread: 0.05, rays: 3, tracer: 0x2ec4b6, muzzle: '#a8f0e8',
    model: 'weapons/spellbook_01.fbx', mScale: 0.01, mPos: [0.32, -0.42, -0.6], mRot: [0.3, 0.2, 0] },

  // ── melee-flavored blades (fast neon-slash hitscan) ────────────────────────
  { name: 'LEDGER BLADE', rate: 140, damage: 30, recoil: 0.12, sound: 620, tracer: 0x06ffa5, muzzle: '#c2ffe8',
    model: 'weapons/sword_01.fbx', mScale: 0.01, mPos: [0.3, -0.4, -0.68], mRot: [0.1, 0, 0.12] },
  { name: 'SHIV', rate: 80, damage: 14, recoil: 0.06, sound: 780, tracer: 0xccff33, muzzle: '#eaffb0',
    model: 'weapons/sword_small_01.fbx', mScale: 0.011, mPos: [0.3, -0.38, -0.62], mRot: [0.1, 0, 0.12] },
  { name: 'RAPIER OF YIELD', rate: 110, damage: 20, recoil: 0.09, sound: 700, tracer: 0xa0f0ff, muzzle: '#dbfaff',
    model: 'weapons/rapier_01.fbx', mScale: 0.01, mPos: [0.3, -0.4, -0.72], mRot: [0.08, 0, 0.14] },
  { name: 'ORNATE EDGE', rate: 300, damage: 48, recoil: 0.22, sound: 500, thick: true, tracer: 0xf1c40f, muzzle: '#fff0b0',
    model: 'weapons/sword_ornate_01.fbx', mScale: 0.01, mPos: [0.3, -0.4, -0.7], mRot: [0.1, 0, 0.12] },

  // ── heavy melee (slow, huge damage, thick beam) ────────────────────────────
  { name: 'FORK AXE', rate: 700, damage: 75, recoil: 0.4, sound: 180, thick: true, tracer: 0xff7b00, muzzle: '#ffcf99',
    model: 'weapons/axe_01.fbx', mScale: 0.01, mPos: [0.32, -0.45, -0.65], mRot: [0.1, 0, 0.1] },
  { name: 'MACE OF MARGIN', rate: 650, damage: 70, recoil: 0.38, sound: 200, thick: true, tracer: 0xff4d6d, muzzle: '#ffb3c1',
    model: 'weapons/mace_01.fbx', mScale: 0.01, mPos: [0.32, -0.45, -0.65], mRot: [0.1, 0, 0.1] },
  { name: 'STAKE HAMMER', rate: 900, damage: 95, recoil: 0.5, sound: 130, thick: true, tracer: 0xef233c, muzzle: '#ffa0ad',
    model: 'weapons/mace_02.fbx', mScale: 0.01, mPos: [0.32, -0.46, -0.65], mRot: [0.1, 0, 0.1] },

  // ── daggers / throwers ─────────────────────────────────────────────────────
  { name: 'DELTA DAGGER', rate: 70, damage: 12, recoil: 0.05, sound: 820, tracer: 0x64dfdf, muzzle: '#c8fafa',
    model: 'weapons/dagger_01.fbx', mScale: 0.013, mPos: [0.3, -0.4, -0.58], mRot: [0.1, 0, 0.1] },
  { name: 'SHORT SELL', rate: 250, damage: 40, recoil: 0.1, sound: 760, type: 'projectile', tracer: 0xcaf0f8, muzzle: '#e8fbff',
    model: 'weapons/throwingknife_01.fbx', mScale: 0.013, mPos: [0.3, -0.4, -0.6], mRot: [0.1, 0, 0.1] },

  // ── spears / pikes (long reach, colored lance beam) ────────────────────────
  { name: 'LONG SPEAR', rate: 400, damage: 60, recoil: 0.28, sound: 360, tracer: 0x7209b7, muzzle: '#d3a8ff',
    model: 'weapons/spear_01.fbx', mScale: 0.007, mPos: [0.34, -0.5, -0.9], mRot: [-0.15, 0, 0] },
  { name: 'PIERCE PIKE', rate: 550, damage: 85, recoil: 0.35, sound: 320, thick: true, tracer: 0x8338ec, muzzle: '#cbb2ff',
    model: 'weapons/spear_02.fbx', mScale: 0.007, mPos: [0.34, -0.5, -0.92], mRot: [-0.15, 0, 0] },
];

export const weaponName = (i: number): string => WEAPONS[i]?.name ?? 'UNKNOWN';
