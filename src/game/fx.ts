/**
 * Tiny combat-FX event bus for things that live in the DOM HUD (hitmarkers)
 * but are triggered from the 3D layer (Player hitscan). Decoupled so we don't
 * churn zustand on every shot. Cosmetic only.
 */
type HitListener = (kill: boolean) => void;

const hitListeners = new Set<HitListener>();

export function onHitmarker(l: HitListener): () => void {
  hitListeners.add(l);
  return () => hitListeners.delete(l);
}

export function fireHitmarker(kill: boolean) {
  hitListeners.forEach((l) => l(kill));
}
