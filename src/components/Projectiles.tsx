import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../store';
import { socket } from '../socket';
import { addTrauma } from '../game/shake';
import { getSpell } from '../config/spells';
import { makeFlames } from '../game/voxel';
import type { DebrisChunk } from '../game/voxel';
import { carveVoxCandle } from './VoxelCandles';
import { ECON } from '../config/economy';

/**
 * Projectile behaviors — V2: сложносочинённая magic (multi-stage, layered).
 *
 *   rainbow (PRISM) — stage 1: white-hot hue-cycling bolt; stage 2 after
 *     `splitAt` ms it SPLITS into a cone of `splitCount` children, one per
 *     spectrum color red→violet (kind 'prism', half damage, short life);
 *     stage 3: every child impact burns a pixel-fire spot in its own color.
 *   void — heavy orb; impact IMPLODES: 12 debris chunks spawned on a shell
 *     around the hit with velocities pointing INWARD, then purple flames.
 *   homing — steers toward the nearest enemy AND leaves a flame-chunk trail
 *     (throttled to one chunk per ~80ms — cheap, readable arc).
 *   bolt/nova children — every spell impact leaves burning pixel flames.
 *
 * All effects ride existing systems (store.addDebris / addProjectile); module
 * temps keep the per-frame path allocation-free.
 */
export const Projectiles = () => {
  const projectiles = useStore((s) => s.projectiles);
  const { camera, scene } = useThree();

  return (
    <>
      {projectiles.map((p) => (
        <Projectile key={p.id} {...p} camera={camera} scene={scene} />
      ))}
    </>
  );
};

// Shared temporaries — reused every frame across every projectile (zero-alloc).
const _projDir = new THREE.Vector3();
const _steer = new THREE.Vector3();
const _rainbow = new THREE.Color();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _child = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);
const _altUp = new THREE.Vector3(1, 0, 0);

// PRISM spectrum: the 7 fixed child colors, red → violet.
const SPECTRUM = ['#ff0040', '#ff7b00', '#ffd000', '#39ff14', '#00c8ff', '#4361ee', '#b5179e'];
const PRISM = getSpell('rainbow');
const PRISM_SPLIT_AT = PRISM.splitAt ?? 400; // ms of flight before the split
const PRISM_SPLIT_COUNT = PRISM.splitCount ?? 7;
const PRISM_CHILD_LIFE = 1100; // ms — children are short-lived shards
const PRISM_CONE = 0.16; // rad — tight cone so the split reads as a burst

// Base render radius per spell kind — gives each spell a distinct silhouette.
const radiusFor = (kind?: string): number =>
  kind === 'void' ? 0.5 : kind === 'homing' ? 0.34 : kind === 'rainbow' ? 0.36 : kind === 'prism' ? 0.2 : 0.3;

// A small colored voxel burst at an impact point (drains via Debris.tsx inbox).
function spellImpact(x: number, y: number, z: number, color: string) {
  const chunks: Omit<DebrisChunk, 'id' | 'createdAt'>[] = [];
  for (let i = 0; i < 7; i++) {
    const a = Math.random() * Math.PI * 2;
    const b = Math.acos(2 * Math.random() - 1);
    const sp = 6 + Math.random() * 7;
    const dx = Math.sin(b) * Math.cos(a), dy = Math.cos(b), dz = Math.sin(b) * Math.sin(a);
    chunks.push({
      x, y, z,
      vx: dx * sp, vy: dy * sp + 3, vz: dz * sp,
      color,
      size: 0.18 + Math.random() * 0.22,
      rx: 0, ry: 0, rz: 0,
      sx: (Math.random() - 0.5) * 14, sy: (Math.random() - 0.5) * 14, sz: (Math.random() - 0.5) * 14,
      life: 0.55 + Math.random() * 0.3,
    });
  }
  useStore.getState().addDebris(chunks);
  addTrauma(0.05);
}

// VOID implosion: chunks spawned on a shell around the hit, velocities pointing
// INWARD (the world collapses into the orb), then purple flames rise.
function voidImplosion(x: number, y: number, z: number, color: string) {
  const chunks: Omit<DebrisChunk, 'id' | 'createdAt'>[] = [];
  for (let i = 0; i < 12; i++) {
    const a = Math.random() * Math.PI * 2;
    const b = Math.acos(2 * Math.random() - 1);
    const r = 2.2 + Math.random() * 1.4; // shell radius
    const dx = Math.sin(b) * Math.cos(a), dy = Math.cos(b), dz = Math.sin(b) * Math.sin(a);
    const sp = 9 + Math.random() * 5;
    chunks.push({
      x: x + dx * r, y: y + dy * r, z: z + dz * r,
      vx: -dx * sp, vy: -dy * sp, vz: -dz * sp, // sucked toward the impact
      color: Math.random() > 0.4 ? color : '#2b0a4a',
      size: 0.14 + Math.random() * 0.18,
      rx: 0, ry: 0, rz: 0,
      sx: (Math.random() - 0.5) * 16, sy: (Math.random() - 0.5) * 16, sz: (Math.random() - 0.5) * 16,
      life: 0.35 + Math.random() * 0.2, // die as they converge — reads as absorption
    });
  }
  useStore.getState().addDebris(chunks);
  useStore.getState().addDebris(makeFlames([x, y, z], color, 8));
  addTrauma(0.12);
}

// PRISM split: replace the parent with a spectrum cone of child bolts.
function prismSplit(pos: THREE.Vector3, vel: THREE.Vector3, dmg: number) {
  const spd = vel.length() || 40;
  _projDir.copy(vel).normalize();
  _up.copy(Math.abs(_projDir.y) > 0.9 ? _altUp : _worldUp);
  _right.crossVectors(_projDir, _up).normalize();
  _up.crossVectors(_right, _projDir).normalize();
  const st = useStore.getState();
  for (let i = 0; i < PRISM_SPLIT_COUNT; i++) {
    const a = (i / PRISM_SPLIT_COUNT) * Math.PI * 2;
    _child
      .copy(_projDir)
      .multiplyScalar(Math.cos(PRISM_CONE))
      .addScaledVector(_right, Math.cos(a) * Math.sin(PRISM_CONE))
      .addScaledVector(_up, Math.sin(a) * Math.sin(PRISM_CONE))
      .normalize()
      .multiplyScalar(spd);
    st.addProjectile({
      position: [pos.x, pos.y, pos.z],
      velocity: [_child.x, _child.y, _child.z],
      fromPlayer: true,
      kind: 'prism', // short-lived spectrum shard (bolt behavior + flames)
      color: SPECTRUM[i % SPECTRUM.length],
      damage: dmg * 0.5,
      speed: spd,
    });
  }
  // The split itself flashes — a white micro-burst at the fork point.
  useStore.getState().addDebris(makeFlames([pos.x, pos.y, pos.z], '#ffffff', 5));
  addTrauma(0.04);
}

const Projectile = ({ id, position, velocity, fromPlayer, createdAt, kind, color, damage, speed, camera, scene }: any) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const pos = useRef(new THREE.Vector3(...position));
  const vel = useRef(new THREE.Vector3(...velocity));
  const raycaster = useRef(new THREE.Raycaster());
  const lastTrail = useRef(0); // homing flame-trail throttle
  const removeProjectile = useStore((s) => s.removeProjectile);
  const takeDamage = useStore((s) => s.takeDamage);

  const dmg: number = typeof damage === 'number' ? damage : 40;
  const baseR = radiusFor(kind);
  const isRainbow = kind === 'rainbow';
  const isPrismChild = kind === 'prism';
  // Fallback keeps the ORIGINAL look for plain gun/enemy shots (no spell fields).
  const baseColor: string = color || (fromPlayer ? '#00f5d4' : '#f72585');
  const maxLife = isPrismChild ? PRISM_CHILD_LIFE : 3000;

  useFrame((_, deltaRaw) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const delta = Math.min(deltaRaw, 1 / 30);
    const now = Date.now();

    // --- PRISM stage 2: the bolt splits into a spectrum cone mid-flight ---
    if (isRainbow && fromPlayer && now - createdAt > PRISM_SPLIT_AT) {
      prismSplit(pos.current, vel.current, dmg);
      removeProjectile(id);
      return;
    }

    // --- homing: steer velocity toward the nearest enemy, keep speed ---
    if (kind === 'homing' && fromPlayer) {
      const st = useStore.getState();
      let bx = 0, by = 0, bz = 0, bestD = Infinity, found = false;
      for (const e of st.enemies) {
        const dx = e.position[0] - pos.current.x, dy = e.position[1] - pos.current.y, dz = e.position[2] - pos.current.z;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bestD) { bestD = d; bx = e.position[0]; by = e.position[1]; bz = e.position[2]; found = true; }
      }
      for (const e of st.netEnemies) {
        const dx = e.x - pos.current.x, dy = e.y - pos.current.y, dz = e.z - pos.current.z;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bestD) { bestD = d; bx = e.x; by = e.y; bz = e.z; found = true; }
      }
      if (found) {
        const spd = typeof speed === 'number' && speed > 0 ? speed : vel.current.length() || 40;
        _steer.set(bx - pos.current.x, by - pos.current.y, bz - pos.current.z);
        if (_steer.lengthSq() > 1e-4) {
          _steer.normalize();
          _projDir.copy(vel.current).normalize();
          _projDir.lerp(_steer, Math.min(1, 3.5 * delta)); // turn rate
          _projDir.normalize().multiplyScalar(spd);
          vel.current.copy(_projDir);
        }
      }
      // Flame trail: one tiny chunk per ~80ms marks the seeker's curved path.
      if (now - lastTrail.current > 80) {
        lastTrail.current = now;
        useStore.getState().addDebris(
          makeFlames([pos.current.x, pos.current.y, pos.current.z], baseColor, 1),
        );
      }
    }

    // Move
    pos.current.addScaledVector(vel.current, delta);
    mesh.position.copy(pos.current);

    // --- flashy render: rainbow hue-cycle, plus a subtle pulse for all spells ---
    const mat = mesh.material as THREE.MeshBasicMaterial;
    if (isRainbow) {
      _rainbow.setHSL(((now * 0.0015) % 1), 1, 0.6);
      mat.color.copy(_rainbow);
    }
    if (kind) {
      const pulse = 1 + Math.sin(now * 0.02) * 0.15;
      mesh.scale.setScalar(pulse);
    }

    // Expire (prism children burn out fast)
    if (now - createdAt > maxLife) {
      if (isPrismChild) {
        // Fizzle in the air — a last lick of flame where the shard died.
        useStore.getState().addDebris(
          makeFlames([pos.current.x, pos.current.y, pos.current.z], baseColor, 2),
        );
      }
      removeProjectile(id);
      return;
    }

    // Collision with the local player (enemy shots only)
    if (!fromPlayer) {
      if (pos.current.distanceTo(camera.position) < 2) {
        takeDamage(15);
        removeProjectile(id);
        return;
      }
    }

    // Collision with environment + enemies (forward raycast). far is clamped to
    // this frame's travel so bounding-sphere tests cull almost everything — a
    // full-scene unbounded raycast per projectile per frame was an FPS killer.
    _projDir.copy(vel.current).normalize();
    raycaster.current.set(pos.current, _projDir);
    const distNextFrame = vel.current.length() * delta;
    raycaster.current.far = distNextFrame + 0.6;
    const hits = raycaster.current.intersectObjects(scene.children, true);

    for (const hit of hits) {
      if (hit.distance < distNextFrame + 0.5) {
        if (fromPlayer) {
          let obj: THREE.Object3D | null = hit.object;
          let hitEnemy = false;
          while (obj) {
            if (obj.userData?.isEnemy) {
              if (obj.userData?.isPlayer) {
                socket.emit('hit', { targetId: obj.userData.id, damage: dmg });
              } else {
                const eid = obj.userData.id;
                const pt: [number, number, number] = [hit.point.x, hit.point.y, hit.point.z];
                if (useStore.getState().isHost) {
                  useStore.getState().damageEnemy(eid, dmg, pt);
                } else {
                  socket.emit('ehit', { id: eid, damage: dmg, point: pt });
                }
              }
              useStore.getState().addMoney(dmg * ECON.moneyPerDamage); // CS economy
              hitEnemy = true;
              break;
            }
            obj = obj.parent;
          }
          if (hitEnemy || hit.object.userData?.isWall || hit.object.userData?.isFloor || hit.object.userData?.isJumpPad) {
            const hx = hit.point.x, hy = hit.point.y, hz = hit.point.z;
            // Teardown voxel candles: projectiles carve too (bigger bite).
            if (hit.object.userData?.isVoxCandle) {
              carveVoxCandle(+hit.object.userData.id, hx, hy, hz, 1.2 + dmg * 0.014);
            }
            if (kind === 'void') {
              // Stage impact: implosion shell + purple flames (no outward burst).
              voidImplosion(hx, hy, hz, baseColor);
            } else {
              spellImpact(hx, hy, hz, isRainbow ? '#ffffff' : baseColor);
              // Every spell impact BURNS: pixel-fire spot in the spell's color
              // (prism children each stamp their own spectrum hue).
              if (kind) {
                useStore.getState().addDebris(
                  makeFlames([hx, hy, hz], baseColor, isPrismChild ? 4 : 6),
                );
              }
            }
            removeProjectile(id);
            return;
          }
        } else if (hit.object.userData?.isWall || hit.object.userData?.isFloor || hit.object.userData?.isJumpPad) {
          removeProjectile(id);
          return;
        }
      }
    }
  });

  return (
    <mesh ref={meshRef} position={position}>
      <sphereGeometry args={[baseR, kind === 'void' ? 12 : 8, kind === 'void' ? 12 : 8]} />
      <meshBasicMaterial color={baseColor} toneMapped={false} />
    </mesh>
  );
};
