import { useMemo, useRef, useLayoutEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../store';
import { tag } from '../game/hitTags';
import { socket } from '../socket';
import { addTrauma } from '../game/shake';
import { playImpactSound, playExplosionSound } from '../utils/audio';
import {
  generateVoxCandles, voxDebris, voxInbox, VOX_SIZE, COLLAPSE_AT,
  candleBasePos, type VoxCandle,
} from '../game/voxCandles';

/**
 * V3.1 «Вселенная свечей»: ALL candles are Teardown-voxel STARS orbiting the
 * central black-hole donut. ~90 candles ≈ 5.5k voxels in ONE InstancedMesh
 * (raycast=noop); 90 invisible moving box proxies are the only ray targets
 * (grapple-able — you can ride an orbiting star!). Shooting carves voxels;
 * below 25% alive the candle STOPS orbiting and FALLS, tumbling, until it
 * shatters on the void floor. Carves replicate via 'vox' (voxInbox).
 *
 * Perf: orbit matrices update round-robin (1/6 of candles per frame ≈ 900
 * setMatrixAt); falling candles update every frame (few at a time).
 */
const NO_RAYCAST = () => {};
const DUMMY = new THREE.Object3D();
const COLOR = new THREE.Color();
const BULL = new THREE.Color('#2fbf71');
const BEAR = new THREE.Color('#c9184a');
const ZERO_SCALE = new THREE.Matrix4().makeScale(0, 0, 0);
const G = 26; // fall gravity for broken candles

// ---- module state (grapple + carve API without prop drilling) --------------
let _carve: ((id: number, x: number, y: number, z: number, r: number, broadcast: boolean) => void) | null = null;
let _basePos: Float32Array | null = null;   // current base position per candle (xyz)
let _aliveCount: Int32Array | null = null;

export function carveVoxCandle(id: number, x: number, y: number, z: number, r = 1.4, broadcast = true) {
  _carve?.(id, x, y, z, r, broadcast);
}

/** Current world base position of a candle (for grapple anchors on moving stars). */
export function getVoxCandlePos(id: number, out: THREE.Vector3): boolean {
  if (!_basePos || !_aliveCount || _aliveCount[id] <= 0) return false;
  out.set(_basePos[id * 3], _basePos[id * 3 + 1], _basePos[id * 3 + 2]);
  return true;
}

export function voxCandleAlive(id: number): boolean {
  return !!_aliveCount && _aliveCount[id] > 0;
}

export const VoxelCandles = () => {
  const data = useMemo(() => generateVoxCandles(), []);
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const proxyRefs = useRef<Array<THREE.Mesh | null>>([]);
  const alive = useRef<Uint8Array>(new Uint8Array(data.total).fill(1));
  const aliveCount = useRef<Int32Array>(new Int32Array(data.candles.length));
  const basePos = useRef<Float32Array>(new Float32Array(data.candles.length * 3));
  // falling state: -1 = orbiting; >=0 = current fall vy
  const fallVy = useRef<Float32Array>(new Float32Array(data.candles.length).fill(-1));
  const fallSpin = useRef<Float32Array>(new Float32Array(data.candles.length));
  const frame = useRef(0);
  const timeRef = useRef(0);

  const writeCandle = (c: VoxCandle, m: THREE.InstancedMesh, spin: number) => {
    const bx = basePos.current[c.id * 3];
    const by = basePos.current[c.id * 3 + 1];
    const bz = basePos.current[c.id * 3 + 2];
    for (let v = 0; v < c.voxCount; v++) {
      const g = c.voxStart + v;
      if (!alive.current[g]) continue;
      DUMMY.position.set(
        bx + data.local[g * 3],
        by + data.local[g * 3 + 1],
        bz + data.local[g * 3 + 2],
      );
      DUMMY.rotation.set(spin, spin * 0.7, 0);
      DUMMY.scale.setScalar(VOX_SIZE * 0.96);
      DUMMY.updateMatrix();
      m.setMatrixAt(g, DUMMY.matrix);
    }
    const proxy = proxyRefs.current[c.id];
    if (proxy) proxy.position.set(bx, by + (c.voxCount / 11) * VOX_SIZE * 0.5, bz);
  };

  // seed matrices + colors + module registries
  useLayoutEffect(() => {
    const m = meshRef.current;
    if (!m) return;
    m.raycast = NO_RAYCAST;
    m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const posTmp = { x: 0, y: 0, z: 0 };
    for (const c of data.candles) {
      aliveCount.current[c.id] = c.voxCount;
      candleBasePos(c, 0, posTmp);
      basePos.current[c.id * 3] = posTmp.x;
      basePos.current[c.id * 3 + 1] = posTmp.y;
      basePos.current[c.id * 3 + 2] = posTmp.z;
      writeCandle(c, m, 0);
      for (let v = 0; v < c.voxCount; v++) {
        const g = c.voxStart + v;
        COLOR.copy(c.bull ? BULL : BEAR).multiplyScalar(data.shade[g]);
        m.setColorAt(g, COLOR);
      }
    }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    _basePos = basePos.current;
    _aliveCount = aliveCount.current;
    return () => { _basePos = null; _aliveCount = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // carve implementation
  useLayoutEffect(() => {
    _carve = (id, x, y, z, r, broadcast) => {
      const m = meshRef.current;
      const c = data.candles[id];
      if (!m || !c || aliveCount.current[id] <= 0) return;
      const r2 = r * r;
      const bx = basePos.current[id * 3];
      const by = basePos.current[id * 3 + 1];
      const bz = basePos.current[id * 3 + 2];
      const chunks: ReturnType<typeof voxDebris>[] = [];
      const colorHex = c.bull ? '#2fbf71' : '#c9184a';
      for (let v = 0; v < c.voxCount; v++) {
        const g = c.voxStart + v;
        if (!alive.current[g]) continue;
        const wx = bx + data.local[g * 3];
        const wy = by + data.local[g * 3 + 1];
        const wz = bz + data.local[g * 3 + 2];
        const dx = wx - x, dy = wy - y, dz = wz - z;
        if (dx * dx + dy * dy + dz * dz <= r2) {
          alive.current[g] = 0;
          aliveCount.current[id]--;
          m.setMatrixAt(g, ZERO_SCALE);
          if (chunks.length < 14) chunks.push(voxDebris(wx, wy, wz, x, y, z, colorHex));
        }
      }
      if (!chunks.length) return;
      // Broken past the threshold → the star STOPS orbiting and FALLS.
      if (
        fallVy.current[id] < 0 &&
        aliveCount.current[id] > 0 &&
        aliveCount.current[id] < c.voxCount * COLLAPSE_AT
      ) {
        fallVy.current[id] = 0.01;
        addTrauma(0.1);
      } else {
        addTrauma(0.05);
      }
      m.instanceMatrix.needsUpdate = true;
      playImpactSound();
      useStore.getState().addDebris(chunks);
      if (broadcast) socket.emit('vox', { id, x, y, z, r });
    };
    return () => { _carve = null; };
  }, [data]);

  // shatter a falling candle on the floor: burst every remaining voxel
  const shatter = (c: VoxCandle, m: THREE.InstancedMesh) => {
    const bx = basePos.current[c.id * 3];
    const by = basePos.current[c.id * 3 + 1];
    const bz = basePos.current[c.id * 3 + 2];
    const chunks: ReturnType<typeof voxDebris>[] = [];
    const colorHex = c.bull ? '#2fbf71' : '#c9184a';
    for (let v = 0; v < c.voxCount; v++) {
      const g = c.voxStart + v;
      if (!alive.current[g]) continue;
      alive.current[g] = 0;
      const wx = bx + data.local[g * 3];
      const wy = by + data.local[g * 3 + 1];
      const wz = bz + data.local[g * 3 + 2];
      m.setMatrixAt(g, ZERO_SCALE);
      if (chunks.length < 30) chunks.push(voxDebris(wx, wy, wz, bx, by - 3, bz, colorHex));
    }
    aliveCount.current[c.id] = 0;
    m.instanceMatrix.needsUpdate = true;
    if (chunks.length) useStore.getState().addDebris(chunks);
    addTrauma(0.2);
    playExplosionSound();
  };

  useFrame((state, dt) => {
    const m = meshRef.current;
    if (!m) return;
    while (voxInbox.length) {
      const e = voxInbox.pop()!;
      _carve?.(e.id, e.x, e.y, e.z, e.r, false);
    }
    const t = state.clock.elapsedTime;
    timeRef.current = t;
    frame.current = (frame.current + 1) % 6;
    let touched = false;
    const posTmp = { x: 0, y: 0, z: 0 };

    for (let ci = 0; ci < data.candles.length; ci++) {
      const c = data.candles[ci];
      if (aliveCount.current[ci] <= 0) continue;
      const falling = fallVy.current[ci] >= 0;
      // orbiting candles update round-robin; FALLING ones update every frame
      if (!falling && ci % 6 !== frame.current) continue;

      if (falling) {
        fallVy.current[ci] += G * dt;
        basePos.current[ci * 3 + 1] -= fallVy.current[ci] * dt;
        fallSpin.current[ci] += dt * 2.4;
        if (basePos.current[ci * 3 + 1] < -46) { shatter(c, m); touched = true; continue; }
      } else {
        candleBasePos(c, t, posTmp);
        basePos.current[ci * 3] = posTmp.x;
        basePos.current[ci * 3 + 1] = posTmp.y;
        basePos.current[ci * 3 + 2] = posTmp.z;
      }
      writeCandle(c, m, falling ? fallSpin.current[ci] : 0);
      touched = true;
    }
    if (touched) m.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      <instancedMesh ref={meshRef} args={[undefined, undefined, data.total]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={0.55} toneMapped={false} roughness={0.35} metalness={0.4} />
      </instancedMesh>
      {/* invisible MOVING per-candle proxies: the ONLY raycast targets (grapple-able stars) */}
      {data.candles.map((c) => (
        <mesh
          key={c.id}
          ref={(el) => { proxyRefs.current[c.id] = el; }}
          visible={false}
          userData={tag({ isWall: true, isVoxCandle: true, id: String(c.id) })}
        >
          <boxGeometry args={[3.6 * VOX_SIZE, (c.voxCount / 9 + 6) * VOX_SIZE, 3.6 * VOX_SIZE]} />
        </mesh>
      ))}
    </group>
  );
};
