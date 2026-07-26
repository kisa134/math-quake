import { useRef, useMemo, Suspense } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { RigidBody, CuboidCollider, type RapierRigidBody } from '@react-three/rapier';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { ROAD_DECK, ROAD_DECK_TOP } from '../config/trackSpline';
import { CAR } from '../config/vehicles';
import { useKeyboard } from '../hooks/useKeyboard';
import { useStore } from '../store';
import { tag } from '../game/hitTags';
import { PALETTE } from '../theme';
import { MATTE_WORLD_SOFT } from '../game/materials';
import { updateEngine, stopEngine } from '../utils/audio';
import { registerCarRecall } from '../game/admin';
import { worldT } from '../game/worldClock';
import { useEffect } from 'react';

/**
 * V6.1 — REAL drift cars: the owner's Synty Street-Racer bodies (EXOTIC
 * supercar / MUSCLE / SPORTS), re-shaded gloss-black with per-car accent glow,
 * bbox-normalized onto the physics box. JUICE:
 *  - wheels SPIN with speed, front wheels STEER with input
 *  - the body ROLLS into corners and PITCHES under throttle/brake (подвеска)
 *  - handbrake drift pours SMOKE from the rear arches + screeches (audio)
 *  - engine loop: V8-ish growl whose RPM follows your speed
 * Physics model unchanged (arcade grip-kill drift) — it already slides great.
 */

export const carPositions: Record<string, { x: number; y: number; z: number; heading: number }> = {};

export function tryToggleCar(px: number, py: number, pz: number): boolean {
  const st = useStore.getState();
  if (st.driving) {
    st.setDriving(null);
    stopEngine();
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

// per-car live sim data (main sim writes, per-car visual useFrame reads)
const carSim: Record<string, { fwd: number; lat: number; steer: number; thr: number; hb: boolean }> = {};

// ---- zero-alloc frame temps ----
const _q = new THREE.Quaternion();
const _fwd = new THREE.Vector3();

// ---- shared materials / geometry (module-level) ----
const wheelGeo = new THREE.CylinderGeometry(0.48, 0.48, 0.4, 12);
const wheelMat = new THREE.MeshStandardMaterial({ color: '#0b0a09', metalness: 0.5, roughness: 0.55 });
const rimMat = new THREE.MeshBasicMaterial({ color: '#c8b273', toneMapped: false });
const rimGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.42, 8);
const headlightMat = new THREE.MeshBasicMaterial({ color: PALETTE.bloomWhite, toneMapped: false });
const taillightMat = new THREE.MeshBasicMaterial({ color: '#ff2d55', toneMapped: false });
const deckEdgeMat = new THREE.MeshBasicMaterial({ color: '#ff2d55', toneMapped: false });

// car defs — the owner's Street-Racer garage
const CAR_DEFS = [
  { id: 'car-1', name: 'EXOTIC', model: 'cars/exotic.fbx', color: '#ff2d55', x: ROAD_DECK.x - 30, z: ROAD_DECK.z - 15, rotY: 0.4 },
  { id: 'car-2', name: 'MUSCLE', model: 'cars/muscle.fbx', color: '#e9c46a', x: ROAD_DECK.x, z: ROAD_DECK.z + 18, rotY: -1.1 },
  { id: 'car-3', name: 'SPORTS', model: 'cars/sports.fbx', color: '#2fbf71', x: ROAD_DECK.x + 32, z: ROAD_DECK.z - 8, rotY: 2.3 },
];

const HALF = { w: 1.1, h: 0.5, l: 2.2 };
const WHEEL_R = 0.48;

/** Synty body, re-shaded + bbox-normalized to ~4.6u length, resting on wheels. */
const SyntyCarBody = ({ model, color }: { model: string; color: string }) => {
  const fbx = useLoader(FBXLoader, `${import.meta.env.BASE_URL}${model}`);
  const body = useMemo(() => {
    const clone = fbx.clone(true);
    const mat = new THREE.MeshStandardMaterial({
      color: '#121110',
      emissive: color,
      emissiveIntensity: 0.22,
      metalness: 0.8,
      roughness: 0.28, // gloss-black с отражениями (PMREM уже в сцене)
    });
    clone.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) { m.material = mat; m.castShadow = false; m.receiveShadow = false; }
    });
    const box = new THREE.Box3().setFromObject(clone);
    const size = new THREE.Vector3();
    box.getSize(size);
    const k = 4.6 / (Math.max(size.x, size.y, size.z) || 1);
    const center = new THREE.Vector3();
    box.getCenter(center);
    const holder = new THREE.Group();
    clone.scale.setScalar(k);
    // recenter; drop so the underside sits at wheel level
    clone.position.set(-center.x * k, -center.y * k - size.y * k * 0.5 + 0.55, -center.z * k);
    holder.add(clone);
    return holder;
  }, [fbx, color]);
  return <primitive object={body} />;
};

const DriftCar = ({
  def,
  bodyRef,
}: {
  def: (typeof CAR_DEFS)[number];
  bodyRef: (b: RapierRigidBody | null) => void;
}) => {
  const tiltRef = useRef<THREE.Group>(null);
  const steerL = useRef<THREE.Group>(null);
  const steerR = useRef<THREE.Group>(null);
  const wheels = useRef<Array<THREE.Mesh | null>>([null, null, null, null]);
  const spin = useRef(0);

  // per-car visual juice: suspension roll/pitch, wheel spin + steering
  useFrame((_, dt) => {
    const sim = carSim[def.id];
    const g = tiltRef.current;
    if (!sim || !g) return;
    const targetRoll = THREE.MathUtils.clamp(-sim.lat * 0.014, -0.22, 0.22);
    const targetPitch = THREE.MathUtils.clamp(-sim.thr * 0.05 + (sim.hb ? 0.03 : 0), -0.12, 0.1);
    g.rotation.z += (targetRoll - g.rotation.z) * Math.min(1, dt * 8);
    g.rotation.x += (targetPitch - g.rotation.x) * Math.min(1, dt * 8);
    spin.current += (sim.fwd / WHEEL_R) * dt;
    for (const w of wheels.current) if (w) w.rotation.x = spin.current;
    const steerAngle = sim.steer * 0.42;
    if (steerL.current) steerL.current.rotation.y += (steerAngle - steerL.current.rotation.y) * Math.min(1, dt * 10);
    if (steerR.current) steerR.current.rotation.y += (steerAngle - steerR.current.rotation.y) * Math.min(1, dt * 10);
  });

  return (
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
      <group ref={tiltRef}>
        {/* the owner's Street-Racer body */}
        <Suspense fallback={
          <mesh material={MATTE_WORLD_SOFT}>
            <boxGeometry args={[HALF.w * 2, HALF.h * 2, HALF.l * 2]} />
          </mesh>
        }>
          <SyntyCarBody model={def.model} color={def.color} />
        </Suspense>
        {/* headlights + taillight strip */}
        <mesh position={[-HALF.w * 0.55, 0.05, -HALF.l - 0.05]} material={headlightMat}>
          <planeGeometry args={[0.45, 0.2]} />
        </mesh>
        <mesh position={[HALF.w * 0.55, 0.05, -HALF.l - 0.05]} material={headlightMat}>
          <planeGeometry args={[0.45, 0.2]} />
        </mesh>
        <mesh position={[0, 0.12, HALF.l + 0.05]} rotation={[0, Math.PI, 0]} material={taillightMat}>
          <planeGeometry args={[HALF.w * 1.5, 0.16]} />
        </mesh>
      </group>
      {/* wheels: front pair steers, all four spin */}
      <group ref={steerL} position={[-HALF.w, -HALF.h, -HALF.l * 0.62]}>
        <mesh ref={(m) => { wheels.current[0] = m; }} geometry={wheelGeo} material={wheelMat} rotation={[0, 0, Math.PI / 2]} />
        <mesh geometry={rimGeo} material={rimMat} rotation={[0, 0, Math.PI / 2]} />
      </group>
      <group ref={steerR} position={[HALF.w, -HALF.h, -HALF.l * 0.62]}>
        <mesh ref={(m) => { wheels.current[1] = m; }} geometry={wheelGeo} material={wheelMat} rotation={[0, 0, Math.PI / 2]} />
        <mesh geometry={rimGeo} material={rimMat} rotation={[0, 0, Math.PI / 2]} />
      </group>
      <group position={[-HALF.w, -HALF.h, HALF.l * 0.62]}>
        <mesh ref={(m) => { wheels.current[2] = m; }} geometry={wheelGeo} material={wheelMat} rotation={[0, 0, Math.PI / 2]} />
        <mesh geometry={rimGeo} material={rimMat} rotation={[0, 0, Math.PI / 2]} />
      </group>
      <group position={[HALF.w, -HALF.h, HALF.l * 0.62]}>
        <mesh ref={(m) => { wheels.current[3] = m; }} geometry={wheelGeo} material={wheelMat} rotation={[0, 0, Math.PI / 2]} />
        <mesh geometry={rimGeo} material={rimMat} rotation={[0, 0, Math.PI / 2]} />
      </group>
    </RigidBody>
  );
};

export const Cars = () => {
  const keys = useKeyboard();
  const bodies = useRef<Record<string, RapierRigidBody | null>>({});
  const lastSmoke = useRef(0);
  const wasDriving = useRef<string | null>(null);

  // V8.5 admin sandbox: «тачку ко мне» — car-1 teleports to the player
  useEffect(() => {
    registerCarRecall((x, y, z) => {
      const b = bodies.current['car-1'];
      if (!b) return;
      b.setTranslation({ x: x + 4, y: y + 2, z }, true);
      b.setLinvel({ x: 0, y: 0, z: 0 }, true);
    });
    return () => registerCarRecall(null);
  }, []);

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 0.1);
    const fsT = worldT(); // V8.6: the parade is identical on both clients
    const driving = useStore.getState().driving;

    // engine shutdown when we hop out by any path
    if (wasDriving.current && !driving) stopEngine();
    wasDriving.current = driving;

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
      const heading = Math.atan2(_fwd.x, _fwd.z);

      let cp = carPositions[def.id];
      if (!cp) cp = carPositions[def.id] = { x: 0, y: 0, z: 0, heading: 0 };
      cp.x = t.x; cp.y = t.y; cp.z = t.z; cp.heading = heading;

      let sim = carSim[def.id];
      if (!sim) sim = carSim[def.id] = { fwd: 0, lat: 0, steer: 0, thr: 0, hb: false };

      if (driving !== def.id) {
        // V7.5 Ц3: АВТОПИЛОТ-ПАРАД — пустые тачки кружат по деку сами.
        // Серво к аналитической точке круга = чистая f(t): оба клиента видят
        // один парад без сети; после броска машина сама возвращается на круг.
        const idx = CAR_DEFS.indexOf(def);
        const ph = fsT * 0.25 + idx * 2.1;
        const R = 24 + idx * 10;
        const tx = ROAD_DECK.x + Math.cos(ph) * R;
        const tz = ROAD_DECK.z + Math.sin(ph) * R;
        if (Math.abs(t.y - (ROAD_DECK_TOP + 1)) < 6) {
          const vel0 = body.linvel();
          let dx = tx - t.x, dz = tz - t.z;
          const d = Math.hypot(dx, dz) || 1;
          const spd = Math.min(14, d * 2);
          dx /= d; dz /= d;
          if (d > 0.4) body.setLinvel({ x: dx * spd, y: vel0.y, z: dz * spd }, true);
          const targetH = Math.atan2(dx, dz);
          const diff = Math.atan2(Math.sin(targetH - heading), Math.cos(targetH - heading));
          body.setAngvel({ x: 0, y: Math.max(-2, Math.min(2, diff * 3)), z: 0 }, true);
          sim.fwd = spd; sim.lat = 0; sim.steer = Math.max(-1, Math.min(1, diff)); sim.thr = 0.5; sim.hb = false;
        } else {
          sim.fwd *= 0.95; sim.lat *= 0.9; sim.steer *= 0.9; sim.thr *= 0.9; sim.hb = false;
        }
        continue;
      }

      // ---------------- arcade driving model (the driven car only) ----------
      const vel = body.linvel();
      let vx = vel.x, vz = vel.z;
      const fwdSpeed = vx * _fwd.x + vz * _fwd.z;
      const handbrake = keys.jump;

      let thr = 0;
      if (keys.forward) {
        vx += _fwd.x * CAR.accel * delta;
        vz += _fwd.z * CAR.accel * delta;
        thr = 1;
      } else if (keys.backward) {
        vx -= _fwd.x * CAR.reverseAccel * delta;
        vz -= _fwd.z * CAR.reverseAccel * delta;
        thr = -1;
      } else {
        const hs = Math.hypot(vx, vz);
        if (hs > 0.01) {
          const drop = Math.min(hs, CAR.idleDrag * delta);
          vx -= (vx / hs) * drop;
          vz -= (vz / hs) * drop;
        }
      }

      const steer = (keys.left ? 1 : 0) - (keys.right ? 1 : 0);
      const speedFactor = Math.min(1, Math.abs(fwdSpeed) / 10);
      const dirSign = fwdSpeed >= -0.5 ? 1 : -1;
      const yawRate = steer * CAR.turnRate * speedFactor * dirSign * (handbrake ? CAR.driftTurnBonus : 1);
      body.setAngvel({ x: 0, y: yawRate, z: 0 }, true);

      const rx = -_fwd.z, rz = _fwd.x;
      const lat = vx * rx + vz * rz;
      const grip = handbrake ? CAR.gripDrift : CAR.gripNormal;
      const kill = 1 - Math.pow(1 - grip, delta * 60);
      vx -= rx * lat * kill;
      vz -= rz * lat * kill;

      const hs2 = Math.hypot(vx, vz);
      if (hs2 > CAR.maxSpeed) {
        vx *= CAR.maxSpeed / hs2;
        vz *= CAR.maxSpeed / hs2;
      }
      const fs2 = vx * _fwd.x + vz * _fwd.z;
      if (fs2 < -CAR.maxReverse) {
        const excess = fs2 + CAR.maxReverse;
        vx -= _fwd.x * excess;
        vz -= _fwd.z * excess;
      }

      body.setLinvel({ x: vx, y: vel.y, z: vz }, true);

      // publish juice data + audio + smoke
      sim.fwd = fwdSpeed; sim.lat = lat; sim.steer = steer; sim.thr = thr; sim.hb = handbrake;
      const drifting = handbrake && Math.abs(lat) > 5 && Math.abs(fwdSpeed) > 6;
      updateEngine(Math.min(1, Math.abs(fwdSpeed) / CAR.maxSpeed), drifting);
      const now = performance.now();
      if (drifting && now - lastSmoke.current > 70) {
        lastSmoke.current = now;
        // дым из-под задних арок
        useStore.getState().addDebris([0, 1].map((side) => ({
          x: t.x + _fwd.x * -HALF.l + (side ? rx : -rx) * HALF.w,
          y: t.y - 0.4,
          z: t.z + _fwd.z * -HALF.l + (side ? rz : -rz) * HALF.w,
          vx: (Math.random() - 0.5) * 2 - _fwd.x * 2,
          vy: 1.2 + Math.random() * 1.4,
          vz: (Math.random() - 0.5) * 2 - _fwd.z * 2,
          color: '#6a675f',
          size: 0.35 + Math.random() * 0.3,
          rx: Math.random() * 4, ry: Math.random() * 4, rz: Math.random() * 4,
          life: 600 + Math.random() * 350,
        })));
      }
    }
  });

  return (
    <>
      {/* the road deck: 1 fixed body, walkable + drivable (V6 matte-black) */}
      <RigidBody type="fixed" colliders={false} position={[ROAD_DECK.x, ROAD_DECK.y, ROAD_DECK.z]}>
        <CuboidCollider args={[ROAD_DECK.w / 2, ROAD_DECK.h / 2, ROAD_DECK.d / 2]} friction={2} />
        <mesh material={MATTE_WORLD_SOFT} userData={tag({ isFloor: true })}>
          <boxGeometry args={[ROAD_DECK.w, ROAD_DECK.h, ROAD_DECK.d]} />
        </mesh>
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
