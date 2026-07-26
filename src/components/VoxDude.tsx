import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getDudeParts, JOINTS, LIMB } from '../game/voxHumanoid';
import { WEAPONS } from '../config/weapons';
import { buildVoxGun, type VoxGunKind } from '../game/voxGuns';

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

// V9 К: чужой ствол в руке — те же вокс-геометрии, что и от первого лица,
// но общие материалы и БЕЗ рейкаста (стреляем по телу, не по железу).
const NO_RAYCAST = () => {};
const HELD_BODY_MAT = new THREE.MeshStandardMaterial({ color: '#0f0e0d', roughness: 0.55, metalness: 0.55 });
const HELD_GLOW_MAT = new THREE.MeshStandardMaterial({
  color: '#c8b273', emissive: '#c8b273', emissiveIntensity: 1.2, toneMapped: false,
});

const HeldGun = ({ weapon }: { weapon: number }) => {
  const spec = WEAPONS[weapon] ?? WEAPONS[0];
  const kind = (spec.voxel ?? 'smg') as VoxGunKind;
  const build = useMemo(() => buildVoxGun(kind), [kind]);
  return (
    <group position={[0, -0.5, 0.26]} rotation={[0.12, 0, 0]} scale={0.92}>
      <mesh geometry={build.body} material={HELD_BODY_MAT} raycast={NO_RAYCAST} />
      <mesh geometry={build.glow} material={HELD_GLOW_MAT} raycast={NO_RAYCAST} />
      {build.moving && (
        <mesh geometry={build.moving.geo} material={HELD_BODY_MAT} position={build.moving.pos} raycast={NO_RAYCAST} />
      )}
    </group>
  );
};

export const VoxDude = ({
  limbMask = 0,
  getSpeed,
  weapon,
  aiming = false,
}: {
  limbMask?: number;
  getSpeed?: () => number;
  weapon?: number;       // V9 К: ствол в правой руке — видно, чем в тебя целят
  aiming?: boolean;      // жмёт на курок → руки вскинуты вперёд
}) => {
  const parts = useMemo(() => getDudeParts(), []);
  const armL = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const legL = useRef<THREE.Group>(null);
  const legR = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const phase = useRef(Math.random() * Math.PI * 2);
  const aimK = useRef(0);
  const crawlK = useRef(0);

  // без обеих ног чувак не стоит — он ПОЛЗЁТ (V9 К)
  const noLegs = (limbMask & (1 << LIMB.legL)) !== 0 && (limbMask & (1 << LIMB.legR)) !== 0;

  useFrame((state, dt) => {
    const spd = getSpeed ? getSpeed() : 0;
    const k = Math.min(1, spd / 12);
    phase.current += dt * (4 + spd * 0.55);
    const s = Math.sin(phase.current) * 0.75 * k;
    // прицел: руки вскидываются вперёд (плавно, чтобы не дёргало)
    aimK.current += ((aiming ? 1 : 0) - aimK.current) * Math.min(1, dt * 10);
    crawlK.current += ((noLegs ? 1 : 0) - crawlK.current) * Math.min(1, dt * 6);
    const a = aimK.current;
    if (armL.current) armL.current.rotation.x = s * (1 - a) + -1.15 * a;
    if (armR.current) armR.current.rotation.x = -s * (1 - a) + -1.45 * a;
    if (legL.current) legL.current.rotation.x = -s;
    if (legR.current) legR.current.rotation.x = s;
    if (body.current) {
      // ползком корпус валится вперёд и падает к земле
      const c = crawlK.current;
      body.current.position.y = Math.abs(Math.sin(phase.current)) * 0.06 * k - 0.62 * c;
      body.current.rotation.x = -1.25 * c;
    }
  });

  const gone = (bit: number) => (limbMask & (1 << bit)) !== 0;

  return (
    <group ref={body}>
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
          {/* V9 К: ствол в кулаке — отстрелил руку, отстрелил и оружие */}
          {weapon !== undefined && <HeldGun weapon={weapon} />}
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
