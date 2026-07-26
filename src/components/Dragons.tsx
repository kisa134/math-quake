import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../store';
import { tag } from '../game/hitTags';
import { socket } from '../socket';
import { addTrauma } from '../game/shake';
import { playExplosionSound } from '../utils/audio';
import { makeGore } from '../game/voxHumanoid';
import {
  DRAGONS, DJOINT, getDragonParts, wildDragonPos, dragonState, dragonAlive,
  dragonFxInbox, RAINBOW,
} from '../game/voxDragon';
import { worldT } from '../game/worldClock';

/**
 * V4.1 — renders the four voxel dragons. Wild ones fly deterministic analytic
 * patrols (zero net traffic); a dragon ridden by ME follows `dragonRide` (the
 * flight sim lives in Player.tsx); one ridden by a PEER follows that player's
 * interpolated position from the update payload (`dragon` field). Each dragon:
 * 5 meshes (body/head/2 wings/tail, module-shared voxel geometries) + an
 * invisible hit proxy (isDragon) — shootable, event-sourced HP, death = huge
 * rainbow-bone burst, resurrect in 60s.
 */
const NO_RAYCAST = () => {};
const _wild = { x: 0, y: 0, z: 0, heading: 0 };

// Mounted-flight shared state (Player writes, we read; zero-alloc)
export const dragonRide = { x: 0, y: 0, z: 0, heading: 0, pitch: 0, active: false };

/** T-interact: mount the nearest living unridden dragon within reach. */
export function tryMountDragon(px: number, py: number, pz: number): boolean {
  const st = useStore.getState();
  if (st.ridingDragon !== null) { // dismount
    const id = st.ridingDragon;
    st.setRidingDragon(null);
    if (dragonState[id]) dragonState[id].riddenBy = null;
    socket.emit('ddismount', { id });
    return true;
  }
  const t = worldT(); // V8.6: FIX — mount used a different clock than render (~60u miss)
  for (const d of DRAGONS) {
    if (!dragonAlive(d.id) || dragonState[d.id].riddenBy) continue;
    wildDragonPos(d, t, _wild);
    const dx = _wild.x - px, dy = _wild.y - py, dz = _wild.z - pz;
    if (dx * dx + dy * dy + dz * dz < (9 * d.scale) ** 2) {
      dragonState[d.id].riddenBy = socket.id;
      useStore.getState().setRidingDragon(d.id);
      dragonRide.x = _wild.x; dragonRide.y = _wild.y; dragonRide.z = _wild.z;
      dragonRide.heading = _wild.heading;
      socket.emit('dmount', { id: d.id });
      return true;
    }
  }
  return false;
}

const DRAGON_MAT = new THREE.MeshStandardMaterial({
  color: '#f5f0e6', emissive: '#f5f0e6', emissiveIntensity: 0.12,
  roughness: 0.5, metalness: 0.1,
});
const EYE_MAT = new THREE.MeshBasicMaterial({ color: '#ff2fd0', toneMapped: false });

const DragonMesh = ({ def }: { def: (typeof DRAGONS)[number] }) => {
  const parts = useMemo(() => getDragonParts(), []);
  const root = useRef<THREE.Group>(null);
  const wingL = useRef<THREE.Group>(null);
  const wingR = useRef<THREE.Group>(null);
  const tail = useRef<THREE.Group>(null);
  const proxy = useRef<THREE.Mesh>(null);
  const { camera } = useThree();

  useFrame((state) => {
    const g = root.current;
    if (!g) return;
    const st = useStore.getState();
    const s = dragonState[def.id];
    const alive = dragonAlive(def.id);
    g.visible = alive;
    if (proxy.current) proxy.current.position.set(0, -900 - def.id * 10, 0);
    if (!alive) return;

    const t = worldT(); // V8.6 shared wall clock
    let flap = 0.18;
    if (st.ridingDragon === def.id) {
      // I ride it — follow the flight sim
      g.position.set(dragonRide.x, dragonRide.y, dragonRide.z);
      g.rotation.set(dragonRide.pitch * 0.6, dragonRide.heading, 0);
      flap = 0.55;
    } else if (s.riddenBy) {
      // a peer rides it — sit under their interpolated body
      const rider = Object.values(st.remotePlayers).find((p) => p.id === s.riddenBy);
      if (rider) {
        g.position.set(rider.x, rider.y - 1.2, rider.z);
        g.rotation.set(0, rider.rotation, 0);
        flap = 0.55;
      }
    } else {
      wildDragonPos(def, t, _wild);
      g.position.set(_wild.x, _wild.y, _wild.z);
      g.rotation.set(0, _wild.heading, 0);
    }
    const w = Math.sin(t * 6 + def.phase) * flap;
    if (wingL.current) wingL.current.rotation.z = -0.25 - w;
    if (wingR.current) wingR.current.rotation.z = 0.25 + w;
    if (tail.current) tail.current.rotation.y = Math.sin(t * 2 + def.phase) * 0.3;
    if (proxy.current) proxy.current.position.copy(g.position);
  });

  return (
    <>
      <group ref={root} scale={def.scale}>
        <mesh geometry={parts.body} material={DRAGON_MAT} />
        <group position={[DJOINT.head[0], DJOINT.head[1], DJOINT.head[2]]}>
          <mesh geometry={parts.head} material={DRAGON_MAT} />
          <mesh material={EYE_MAT} position={[-0.18, 0.15, -0.6]}>
            <boxGeometry args={[0.1, 0.1, 0.05]} />
          </mesh>
          <mesh material={EYE_MAT} position={[0.18, 0.15, -0.6]}>
            <boxGeometry args={[0.1, 0.1, 0.05]} />
          </mesh>
        </group>
        <group ref={wingL} position={[DJOINT.wingL[0], DJOINT.wingL[1], DJOINT.wingL[2]]} scale={[-1, 1, 1]}>
          <mesh geometry={parts.wing} material={DRAGON_MAT} />
        </group>
        <group ref={wingR} position={[DJOINT.wingR[0], DJOINT.wingR[1], DJOINT.wingR[2]]}>
          <mesh geometry={parts.wing} material={DRAGON_MAT} />
        </group>
        <group ref={tail} position={[DJOINT.tail[0], DJOINT.tail[1], DJOINT.tail[2]]}>
          <mesh geometry={parts.tail} material={DRAGON_MAT} />
        </group>
      </group>
      {/* hit proxy (world-positioned, outside the scaled group) */}
      <mesh
        ref={proxy}
        visible={false}
        position={[0, -900, 0]}
        userData={tag({ isDragon: true, id: String(def.id) })}
      >
        <boxGeometry args={[3.2 * def.scale, 1.6 * def.scale, 6 * def.scale]} />
      </mesh>
    </>
  );
};

export const Dragons = () => {
  useFrame(() => {
    while (dragonFxInbox.length) {
      const e = dragonFxInbox.pop()!;
      // dragon death = huge bone + rainbow burst
      const chunks = makeGore(e.x, e.y, e.z, 30, 12);
      for (let i = 0; i < chunks.length; i += 3) chunks[i].color = RAINBOW[i % RAINBOW.length];
      useStore.getState().addDebris(chunks);
      addTrauma(0.3);
      playExplosionSound();
    }
  });
  return (
    <>
      {DRAGONS.map((d) => <DragonMesh key={d.id} def={d} />)}
    </>
  );
};
