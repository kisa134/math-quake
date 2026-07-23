import type { HitTag } from '../game/hitTags';

/**
 * Placeable-asset registry for the Valheim-style build editor (WS-1). Single
 * source of truth: the editor palette, the ghost, and PlacedProps rendering all
 * read this. Pure data — no framework imports.
 *
 * `src` is relative to import.meta.env.BASE_URL. GLB (Meshy creatures) keep
 * their baked textures; FBX (Synty icons, texture atlas not shipped) are
 * re-shaded to a neon emissive tint so they read in the matrix world and catch
 * Bloom. `baseScale` is a sane default size; the editor lets you scale freely.
 */
export interface AssetSpec {
  id: string;
  label: string;
  category: 'creature' | 'finance' | 'monument' | 'functional';
  src: string;              // path under BASE_URL, or '' for a built-in primitive
  loader: 'glb' | 'fbx' | 'primitive';
  baseScale: number;
  tags: HitTag;             // userData written on every instance
  neon?: boolean;           // re-shade to a single emissive color (FBX icons)
  neonColor?: string;
  prim?: 'pad' | 'candle' | 'atm'; // built-in primitive shape (functional)
}

export const ASSETS: AssetSpec[] = [
  // --- Your Meshy creatures (optimized GLB, keep textures) ---
  { id: 'skull',  label: 'WHITE SKULL',     category: 'creature', src: 'props/skull.glb',  loader: 'glb', baseScale: 6,  tags: { isFloor: true } },
  { id: 'bomber', label: 'BOMBER MASCOT',   category: 'creature', src: 'props/bomber.glb', loader: 'glb', baseScale: 6,  tags: { isFloor: true } },
  { id: 'zombie', label: 'PINK ZOMBIE HEAD',category: 'creature', src: 'props/zombie.glb', loader: 'glb', baseScale: 6,  tags: { isFloor: true } },
  { id: 'throne', label: 'THRONE CREATURE', category: 'creature', src: 'props/throne.glb', loader: 'glb', baseScale: 6,  tags: { isFloor: true } },

  // --- Finance / matrix lore icons (Synty FBX, neon-shaded) ---
  { id: 'bitcoin',   label: 'BITCOIN',   category: 'finance', src: 'props/bitcoin.fbx',   loader: 'fbx', baseScale: 0.12, tags: { isWall: true }, neon: true, neonColor: '#f7931a' },
  { id: 'dollar',    label: 'DOLLAR',    category: 'finance', src: 'props/dollar.fbx',    loader: 'fbx', baseScale: 0.12, tags: { isWall: true }, neon: true, neonColor: '#2ecc71' },
  { id: 'euro',      label: 'EURO',      category: 'finance', src: 'props/euro.fbx',      loader: 'fbx', baseScale: 0.12, tags: { isWall: true }, neon: true, neonColor: '#4361ee' },
  { id: 'yen',       label: 'YEN',       category: 'finance', src: 'props/yen.fbx',       loader: 'fbx', baseScale: 0.12, tags: { isWall: true }, neon: true, neonColor: '#f72585' },
  { id: 'coins',     label: 'COINS',     category: 'finance', src: 'props/coins.fbx',     loader: 'fbx', baseScale: 0.12, tags: { isFloor: true }, neon: true, neonColor: '#ffd700' },
  { id: 'gem',       label: 'GEM',       category: 'finance', src: 'props/gem.fbx',       loader: 'fbx', baseScale: 0.15, tags: { isWall: true }, neon: true, neonColor: '#00f5d4' },
  { id: 'crown',     label: 'CROWN',     category: 'finance', src: 'props/crown.fbx',     loader: 'fbx', baseScale: 0.15, tags: { isWall: true }, neon: true, neonColor: '#ffd700' },
  { id: 'star',      label: 'STAR',      category: 'finance', src: 'props/star.fbx',      loader: 'fbx', baseScale: 0.15, tags: { isWall: true }, neon: true, neonColor: '#ffe066' },
  { id: 'starburst', label: 'STARBURST', category: 'finance', src: 'props/starburst.fbx', loader: 'fbx', baseScale: 0.15, tags: { isWall: true }, neon: true, neonColor: '#b5179e' },
  { id: 'diamond',   label: 'DIAMOND',   category: 'finance', src: 'props/diamond.fbx',   loader: 'fbx', baseScale: 0.15, tags: { isWall: true }, neon: true, neonColor: '#4cc9f0' },

  // --- Monuments / structural (Synty FBX, neon-shaded) ---
  { id: 'statue',  label: 'STATUE',  category: 'monument', src: 'props/statue.fbx',  loader: 'fbx', baseScale: 0.06, tags: { isFloor: true }, neon: true, neonColor: '#7209b7' },
  { id: 'arch',    label: 'ARCH',    category: 'monument', src: 'props/arch.fbx',    loader: 'fbx', baseScale: 0.06, tags: { isWall: true },  neon: true, neonColor: '#4cc9f0' },
  { id: 'pillar',  label: 'PILLAR',  category: 'monument', src: 'props/pillar.fbx',  loader: 'fbx', baseScale: 0.06, tags: { isFloor: true }, neon: true, neonColor: '#3a0ca3' },

  // --- Functional built-in primitives (no model load) ---
  { id: 'pad', label: 'JUMP PAD', category: 'functional', src: '', loader: 'primitive', baseScale: 1, tags: { isJumpPad: true, jumpForce: 95 }, prim: 'pad' },
];

export const ASSET_BY_ID: Record<string, AssetSpec> = Object.fromEntries(ASSETS.map((a) => [a.id, a]));
export const getAsset = (id: string): AssetSpec => ASSET_BY_ID[id] ?? ASSETS[0];
export const ASSET_IDS = ASSETS.map((a) => a.id);
