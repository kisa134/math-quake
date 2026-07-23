import { Suspense } from 'react';
import { RigidBody } from '@react-three/rapier';
import { useStore } from '../store';
import { PALETTE } from '../theme';
import { tag } from '../game/hitTags';
import { getAsset } from '../config/assets';
import { AssetModel } from '../game/modelCache';

/**
 * Renders player-built props (Valheim editor, WS-1). Each PlacedProp carries an
 * assetId + its own transform (rotY, scale) + a static/physics flag. Models come
 * from the asset registry via modelCache (GLB creatures keep textures, FBX icons
 * are neon-shaded); built-in primitives (jump pad) draw inline. Tags ride on the
 * meshes so the ground probe + hitscan see them.
 */

// Pure visual (no rigid body / transform) — reused by the editor ghost.
export const PropVisual = ({ assetId }: { assetId: string }) => {
  const spec = getAsset(assetId);
  if (spec.loader === 'primitive') {
    if (spec.prim === 'pad') {
      return (
        <mesh userData={tag(spec.tags)}>
          <cylinderGeometry args={[4, 4, 1, 20]} />
          <meshStandardMaterial color={PALETTE.bull} emissive={PALETTE.bull} emissiveIntensity={1.1} toneMapped={false} />
        </mesh>
      );
    }
    return null;
  }
  return (
    <Suspense fallback={null}>
      <AssetModel assetId={assetId} />
    </Suspense>
  );
};

export const PlacedProps = () => {
  const props = useStore((s) => s.placedProps);
  return (
    <>
      {props.map((p) => (
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
