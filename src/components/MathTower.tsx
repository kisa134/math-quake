import { useMemo, useRef, useLayoutEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { RigidBody } from '@react-three/rapier';
import { tag } from '../game/hitTags';
import { MATTE_WORLD } from '../game/materials';
import { accent } from '../game/accent';
import { orbSpawnInbox } from '../game/botHorde';
import { heightState } from '../game/builtProps';

/**
 * МАТЕМАТИЧЕСКАЯ БАШНЯ — the doodle-jump world. You spawn on the plate at the
 * bottom with nothing but money: build giant candles, climb them, shoot them
 * out from under each other. The higher you get, the crazier the mathematics
 * around you — belts of TORI (пончики), TORUS KNOTS, icosahedra, octahedra,
 * dodecahedra, spheres, each band bigger/faster/hotter than the last, plus
 * «new universes» — real landable checkpoint discs every 500 units with loot.
 * Six InstancedMesh draws for the entire infinite madness; raycast=noop.
 */
const NO_RAYCAST = () => {};
const DUMMY = new THREE.Object3D();
const COLOR = new THREE.Color();

const BAND_STEP = 160;      // altitude between shape belts
const BANDS = 30;           // → мадость до ~5000u
const PER_BAND = 7;
const CHECKPOINT_STEP = 500;
const CHECKPOINTS = 9;

const hash = (n: number) => {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

type ShapeKind = 0 | 1 | 2 | 3 | 4 | 5; // torus · knot · ico · octa · dodeca · sphere

interface Fig { kind: ShapeKind; x: number; y: number; z: number; s: number; spin: number; phase: number; hot: number }

export const MathTower = () => {
  const { camera } = useThree();

  const figs = useMemo(() => {
    const out: Fig[] = [];
    for (let b = 0; b < BANDS; b++) {
      const y = 120 + b * BAND_STEP;
      const hot = Math.min(1, b / (BANDS - 1));       // выше = безумнее
      for (let i = 0; i < PER_BAND; i++) {
        const h = hash(b * 31.7 + i * 7.13);
        const a = (i / PER_BAND) * Math.PI * 2 + b * 0.6;
        const r = 55 + h * 130 + hot * 90;
        out.push({
          kind: (Math.floor(hash(b * 3.1 + i) * 6) % 6) as ShapeKind,
          x: Math.cos(a) * r,
          y: y + (h - 0.5) * 60,
          z: Math.sin(a) * r,
          s: (7 + h * 16) * (0.7 + hot * 1.9),        // выше — гигантские
          spin: (0.08 + h * 0.35) * (0.5 + hot * 2),
          phase: h * Math.PI * 2,
          hot,
        });
      }
    }
    return out;
  }, []);

  const byKind = useMemo(() => {
    const m: Fig[][] = [[], [], [], [], [], []];
    for (const f of figs) m[f.kind].push(f);
    return m;
  }, [figs]);

  const refs = useRef<Array<THREE.InstancedMesh | null>>([null, null, null, null, null, null]);
  const matRefs = useRef<Array<THREE.MeshStandardMaterial | null>>([null, null, null, null, null, null]);
  const frame = useRef(0);
  const lastOrb = useRef<Float64Array>(new Float64Array(CHECKPOINTS));

  useLayoutEffect(() => {
    refs.current.forEach((m, k) => {
      if (!m) return;
      m.raycast = NO_RAYCAST;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      byKind[k].forEach((f, i) => {
        DUMMY.position.set(f.x, f.y, f.z);
        DUMMY.scale.setScalar(f.s);
        DUMMY.rotation.set(f.phase, f.phase * 0.7, 0);
        DUMMY.updateMatrix();
        m.setMatrixAt(i, DUMMY.matrix);
        // цвет: снизу холодный кость-белый → выше кислотный психодел
        COLOR.setHSL(0.55 + f.hot * 0.45, 0.25 + f.hot * 0.75, 0.45 + f.hot * 0.2);
        m.setColorAt(i, COLOR);
      });
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    });
  }, [byKind]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    frame.current = (frame.current + 1) % 3;
    // вращение фигур — round-robin 1/3, зеро-аллок
    refs.current.forEach((m, k) => {
      if (!m) return;
      const list = byKind[k];
      for (let i = frame.current; i < list.length; i += 3) {
        const f = list[i];
        DUMMY.position.set(f.x, f.y + Math.sin(t * 0.25 + f.phase) * (2 + f.hot * 10), f.z);
        DUMMY.rotation.set(f.phase + t * f.spin, f.phase * 0.7 + t * f.spin * 0.6, t * f.spin * 0.3);
        DUMMY.scale.setScalar(f.s);
        DUMMY.updateMatrix();
        m.setMatrixAt(i, DUMMY.matrix);
      }
      m.instanceMatrix.needsUpdate = true;
      const mat = matRefs.current[k];
      if (mat) mat.emissiveIntensity = 0.35 + 0.25 * Math.sin(t * 0.7 + k);
    });

    // чекпойнт-вселенные роняют лут, когда ты рядом (награда за высоту)
    const y = camera.position.y;
    const now = performance.now();
    for (let c = 0; c < CHECKPOINTS; c++) {
      const cy = (c + 1) * CHECKPOINT_STEP;
      if (Math.abs(y - cy) < 70 && now - lastOrb.current[c] > 25000) {
        lastOrb.current[c] = now;
        orbSpawnInbox.push({ x: 0, y: cy + 4, z: 0, kind: c % 2 === 0 ? 'cash' : 'buff' });
      }
    }
    heightState.now = y;
  });

  const geos = useMemo(() => [
    new THREE.TorusGeometry(1, 0.36, 12, 26),          // ПОНЧИК
    new THREE.TorusKnotGeometry(0.8, 0.26, 64, 10),    // УЗЕЛ
    new THREE.IcosahedronGeometry(1, 0),
    new THREE.OctahedronGeometry(1, 0),
    new THREE.DodecahedronGeometry(1, 0),
    new THREE.SphereGeometry(1, 16, 12),
  ], []);

  return (
    <group>
      {/* стартовая плита — здесь ты появляешься с деньгами и пустыми руками */}
      <RigidBody type="fixed">
        <mesh position={[0, -2, 0]} material={MATTE_WORLD} userData={tag({ isFloor: true })}>
          <boxGeometry args={[300, 4, 300]} />
        </mesh>
      </RigidBody>
      {/* золотая кромка плиты — видно край, за которым падение */}
      <mesh position={[0, 0.2, 0]} onUpdate={(m) => { m.raycast = NO_RAYCAST; }}>
        <ringGeometry args={[146, 150, 48]} />
        <meshBasicMaterial color={accent} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>

      {/* ЧЕКПОЙНТ-ВСЕЛЕННЫЕ: реальные диски, на которые можно приземлиться */}
      {Array.from({ length: CHECKPOINTS }, (_, c) => {
        const cy = (c + 1) * CHECKPOINT_STEP;
        return (
          <RigidBody key={c} type="fixed" position={[0, cy, 0]}>
            <mesh material={MATTE_WORLD} userData={tag({ isFloor: true })}>
              <cylinderGeometry args={[30, 30, 3, 24]} />
            </mesh>
            <mesh position={[0, 2.2, 0]} onUpdate={(m) => { m.raycast = NO_RAYCAST; }}>
              <torusGeometry args={[26, 1.4, 8, 32]} />
              <meshStandardMaterial
                color={new THREE.Color().setHSL(0.5 + c * 0.06, 0.85, 0.55)}
                emissive={new THREE.Color().setHSL(0.5 + c * 0.06, 0.85, 0.5)}
                emissiveIntensity={1.4} toneMapped={false}
              />
            </mesh>
          </RigidBody>
        );
      })}

      {/* математическое безумие: 6 инстанс-мешей на всю бесконечность */}
      {geos.map((g, k) => (
        <instancedMesh
          key={k}
          ref={(m) => { refs.current[k] = m; }}
          args={[g, undefined, Math.max(1, byKind[k].length)]}
        >
          <meshStandardMaterial
            ref={(m) => { matRefs.current[k] = m; }}
            color="#ffffff" emissive="#ffffff" emissiveIntensity={0.4}
            roughness={0.3} metalness={0.6} toneMapped={false}
          />
        </instancedMesh>
      ))}
    </group>
  );
};
