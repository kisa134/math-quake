import { useMemo, useRef, useLayoutEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * V3 Bosch-psychedelia sky & ground dressing (owner reference boards): a giant
 * antique-gold CRESCENT MOON, puffy cream storybook clouds, a ring of dark
 * cypress silhouettes around the arena floor, and crimson toadstools below.
 * Pure atmosphere: everything instanced (6 draw calls total), raycast=noop,
 * seeded — zero gameplay surface, near-zero frame cost.
 */
const NO_RAYCAST = () => {};
const DUMMY = new THREE.Object3D();

const mulberry32 = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** Flat crescent: outer circle minus offset inner circle (Shape + hole). */
function makeCrescentGeometry(): THREE.ShapeGeometry {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, 1, 0, Math.PI * 2, false);
  const bite = new THREE.Path();
  bite.absarc(0.45, 0.18, 0.82, 0, Math.PI * 2, true);
  shape.holes.push(bite);
  return new THREE.ShapeGeometry(shape, 48);
}

interface Inst { pos: [number, number, number]; scale: [number, number, number]; rotY: number }

function fillStatic(mesh: THREE.InstancedMesh | null, list: Inst[]) {
  if (!mesh) return;
  mesh.raycast = NO_RAYCAST;
  mesh.frustumCulled = false;
  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    DUMMY.position.set(it.pos[0], it.pos[1], it.pos[2]);
    DUMMY.rotation.set(0, it.rotY, 0);
    DUMMY.scale.set(it.scale[0], it.scale[1], it.scale[2]);
    DUMMY.updateMatrix();
    mesh.setMatrixAt(i, DUMMY.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
}

export const Dreamscape = () => {
  const crescent = useMemo(() => makeCrescentGeometry(), []);

  const { clouds, cypress, caps, stems } = useMemo(() => {
    const rnd = mulberry32(0xb05c4);
    const clouds: Inst[] = [];
    for (let i = 0; i < 26; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 350 + rnd() * 700;
      const s = 26 + rnd() * 44;
      clouds.push({
        pos: [Math.cos(a) * r, 180 + rnd() * 560, Math.sin(a) * r],
        scale: [s * (1.4 + rnd()), s * 0.45, s],
        rotY: rnd() * Math.PI,
      });
    }
    const cypress: Inst[] = [];
    for (let i = 0; i < 120; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 150 + rnd() * 500;
      const h = 22 + rnd() * 46;
      cypress.push({ pos: [Math.cos(a) * r, -50 + h / 2, Math.sin(a) * r], scale: [4 + rnd() * 4, h, 4 + rnd() * 4], rotY: 0 });
    }
    const caps: Inst[] = [];
    const stems: Inst[] = [];
    for (let i = 0; i < 70; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 40 + rnd() * 280;
      const s = 1.2 + rnd() * 2.6;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      stems.push({ pos: [x, -50 + s * 0.7, z], scale: [s * 0.35, s * 1.4, s * 0.35], rotY: 0 });
      caps.push({ pos: [x, -50 + s * 1.5, z], scale: [s, s * 0.6, s], rotY: 0 });
    }
    return { clouds, cypress, caps, stems };
  }, []);

  const cloudRef = useRef<THREE.InstancedMesh>(null);
  const cypressRef = useRef<THREE.InstancedMesh>(null);
  const capRef = useRef<THREE.InstancedMesh>(null);
  const stemRef = useRef<THREE.InstancedMesh>(null);
  const moonRef = useRef<THREE.Mesh>(null);
  const cloudGroup = useRef<THREE.Group>(null);

  useLayoutEffect(() => {
    fillStatic(cloudRef.current, clouds);
    fillStatic(cypressRef.current, cypress);
    fillStatic(capRef.current, caps);
    fillStatic(stemRef.current, stems);
    if (moonRef.current) moonRef.current.raycast = NO_RAYCAST;
  }, [clouds, cypress, caps, stems]);

  // whole-group micro-drift: one transform per frame, not per-instance updates
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (cloudGroup.current) {
      cloudGroup.current.position.x = Math.sin(t * 0.008) * 24;
      cloudGroup.current.position.z = Math.cos(t * 0.006) * 18;
    }
  });

  return (
    <group>
      {/* the crescent moon — huge, gold, always on the horizon */}
      <mesh ref={moonRef} geometry={crescent} position={[620, 520, -980]} rotation={[0, -0.55, 0.35]} scale={90}>
        <meshBasicMaterial color="#ffd97a" toneMapped={false} side={THREE.DoubleSide} fog={false} />
      </mesh>

      {/* storybook clouds (cream, matte, slow group drift) */}
      <group ref={cloudGroup}>
        <instancedMesh ref={cloudRef} args={[undefined, undefined, clouds.length]}>
          <dodecahedronGeometry args={[1, 0]} />
          <meshStandardMaterial color="#cfc4b6" emissive="#5a5049" emissiveIntensity={0.25} flatShading roughness={1} />
        </instancedMesh>
      </group>

      {/* cypress silhouettes ringing the arena floor */}
      <instancedMesh ref={cypressRef} args={[undefined, undefined, cypress.length]}>
        <coneGeometry args={[0.5, 1, 7]} />
        <meshStandardMaterial color="#12291c" emissive="#0c1f14" emissiveIntensity={0.4} flatShading roughness={0.9} />
      </instancedMesh>

      {/* crimson toadstools on the void floor */}
      <instancedMesh ref={stemRef} args={[undefined, undefined, stems.length]}>
        <cylinderGeometry args={[0.5, 0.65, 1, 6]} />
        <meshStandardMaterial color="#efe2c8" emissive="#efe2c8" emissiveIntensity={0.25} toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={capRef} args={[undefined, undefined, caps.length]}>
        <sphereGeometry args={[1, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55]} />
        <meshStandardMaterial color="#c9184a" emissive="#c9184a" emissiveIntensity={0.5} toneMapped={false} />
      </instancedMesh>
    </group>
  );
};
