import { useMemo, useRef, useLayoutEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getCity } from '../game/cityscape';
import { worldT } from '../game/worldClock';

/**
 * V8.5 П4 — THE HIGH SWARM RETURNS. The owner asked for the old BIG candles
 * back: the original V2 decorative swarm — 320 bull/bear candles in shells
 * around the donut core (y≈900) and all four planets, loose scatter up to
 * y≈2350, FULL original sizes (h 6-20) — generateCity still produces the
 * untouched data; LowerSwarm only derived a low remap from it. This renders
 * the originals verbatim. ONE InstancedMesh, raycast=noop, rr 1/4 bob.
 */
const NO_RAYCAST = () => {};
const DUMMY = new THREE.Object3D();
const COLOR = new THREE.Color();

export const HighSwarm = () => {
  const swarm = useMemo(() => {
    const city = getCity();
    return [...city.bulls.map((c) => ({ ...c, bull: true })), ...city.bears.map((c) => ({ ...c, bull: false }))];
  }, []);

  const ref = useRef<THREE.InstancedMesh>(null);
  const frame = useRef(0);

  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    m.raycast = NO_RAYCAST;
    m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < swarm.length; i++) {
      const c = swarm[i];
      DUMMY.position.set(c.pos[0], c.pos[1], c.pos[2]);
      DUMMY.rotation.set(0, 0, 0);
      DUMMY.scale.set(c.scale[0], c.scale[1], c.scale[2]);
      DUMMY.updateMatrix();
      m.setMatrixAt(i, DUMMY.matrix);
      m.setColorAt(i, COLOR.set(c.color));
    }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [swarm]);

  useFrame((state) => {
    const m = ref.current;
    if (!m) return;
    const t = worldT(); // V8.6 shared wall clock
    frame.current = (frame.current + 1) % 4;
    for (let i = frame.current; i < swarm.length; i += 4) {
      const c = swarm[i];
      DUMMY.position.set(
        c.pos[0],
        c.pos[1] + Math.sin(t * c.speed + c.phase) * c.amp,
        c.pos[2],
      );
      DUMMY.rotation.set(0, t * c.speed * 0.3 + c.phase, 0);
      DUMMY.scale.set(c.scale[0], c.scale[1], c.scale[2]);
      DUMMY.updateMatrix();
      m.setMatrixAt(i, DUMMY.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, swarm.length]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={0.45} toneMapped={false} roughness={0.4} metalness={0.3} />
    </instancedMesh>
  );
};
