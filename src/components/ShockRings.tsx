import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { ringInbox } from '../game/botHorde';
import { accent } from '../game/accent';

/**
 * V5 C4 — dopamine shockwave rings. A pool of 4 flat rings; every death /
 * explosion claims one: it expands 1→16u and fades in 0.45s, tinted by the
 * market accent. Pure visual (raycast=noop), 4 draw calls max, zero alloc.
 */
const POOL = 6;
const LIFE = 0.45;
const NO_RAYCAST = () => {};

export const ShockRings = () => {
  const meshes = useRef<Array<THREE.Mesh | null>>(Array(POOL).fill(null));
  const mats = useRef<THREE.MeshBasicMaterial[]>(
    Array.from({ length: POOL }, () => new THREE.MeshBasicMaterial({
      color: '#ffffff', transparent: true, opacity: 0, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    })),
  );
  const age = useRef<Float32Array>(new Float32Array(POOL).fill(99));

  useFrame((_, dt) => {
    while (ringInbox.length) {
      const e = ringInbox.pop()!;
      let slot = 0;
      for (let i = 0; i < POOL; i++) if (age.current[i] > age.current[slot]) slot = i;
      age.current[slot] = 0;
      const m = meshes.current[slot];
      if (m) m.position.set(e.x, e.y, e.z);
    }
    for (let i = 0; i < POOL; i++) {
      age.current[i] += dt;
      const m = meshes.current[i];
      if (!m) continue;
      const a = age.current[i];
      if (a >= LIFE) { mats.current[i].opacity = 0; continue; }
      const k = a / LIFE;
      m.scale.setScalar(1 + k * 15);
      mats.current[i].opacity = 0.5 * (1 - k);
      mats.current[i].color.copy(accent);
    }
  });

  return (
    <>
      {Array.from({ length: POOL }, (_, i) => (
        <mesh
          key={i}
          ref={(el) => { meshes.current[i] = el; if (el) el.raycast = NO_RAYCAST; }}
          rotation={[-Math.PI / 2, 0, 0]}
          material={mats.current[i]}
          frustumCulled={false}
        >
          <ringGeometry args={[0.8, 1, 32]} />
        </mesh>
      ))}
    </>
  );
};
