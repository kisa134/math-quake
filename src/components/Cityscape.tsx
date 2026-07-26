import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { RigidBody } from '@react-three/rapier';
import { AssetModel } from '../game/modelCache';
import { tag } from '../game/hitTags';
import { accent } from '../game/accent';
import { MATTE_INSTANCED, MATTE_WORLD } from '../game/materials';
import { getCity, type ClimbPiece, type Inst } from '../game/cityscape';
import { worldT } from '../game/worldClock';

/**
 * WS-A — renders the seeded 1-km cyberpunk city from generateCity().
 *
 * Perf contract (hard):
 *  - Skyscrapers = exactly 3 InstancedMesh draw calls (dark bodies, emissive
 *    light strips, emissive roof caps). One shared unit boxGeometry, per-
 *    instance color via instanceColor, NO per-building materials.
 *  - Candles = exactly 2 InstancedMesh (bull / bear), one merged body+wick
 *    geometry each. Drift animates in ONE useFrame with a module-level dummy
 *    (zero alloc), round-robin 1/4 of instances per frame.
 *  - Every purely-visual InstancedMesh gets a no-op raycast so the player
 *    ground-probe / hitscan / grapple never test hundreds of instances.
 *  - Playable climb = plain fixed RigidBodies (≈70 total) with typed tag()
 *    userData on the meshes (probe reads userData on the hit mesh).
 *  - 4 giant GLB planets keep raycast ON (grappling onto them is a feature)
 *    but have NO RigidBody; one shared useFrame rotates all four.
 */

const DUMMY = new THREE.Object3D();
const COLOR = new THREE.Color();
const NO_RAYCAST = () => {};

// Grapple-anything support: the tower bodies are raycast-noop for the per-frame
// probes (perf), but the grapple fires ONCE per click — so it may raycast the
// 430 instanced tower boxes explicitly through this hook. Player.tsx calls it.
let _towersMesh: THREE.InstancedMesh | null = null;
export function grappleCityHits(ray: THREE.Raycaster): THREE.Intersection[] {
  if (!_towersMesh) return [];
  const out: THREE.Intersection[] = [];
  THREE.InstancedMesh.prototype.raycast.call(_towersMesh, ray, out);
  return out;
}

/** Fill an InstancedMesh from descriptors once (static visual layer). */
function useStaticInstances(list: Inst[], dynamic = false) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    m.raycast = NO_RAYCAST;          // visual-only: never raycast N-hundred instances
    m.frustumCulled = false;         // instanced bounds don't cover the spread — keep drawn
    if (dynamic) m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      DUMMY.position.set(it.pos[0], it.pos[1], it.pos[2]);
      DUMMY.rotation.set(0, 0, 0);
      DUMMY.scale.set(it.scale[0], it.scale[1], it.scale[2]);
      DUMMY.updateMatrix();
      m.setMatrixAt(i, DUMMY.matrix);
      m.setColorAt(i, COLOR.set(it.color));
    }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [list, dynamic]);
  return ref;
}

// NOTE (V3.1): the old decorative bull/bear candle swarms are GONE — every
// candle in the sky is now a real voxel star orbiting the black hole
// (VoxelCandles.tsx). Cheaper AND shootable.

// ------------------------------------------------------- climb (physics) ----

const ClimbBody = ({ p }: { p: ClimbPiece }) => {
  if (p.kind === 'pad') {
    const r = p.size[0] / 2;
    return (
      <RigidBody type="fixed">
        <mesh position={p.pos} userData={tag({ isJumpPad: true, jumpForce: p.jumpForce })}>
          <cylinderGeometry args={[r, r, p.size[1], 16]} />
          <meshStandardMaterial color={p.color} emissive={p.color} emissiveIntensity={1.0} toneMapped={false} />
        </mesh>
      </RigidBody>
    );
  }
  const ud = p.kind === 'wall'
    ? tag({ isWall: true, isMetal: p.isMetal })
    : tag({ isFloor: true, friction: p.friction, isMetal: p.isMetal });
  const ice = p.friction !== undefined;
  const metal = !!p.isMetal;
  // V5.1: normal decks share the matte-black glitter world material; ice and
  // metal keep their functional read (glassy / bronze).
  if (!ice && !metal) {
    return (
      <RigidBody type="fixed">
        <mesh position={p.pos} userData={ud} material={MATTE_WORLD}>
          <boxGeometry args={p.size} />
        </mesh>
      </RigidBody>
    );
  }
  return (
    <RigidBody type="fixed">
      <mesh position={p.pos} userData={ud}>
        <boxGeometry args={p.size} />
        <meshStandardMaterial
          color={p.color}
          emissive={p.color}
          emissiveIntensity={ice ? 0.25 : 0.35}
          roughness={ice ? 0.05 : 0.25}
          metalness={ice ? 0.9 : 0.95}
          toneMapped={false}
        />
      </mesh>
    </RigidBody>
  );
};

// ------------------------------------------------------------- component ----

export const Cityscape = () => {
  const city = useMemo(() => getCity(), []);

  const towersRef = useStaticInstances(city.towers);
  useEffect(() => { _towersMesh = towersRef.current; return () => { _towersMesh = null; }; }, [towersRef]);
  const stripsRef = useStaticInstances(city.strips);
  const roofsRef = useStaticInstances(city.roofs);

  const planetRefs = useRef<Array<THREE.Group | null>>([]);
  const planetPatched = useRef<boolean[]>([]);
  const frame = useRef(0);
  // V5: strip/roof glow follows THE accent (market-conducted world color)
  const stripMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const roofMatRef = useRef<THREE.MeshBasicMaterial>(null);

  // Dev perf helper: window.__perf() → { calls, tris }
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as unknown as Record<string, unknown>).__perf = () =>
        ({ calls: gl.info.render.calls, tris: gl.info.render.triangles });
    }
  }, [gl]);

  // ONE batched useFrame: planet rotation (+ one-time raycast patch below).
  useFrame((state, dt) => {
    const t = worldT(); // V8.6: world layers tick on the shared wall clock
    frame.current = (frame.current + 1) % 8;

    // V5 monochrome: the city's glow IS the market's mood
    if (stripMatRef.current) stripMatRef.current.color.copy(accent);
    if (roofMatRef.current) roofMatRef.current.color.copy(accent);

    for (let i = 0; i < city.planets.length; i++) {
      const g = planetRefs.current[i];
      if (!g) continue;
      const p = city.planets[i];
      g.rotation.y += p.spin * dt;
      // V6 Ш5: планеты ЖИВУТ — медленные орбиты вокруг пончика (ничего не висит)
      const orbR = Math.hypot(p.pos[0], p.pos[2]);
      const orbA = Math.atan2(p.pos[2], p.pos[0]) + t * (0.008 + i * 0.003);
      g.position.x = Math.cos(orbA) * orbR;
      g.position.z = Math.sin(orbA) * orbR;
      g.position.y = p.pos[1] + Math.sin(t * 0.11 + i * 1.7) * 12;

      // One-time: once the Suspense-loaded GLB meshes exist, silence their
      // triangle-level raycast (tens of thousands of tris tested by the
      // per-frame ground probe = the V2 fps sink). The invisible proxy sphere
      // (added below, named 'proxy') stays raycastable for grapple/standing.
      if (!planetPatched.current[i]) {
        let found = false;
        g.traverse((o) => {
          if ((o as THREE.Mesh).isMesh && o.name !== 'planet-proxy') {
            o.raycast = NO_RAYCAST;
            found = true;
          }
        });
        if (found) planetPatched.current[i] = true;
      }
    }
  });

  return (
    <group>
      {/* --- skyline: 3 instanced draw calls total ------------------------ */}
      <instancedMesh ref={towersRef} args={[undefined, undefined, city.towers.length]} material={MATTE_INSTANCED}>
        <boxGeometry args={[1, 1, 1]} />
      </instancedMesh>
      <instancedMesh ref={stripsRef} args={[undefined, undefined, city.strips.length]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial ref={stripMatRef} color="#c8b273" toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={roofsRef} args={[undefined, undefined, city.roofs.length]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial ref={roofMatRef} color="#c8b273" toneMapped={false} />
      </instancedMesh>

      {/* --- playable climb skeleton (fixed RigidBodies) ------------------ */}
      {city.climb.map((p, i) => (
        <ClimbBody key={`climb-${i}`} p={p} />
      ))}

      {/* --- 4 giant rotating planet set-pieces (grapple-able, no physics) - */}
      {city.planets.map((p, i) => (
        <group
          key={p.assetId}
          ref={(g) => { planetRefs.current[i] = g; }}
          position={p.pos}
          scale={p.scale}
        >
          <AssetModel assetId={p.assetId} />
          {/* invisible raycast proxy — grapple/probe hit a cheap sphere, not
              the GLB's tens of thousands of triangles */}
          <mesh name="planet-proxy" visible={false} userData={tag({ isWall: true, isFloor: true })}>
            <sphereGeometry args={[0.55, 12, 12]} />
          </mesh>
        </group>
      ))}
    </group>
  );
};
