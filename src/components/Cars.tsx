import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { RigidBody, CuboidCollider, type RapierRigidBody } from '@react-three/rapier';
import { ROAD_DECK, ROAD_DECK_TOP } from '../config/trackSpline';
import { CAR } from '../config/vehicles';
import { useKeyboard } from '../hooks/useKeyboard';
import { useStore } from '../store';
import { tag } from '../game/hitTags';
import { PALETTE } from '../theme';

/**
 * V2 WS-B — drift cars on the road deck.
 *
 * 2-3 dynamic-body arcade cars: forward push along heading, scripted yaw
 * steering, and per-frame lateral-grip kill. Handbrake (Space) drops grip
 * 0.9 → 0.15 so the car slides = дрифт. Only the car whose id === store.driving
 * is simulated with input; parked cars just sit on the deck (damping).
 */

/**
 * Live car transforms, mutated in place each frame (zero-alloc). Player.tsx
 * reads these for the chase cam + seat pinning; tryToggleCar uses them for
 * T-proximity. heading is world yaw: forward = (sin h, 0, cos h).
 */
export const carPositions: Record<string, { x: number; y: number; z: number; heading: number }> = {};

/**
 * T-interact (car part). Called from Player's keydown with the player body
 * position. Returns true if the press was consumed (entered OR exited a car) —
 * the integrator calls this first and falls through to creature taming on false.
 */
export function tryToggleCar(px: number, py: number, pz: number): boolean {
  const st = useStore.getState();
  if (st.driving) {
    st.setDriving(null); // Player.tsx pops the body out beside the car
    return true;
  }
  let best: string | null = null;
  let bestD = CAR.enterRadius * CAR.enterRadius;
  for (const id in carPositions) {
    const c = carPositions[id];
    const dx = c.x - px, dy = c.y - py, dz = c.z - pz;
    const d = dx * dx + dy * dy + dz * dz;
    if (d < bestD) { bestD = d; best = id; }
  }
  if (best) { st.setDriving(best); return true; }
  return false;
}

// ---- zero-alloc frame temps ----
const _q = new THREE.Quaternion();
const _fwd = new THREE.Vector3();

// ---- shared materials / geometry (module-level) ----
const wheelGeo = new THREE.CylinderGeometry(0.45, 0.45, 0.35, 10);
const wheelMat = new THREE.MeshStandardMaterial({ color: '#0a0a14', metalness: 0.6, roughness: 0.5 });
const headlightMat = new THREE.MeshBasicMaterial({ color: PALETTE.bloomWhite, toneMapped: false });
const taillightMat = new THREE.MeshBasicMaterial({ color: PALETTE.bear, toneMapped: false });
const deckMat = new THREE.MeshStandardMaterial({
  color: '#10142e',
  emissive: PALETTE.gridCell,
  emissiveIntensity: 0.5,
  metalness: 0.4,
  roughness: 0.7,
});
const deckEdgeMat = new THREE.MeshBasicMaterial({ color: PALETTE.uiCyan, toneMapped: false });

// car defs — parked in a row on the deck, noses (local -Z) pointing +x-ish apart
const CAR_DEFS = [
  { id: 'car-1', color: PALETTE.bull,      x: ROAD_DECK.x - 30, z: ROAD_DECK.z - 15, rotY: 0.4 },
  { id: 'car-2', color: PALETTE.bear,      x: ROAD_DECK.x,      z: ROAD_DECK.z + 18, rotY: -1.1 },
  { id: 'car-3', color: PALETTE.enemyAmber, x: ROAD_DECK.x + 32, z: ROAD_DECK.z - 8,  rotY: 2.3 },
];

// body half extents (visual box = full 2.2 × 1.0 × 4.4, forward = -Z)
const HALF = { w: 1.1, h: 0.5, l: 2.2 };

const DriftCar = ({
  def,
  bodyRef,
}: {
  def: (typeof CAR_DEFS)[number];
  bodyRef: (b: RapierRigidBody | null) => void;
}) => (
  <RigidBody
    ref={bodyRef}
    type="dynamic"
    colliders={false}
    position={[def.x, ROAD_DECK_TOP + 1.2, def.z]}
    rotation={[0, def.rotY, 0]}
    linearDamping={CAR.linearDamping}
    angularDamping={CAR.angularDamping}
    enabledRotations={[false, true, false]}
  >
    <CuboidCollider args={[HALF.w, HALF.h, HALF.l]} mass={CAR.mass} friction={0.4} />
    {/* neon body */}
    <mesh>
      <boxGeometry args={[HALF.w * 2, HALF.h * 2, HALF.l * 2]} />
      <meshStandardMaterial
        color="#0d1030"
        emissive={def.color}
        emissiveIntensity={0.55}
        metalness={0.7}
        roughness={0.3}
      />
    </mesh>
    {/* cabin */}
    <mesh position={[0, HALF.h + 0.3, 0.3]}>
      <boxGeometry args={[HALF.w * 1.6, 0.6, HALF.l * 1.1]} />
      <meshStandardMaterial color="#05050f" emissive={PALETTE.uiCyan} emissiveIntensity={0.2} metalness={0.9} roughness={0.2} />
    </mesh>
    {/* 4 wheels (static visuals, no per-wheel physics) */}
    <mesh geometry={wheelGeo} material={wheelMat} position={[-HALF.w, -HALF.h, -HALF.l * 0.6]} rotation={[0, 0, Math.PI / 2]} />
    <mesh geometry={wheelGeo} material={wheelMat} position={[HALF.w, -HALF.h, -HALF.l * 0.6]} rotation={[0, 0, Math.PI / 2]} />
    <mesh geometry={wheelGeo} material={wheelMat} position={[-HALF.w, -HALF.h, HALF.l * 0.6]} rotation={[0, 0, Math.PI / 2]} />
    <mesh geometry={wheelGeo} material={wheelMat} position={[HALF.w, -HALF.h, HALF.l * 0.6]} rotation={[0, 0, Math.PI / 2]} />
    {/* headlight quads (front = -Z) + taillights */}
    <mesh position={[-HALF.w * 0.6, 0.1, -HALF.l - 0.01]} material={headlightMat}>
      <planeGeometry args={[0.5, 0.25]} />
    </mesh>
    <mesh position={[HALF.w * 0.6, 0.1, -HALF.l - 0.01]} material={headlightMat}>
      <planeGeometry args={[0.5, 0.25]} />
    </mesh>
    <mesh position={[0, 0.1, HALF.l + 0.01]} rotation={[0, Math.PI, 0]} material={taillightMat}>
      <planeGeometry args={[HALF.w * 1.6, 0.2]} />
    </mesh>
  </RigidBody>
);

export const Cars = () => {
  const keys = useKeyboard();
  const bodies = useRef<Record<string, RapierRigidBody | null>>({});

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 0.1);
    const driving = useStore.getState().driving;

    for (const def of CAR_DEFS) {
      const body = bodies.current[def.id];
      if (!body) continue;

      const t = body.translation();
      const r = body.rotation();
      _q.set(r.x, r.y, r.z, r.w);
      _fwd.set(0, 0, -1).applyQuaternion(_q);
      _fwd.y = 0;
      const flen = _fwd.length() || 1;
      _fwd.x /= flen; _fwd.z /= flen;
      const heading = Math.atan2(_fwd.x, _fwd.z); // forward = (sin h, 0, cos h)

      // publish transform (mutate in place; allocate the record entry once)
      let cp = carPositions[def.id];
      if (!cp) cp = carPositions[def.id] = { x: 0, y: 0, z: 0, heading: 0 };
      cp.x = t.x; cp.y = t.y; cp.z = t.z; cp.heading = heading;

      if (driving !== def.id) continue; // parked: damping does the rest

      // ---------------- arcade driving model (the driven car only) ----------
      const vel = body.linvel();
      let vx = vel.x, vz = vel.z;
      const fwdSpeed = vx * _fwd.x + vz * _fwd.z;
      const handbrake = keys.jump; // Space

      // throttle / brake-reverse
      if (keys.forward) {
        vx += _fwd.x * CAR.accel * delta;
        vz += _fwd.z * CAR.accel * delta;
      } else if (keys.backward) {
        vx -= _fwd.x * CAR.reverseAccel * delta;
        vz -= _fwd.z * CAR.reverseAccel * delta;
      } else {
        // rolling drag so a released car settles instead of creeping
        const hs = Math.hypot(vx, vz);
        if (hs > 0.01) {
          const drop = Math.min(hs, CAR.idleDrag * delta);
          vx -= (vx / hs) * drop;
          vz -= (vz / hs) * drop;
        }
      }

      // steering: scripted yaw rate, scaled by speed, inverted in reverse
      const steer = (keys.left ? 1 : 0) - (keys.right ? 1 : 0);
      const speedFactor = Math.min(1, Math.abs(fwdSpeed) / 10);
      const dirSign = fwdSpeed >= -0.5 ? 1 : -1;
      const yawRate =
        steer * CAR.turnRate * speedFactor * dirSign * (handbrake ? CAR.driftTurnBonus : 1);
      body.setAngvel({ x: 0, y: yawRate, z: 0 }, true);

      // lateral grip: kill the sideways velocity component (drift = keep it)
      const rx = -_fwd.z, rz = _fwd.x; // right vector
      const lat = vx * rx + vz * rz;
      const grip = handbrake ? CAR.gripDrift : CAR.gripNormal;
      const kill = 1 - Math.pow(1 - grip, delta * 60); // framerate-independent
      vx -= rx * lat * kill;
      vz -= rz * lat * kill;

      // clamps: overall horizontal + reverse
      const hs2 = Math.hypot(vx, vz);
      if (hs2 > CAR.maxSpeed) {
        vx *= CAR.maxSpeed / hs2;
        vz *= CAR.maxSpeed / hs2;
      }
      const fs2 = vx * _fwd.x + vz * _fwd.z;
      if (fs2 < -CAR.maxReverse) {
        const excess = fs2 + CAR.maxReverse; // negative
        vx -= _fwd.x * excess;
        vz -= _fwd.z * excess;
      }

      body.setLinvel({ x: vx, y: vel.y, z: vz }, true);
    }
  });

  return (
    <>
      {/* the road deck: 1 fixed body, walkable + drivable */}
      <RigidBody type="fixed" colliders={false} position={[ROAD_DECK.x, ROAD_DECK.y, ROAD_DECK.z]}>
        <CuboidCollider args={[ROAD_DECK.w / 2, ROAD_DECK.h / 2, ROAD_DECK.d / 2]} friction={2} />
        <mesh material={deckMat} userData={tag({ isFloor: true })}>
          <boxGeometry args={[ROAD_DECK.w, ROAD_DECK.h, ROAD_DECK.d]} />
        </mesh>
        {/* neon perimeter strips */}
        <mesh position={[0, ROAD_DECK.h / 2 + 0.03, -ROAD_DECK.d / 2 + 0.4]} material={deckEdgeMat}>
          <boxGeometry args={[ROAD_DECK.w, 0.06, 0.5]} />
        </mesh>
        <mesh position={[0, ROAD_DECK.h / 2 + 0.03, ROAD_DECK.d / 2 - 0.4]} material={deckEdgeMat}>
          <boxGeometry args={[ROAD_DECK.w, 0.06, 0.5]} />
        </mesh>
        <mesh position={[-ROAD_DECK.w / 2 + 0.4, ROAD_DECK.h / 2 + 0.03, 0]} material={deckEdgeMat}>
          <boxGeometry args={[0.5, 0.06, ROAD_DECK.d]} />
        </mesh>
        <mesh position={[ROAD_DECK.w / 2 - 0.4, ROAD_DECK.h / 2 + 0.03, 0]} material={deckEdgeMat}>
          <boxGeometry args={[0.5, 0.06, ROAD_DECK.d]} />
        </mesh>
      </RigidBody>

      {CAR_DEFS.map((def) => (
        <DriftCar
          key={def.id}
          def={def}
          bodyRef={(b) => {
            bodies.current[def.id] = b;
          }}
        />
      ))}
    </>
  );
};
