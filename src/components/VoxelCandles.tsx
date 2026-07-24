import { useMemo, useRef, useLayoutEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../store';
import { tag } from '../game/hitTags';
import { socket } from '../socket';
import { addTrauma } from '../game/shake';
import { playImpactSound } from '../utils/audio';
import {
  generateVoxCandles, voxDebris, voxInbox, VOX_SIZE, COLLAPSE_AT,
} from '../game/voxCandles';

/**
 * Teardown-style voxel trading candles (V2.1). ~44 candles ≈ 3k voxels drawn as
 * ONE InstancedMesh (per-voxel instanceColor, raycast=noop — the raycast law).
 * Each candle has an invisible box PROXY tagged {isWall,isVoxCandle,id}: the
 * probes/grapple/hitscan see only 44 cheap boxes. Shooting carves voxels in a
 * radius — they fly off through the existing Debris pool; below 25% alive the
 * whole candle bursts. Carves replicate via the 'vox' broadcast (voxInbox).
 */
const NO_RAYCAST = () => {};
const DUMMY = new THREE.Object3D();
const COLOR = new THREE.Color();
const BULL = new THREE.Color('#00f5d4');
const BEAR = new THREE.Color('#f72585');
const ZERO_SCALE = new THREE.Matrix4().makeScale(0, 0, 0);

// module state so Player/Projectiles can carve without prop-drilling
let _carve: ((id: number, x: number, y: number, z: number, r: number, broadcast: boolean) => void) | null = null;

/** Carve voxels near a world point (called from Player hitscan / Projectiles). */
export function carveVoxCandle(id: number, x: number, y: number, z: number, r = 1.4, broadcast = true) {
  _carve?.(id, x, y, z, r, broadcast);
}

export const VoxelCandles = () => {
  const data = useMemo(() => generateVoxCandles(), []);
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const alive = useRef<Uint8Array>(new Uint8Array(data.total).fill(1));
  const aliveCount = useRef<Int32Array>(new Int32Array(data.candles.length));
  const bobY = useRef<Float32Array>(new Float32Array(data.candles.length));
  const frame = useRef(0);

  // seed initial matrices + colors
  useLayoutEffect(() => {
    const m = meshRef.current;
    if (!m) return;
    m.raycast = NO_RAYCAST;
    m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (const c of data.candles) {
      aliveCount.current[c.id] = c.voxCount;
      for (let v = 0; v < c.voxCount; v++) {
        const g = c.voxStart + v;
        DUMMY.position.set(
          c.pos[0] + data.local[g * 3],
          c.pos[1] + data.local[g * 3 + 1],
          c.pos[2] + data.local[g * 3 + 2],
        );
        DUMMY.rotation.set(0, 0, 0);
        DUMMY.scale.setScalar(VOX_SIZE * 0.96);
        DUMMY.updateMatrix();
        m.setMatrixAt(g, DUMMY.matrix);
        COLOR.copy(c.bull ? BULL : BEAR).multiplyScalar(data.shade[g]);
        m.setColorAt(g, COLOR);
      }
    }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [data]);

  // the carve implementation (registered module-wide)
  useLayoutEffect(() => {
    _carve = (id, x, y, z, r, broadcast) => {
      const m = meshRef.current;
      const c = data.candles[id];
      if (!m || !c || aliveCount.current[id] <= 0) return;
      const r2 = r * r;
      const by = bobY.current[id];
      const chunks: ReturnType<typeof voxDebris>[] = [];
      const colorHex = c.bull ? '#00f5d4' : '#f72585';
      for (let v = 0; v < c.voxCount; v++) {
        const g = c.voxStart + v;
        if (!alive.current[g]) continue;
        const wx = c.pos[0] + data.local[g * 3];
        const wy = c.pos[1] + data.local[g * 3 + 1] + by;
        const wz = c.pos[2] + data.local[g * 3 + 2];
        const dx = wx - x, dy = wy - y, dz = wz - z;
        if (dx * dx + dy * dy + dz * dz <= r2) {
          alive.current[g] = 0;
          aliveCount.current[id]--;
          m.setMatrixAt(g, ZERO_SCALE);
          if (chunks.length < 14) chunks.push(voxDebris(wx, wy, wz, x, y, z, colorHex));
        }
      }
      if (!chunks.length) return;
      // collapse: too little left → burst everything remaining
      if (aliveCount.current[id] > 0 && aliveCount.current[id] < c.voxCount * COLLAPSE_AT) {
        for (let v = 0; v < c.voxCount; v++) {
          const g = c.voxStart + v;
          if (!alive.current[g]) continue;
          alive.current[g] = 0;
          const wx = c.pos[0] + data.local[g * 3];
          const wy = c.pos[1] + data.local[g * 3 + 1] + by;
          const wz = c.pos[2] + data.local[g * 3 + 2];
          m.setMatrixAt(g, ZERO_SCALE);
          if (chunks.length < 30) chunks.push(voxDebris(wx, wy, wz, x, y, z, colorHex));
        }
        aliveCount.current[id] = 0;
        addTrauma(0.18);
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

  // drift (round-robin 1/6 of candles per frame) + drain remote carves
  useFrame((state) => {
    const m = meshRef.current;
    if (!m) return;
    while (voxInbox.length) {
      const e = voxInbox.pop()!;
      _carve?.(e.id, e.x, e.y, e.z, e.r, false);
    }
    const t = state.clock.elapsedTime;
    frame.current = (frame.current + 1) % 6;
    let touched = false;
    for (let ci = frame.current; ci < data.candles.length; ci += 6) {
      const c = data.candles[ci];
      if (aliveCount.current[ci] <= 0) continue;
      const by = Math.sin(t * c.speed + c.phase) * c.amp;
      bobY.current[ci] = by;
      for (let v = 0; v < c.voxCount; v++) {
        const g = c.voxStart + v;
        if (!alive.current[g]) continue;
        DUMMY.position.set(
          c.pos[0] + data.local[g * 3],
          c.pos[1] + data.local[g * 3 + 1] + by,
          c.pos[2] + data.local[g * 3 + 2],
        );
        DUMMY.rotation.set(0, 0, 0);
        DUMMY.scale.setScalar(VOX_SIZE * 0.96);
        DUMMY.updateMatrix();
        m.setMatrixAt(g, DUMMY.matrix);
      }
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
      {/* invisible per-candle proxies: the ONLY raycast targets (grapple-able) */}
      {data.candles.map((c) => (
        <mesh
          key={c.id}
          visible={false}
          position={[c.pos[0], c.pos[1] + (c.voxCount / 11) * VOX_SIZE * 0.5, c.pos[2]]}
          userData={tag({ isWall: true, isVoxCandle: true, id: String(c.id) })}
        >
          <boxGeometry args={[3.4 * VOX_SIZE, (c.voxCount / 9 + 6) * VOX_SIZE + 5, 3.4 * VOX_SIZE]} />
        </mesh>
      ))}
    </group>
  );
};
