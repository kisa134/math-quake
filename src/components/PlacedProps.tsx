import { Suspense } from 'react';
import * as THREE from 'three';
import { RigidBody } from '@react-three/rapier';
import { useStore } from '../store';
import { PALETTE } from '../theme';
import { tag } from '../game/hitTags';
import { getAsset } from '../config/assets';
import { AssetModel } from '../game/modelCache';

/**
 * Renders player-built props (Valheim × Fortnite build kit). Each PlacedProp
 * carries an assetId + its own transform (rotY, scale) + a static/physics flag.
 * Build pieces are cheap primitives drawn with MODULE-LEVEL shared geometries +
 * holo-neon materials (one material per tag-color — never per instance), so 300
 * pieces cost 300 draw calls of the same boxGeometry, zero material churn.
 * Model assets (GLB creatures / FBX icons) still render via modelCache for
 * backward-compat with old placed props. Tags ride on the meshes so the ground
 * probe + hitscan see them.
 */

// ---------- module-level shared resources (created once, never per instance) ----------
const BOX = new THREE.BoxGeometry(1, 1, 1); // every build piece = this box, sized via mesh.scale
const PAD_GEO = new THREE.CylinderGeometry(4, 4, 1, 20);

const holo = (hex: string, intensity = 0.9) =>
  new THREE.MeshStandardMaterial({
    color: hex,
    emissive: hex,
    emissiveIntensity: intensity,
    toneMapped: false,
    transparent: true,
    opacity: 0.92,
    metalness: 0.1,
    roughness: 0.35,
  });

// One shared holo material per tag-color (world-cold palette: floors mint, walls cyan).
const MAT_FLOOR = holo(PALETTE.bull);        // floors / platforms / ramps / stairs
const MAT_WALL = holo(PALETTE.uiCyan);       // walls / half walls / pillars
const MAT_PAD = holo(PALETTE.bull, 1.1);     // jump pad (kept from V1)

// Shared userData objects too — tag() is identity, these never mutate.
const TAG_FLOOR = tag({ isFloor: true });
const TAG_WALL = tag({ isWall: true });
const TAG_PAD = tag({ isJumpPad: true, jumpForce: 95 });

const R45 = Math.PI / 4;

/**
 * Pure visual (no rigid body / outer transform) — reused by the editor ghost.
 * Build-piece origins sit at the BOTTOM of the piece (Fortnite-style: the hit
 * point is the base), except the legacy pad which stays center-origin so old
 * placed pads keep their stored y. `material` lets the ghost override the
 * shared holo materials with its own tintable one (valid/invalid feedback)
 * without touching the materials placed pieces share.
 */
export const PropVisual = ({ assetId, material }: { assetId: string; material?: THREE.Material }) => {
  const spec = getAsset(assetId);
  if (spec.loader === 'primitive') {
    switch (spec.prim) {
      case 'floor':
        return <mesh geometry={BOX} material={material ?? MAT_FLOOR} userData={TAG_FLOOR} position={[0, 0.2, 0]} scale={[4, 0.4, 4]} />;
      case 'platform':
        return <mesh geometry={BOX} material={material ?? MAT_FLOOR} userData={TAG_FLOOR} position={[0, 0.2, 0]} scale={[8, 0.4, 8]} />;
      case 'ramp':
        // 4×0.4×5.66 slab pitched 45° → covers a 4-high 4-deep rise.
        return <mesh geometry={BOX} material={material ?? MAT_FLOOR} userData={TAG_FLOOR} position={[0, 2, 0]} rotation={[-R45, 0, 0]} scale={[4, 0.4, 5.66]} />;
      case 'stairs':
        // 4 solid steps (shared BOX + shared material) → 3 high, 4 deep.
        return (
          <group>
            {[0, 1, 2, 3].map((i) => (
              <mesh
                key={i}
                geometry={BOX}
                material={material ?? MAT_FLOOR}
                userData={TAG_FLOOR}
                position={[0, ((i + 1) * 0.75) / 2, 1.5 - i]}
                scale={[4, (i + 1) * 0.75, 1]}
              />
            ))}
          </group>
        );
      case 'wall':
        return <mesh geometry={BOX} material={material ?? MAT_WALL} userData={TAG_WALL} position={[0, 1.5, 0]} scale={[4, 3, 0.4]} />;
      case 'halfwall':
        return <mesh geometry={BOX} material={material ?? MAT_WALL} userData={TAG_WALL} position={[0, 0.75, 0]} scale={[4, 1.5, 0.4]} />;
      case 'pillar':
        return <mesh geometry={BOX} material={material ?? MAT_WALL} userData={TAG_WALL} position={[0, 2, 0]} scale={[0.6, 4, 0.6]} />;
      case 'pad':
        return <mesh geometry={PAD_GEO} material={material ?? MAT_PAD} userData={TAG_PAD} />;
      default:
        return null;
    }
  }
  // Backward-compat: model assets (old placed props, world decor) still render.
  return (
    <Suspense fallback={null}>
      <AssetModel assetId={assetId} />
    </Suspense>
  );
};

const MAX_VISIBLE = 300; // hard cap — oldest pieces drop out visually first

export const PlacedProps = () => {
  const props = useStore((s) => s.placedProps);
  const visible = props.length > MAX_VISIBLE ? props.slice(props.length - MAX_VISIBLE) : props;
  return (
    <>
      {visible.map((p) => (
        <RigidBody
          key={p.id}
          type={p.body}
          position={[p.x, p.y, p.z]}
          colliders="cuboid"
          enabledRotations={p.body === 'dynamic' ? undefined : [false, false, false]}
        >
          <group rotation={[0, p.rotY, 0]} scale={getAsset(p.assetId).baseScale * p.scale}>
            <PropVisual assetId={p.assetId} />
          </group>
        </RigidBody>
      ))}
    </>
  );
};
