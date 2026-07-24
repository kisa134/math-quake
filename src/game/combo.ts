/**
 * V5 C10 — KILL COMBO. Kills within 3s chain a multiplier: the kill bonus
 * grows ×(1+0.25·(n−1)), capped ×3. Module-mutable, HUD polls it. Дофамин
 * должен НАРАСТАТЬ — одиночный килл приятен, пятый подряд — экстаз.
 */
export const combo = { n: 0, until: 0 };

/** Register a kill; returns the multiplier to apply to bonuses. */
export function registerKill(): number {
  const now = Date.now();
  combo.n = now < combo.until ? combo.n + 1 : 1;
  combo.until = now + 3000;
  return Math.min(3, 1 + 0.25 * (combo.n - 1));
}
