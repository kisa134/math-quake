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
  isPlayer?: boolean;
  isFloor?: boolean;
  isWall?: boolean;
  isJumpPad?: boolean;
  id?: string;
  jumpForce?: number;
}

/** Typed factory for `userData` (identity at runtime, checked at compile time). */
export const tag = (t: HitTag): HitTag => t;

const TAGGED = ['isEnemy', 'isPlayer', 'isFloor', 'isWall', 'isJumpPad'] as const;

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
