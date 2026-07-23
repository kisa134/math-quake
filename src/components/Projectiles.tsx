import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../store';
import { socket } from '../socket';
import { addTrauma } from '../game/shake';
import type { DebrisChunk } from '../game/voxel';

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

// Base render radius per spell kind — gives each spell a distinct silhouette.
const radiusFor = (kind?: string): number =>
  kind === 'void' ? 0.5 : kind === 'homing' ? 0.34 : kind === 'rainbow' ? 0.36 : 0.3;

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

const Projectile = ({ id, position, velocity, fromPlayer, createdAt, kind, color, damage, speed, camera, scene }: any) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const pos = useRef(new THREE.Vector3(...position));
  const vel = useRef(new THREE.Vector3(...velocity));
  const raycaster = useRef(new THREE.Raycaster());
  const removeProjectile = useStore((s) => s.removeProjectile);
  const takeDamage = useStore((s) => s.takeDamage);

  const dmg: number = typeof damage === 'number' ? damage : 40;
  const baseR = radiusFor(kind);
  const isRainbow = kind === 'rainbow';
  // Fallback keeps the ORIGINAL look for plain gun/enemy shots (no spell fields).
  const baseColor: string = color || (fromPlayer ? '#00f5d4' : '#f72585');

  useFrame((_, deltaRaw) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const delta = Math.min(deltaRaw, 1 / 30);

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
    }

    // Move
    pos.current.addScaledVector(vel.current, delta);
    mesh.position.copy(pos.current);

    // --- flashy render: rainbow hue-cycle, plus a subtle pulse for all spells ---
    const mat = mesh.material as THREE.MeshBasicMaterial;
    if (isRainbow) {
      _rainbow.setHSL(((Date.now() * 0.0015) % 1), 1, 0.6);
      mat.color.copy(_rainbow);
    }
    if (kind) {
      const pulse = 1 + Math.sin(Date.now() * 0.02) * 0.15;
      mesh.scale.setScalar(pulse);
    }

    // Expire
    if (Date.now() - createdAt > 3000) { removeProjectile(id); return; }

    // Collision with the local player (enemy shots only)
    if (!fromPlayer) {
      if (pos.current.distanceTo(camera.position) < 2) {
        takeDamage(15);
        removeProjectile(id);
        return;
      }
    }

    // Collision with environment + enemies (forward raycast)
    _projDir.copy(vel.current).normalize();
    raycaster.current.set(pos.current, _projDir);
    const distNextFrame = vel.current.length() * delta;
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
              hitEnemy = true;
              break;
            }
            obj = obj.parent;
          }
          if (hitEnemy || hit.object.userData?.isWall || hit.object.userData?.isFloor || hit.object.userData?.isJumpPad) {
            spellImpact(hit.point.x, hit.point.y, hit.point.z, isRainbow ? '#ffffff' : baseColor);
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
