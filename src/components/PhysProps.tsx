import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { RigidBody, type RapierRigidBody } from '@react-three/rapier';
import { useStore } from '../store';
import { tag } from '../game/hitTags';
import { makeFlames } from '../game/voxel';
import { ringInbox } from '../game/botHorde';
import { playImpactSound } from '../utils/audio';

/**
 * V5 C9 — «физика на каждый элемент»: 16 bone-white dynamic crates scattered
 * on the spawn temple + the drift deck. Shoot one → it takes the impulse and
 * FLIES; 40 hp → bursts into pixel fire + a shockwave ring, respawns in 45s.
 * 16 dynamic bodies inside the budget. Hits arrive via propHitInbox.
 */
export const propHitInbox: { id: number; damage: number; dx: number; dy: number; dz: number }[] = [];

const SPOTS: [number, number, number][] = [
  // spawn temple scatter
  [8, 86, -6], [-10, 86, 8], [14, 86, 10], [-6, 86, -14], [3, 86, 16], [-16, 86, -3],
  [20, 86, -12], [-20, 86, 14],
  // drift deck (road at y≈31)
  [12, 34, 150], [-18, 34, 178], [30, 34, 190], [-8, 34, 162],
  // outer temples
  [206, 27, 194], [-194, 27, 206], [198, 27, -206], [-206, 27, -198],
];
const HP0 = 40;

const CRATE_MAT = new THREE.MeshStandardMaterial({
  color: '#e8e2d4', emissive: '#e8e2d4', emissiveIntensity: 0.08, roughness: 0.6, metalness: 0.15,
});
const CRATE_GEO = new THREE.BoxGeometry(1.2, 1.2, 1.2);

export const PhysProps = () => {
  const bodies = useRef<Array<RapierRigidBody | null>>(Array(SPOTS.length).fill(null));
  const hp = useRef<Float32Array>(new Float32Array(SPOTS.length).fill(HP0));
  const deadUntil = useRef<Float64Array>(new Float64Array(SPOTS.length));
  const tags = useMemo(() => SPOTS.map((_, i) => tag({ isProp: true, id: String(i) })), []);

  useFrame(() => {
    const now = Date.now();
    while (propHitInbox.length) {
      const h = propHitInbox.pop()!;
      const rb = bodies.current[h.id];
      if (!rb || deadUntil.current[h.id] > now) continue;
      rb.applyImpulse({ x: h.dx * h.damage * 0.35, y: 2 + h.damage * 0.1, z: h.dz * h.damage * 0.35 }, true);
      hp.current[h.id] -= h.damage;
      if (hp.current[h.id] <= 0) {
        const t = rb.translation();
        useStore.getState().addDebris(makeFlames([t.x, t.y, t.z], '#e8e2d4', 10));
        ringInbox.push({ x: t.x, y: t.y, z: t.z });
        playImpactSound();
        deadUntil.current[h.id] = now + 45000;
        rb.setTranslation({ x: 0, y: -850 - h.id * 4, z: 0 }, true);
        rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
        rb.sleep();
      }
    }
    // respawns
    for (let i = 0; i < SPOTS.length; i++) {
      if (deadUntil.current[i] !== 0 && deadUntil.current[i] < now) {
        deadUntil.current[i] = 0;
        hp.current[i] = HP0;
        const rb = bodies.current[i];
        if (rb) {
          rb.setTranslation({ x: SPOTS[i][0], y: SPOTS[i][1] + 1, z: SPOTS[i][2] }, true);
          rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
          rb.wakeUp();
        }
      }
    }
  });

  return (
    <>
      {SPOTS.map((p, i) => (
        <RigidBody
          key={i}
          ref={(rb) => { bodies.current[i] = rb; }}
          position={[p[0], p[1] + 1, p[2]]}
          colliders="cuboid"
          mass={1.2}
          linearDamping={0.4}
          angularDamping={0.6}
          canSleep
        >
          <mesh geometry={CRATE_GEO} material={CRATE_MAT} userData={tags[i]} />
        </RigidBody>
      ))}
    </>
  );
};
