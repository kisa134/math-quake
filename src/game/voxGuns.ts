import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { voxGrid } from './voxHumanoid';

/**
 * V6 Ш3 — VOXEL GUNS. «Оружие наконец нормальное»: узнаваемые стволы, собранные
 * в нашем вокс-языке (как чуваки и драконы) — потому что настоящих моделей
 * автоматов в паках нет, а стиль у нас свой. Каждый ган = 2-3 merged-геометрии:
 * BODY (чёрный матовый), GLOW (акцент-полосы, светятся цветом рынка), MOVING
 * (затвор/помпа/блок стволов минигана — анимируются в WeaponModel).
 * Forward = −z, построено в юнитах ~1.0 длины → скалируется под vLen.
 */
export type VoxGunKind = 'smg' | 'shotgun' | 'ak' | 'rail' | 'minigun' | 'deagle'
  | 'db' | 'printer' | 'harpoon' | 'swan';
export type MovingKind = 'bolt' | 'pump' | 'barrels';

export interface VoxGunBuild {
  body: THREE.BufferGeometry;
  glow: THREE.BufferGeometry;
  moving?: { geo: THREE.BufferGeometry; kind: MovingKind; pos: [number, number, number] };
}

const V = 0.045; // gun voxel

/** Merge helper with disposal. */
function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const m = mergeGeometries(parts);
  parts.forEach((g) => g.dispose());
  return m;
}
/** voxGrid alias in gun voxels, centered on x. */
function g(w: number, h: number, d: number, x: number, y: number, z: number) {
  return voxGrid(w, h, d, x * V - (w * V) / 2, y * V, z * V, V);
}

const cache = new Map<VoxGunKind, VoxGunBuild>();

export function buildVoxGun(kind: VoxGunKind): VoxGunBuild {
  const hit = cache.get(kind);
  if (hit) return hit;
  let b: VoxGunBuild;
  switch (kind) {
    case 'ak': {
      b = {
        body: merge([
          g(2, 3, 14, 0, 0, -12),   // receiver
          g(1, 1, 8, 0, 1, -20),    // barrel
          g(1, 2, 4, 0, 0.5, -18),  // handguard
          g(1, 3, 2, 0, -3, -8),    // grip
          g(1, 2, 5, 0, -0.5, -2),  // stock
          g(1, 3, 2, 0, -3, -13),   // magazine top
          g(1, 3, 2, 0, -5.4, -12), // magazine bottom (изогнутый рожок — ступенькой)
        ]),
        glow: merge([
          g(1, 0.8, 9, 1.1, 1.2, -14), // side stripe
          g(1, 0.8, 1, 0, 2, -20.5),   // front sight
        ]),
        moving: { geo: g(0.9, 1, 3, 1.2, 2, -10), kind: 'bolt', pos: [0, 0, 0] },
      };
      break;
    }
    case 'deagle': {
      b = {
        body: merge([
          g(1.6, 2, 8, 0, 1, -8),   // slide/frame
          g(1.2, 4, 2.4, 0, -3, -2),// grip
          g(1, 1, 1.6, 0, -0.4, -4),// trigger guard
        ]),
        glow: merge([
          g(0.8, 0.7, 1, 0, 3, -8.4), // sight
          g(0.6, 0.6, 5, 0, 0.2, -7), // barrel line
        ]),
        moving: { geo: g(1.7, 1, 4, 0, 3, -7), kind: 'bolt', pos: [0, 0, 0] },
      };
      break;
    }
    case 'smg': {
      b = {
        body: merge([
          g(1.8, 3, 9, 0, 0, -9),
          g(1, 1, 4, 0, 1, -13.5),
          g(1, 3, 1.8, 0, -3, -6),
          g(1, 2.6, 1.6, 0, -3, -9.5), // mag
        ]),
        glow: merge([
          g(1, 0.7, 6, 1, 1.4, -10),
          g(1, 0.7, 6, -1, 1.4, -10),
        ]),
        moving: { geo: g(0.8, 0.9, 2.4, 1.1, 1.6, -8), kind: 'bolt', pos: [0, 0, 0] },
      };
      break;
    }
    case 'shotgun': {
      b = {
        body: merge([
          g(1.8, 2.6, 8, 0, 0, -8),   // receiver
          g(1.1, 1.1, 10, 0, 1.4, -18), // barrel
          g(1.1, 1.1, 9, 0, 0, -17),  // mag tube
          g(1, 3, 2, 0, -3, -5),      // grip
          g(1.2, 2, 4, 0, -0.4, -1),  // stock
        ]),
        glow: merge([g(0.8, 0.6, 1.2, 0, 2.3, -18.6)]),
        moving: { geo: g(1.6, 1.4, 3.4, 0, -1.4, -14), kind: 'pump', pos: [0, 0, 0] },
      };
      break;
    }
    case 'rail': {
      b = {
        body: merge([
          g(1.4, 2, 20, 0, 0, -18),  // long rail body
          g(1, 3, 2, 0, -3, -7),     // grip
          g(1.2, 2, 4, 0, -0.4, -1), // stock
        ]),
        glow: merge([
          g(1, 1, 1.6, 0, 2.2, -6),
          g(1, 1, 1.6, 0, 2.2, -10),
          g(1, 1, 1.6, 0, 2.2, -14),
          g(1, 1, 1.6, 0, 2.2, -18), // coil cubes down the spine
        ]),
        moving: { geo: g(0.9, 0.9, 2, 1, 1.5, -9), kind: 'bolt', pos: [0, 0, 0] },
      };
      break;
    }
    case 'db': {
      // break-action double-barrel: two fat tubes + a break lever that pumps
      b = {
        body: merge([
          g(2.4, 2.2, 7, 0, 0, -6),      // receiver
          g(1.1, 1.1, 14, -0.75, 0.6, -19), // left barrel
          g(1.1, 1.1, 14, 0.75, 0.6, -19),  // right barrel
          g(1, 3, 2, 0, -3, -4),         // grip
          g(1.2, 2, 4, 0, -0.5, -1),     // stock
        ]),
        glow: merge([
          g(0.8, 0.8, 1, -0.75, 0.6, -22.5), // muzzle L
          g(0.8, 0.8, 1, 0.75, 0.6, -22.5),  // muzzle R
        ]),
        moving: { geo: g(1.8, 0.8, 2.4, 0, 1.8, -5), kind: 'pump', pos: [0, 0, 0] },
      };
      break;
    }
    case 'printer': {
      // the money printer: box + bill tray + slot barrel; the carriage prints
      b = {
        body: merge([
          g(3, 3, 6, 0, 0, -6),      // box
          g(2.6, 0.5, 3, 0, 2, -9),  // tray
          g(2, 1, 4, 0, 0.5, -11),   // slot barrel
          g(1, 3, 2, 0, -3, -4),     // grip
        ]),
        glow: merge([
          g(2.2, 0.4, 1, 0, 2.4, -9.5), // fresh bill edge
          g(1, 0.6, 3, 1.6, 0.8, -6),   // side indicator
        ]),
        moving: { geo: g(2.4, 0.7, 1.4, 0, 2.6, -8), kind: 'bolt', pos: [0, 0, 0] },
      };
      break;
    }
    case 'harpoon': {
      // whale harpoon: a long shaft, barbed head, glow rings down the spine
      b = {
        body: merge([
          g(1, 1, 26, 0, 0.5, -22),     // shaft
          g(1.6, 2, 8, 0, -0.5, -6),    // housing
          g(1, 3, 2, 0, -3, -5),        // grip
          g(1.6, 1.6, 2, 0, 0.5, -25),  // head
          g(0.6, 2, 1.6, -0.9, 0.2, -24), // barb L
          g(0.6, 2, 1.6, 0.9, 0.2, -24),  // barb R
        ]),
        glow: merge([
          g(1.4, 1.4, 0.8, 0, 0.5, -10),
          g(1.4, 1.4, 0.8, 0, 0.5, -15),
          g(1.4, 1.4, 0.8, 0, 0.5, -20),
        ]),
        moving: { geo: g(0.8, 0.8, 6, 0, 1.6, -12), kind: 'bolt', pos: [0, 0, 0] },
      };
      break;
    }
    case 'swan': {
      // doomsday bird: wing body + a neck stepping up toward the muzzle + keel
      b = {
        body: merge([
          g(2, 2.6, 10, 0, -0.5, -8),  // wing body
          g(1, 1.2, 4, 0, 0.8, -12),   // neck 1
          g(1, 1.2, 4, 0, 1.6, -15.5), // neck 2
          g(1, 1.2, 4, 0, 2.4, -19),   // neck 3
          g(1, 1.2, 4, 0, 3.2, -22.5), // neck 4 (head/muzzle)
          g(1, 3, 2, 0, -3, -7),       // grip
          g(1.2, 2, 4, 0, -0.4, -1),   // stock
        ]),
        glow: merge([
          g(0.4, 2.2, 6, 0, 2, -10),     // keel feather
          g(1.4, 0.5, 4, -1.2, 0, -8),   // wing stripe L
          g(1.4, 0.5, 4, 1.2, 0, -8),    // wing stripe R
        ]),
        moving: { geo: g(0.9, 0.9, 2, 1, 1.5, -9), kind: 'bolt', pos: [0, 0, 0] },
      };
      break;
    }
    case 'minigun': {
      // rotating barrel block: 6 thin barrels arranged around the axis
      const barrels: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const bx = Math.cos(a) * 1.4 * V;
        const by = Math.sin(a) * 1.4 * V + 0.5 * V;
        const bar = voxGrid(0.8, 0.8, 14, bx - 0.4 * V, by, -22 * V, V);
        barrels.push(bar);
      }
      b = {
        body: merge([
          g(3, 4, 7, 0, -1, -7),   // rear block
          g(2, 2, 2, 0, 0, -9.5),  // hub
          g(1, 3, 2, 0, -4.4, -5), // grip
        ]),
        glow: merge([g(2.4, 0.8, 1, 0, 3, -7), g(2.4, 0.8, 1, 0, -4.5, -8.6)]),
        moving: { geo: merge(barrels), kind: 'barrels', pos: [0, 0.5 * V, 0] },
      };
      break;
    }
  }
  cache.set(kind, b!);
  return b!;
}
