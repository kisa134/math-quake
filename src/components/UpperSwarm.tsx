import { useMemo, useRef, useLayoutEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { accent } from '../game/accent';
import { audioReactive } from '../game/audioReactive';

/**
 * V7.6 М3 — THE UPPER SWARM: more figures flying in the high sky (y 500-1300,
 * r 800-1800) so the космос never reads empty above the city. Procedural voxel
 * crystals — octahedra — orbiting the donut, ONE InstancedMesh, raycast=noop,
 * round-robin 1/4 drift. Гигантизм: a fraction are huge. Emissive rides the
 * market accent and swells on the track's bass (М1 reactive channel).
 */
const NO_RAYCAST = () => {};
const DUMMY = new THREE.Object3D();
const N = 240;

const mulberry = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export const UpperSwarm = () => {
  const figs = useMemo(() => {
    const rnd = mulberry(0x5eed7);
    return Array.from({ length: N }, () => {
      const a = rnd() * Math.PI * 2;
      const r = 800 + rnd() * 1000;
      const big = rnd() < 0.12; // гигантизм: ~1 из 8 — огромный
      const s = big ? 40 + rnd() * 70 : 8 + rnd() * 18;
      return {
        orbitR: r, orbitA: a,
        y: 500 + rnd() * 800,
        s,
        spin: (rnd() - 0.5) * 1.2,
        bob: 6 + rnd() * 18,
        speed: (0.006 + rnd() * 0.02) * (big ? 0.5 : 1),
        phase: rnd() * Math.PI * 2,
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
    for (let i = 0; i < figs.length; i++) {
      const f = figs[i];
      DUMMY.position.set(Math.cos(f.orbitA) * f.orbitR, f.y, Math.sin(f.orbitA) * f.orbitR);
      DUMMY.scale.setScalar(f.s);
      DUMMY.updateMatrix();
      m.setMatrixAt(i, DUMMY.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  }, [figs]);

  useFrame((state) => {
    const m = ref.current;
    if (!m) return;
    const t = state.clock.elapsedTime;
    if (matRef.current) {
      matRef.current.color.copy(accent);
      matRef.current.emissiveIntensity = 0.25 + audioReactive.bass * 0.4;
    }
    frame.current = (frame.current + 1) % 4;
    for (let i = frame.current; i < figs.length; i += 4) {
      const f = figs[i];
      const a = f.orbitA + t * f.speed;
      DUMMY.position.set(
        Math.cos(a) * f.orbitR,
        f.y + Math.sin(t * 0.2 + f.phase) * f.bob,
        Math.sin(a) * f.orbitR,
      );
      DUMMY.rotation.set(t * f.spin, a, t * f.spin * 0.5);
      DUMMY.scale.setScalar(f.s);
      DUMMY.updateMatrix();
      m.setMatrixAt(i, DUMMY.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, N]}>
      <octahedronGeometry args={[1, 0]} />
      <meshStandardMaterial ref={matRef} color="#c8b273" emissive="#c8b273" emissiveIntensity={0.25} toneMapped={false} roughness={0.25} metalness={0.7} />
    </instancedMesh>
  );
};
