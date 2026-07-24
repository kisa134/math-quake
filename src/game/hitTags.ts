import * as THREE from 'three';

/**
 * One typed contract for the `userData` tags the game raycasts against
 * (R2). Previously each component wrote a stringly-typed `userData={{...}}` and
 * the hit tests walked parents ad-hoc. `tag()` gives compile-time checking at
 * the write sites; `findTag()` is the single parent-walk implementation for the
 * read sites (Player shooting/grapple/ground probe, Editor) and for future
 * train/creature hitboxes.
 */
export interface HitTag {
  isEnemy?: boolean;
  isCreature?: boolean; // neutral critter (WS-E): damageable via damageCreature, tameable via T
  isVoxCandle?: boolean; // Teardown-style voxel candle proxy (V2.1): shots carve voxels
  isBot?: boolean; // horde voxel-dude bot proxy (V4): damage via botHitInbox/'bhit'
  isDragon?: boolean; // voxel dragon proxy (V4.1): event-sourced HP via 'dhit'
  isProp?: boolean; // V5 C9: kickable/explodable dynamic crate (propHitInbox)
  isTotem?: boolean; // V5 C3: vice totem — shoot down for the rain of coins
  isPlayer?: boolean;
  isFloor?: boolean;
  isWall?: boolean;
  isJumpPad?: boolean;
  id?: string;
  jumpForce?: number;
  friction?: number;  // per-surface friction override (WS-4 ice = low)
  isMetal?: boolean;  // magnetic boots can stick here (WS-4)
}

/** Typed factory for `userData` (identity at runtime, checked at compile time). */
export const tag = (t: HitTag): HitTag => t;

const TAGGED = ['isEnemy', 'isCreature', 'isPlayer', 'isFloor', 'isWall', 'isJumpPad'] as const;

/** Nearest ancestor (incl. self) carrying any HitTag flag, or null. */
export function findTag(o: THREE.Object3D | null): { obj: THREE.Object3D; tag: HitTag } | null {
  let cur = o;
  while (cur) {
    const ud = cur.userData as HitTag | undefined;
    if (ud && TAGGED.some((k) => ud[k])) return { obj: cur, tag: ud };
    cur = cur.parent;
  }
  return null;
}
