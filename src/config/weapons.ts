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
  { name: 'GLITCH WAND', rate: 120, damage: 15, recoil: 0.1, sound: 800, tracer: 0x00f5d4, muzzle: '#bff9ff',
    model: 'weapons/SM_Wep_Staff_01.fbx', mScale: 0.006, mPos: [0.35, -0.5, -0.7], mRot: [0.2, 0.1, 0] },
  { name: 'SCATTER SHOT', rate: 800, damage: 10, recoil: 0.4, sound: 200, spread: 0.1, rays: 8, tracer: 0xffb703, muzzle: '#ffd27a',
    model: 'weapons/SM_Wep_Shotgun_01.fbx', mScale: 0.01, mPos: [0.32, -0.35, -0.6], mRot: [0, -1.5, 0] },
  { name: 'PLASMA STAFF', rate: 400, damage: 40, recoil: 0.2, sound: 400, type: 'projectile', tracer: 0xb5179e, muzzle: '#ff8be0',
    model: 'weapons/SM_Wep_Staff_02.fbx', mScale: 0.006, mPos: [0.35, -0.5, -0.7], mRot: [0.2, 0.1, 0] },
  { name: 'RAIL BLADE', rate: 1500, damage: 120, recoil: 0.6, sound: 100, thick: true, tracer: 0x9bffc4, muzzle: '#e8ffe8',
    model: 'weapons/SM_Wep_Sword_Large_01.fbx', mScale: 0.01, mPos: [0.3, -0.4, -0.7], mRot: [0.1, 0, 0.1] },
];

export const weaponName = (i: number): string => WEAPONS[i]?.name ?? 'UNKNOWN';
