import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { RigidBody } from '@react-three/rapier';
import * as THREE from 'three';
import { useStore } from '../store';

/**
 * Minion squad (WS-E upgrade). Minions are no longer 3 hardcoded cubes — the
 * squad grows dynamically from store.localMinions (tamed creatures via
 * addMinion, cap 6). They hold a ring formation around the player, or around
 * the F-command target when one is set. Positions are written back to
 * store.localMinions on a 100ms throttle (was every frame — perf hotspot);
 * Player.tsx picks that up for the network update payload.
 */

const MINION_TINTS = ['#00f5d4', '#f7d354', '#f72585', '#4cc9f0', '#b5179e', '#8df0b8'];
const RING_RADIUS = 2.4;
const _anchor = new THREE.Vector3();

export const LocalMinions = () => {
  const isPlaying = useStore((s) => s.isPlaying);
  const count = useStore((s) => s.localMinions.length); // length-only: the 100ms writeback doesn't re-render
  const commandTarget = useStore((s) => s.commandTarget);
  const { camera } = useThree();
  const rbRefs = useRef<any[]>([]);
  const spawns = useRef<[number, number, number][]>([]);
  const lastWrite = useRef(0);

  // Capture a stable spawn position for each newly added minion (addMinion
  // pushed the tame spot); the RigidBody position prop must never churn.
  if (spawns.current.length < count) {
    const lm = useStore.getState().localMinions;
    for (let i = spawns.current.length; i < count; i++) {
      const m = lm[i] ?? { x: camera.position.x, y: camera.position.y + 2, z: camera.position.z };
      spawns.current[i] = [m.x, m.y + 0.8, m.z];
    }
  } else if (spawns.current.length > count) {
    // squad cleared (startGame/reset)
    spawns.current.length = count;
    rbRefs.current.length = count;
  }

  useFrame(() => {
    if (!isPlaying || count === 0) return;

    // follow the F-command target when set, otherwise the player
    if (commandTarget) _anchor.set(commandTarget[0], commandTarget[1], commandTarget[2]);
    else _anchor.copy(camera.position);

    const data: { x: number; y: number; z: number }[] = [];
    for (let i = 0; i < count; i++) {
      const rb = rbRefs.current[i];
      if (!rb) return; // still mounting — skip this frame entirely
      const p = rb.translation();

      // fell off the world → pop back next to the player
      if (p.y < -70) {
        rb.setTranslation({ x: camera.position.x, y: camera.position.y + 2, z: camera.position.z }, true);
        rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
      }

      // this minion's slot on the formation ring
      const ang = (i / count) * Math.PI * 2;
      const tx = _anchor.x + Math.cos(ang) * RING_RADIUS;
      const tz = _anchor.z + Math.sin(ang) * RING_RADIUS;
      const dx = tx - p.x, dz = tz - p.z;
      const dist = Math.hypot(dx, dz);
      const vel = rb.linvel();
      if (dist > 1.1) {
        const speed = Math.min(dist * 2.5, 11); // fast enough to keep up with bhop
        rb.setLinvel({ x: (dx / dist) * speed, y: vel.y, z: (dz / dist) * speed }, true);
      } else {
        rb.setLinvel({ x: vel.x * 0.85, y: vel.y, z: vel.z * 0.85 }, true);
      }
      data.push({ x: p.x, y: p.y, z: p.z });
    }

    // throttled writeback for the net payload (100ms is plenty at 10-20Hz update rate)
    const now = Date.now();
    if (now - lastWrite.current >= 100) {
      lastWrite.current = now;
      useStore.setState({ localMinions: data });
    }
  });

  if (!isPlaying || count === 0) return null;

  return (
    <>
      {Array.from({ length: count }, (_, i) => {
        const tint = MINION_TINTS[i % MINION_TINTS.length];
        return (
          <RigidBody
            key={`minion-${i}`}
            ref={(r) => { rbRefs.current[i] = r; }}
            colliders="cuboid"
            type="dynamic"
            position={spawns.current[i]}
            mass={0.5}
            lockRotations
          >
            <mesh castShadow receiveShadow>
              <boxGeometry args={[0.7, 0.7, 0.7]} />
              <meshStandardMaterial color={tint} emissive={tint} emissiveIntensity={0.25} />
            </mesh>
            <mesh position={[0, 0.16, -0.36]}>
              <boxGeometry args={[0.36, 0.1, 0.08]} />
              <meshBasicMaterial color="#0b0b16" />
            </mesh>
          </RigidBody>
        );
      })}
    </>
  );
};

// Remote player's minions (rendered simply from their update payload)
export const RemotePlayerMinions = ({ minions }: { minions?: { x: number, y: number, z: number }[] }) => {
  if (!minions) return null;

  return (
    <group>
      {minions.map((m, i) => {
        const tint = MINION_TINTS[i % MINION_TINTS.length];
        return (
          <group key={i} position={[m.x, m.y, m.z]}>
            <mesh castShadow receiveShadow>
              <boxGeometry args={[0.7, 0.7, 0.7]} />
              <meshStandardMaterial color={tint} emissive={tint} emissiveIntensity={0.2} />
            </mesh>
            <mesh position={[0, 0.16, -0.36]}>
              <boxGeometry args={[0.36, 0.1, 0.08]} />
              <meshBasicMaterial color="#0b0b16" />
            </mesh>
          </group>
        );
      })}
    </group>
  );
};
