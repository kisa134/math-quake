import { useMemo, useRef, useLayoutEffect } from 'react';
import * as THREE from 'three';

/**
 * V6 sky & ground dressing — стильно и чёрно. Грибы и облака УДАЛЕНЫ (заказ
 * owner). Осталось два жеста: КОНТУРНЫЙ полумесяц-гигант (светится только
 * кромка — рифма со злодейским пончиком) и кольцо чёрных обелисков-игл по
 * горизонту (силуэты вместо кипарисов). Всё инстансы/2 меша, raycast=noop.
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

export const Dreamscape = () => {
  const crescent = useMemo(() => makeCrescentGeometry(), []);

  const obelisks = useMemo(() => {
    const rnd = mulberry32(0xb05c4);
    const list: { pos: [number, number, number]; scale: [number, number, number] }[] = [];
    // V7.5 Ц3: 260 обелисков, теперь и во внутреннем кольце (там ниже —
    // сайтлайны плиты живы). Тот же 1 draw call, raycast=noop.
    for (let i = 0; i < 260; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 300 + rnd() * 2500;
      const h = r < 700 ? 50 + rnd() * 110 : 90 + rnd() * 340;
      list.push({ pos: [Math.cos(a) * r, -50 + h / 2, Math.sin(a) * r], scale: [6 + rnd() * 10, h, 6 + rnd() * 10] });
    }
    return list;
  }, []);

  const obeliskRef = useRef<THREE.InstancedMesh>(null);
  const moonRef = useRef<THREE.Mesh>(null);
  const moonRimRef = useRef<THREE.Mesh>(null);

  useLayoutEffect(() => {
    const m = obeliskRef.current;
    if (m) {
      m.raycast = NO_RAYCAST;
      m.frustumCulled = false;
      for (let i = 0; i < obelisks.length; i++) {
        const o = obelisks[i];
        DUMMY.position.set(o.pos[0], o.pos[1], o.pos[2]);
        DUMMY.rotation.set(0, 0, 0);
        DUMMY.scale.set(o.scale[0], o.scale[1], o.scale[2]);
        DUMMY.updateMatrix();
        m.setMatrixAt(i, DUMMY.matrix);
      }
      m.instanceMatrix.needsUpdate = true;
    }
    if (moonRef.current) moonRef.current.raycast = NO_RAYCAST;
    if (moonRimRef.current) moonRimRef.current.raycast = NO_RAYCAST;
  }, [obelisks]);

  return (
    <group>
      {/* THE CONTOUR MOON — only the edge glows (villain rhyme), ×3, farther */}
      <group position={[2100, 1900, -3400]} rotation={[0, -0.55, 0.35]} scale={280}>
        <mesh ref={moonRimRef} geometry={crescent} scale={1.045}>
          <meshBasicMaterial color="#ffd97a" toneMapped={false} side={THREE.DoubleSide} fog={false} />
        </mesh>
        <mesh ref={moonRef} geometry={crescent} position={[0, 0, 0.01]}>
          <meshBasicMaterial color="#050505" side={THREE.DoubleSide} fog={false} />
        </mesh>
      </group>

      {/* black obelisk needles ringing the horizon — silhouettes of the void */}
      <instancedMesh ref={obeliskRef} args={[undefined, undefined, obelisks.length]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#0a0908" emissive="#060505" emissiveIntensity={0.3} roughness={0.9} metalness={0.2} flatShading />
      </instancedMesh>
    </group>
  );
};
