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
}

export const WEAPONS: WeaponSpec[] = [
  { name: 'AUTO RIFLE', rate: 120, damage: 15, recoil: 0.1, sound: 800, tracer: 0x00f5d4, muzzle: '#bff9ff' },
  { name: 'SPREAD GUN', rate: 800, damage: 10, recoil: 0.4, sound: 200, spread: 0.1, rays: 8, tracer: 0xffb703, muzzle: '#ffd27a' },
  { name: 'PLASMA LAUNCHER', rate: 400, damage: 40, recoil: 0.2, sound: 400, type: 'projectile', tracer: 0xb5179e, muzzle: '#ff8be0' },
  { name: 'RAILGUN', rate: 1500, damage: 120, recoil: 0.6, sound: 100, thick: true, tracer: 0x9bffc4, muzzle: '#e8ffe8' },
];

export const weaponName = (i: number): string => WEAPONS[i]?.name ?? 'UNKNOWN';
