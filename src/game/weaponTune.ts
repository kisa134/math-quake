import { WEAPONS } from '../config/weapons';

/**
 * Live-tunable held-pose for each weapon viewmodel. Seeded from the config
 * defaults; WeaponModel reads it every frame so changes apply instantly. Since
 * the browser preview is headless here (owner is the eyes), expose a console
 * helper so the poses can be dialed in live, then baked back into weapons.ts:
 *
 *   __wpn.set(0, { scale: 0.008, pos: [0.35,-0.4,-0.6], rot: [0.2,0.1,0] })
 *   __wpn.all()   // copy the numbers back to me
 */
export interface WeaponTune {
  scale: number;
  pos: [number, number, number];
  rot: [number, number, number];
}

export const weaponTune: WeaponTune[] = WEAPONS.map((w) => ({
  scale: w.mScale,
  pos: [...w.mPos] as [number, number, number],
  rot: [...w.mRot] as [number, number, number],
}));

if (typeof window !== 'undefined') {
  (window as any).__wpn = {
    get: (i: number) => weaponTune[i],
    set: (i: number, partial: Partial<WeaponTune>) => Object.assign(weaponTune[i], partial),
    all: () => weaponTune.map((t, i) => ({ i, name: WEAPONS[i].name, ...t })),
  };
}
