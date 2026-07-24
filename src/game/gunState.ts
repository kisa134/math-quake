/**
 * V5 C1 — shared gun/movement state for the CS crosshair (module-mutable,
 * written by Player.tsx each frame, read by the DOM crosshair rAF). The gap
 * breathes with run speed and current spray — точность видна глазами.
 */
export const gunState = {
  speed: 0,      // horizontal player speed (u/s)
  spread: 0,     // 0..1 current inaccuracy (spray index + minigun heat)
  heat: 0,       // minigun spin-up 0..1 (VoxWeapon barrels read this)
};
