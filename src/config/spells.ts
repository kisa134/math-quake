/**
 * Spell registry (WS-3) — pure data, no framework imports (cold path).
 *
 * The staff casts one of these when the player fires. `kind` drives BOTH how the
 * projectile behaves (Projectiles.tsx) and how the cast spawns it (Player.tsx):
 *   bolt    — a single travelling orb, straight line
 *   beam    — instant hitscan ray (no projectile), colored laser
 *   nova    — radial fan of `bolt` projectiles spawned at once
 *   homing  — a bolt that steers toward the nearest enemy + leaves a flame trail
 *   rainbow — MULTI-STAGE: a white-hot bolt that SPLITS mid-flight into a
 *             spectrum cone of 7 colored children (red→violet), each trailing
 *             pixel fire on impact — the "сложносочинённая" showpiece
 *   void    — heavy purple orb; impact IMPLODES (debris sucked inward) then
 *             burns purple flames
 *
 * "матрица без правил" — loud colors, cheap effects, no realism.
 */
export type SpellKind = 'none' | 'bolt' | 'beam' | 'nova' | 'homing' | 'rainbow' | 'void';

export interface SpellSpec {
  id: string;
  label: string;
  color: string;      // css/three hex — slice color, projectile tint, beam color
  kind: SpellKind;
  damage: number;
  speed: number;      // world units/sec for projectiles (0 for hitscan beams)
  cooldown?: number;  // optional ms floor between casts (heavy spells)
  novaCount?: number; // bolts in the fan (nova only)
  novaSpread?: number; // fan half-angle in radians (nova only)
  // Multi-stage fields (consumed by Projectiles.tsx):
  splitAt?: number;    // ms of flight before the bolt splits into children
  splitCount?: number; // number of spectrum children spawned at the split
}

export const SPELLS: SpellSpec[] = [
  // RAW — no spell override: the equipped weapon fires its own way (keeps the
  // 20-weapon variety). First wheel slice; default selection.
  { id: 'none',    label: 'WEAPON',   color: '#cfd8dc', kind: 'none',    damage: 0,  speed: 0 },
  // The screaming rainbow bolt: hue-cycles every frame, then SPLITS after
  // 400ms into a 7-bolt spectrum cone (red→violet), children half damage.
  { id: 'rainbow', label: 'PRISM',    color: '#ff2fd0', kind: 'rainbow', damage: 30, speed: 72, splitAt: 400, splitCount: 7 },
  // Radial burst — a ring of bolts, great for crowds.
  { id: 'nova',    label: 'NOVA',     color: '#ffd000', kind: 'nova',    damage: 20, speed: 44, cooldown: 550, novaCount: 12, novaSpread: Math.PI },
  // Seeks the nearest enemy — lazy aim, guaranteed flash.
  { id: 'homing',  label: 'SEEKER',   color: '#00ff9f', kind: 'homing',  damage: 34, speed: 42 },
  // Fat magenta plasma — the workhorse bolt.
  { id: 'plasma',  label: 'PLASMA',   color: '#b5179e', kind: 'bolt',    damage: 42, speed: 62 },
  // Fast, cold, cheap — a glassy shard.
  { id: 'ice',     label: 'ICE SHARD',color: '#9be8ff', kind: 'bolt',    damage: 26, speed: 88 },
  // Slow heavy orb — big damage; impact implodes debris inward, purple flames.
  { id: 'void',    label: 'VOID ORB', color: '#7209b7', kind: 'void',    damage: 58, speed: 26, cooldown: 500 },
  // Instant acid-green hitscan lance — no travel time.
  { id: 'beam',    label: 'RAY',      color: '#39ff14', kind: 'beam',    damage: 60, speed: 0, cooldown: 250 },
];

const BY_ID: Record<string, SpellSpec> = Object.fromEntries(SPELLS.map((s) => [s.id, s]));

/** Look up a spell by id, always returning a valid spell (falls back to rainbow). */
export const getSpell = (id: string): SpellSpec => BY_ID[id] ?? SPELLS[0];
