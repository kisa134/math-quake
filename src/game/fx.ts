/**
 * Tiny combat-FX event bus for things that live in the DOM HUD (hitmarkers)
 * but are triggered from the 3D layer (Player hitscan). Decoupled so we don't
 * churn zustand on every shot. Cosmetic only.
 */
type HitListener = (kill: boolean) => void;
type FireListener = (recoil: number) => void;

const hitListeners = new Set<HitListener>();
const fireListeners = new Set<FireListener>();

export function onHitmarker(l: HitListener): () => void {
  hitListeners.add(l);
  return () => hitListeners.delete(l);
}

export function fireHitmarker(kill: boolean) {
  hitListeners.forEach((l) => l(kill));
}

/** Fired once per shot — the dynamic crosshair blooms on it. */
export function onFire(l: FireListener): () => void {
  fireListeners.add(l);
  return () => fireListeners.delete(l);
}

export function fireShot(recoil = 0) {
  fireListeners.forEach((l) => l(recoil));
}

/** V4: a kill happened CLOSE to the camera — the HUD flashes red for 120ms. */
type FlashListener = () => void;
const flashListeners = new Set<FlashListener>();
export function onKillFlash(l: FlashListener): () => void {
  flashListeners.add(l);
  return () => flashListeners.delete(l);
}
export function fireKillFlash() {
  flashListeners.forEach((l) => l());
}
