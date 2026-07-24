import { useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../store';
import { addTrauma } from '../game/shake';
import { playImpactSound, playExplosionSound } from '../utils/audio';

/**
 * Voxel debris — all chunks in ONE draw call.
 *
 * The store's `debris` array is only a spawn inbox: on a kill frame the store
 * pushes fresh chunks, this component drains them into a local pool, clears the
 * inbox, and from then on integrates + renders them on the CPU via a single
 * InstancedMesh. No per-chunk RigidBody, no per-frame React state, no allocs in
 * the loop. See docs/increments/02-voxel-destruction.md.
 */
const CAP = 384;
const GRAVITY = 30;
const FLOOR_Y = -50;
const FADE = 0.6;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _geo = new THREE.BoxGeometry(1, 1, 1);
const _mat = new THREE.MeshBasicMaterial({ toneMapped: false }); // flat neon, pops in the dark

type Chunk = {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  rx: number; ry: number; rz: number;
  sx: number; sy: number; sz: number;
  color: string; size: number; createdAt: number; life: number;
};

export const Debris = () => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const pool = useRef<Chunk[]>([]);
  const lastFxT = useRef(0);

  useEffect(() => {
    const m = meshRef.current;
    if (!m) return;
    // Pre-allocate the per-instance color buffer at full capacity. Otherwise
    // three lazily allocates it sized to the current `count` (which we set to 0),
    // producing a 0-length buffer and broken/undersized instance colors.
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3);
    m.count = 0;
  }, []);

  useFrame((_, dtRaw) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const dt = Math.min(dtRaw, 1 / 30);

    // --- death FX (shake + sound), once per death, no re-render ---
    const fx = useStore.getState().lastDeathFx;
    if (fx && fx.t !== lastFxT.current) {
      lastFxT.current = fx.t;
      addTrauma(fx.big ? 0.35 : 0.18);
      if (fx.big) playExplosionSound(); else playImpactSound();
    }

    // --- drain the spawn inbox (only happens on kill frames) ---
    const inbox = useStore.getState().debris;
    if (inbox.length) {
      for (const d of inbox) {
        pool.current.push({
          x: d.x, y: d.y, z: d.z,
          vx: d.vx, vy: d.vy, vz: d.vz,
          rx: d.rx ?? 0, ry: d.ry ?? 0, rz: d.rz ?? 0,
          sx: d.sx ?? 0, sy: d.sy ?? 0, sz: d.sz ?? 0,
          color: d.color, size: d.size, createdAt: d.createdAt, life: d.life ?? 2.5,
        });
      }
      if (pool.current.length > CAP) pool.current.splice(0, pool.current.length - CAP);
      useStore.setState({ debris: [] });
    }

    // --- integrate + write instance matrices ---
    const now = Date.now();
    const arr = pool.current;
    let n = 0;
    for (let i = arr.length - 1; i >= 0; i--) {
      const c = arr[i];
      const age = (now - c.createdAt) / 1000;
      if (age >= c.life) { arr.splice(i, 1); continue; }
      c.vy -= GRAVITY * dt;
      c.x += c.vx * dt; c.y += c.vy * dt; c.z += c.vz * dt;
      c.rx += c.sx * dt; c.ry += c.sy * dt; c.rz += c.sz * dt;
      if (c.y < FLOOR_Y) { arr.splice(i, 1); continue; }
      const remain = c.life - age;
      const k = remain < FADE ? remain / FADE : 1; // shrink-out tail
      _v.set(c.x, c.y, c.z);
      _e.set(c.rx, c.ry, c.rz);
      _q.setFromEuler(_e);
      _s.setScalar(c.size * k);
      _m.compose(_v, _q, _s);
      mesh.setMatrixAt(n, _m);
      mesh.setColorAt(n, _c.set(c.color));
      n++;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return <instancedMesh ref={meshRef} args={[_geo, _mat, CAP]} frustumCulled={false} />;
};
