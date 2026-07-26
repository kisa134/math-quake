/**
 * V5 C1 — shared gun/movement state for the CS crosshair (module-mutable,
 * written by Player.tsx each frame, read by the DOM crosshair rAF). The gap
 * breathes with run speed and current spray — точность видна глазами.
 */
// V8 Ф2: therm = per-weapon thermal state 0..1 (cold → warm → overheating).
// Player accumulates it per shot and cools it in idle; WeaponModel drives
// glow/red-hot visuals; the shot pitch rises with it.
export const gunState = {
  therm: 0,
  speed: 0,      // horizontal player speed (u/s)
  spread: 0,     // 0..1 current inaccuracy (spray index + minigun heat)
  heat: 0,       // minigun spin-up 0..1 (VoxWeapon barrels read this)
};
