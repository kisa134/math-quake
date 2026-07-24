import { WEAPONS } from '../config/weapons';

/**
 * Live-tunable held-pose for each weapon viewmodel. Seeded from the config
 * defaults; WeaponModel reads it every frame so changes apply instantly.
 *
 * V2: `scale` is a MULTIPLIER (default 1) on top of WeaponModel's systemic
 * bbox normalization (model's longest dimension = spec.vLen). So scale 1 is
 * always visible/correct; tune it in the 0.7–1.5 range, never 0.006 again.
 * Since the browser preview is headless here (owner is the eyes), a console
 * helper lets the poses be dialed in live, then baked back into weapons.ts:
 *
 *   __wpn.set(0, { scale: 1.1, pos: [0.35,-0.4,-0.6], rot: [0.2,0.1,0] })
 *   __wpn.all()   // copy the numbers back to me
 */
export interface WeaponTune {
  scale: number; // multiplier on the vLen-normalized model
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
