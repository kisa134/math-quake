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
  // V8 Ф2.5 look-lag: per-frame camera yaw/pitch delta (rad) — the viewmodel
  // trails the aim like a real object with mass, then catches up.
  firedAt: 0,   // performance.now() последнего выстрела — дрожь ствола
  lookX: 0,
  lookY: 0,
};
