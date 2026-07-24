import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getDudeParts, JOINTS, LIMB } from '../game/voxHumanoid';

/**
 * V3.2 — the WHITE BLOCKY VOXEL DUDE (Paint-the-Town-Red vibe). Six parts
 * (head / torso / 2 arms / 2 legs) built from module-shared merged voxel
 * geometries → 6 draw calls per dude, zero per-dude geometry cost. Procedural
 * walk: arms/legs swing opposite phases scaled by getSpeed(), body bobs.
 * `limbMask` bit set → that limb is GONE (shot off — gore handled by caller).
 * No hit tags here: the shootable tag lives on the parent group (RemotePlayers).
 */

// one shared bone-white material for every dude on screen
const DUDE_MAT = new THREE.MeshStandardMaterial({
  color: '#f5f0e6',
  emissive: '#f5f0e6',
  emissiveIntensity: 0.14,
  roughness: 0.55,
  metalness: 0.05,
});
// dark voxel eyes so the white cube reads as a face
const EYE_MAT = new THREE.MeshBasicMaterial({ color: '#1a1a1a' });
const EYE_GEO = new THREE.BoxGeometry(0.07, 0.07, 0.03);

export const VoxDude = ({
  limbMask = 0,
  getSpeed,
}: {
  limbMask?: number;
  getSpeed?: () => number;
}) => {
  const parts = useMemo(() => getDudeParts(), []);
  const armL = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const legL = useRef<THREE.Group>(null);
  const legR = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const phase = useRef(Math.random() * Math.PI * 2);

  useFrame((state, dt) => {
    const spd = getSpeed ? getSpeed() : 0;
    const k = Math.min(1, spd / 12);
    phase.current += dt * (4 + spd * 0.55);
    const s = Math.sin(phase.current) * 0.75 * k;
    if (armL.current) armL.current.rotation.x = s;
    if (armR.current) armR.current.rotation.x = -s;
    if (legL.current) legL.current.rotation.x = -s;
    if (legR.current) legR.current.rotation.x = s;
    if (body.current) body.current.position.y = Math.abs(Math.sin(phase.current)) * 0.06 * k;
  });

  const gone = (bit: number) => (limbMask & (1 << bit)) !== 0;

  return (
    <group ref={body} position={[0, -1, 0]}>
      {/* legs (pivot at hip) */}
      {!gone(LIMB.legL) && (
        <group ref={legL} position={[-JOINTS.hipX, JOINTS.hips, 0]}>
          <mesh geometry={parts.leg} material={DUDE_MAT} />
        </group>
      )}
      {!gone(LIMB.legR) && (
        <group ref={legR} position={[JOINTS.hipX, JOINTS.hips, 0]}>
          <mesh geometry={parts.leg} material={DUDE_MAT} />
        </group>
      )}
      {/* torso (pivot at hips) */}
      <mesh geometry={parts.torso} material={DUDE_MAT} position={[0, JOINTS.hips, 0]} />
      {/* arms (pivot at shoulder) */}
      {!gone(LIMB.armL) && (
        <group ref={armL} position={[-JOINTS.shoulderX, JOINTS.shoulderY, 0]}>
          <mesh geometry={parts.arm} material={DUDE_MAT} />
        </group>
      )}
      {!gone(LIMB.armR) && (
        <group ref={armR} position={[JOINTS.shoulderX, JOINTS.shoulderY, 0]}>
          <mesh geometry={parts.arm} material={DUDE_MAT} />
        </group>
      )}
      {/* head (pivot at neck) + eyes */}
      {!gone(LIMB.head) && (
        <group position={[0, JOINTS.neck, 0]}>
          <mesh geometry={parts.head} material={DUDE_MAT} />
          <mesh geometry={EYE_GEO} material={EYE_MAT} position={[-0.1, 0.28, -0.22]} />
          <mesh geometry={EYE_GEO} material={EYE_MAT} position={[0.1, 0.28, -0.22]} />
        </group>
      )}
    </group>
  );
};
