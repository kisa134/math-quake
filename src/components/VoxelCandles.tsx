import { useMemo, useRef, useLayoutEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../store';
import { tag } from '../game/hitTags';
import { socket } from '../socket';
import { addTrauma } from '../game/shake';
import { playImpactSound, playExplosionSound } from '../utils/audio';
import {
  generateVoxCandles, voxDebris, voxInbox, VOX_SIZE, COLLAPSE_AT, BLACK_HOLE,
  candleLivePos, moodGain, fateOf, warpTime, conductorState, type VoxCandle,
} from '../game/voxCandles';
import type { CandleEvent } from '../game/conductor';

/**
 * V4.3 «Литургия ликвидаций» — the living candle cosmos renderer.
 * 180 voxel star-candles (~12k voxels, ONE InstancedMesh) breathe through the
 * conductor's 75s market epochs: whales lead schools, euphoria packs the
 * crowds, liquidation spirals scream into the donut (feed flash!), comets tear
 * outward, the swallowed resurrect in the halo 8s later. Mood recolors bulls/
 * bears every frame (slice-wise). Player damage still rules: carved candles
 * leave the schedule, broken ones FALL. Round-robin 1/8; carves replicate 'vox'.
 */
const NO_RAYCAST = () => {};
const DUMMY = new THREE.Object3D();
const COLOR = new THREE.Color();
const BULL = new THREE.Color('#2fbf71');
const BEAR = new THREE.Color('#c9184a');
const ZERO_SCALE = new THREE.Matrix4().makeScale(0, 0, 0);
const G = 26;

// the donut's feed flash — BlackHole.tsx reads & decays this
export const blackHoleFeed = { v: 0 };

let _carve: ((id: number, x: number, y: number, z: number, r: number, broadcast: boolean) => void) | null = null;
let _basePos: Float32Array | null = null;
let _aliveCount: Int32Array | null = null;

export function carveVoxCandle(id: number, x: number, y: number, z: number, r = 1.4, broadcast = true) {
  _carve?.(id, x, y, z, r, broadcast);
}
export function getVoxCandlePos(id: number, out: THREE.Vector3): boolean {
  if (!_basePos || !_aliveCount || _aliveCount[id] <= 0) return false;
  out.set(_basePos[id * 3], _basePos[id * 3 + 1], _basePos[id * 3 + 2]);
  return true;
}
export function voxCandleAlive(id: number): boolean {
  return !!_aliveCount && _aliveCount[id] > 0;
}

const _pos = { x: 0, y: 0, z: 0 };

export const VoxelCandles = () => {
  const data = useMemo(() => generateVoxCandles(), []);
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const proxyRefs = useRef<Array<THREE.Mesh | null>>([]);
  const alive = useRef<Uint8Array>(new Uint8Array(data.total).fill(1));
  const aliveCount = useRef<Int32Array>(new Int32Array(data.candles.length));
  const basePos = useRef<Float32Array>(new Float32Array(data.candles.length * 3));
  const fallVy = useRef<Float32Array>(new Float32Array(data.candles.length).fill(-1));
  const fallSpin = useRef<Float32Array>(new Float32Array(data.candles.length));
  const hidden = useRef<Uint8Array>(new Uint8Array(data.candles.length)); // swallowed by the donut
  const evCache = useRef<CandleEvent[]>(data.candles.map(() => ({ type: null, tStart: 0, dur: 0 })));
  const evEpoch = useRef<Int32Array>(new Int32Array(data.candles.length).fill(-1));
  const tailTick = useRef(0);
  const frame = useRef(0);

  const writeCandle = (c: VoxCandle, m: THREE.InstancedMesh, spin: number, S: number) => {
    const bx = basePos.current[c.id * 3];
    const by = basePos.current[c.id * 3 + 1];
    const bz = basePos.current[c.id * 3 + 2];
    const gain = moodGain(c.bull, S);
    for (let v = 0; v < c.voxCount; v++) {
      const g = c.voxStart + v;
      if (!alive.current[g]) continue;
      DUMMY.position.set(
        bx + data.local[g * 3] * c.voxScale,
        by + data.local[g * 3 + 1] * c.voxScale,
        bz + data.local[g * 3 + 2] * c.voxScale,
      );
      DUMMY.rotation.set(spin, spin * 0.7, 0);
      DUMMY.scale.setScalar(VOX_SIZE * 0.96 * c.voxScale);
      DUMMY.updateMatrix();
      m.setMatrixAt(g, DUMMY.matrix);
      COLOR.copy(c.bull ? BULL : BEAR).multiplyScalar(data.shade[g] * gain);
      m.setColorAt(g, COLOR);
    }
    const proxy = proxyRefs.current[c.id];
    if (proxy) proxy.position.set(bx, by + (c.voxCount / 11) * VOX_SIZE * 0.5 * c.voxScale, bz);
  };

  const hideCandle = (c: VoxCandle, m: THREE.InstancedMesh) => {
    for (let v = 0; v < c.voxCount; v++) m.setMatrixAt(c.voxStart + v, ZERO_SCALE);
    const proxy = proxyRefs.current[c.id];
    if (proxy) proxy.position.set(0, -700 - c.id, 0);
  };

  const restoreCandle = (c: VoxCandle) => {
    for (let v = 0; v < c.voxCount; v++) alive.current[c.voxStart + v] = 1;
    aliveCount.current[c.id] = c.voxCount;
    fallVy.current[c.id] = -1;
  };

  useLayoutEffect(() => {
    const m = meshRef.current;
    if (!m) return;
    m.raycast = NO_RAYCAST;
    m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const cs0 = conductorState(0);
    for (const c of data.candles) {
      aliveCount.current[c.id] = c.voxCount;
      candleLivePos(c, 0, 0, cs0, evCache.current[c.id], data, _pos);
      basePos.current[c.id * 3] = _pos.x;
      basePos.current[c.id * 3 + 1] = _pos.y;
      basePos.current[c.id * 3 + 2] = _pos.z;
      writeCandle(c, m, 0, 0);
    }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    _basePos = basePos.current;
    _aliveCount = aliveCount.current;
    return () => { _basePos = null; _aliveCount = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // carve (player damage — always older than the theatre)
  useLayoutEffect(() => {
    _carve = (id, x, y, z, r, broadcast) => {
      const m = meshRef.current;
      const c = data.candles[id];
      if (!m || !c || aliveCount.current[id] <= 0 || hidden.current[id]) return;
      const r2 = r * r;
      const bx = basePos.current[id * 3];
      const by = basePos.current[id * 3 + 1];
      const bz = basePos.current[id * 3 + 2];
      const chunks: ReturnType<typeof voxDebris>[] = [];
      const colorHex = c.bull ? '#2fbf71' : '#c9184a';
      for (let v = 0; v < c.voxCount; v++) {
        const g = c.voxStart + v;
        if (!alive.current[g]) continue;
        const wx = bx + data.local[g * 3] * c.voxScale;
        const wy = by + data.local[g * 3 + 1] * c.voxScale;
        const wz = bz + data.local[g * 3 + 2] * c.voxScale;
        const dx = wx - x, dy = wy - y, dz = wz - z;
        if (dx * dx + dy * dy + dz * dz <= r2) {
          alive.current[g] = 0;
          aliveCount.current[id]--;
          m.setMatrixAt(g, ZERO_SCALE);
          if (chunks.length < 14) chunks.push(voxDebris(wx, wy, wz, x, y, z, colorHex));
        }
      }
      if (!chunks.length) return;
      if (
        fallVy.current[id] < 0 &&
        aliveCount.current[id] > 0 &&
        aliveCount.current[id] < c.voxCount * COLLAPSE_AT
      ) {
        fallVy.current[id] = 0.01;
        addTrauma(0.1);
      } else addTrauma(0.05);
      m.instanceMatrix.needsUpdate = true;
      playImpactSound();
      useStore.getState().addDebris(chunks);
      if (broadcast) socket.emit('vox', { id, x, y, z, r });
    };
    return () => { _carve = null; };
  }, [data]);

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
      m.setMatrixAt(g, ZERO_SCALE);
      if (chunks.length < 30) chunks.push(voxDebris(
        bx + data.local[g * 3], by + data.local[g * 3 + 1], bz + data.local[g * 3 + 2],
        bx, by - 3, bz, colorHex,
      ));
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
    const tW = warpTime(t);
    const cs = conductorState(t);
    frame.current = (frame.current + 1) % 8;
    tailTick.current++;
    let touched = false;

    for (let ci = 0; ci < data.candles.length; ci++) {
      const c = data.candles[ci];
      const falling = fallVy.current[ci] >= 0;
      const damaged = aliveCount.current[ci] < c.voxCount;

      // player-broken candles FALL every frame; the rest breathe round-robin 1/8
      if (falling) {
        if (aliveCount.current[ci] <= 0) continue;
        fallVy.current[ci] += G * dt;
        basePos.current[ci * 3 + 1] -= fallVy.current[ci] * dt;
        fallSpin.current[ci] += dt * 2.4;
        if (basePos.current[ci * 3 + 1] < -46) { shatter(c, m); touched = true; continue; }
        writeCandle(c, m, fallSpin.current[ci], cs.S);
        touched = true;
        continue;
      }
      if (ci % 8 !== frame.current) continue;
      if (aliveCount.current[ci] <= 0 && !hidden.current[ci]) continue; // player-shattered stays dead

      // fate: cache per epoch (damaged souls leave the schedule — gameplay first)
      const ev = evCache.current[ci];
      if (evEpoch.current[ci] !== cs.epochIdx) {
        evEpoch.current[ci] = cs.epochIdx;
        if (!damaged) fateOf(c, t, data, ev);
        else { ev.type = null; }
      }
      const status = candleLivePos(c, t, tW, cs, damaged ? { type: null, tStart: 0, dur: 0 } : ev, data, _pos);

      if (status === 2) {
        // SWALLOWED: the donut eats — feed flash + inward crumbs, then digest
        if (!hidden.current[ci]) {
          hidden.current[ci] = 1;
          blackHoleFeed.v = 1;
          const chunks: ReturnType<typeof voxDebris>[] = [];
          for (let k = 0; k < 14; k++) {
            const ch = voxDebris(_pos.x, _pos.y, _pos.z, BLACK_HOLE.x, BLACK_HOLE.y, BLACK_HOLE.z, c.bull ? '#2fbf71' : '#c9184a');
            ch.vx *= -1; ch.vy = (BLACK_HOLE.y - _pos.y) * 0.15; ch.vz *= -1; // sucked INWARD
            chunks.push(ch);
          }
          useStore.getState().addDebris(chunks);
          addTrauma(0.12);
          hideCandle(c, m);
          touched = true;
        }
        continue;
      }
      if (hidden.current[ci]) {
        // RESURRECTION in the halo — liquidity is immortal, only traders die
        hidden.current[ci] = 0;
        restoreCandle(c);
      }

      basePos.current[ci * 3] = _pos.x;
      basePos.current[ci * 3 + 1] = _pos.y;
      basePos.current[ci * 3 + 2] = _pos.z;

      // comet tail: golden crumbs streaming behind the runaway
      if (ev.type === 'comet' && status === 1 && (tailTick.current & 3) === 0) {
        useStore.getState().addDebris([voxDebris(_pos.x, _pos.y, _pos.z, _pos.x, _pos.y - 2, _pos.z, '#e9c46a')]);
      }

      writeCandle(c, m, 0, cs.S);
      touched = true;
    }
    if (touched) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
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
          <boxGeometry args={[3.6 * VOX_SIZE * c.voxScale, (c.voxCount / 9 + 6) * VOX_SIZE * c.voxScale, 3.6 * VOX_SIZE * c.voxScale]} />
        </mesh>
      ))}
    </group>
  );
};
