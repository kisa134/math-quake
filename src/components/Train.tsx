import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { RigidBody, CuboidCollider, type RapierRigidBody } from '@react-three/rapier';
import { TRACK_CURVE, TRACK_LENGTH } from '../config/trackSpline';
import { TRAIN, trainTargetSpeed } from '../config/vehicles';
import { tag } from '../game/hitTags';
import { PALETTE } from '../theme';
import { conductorState } from '../game/conductor';
import { worldT } from '../game/worldClock';

/**
 * V2 WS-B — the crazy neon cyber-train.
 *
 * Loco + 3 wagons ride the closed TRACK_CURVE as kinematicPosition bodies
 * (setNextKinematicTranslation/Rotation each frame). Every hull mesh carries
 * { isFloor, isMetal, id:'train' } directly on the MESH (the Player ground
 * probe reads userData off the hit object, no parent walk) — so the flat wide
 * roofs are walkable and magnetic-boot-stickable.
 *
 * Speed is profile-driven: slow grinding climbs, screaming dives (vehicles.ts).
 */

/**
 * Carrier velocity of the train, mutated in place every frame (zero-alloc).
 * Player.tsx adds this to its own velocity while standing on the train so the
 * rider moves WITH the roof instead of sliding off the back.
 */
export const trainVelocity = { x: 0, y: 0, z: 0 };

// ---- zero-alloc frame temps ----
const _pos = new THREE.Vector3();
const _tan = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _zero = new THREE.Vector3(0, 0, 0);

const noRaycast = () => {}; // rail tube: pure visual, invisible to all rays

// ---- shared materials (module-level; toneMapped=false → true neon) ----
const hullMat = new THREE.MeshStandardMaterial({
  color: '#0d1030',
  emissive: PALETTE.accentIndigo,
  emissiveIntensity: 0.35,
  metalness: 0.7,
  roughness: 0.35,
});
const locoNoseMat = new THREE.MeshBasicMaterial({ color: PALETTE.bull, toneMapped: false });
const stripMat = new THREE.MeshBasicMaterial({ color: PALETTE.uiCyan, toneMapped: false });
const stripMagenta = new THREE.MeshBasicMaterial({ color: PALETTE.bear, toneMapped: false });
const roofMat = new THREE.MeshStandardMaterial({
  color: '#141a3a',
  emissive: PALETTE.node,
  emissiveIntensity: 0.25,
  metalness: 0.8,
  roughness: 0.4,
});
const railMat = new THREE.MeshBasicMaterial({
  color: PALETTE.uiCyan,
  toneMapped: false,
  transparent: true,
  opacity: 0.55,
});

// car dims (loco is index 0 — slightly bigger). Forward = local -Z.
const DIMS: { w: number; h: number; l: number }[] = [
  { w: 6, h: 3.2, l: 14 }, // locomotive
  { w: 6, h: 2.6, l: 12 },
  { w: 6, h: 2.6, l: 12 },
  { w: 6, h: 2.6, l: 12 },
];

/** One train car: hull box (tagged, walkable roof) + neon trim. */
const TrainCar = ({
  index,
  bodyRef,
}: {
  index: number;
  bodyRef: (b: RapierRigidBody | null) => void;
}) => {
  const { w, h, l } = DIMS[index];
  const isLoco = index === 0;
  return (
    <RigidBody ref={bodyRef} type="kinematicPosition" colliders={false} ccd>
      <CuboidCollider args={[w / 2, h / 2, l / 2]} />
      {/* hull — THE walkable/magnetic surface (tag on the mesh itself) */}
      <mesh material={hullMat} userData={tag({ isFloor: true, isMetal: true, id: 'train' })}>
        <boxGeometry args={[w, h, l]} />
      </mesh>
      {/* flat wide roof plate (also tagged → probe hits it first) */}
      <mesh
        position={[0, h / 2 + 0.05, 0]}
        material={roofMat}
        userData={tag({ isFloor: true, isMetal: true, id: 'train' })}
      >
        <boxGeometry args={[w, 0.1, l]} />
      </mesh>
      {/* neon side strips */}
      <mesh position={[w / 2 + 0.02, 0, 0]} material={isLoco ? stripMat : stripMagenta}>
        <boxGeometry args={[0.06, 0.25, l * 0.9]} />
      </mesh>
      <mesh position={[-w / 2 - 0.02, 0, 0]} material={isLoco ? stripMat : stripMagenta}>
        <boxGeometry args={[0.06, 0.25, l * 0.9]} />
      </mesh>
      {isLoco && (
        <>
          {/* glowing nose + the single headlight of the whole train */}
          <mesh position={[0, -0.2, -l / 2 - 0.3]} material={locoNoseMat}>
            <boxGeometry args={[w * 0.7, h * 0.5, 0.7]} />
          </mesh>
          <pointLight
            position={[0, 0, -l / 2 - 2]}
            color={PALETTE.bullHot}
            intensity={60}
            distance={45}
            decay={2}
          />
        </>
      )}
    </RigidBody>
  );
};

export const Train = () => {
  const bodies = useRef<(RapierRigidBody | null)[]>([null, null, null, null]);
  const dist = useRef(0);                    // arc-length travelled by the loco
  const speed = useRef(TRAIN.baseSpeed);     // current speed (chases the profile)

  // rail visual: one tube along the whole loop, no physics, no raycast
  const railGeo = useMemo(
    () => new THREE.TubeGeometry(TRACK_CURVE, 260, TRAIN.railRadius, 6, true),
    [],
  );

  useFrame((fs, rawDelta) => {
    const delta = Math.min(rawDelta, 0.1); // tab-back spike guard

    // --- speed profile: sample the loco tangent, chase the target speed ---
    const uLoco = ((dist.current % TRACK_LENGTH) + TRACK_LENGTH) % TRACK_LENGTH / TRACK_LENGTH;
    TRACK_CURVE.getTangentAt(uLoco, _tan);
    // V7.5 Ц3: поезд дышит с рынком — быстрее в памп, тяжелее в тишину
    const target = trainTargetSpeed(_tan.y) * (0.8 + 0.4 * conductorState(worldT()).speedNow);
    const dv = THREE.MathUtils.clamp(target - speed.current, -TRAIN.accelRate * delta, TRAIN.accelRate * delta);
    speed.current += dv;
    dist.current += speed.current * delta;

    // carrier velocity = loco tangent * speed (mutate in place, zero-alloc)
    trainVelocity.x = _tan.x * speed.current;
    trainVelocity.y = _tan.y * speed.current;
    trainVelocity.z = _tan.z * speed.current;

    // --- place loco + wagons at trailing arc-length offsets ---
    for (let i = 0; i < TRAIN.carCount; i++) {
      const body = bodies.current[i];
      if (!body) continue;
      const s = dist.current - i * TRAIN.carSpacing;
      const u = (((s % TRACK_LENGTH) + TRACK_LENGTH) % TRACK_LENGTH) / TRACK_LENGTH;
      TRACK_CURVE.getPointAt(u, _pos);
      TRACK_CURVE.getTangentAt(u, _tan);
      // orient: -Z faces along the travel direction (Matrix4.lookAt convention)
      _m4.lookAt(_zero, _tan, _up);
      _q.setFromRotationMatrix(_m4);
      body.setNextKinematicTranslation({
        x: _pos.x,
        y: _pos.y + TRAIN.bodyLift,
        z: _pos.z,
      });
      body.setNextKinematicRotation(_q);
    }
  });

  return (
    <>
      {Array.from({ length: TRAIN.carCount }, (_, i) => (
        <TrainCar
          key={i}
          index={i}
          bodyRef={(b) => {
            bodies.current[i] = b;
          }}
        />
      ))}
      {/* the rail: 1 mesh, visual only */}
      <mesh geometry={railGeo} material={railMat} raycast={noRaycast} />
    </>
  );
};
