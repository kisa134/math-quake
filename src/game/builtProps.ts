import { getAsset } from '../config/assets';

/**
 * МАТЕМАТИЧЕСКАЯ БАШНЯ — structural integrity + destructibility for
 * player-built pieces (Valheim rules, our voxel candles).
 *
 * A piece stands if its base rests on the GROUND or on top of another piece
 * that itself stands (support chain). Shoot the base out and everything that
 * loses its chain COLLAPSES — cascading, like Valheim. Pure logic module: no
 * framework imports, PlacedProps drains the inboxes and does the rendering.
 */

export interface BuiltPiece {
  id: string;
  assetId: string;
  x: number; y: number; z: number; // y = BASE (build pieces are bottom-origin)
  scale: number;                    // editor scale × baseScale already applied
}

/** Shots land here: PlacedProps applies damage. */
export const builtHitInbox: { id: string; damage: number }[] = [];
/** Pieces that just died / collapsed — the FX layer drains for debris+sound. */
export const builtFxInbox: { x: number; y: number; z: number; big: boolean }[] = [];

export const GROUND_Y = 0;      // tower ground plate top
const SNAP = 3.2;               // vertical tolerance «стоит на»
const HP_PER_SCALE = 110;

/** Footprint half-extents + height for a placed piece (candles are the tall ones). */
export function dims(assetId: string, scale: number): { hw: number; hd: number; h: number } {
  const spec = getAsset(assetId);
  const s = spec.baseScale * scale;
  switch (spec.prim) {
    case 'candle':   return { hw: 3 * s, hd: 3 * s, h: 24 * s };
    case 'platform': return { hw: 4 * s, hd: 4 * s, h: 0.4 * s };
    case 'floor':    return { hw: 2 * s, hd: 2 * s, h: 0.4 * s };
    case 'wall':     return { hw: 2 * s, hd: 0.2 * s, h: 3 * s };
    case 'halfwall': return { hw: 2 * s, hd: 0.2 * s, h: 1.5 * s };
    case 'pillar':   return { hw: 0.3 * s, hd: 0.3 * s, h: 4 * s };
    case 'ramp':
    case 'stairs':   return { hw: 2 * s, hd: 2.8 * s, h: 4 * s };
    default:         return { hw: 2 * s, hd: 2 * s, h: 2 * s };
  }
}

export function maxHp(assetId: string, scale: number): number {
  const d = dims(assetId, scale);
  return Math.max(60, Math.round(HP_PER_SCALE * Math.max(0.5, d.h / 24) * 1.6));
}

/** Building costs money — the bigger the candle, the dearer the tower. */
export function buildCost(assetId: string, scale: number): number {
  const d = dims(assetId, scale);
  const vol = d.hw * d.hd * d.h; // ~54 at scale 1 candle
  return Math.max(25, Math.round(vol * 0.25));
}

const overlaps = (a: BuiltPiece, b: BuiltPiece): boolean => {
  const A = dims(a.assetId, a.scale), B = dims(b.assetId, b.scale);
  return Math.abs(a.x - b.x) <= A.hw + B.hw + 0.6 && Math.abs(a.z - b.z) <= A.hd + B.hd + 0.6;
};

/**
 * Ids that LOSE their support chain (→ must collapse). Iterative flood from
 * grounded pieces upward; anything never reached is orphaned.
 */
export function findUnsupported(pieces: BuiltPiece[]): string[] {
  const standing = new Set<string>();
  // seed: everything resting on the ground
  for (const p of pieces) if (p.y <= GROUND_Y + SNAP) standing.add(p.id);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of pieces) {
      if (standing.has(p.id)) continue;
      for (const q of pieces) {
        if (q.id === p.id || !standing.has(q.id)) continue;
        const Q = dims(q.assetId, q.scale);
        const qTop = q.y + Q.h;
        if (Math.abs(p.y - qTop) <= SNAP && overlaps(p, q)) { standing.add(p.id); grew = true; break; }
      }
    }
  }
  return pieces.filter((p) => !standing.has(p.id)).map((p) => p.id);
}

/** Can this piece be placed here — does it stand on ground or on something? */
export function isSupportedAt(candidate: BuiltPiece, pieces: BuiltPiece[]): boolean {
  if (candidate.y <= GROUND_Y + SNAP) return true;
  for (const q of pieces) {
    const Q = dims(q.assetId, q.scale);
    if (Math.abs(candidate.y - (q.y + Q.h)) <= SNAP && overlaps(candidate, q)) return true;
  }
  return false;
}

// ---- altitude record (doodle-jump progression) ------------------------------
export const heightState = { now: 0, best: 0 };
export function loadBest(): void {
  try { heightState.best = +(localStorage.getItem('mq-tower-best') ?? 0) || 0; } catch { /* ok */ }
}
export function saveBest(): void {
  try { localStorage.setItem('mq-tower-best', String(Math.round(heightState.best))); } catch { /* ok */ }
}
