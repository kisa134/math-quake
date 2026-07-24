import { useMemo, useRef, useLayoutEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getCity } from '../game/cityscape';
import { audioReactive } from '../game/audioReactive';

/**
 * V7.5 Ц3 — THE LOWER SWARM: generateCity's 320 decorative bull/bear candles
 * were generated but never rendered since V3.1 — repurposed as a drifting
 * swarm in the LOW sky (y 150-400, r 250-800), filling the dead ring between
 * the plate and the towers. ONE InstancedMesh, instanceColor bull/bear,
 * raycast=noop, round-robin 1/4 drift. Cheapest aliveness in the game.
 */
const NO_RAYCAST = () => {};
const DUMMY = new THREE.Object3D();
const COLOR = new THREE.Color();

export const LowerSwarm = () => {
  // remap the dead decor data into the low ring once
  const swarm = useMemo(() => {
    const city = getCity();
    const all = [...city.bulls, ...city.bears];
    return all.map((c, i) => {
      const isBull = i < city.bulls.length;
      const a = Math.atan2(c.pos[2], c.pos[0]) + i * 0.37;
      const r = 250 + ((i * 97) % 550);
      return {
        x: Math.cos(a) * r, z: Math.sin(a) * r,
        y: 150 + ((i * 53) % 250),
        w: c.scale[0] * 0.8, h: c.scale[1] * 0.8, d: c.scale[2] * 0.8,
        color: isBull ? '#2fbf71' : '#c9184a',
        phase: c.phase, speed: c.speed * 0.4, amp: c.amp,
        orbitR: r, orbitA: a,
      };
    });
  }, []);

  const ref = useRef<THREE.InstancedMesh>(null);
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  const frame = useRef(0);

  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    m.raycast = NO_RAYCAST;
    m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < swarm.length; i++) {
      const s = swarm[i];
      DUMMY.position.set(s.x, s.y, s.z);
      DUMMY.rotation.set(0, 0, 0);
      DUMMY.scale.set(s.w, s.h, s.d);
      DUMMY.updateMatrix();
      m.setMatrixAt(i, DUMMY.matrix);
      m.setColorAt(i, COLOR.set(s.color));
    }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [swarm]);

  useFrame((state) => {
    const m = ref.current;
    if (!m) return;
    const t = state.clock.elapsedTime;
    // V7.6: the lower swarm glows harder on the track's bass
    if (matRef.current) matRef.current.emissiveIntensity = 0.4 + audioReactive.bass * 0.5;
    frame.current = (frame.current + 1) % 4;
    for (let i = frame.current; i < swarm.length; i += 4) {
      const s = swarm[i];
      const a = s.orbitA + t * s.speed * 0.05;
      DUMMY.position.set(
        Math.cos(a) * s.orbitR,
        s.y + Math.sin(t * s.speed + s.phase) * s.amp,
        Math.sin(a) * s.orbitR,
      );
      DUMMY.rotation.set(0, a, 0);
      DUMMY.scale.set(s.w, s.h, s.d);
      DUMMY.updateMatrix();
      m.setMatrixAt(i, DUMMY.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, swarm.length]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial ref={matRef} color="#ffffff" emissive="#ffffff" emissiveIntensity={0.4} toneMapped={false} roughness={0.4} metalness={0.3} />
    </instancedMesh>
  );
};
