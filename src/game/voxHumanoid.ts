import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { DebrisChunk } from './voxel';

/**
 * V3.2 «Paint the Town Red» pass — WHITE BLOCKY VOXEL PLAYER DUDES + gore.
 * Pure geometry/data module: builds the six body-part voxel geometries once
 * (module-level, shared by every dude on screen), and factories the voxel
 * GORE (bone-white body chunks + crimson blood + organ-pink bits) that bursts
 * out when players get shot / dismembered. Rendered by components/VoxDude.tsx.
 */

export const VOXEL = 0.14;              // one body voxel (world units)
export type LimbBit = 0 | 1 | 2 | 3 | 4; // head, armL, armR, legL, legR
export const LIMB = { head: 0, armL: 1, armR: 2, legL: 3, legR: 4 } as const;

/** Merged grid-of-cubes geometry (tiny gaps → the voxel read). */
function voxGrid(w: number, h: number, d: number, ox: number, oy: number, oz: number): THREE.BufferGeometry {
  const cube = VOXEL * 0.92;
  const parts: THREE.BufferGeometry[] = [];
  for (let x = 0; x < w; x++)
    for (let y = 0; y < h; y++)
      for (let z = 0; z < d; z++) {
        const g = new THREE.BoxGeometry(cube, cube, cube);
        g.translate(ox + (x + 0.5) * VOXEL, oy + (y + 0.5) * VOXEL, oz + (z + 0.5) * VOXEL);
        parts.push(g);
      }
  const merged = mergeGeometries(parts);
  parts.forEach((g) => g.dispose());
  return merged;
}

// Part geometries with pivots AT THE JOINT so VoxDude can swing them.
// Proportions (v = VOXEL): legs 5v, torso 5v, head 3v → ~1.8 units tall.
let _cache: {
  head: THREE.BufferGeometry;
  torso: THREE.BufferGeometry;
  arm: THREE.BufferGeometry;   // shared L/R (pivot at shoulder, hangs down)
  leg: THREE.BufferGeometry;   // shared L/R (pivot at hip, hangs down)
} | null = null;

export function getDudeParts() {
  if (_cache) return _cache;
  _cache = {
    // head 3×3×3, pivot at neck (bottom-center)
    head: voxGrid(3, 3, 3, -1.5 * VOXEL, 0, -1.5 * VOXEL),
    // torso 4×5×2, pivot at hips (bottom-center)
    torso: voxGrid(4, 5, 2, -2 * VOXEL, 0, -1 * VOXEL),
    // arm 1×4×1, pivot at shoulder (top-center) → hangs down
    arm: voxGrid(1, 4, 1, -0.5 * VOXEL, -4 * VOXEL, -0.5 * VOXEL),
    // leg 1×5×1, pivot at hip (top-center) → hangs down
    leg: voxGrid(1, 5, 1, -0.5 * VOXEL, -5 * VOXEL, -0.5 * VOXEL),
  };
  return _cache;
}

// Joint anchor points in dude-local space (feet at y=0)
export const JOINTS = {
  hips: 5 * VOXEL,               // top of legs / bottom of torso
  neck: 10 * VOXEL,              // top of torso
  shoulderY: 9.5 * VOXEL,
  shoulderX: 2.5 * VOXEL,
  hipX: 1 * VOXEL,
} as const;

// ------------------------------- GORE ---------------------------------------

const GORE_COLORS = ['#f5f0e6', '#f5f0e6', '#c9184a', '#c9184a', '#7a0c2e', '#ff758f'];

/** Voxel gore burst: bone-white body cubes + blood + organ bits flying out. */
export function makeGore(
  x: number, y: number, z: number,
  count = 10,
  kick = 7,
): Omit<DebrisChunk, 'id' | 'createdAt'>[] {
  const out: Omit<DebrisChunk, 'id' | 'createdAt'>[] = [];
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const up = 2 + Math.random() * 5;
    const k = kick * (0.5 + Math.random() * 0.8);
    out.push({
      x: x + (Math.random() - 0.5) * 0.4,
      y: y + (Math.random() - 0.5) * 0.4,
      z: z + (Math.random() - 0.5) * 0.4,
      vx: Math.cos(a) * k,
      vy: up,
      vz: Math.sin(a) * k,
      color: GORE_COLORS[Math.floor(Math.random() * GORE_COLORS.length)],
      size: 0.1 + Math.random() * 0.14,
      rx: Math.random() * 7, ry: Math.random() * 7, rz: Math.random() * 7,
      life: 900 + Math.random() * 700,
    });
  }
  return out;
}

// Cross-module inbox: socket pushes every player 'hit' here; RemotePlayers
// drains it each frame → gore burst + possible limb pop on the victim's model.
export const goreInbox: { targetId: string; damage: number }[] = [];
