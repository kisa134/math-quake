import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { RigidBody, CuboidCollider, type RapierRigidBody } from '@react-three/rapier';
import { useStore } from '../store';
import { getDudeParts, makeGore } from '../game/voxHumanoid';
import { ragdollInbox } from '../game/botHorde';

/**
 * V5 C2 — REAL ragdolls. A pool of 3 ragdolls × 6 dynamic bodies (head, torso,
 * 2 arms, 2 legs). A close-by bot death claims a slot: the six parts teleport
 * to the corpse, inherit the shot's impulse, and tumble with true physics for
 * 2.4s — then dissolve into voxel gore and return to the pool. 18 short-lived
 * bodies inside the physics budget; far deaths keep the cheap debris burst.
 */
const POOL = 3;
const LIFE_MS = 2400;
const PART_DEFS = [
  { key: 'head', dx: 0, dy: 1.5, hx: 0.21, hy: 0.21, hz: 0.21 },
  { key: 'torso', dx: 0, dy: 1.0, hx: 0.28, hy: 0.35, hz: 0.14 },
  { key: 'arm', dx: -0.36, dy: 1.1, hx: 0.08, hy: 0.28, hz: 0.08 },
  { key: 'arm', dx: 0.36, dy: 1.1, hx: 0.08, hy: 0.28, hz: 0.08 },
  { key: 'leg', dx: -0.14, dy: 0.4, hx: 0.08, hy: 0.35, hz: 0.08 },
  { key: 'leg', dx: 0.14, dy: 0.4, hx: 0.08, hy: 0.35, hz: 0.08 },
] as const;

const RAG_MAT = new THREE.MeshStandardMaterial({
  color: '#f5f0e6', emissive: '#f5f0e6', emissiveIntensity: 0.1, roughness: 0.6,
});

export const Ragdolls = () => {
  const parts = useMemo(() => getDudeParts(), []);
  const bodies = useRef<Array<Array<RapierRigidBody | null>>>(
    Array.from({ length: POOL }, () => Array(6).fill(null)),
  );
  const busyUntil = useRef<number[]>(Array(POOL).fill(0));
  const slotPos = useRef<THREE.Vector3[]>(Array.from({ length: POOL }, () => new THREE.Vector3()));

  useFrame(() => {
    const now = Date.now();
    // claim slots for fresh close deaths
    while (ragdollInbox.length) {
      const e = ragdollInbox.pop()!;
      const slot = busyUntil.current.findIndex((u) => u < now);
      if (slot < 0) break; // pool saturated — the debris burst already covered it
      busyUntil.current[slot] = now + LIFE_MS;
      slotPos.current[slot].set(e.x, e.y, e.z);
      for (let p = 0; p < 6; p++) {
        const rb = bodies.current[slot][p];
        if (!rb) continue;
        const d = PART_DEFS[p];
        rb.setTranslation({ x: e.x + d.dx * e.scale, y: e.y + d.dy * e.scale - 1, z: e.z }, true);
        rb.setLinvel({
          x: e.dx * (6 + Math.random() * 6) + (Math.random() - 0.5) * 4,
          y: 5 + Math.random() * 6,
          z: e.dz * (6 + Math.random() * 6) + (Math.random() - 0.5) * 4,
        }, true);
        rb.setAngvel({ x: Math.random() * 10 - 5, y: Math.random() * 10 - 5, z: Math.random() * 10 - 5 }, true);
        rb.wakeUp();
      }
    }
    // expire slots → dissolve into gore + park the bodies far away asleep
    for (let s = 0; s < POOL; s++) {
      if (busyUntil.current[s] !== 0 && busyUntil.current[s] < now) {
        busyUntil.current[s] = 0;
        const torso = bodies.current[s][1];
        if (torso) {
          const t = torso.translation();
          useStore.getState().addDebris(makeGore(t.x, t.y, t.z, 12, 6));
        }
        for (let p = 0; p < 6; p++) {
          const rb = bodies.current[s][p];
          if (!rb) continue;
          rb.setTranslation({ x: 0, y: -800 - s * 20 - p * 3, z: 0 }, true);
          rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
          rb.sleep();
        }
      }
    }
  });

  return (
    <>
      {Array.from({ length: POOL }, (_, s) => (
        PART_DEFS.map((d, p) => (
          <RigidBody
            key={`${s}-${p}`}
            ref={(rb) => { bodies.current[s][p] = rb; }}
            colliders={false}
            position={[0, -800 - s * 20 - p * 3, 0]}
            linearDamping={0.3}
            angularDamping={0.8}
            canSleep
          >
            <CuboidCollider args={[d.hx, d.hy, d.hz]} />
            <mesh
              geometry={d.key === 'head' ? parts.head : d.key === 'torso' ? parts.torso : d.key === 'arm' ? parts.arm : parts.leg}
              material={RAG_MAT}
              position={d.key === 'head' ? [0, -0.2, 0] : d.key === 'torso' ? [0, -0.35, 0] : [0, 0.28, 0]}
            />
          </RigidBody>
        ))
      ))}
    </>
  );
};
