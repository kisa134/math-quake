import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../store';
import { socket } from '../socket';

export const Projectiles = () => {
  const { projectiles, removeProjectile, takeDamage } = useStore();
  const { camera, scene } = useThree();
  const dummy = useRef(new THREE.Object3D());
  const meshRef = useRef<THREE.InstancedMesh>(null);
  
  // Actually, because projectiles need to be removed and their positions updated, 
  // mapping normal meshes might be easier to reason about than InstancedMesh for a quick prototype, 
  // but let's just map them.
  return (
    <>
      {projectiles.map(p => (
        <Projectile key={p.id} {...p} camera={camera} scene={scene} />
      ))}
    </>
  );
};

const _projDir = new THREE.Vector3();

const Projectile = ({ id, position, velocity, fromPlayer, createdAt, camera, scene }: any) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const pos = useRef(new THREE.Vector3(...position));
  const vel = useRef(new THREE.Vector3(...velocity));
  const removeProjectile = useStore(s => s.removeProjectile);
  const takeDamage = useStore(s => s.takeDamage);
  const raycaster = useRef(new THREE.Raycaster());

  useFrame((_, delta) => {
    if (!meshRef.current) return;
    
    // Move
    pos.current.addScaledVector(vel.current, delta);
    meshRef.current.position.copy(pos.current);

    // Expire
    if (Date.now() - createdAt > 3000) {
      removeProjectile(id);
      return;
    }

    // Check collision with player
    if (!fromPlayer) {
      const distToPlayer = pos.current.distanceTo(camera.position);
      if (distToPlayer < 2) {
        takeDamage(15);
        removeProjectile(id);
        return;
      }
    }

    // Check collision with environment and enemies
    _projDir.copy(vel.current).normalize();
    raycaster.current.set(pos.current, _projDir);
    const distNextFrame = vel.current.length() * delta;
    const hits = raycaster.current.intersectObjects(scene.children, true);
    
    for (const hit of hits) {
      if (hit.distance < distNextFrame + 0.5) {
        if (fromPlayer) {
           let obj: THREE.Object3D | null = hit.object;
           let hitEnemy = false;
           while(obj) {
             if (obj.userData?.isEnemy) {
               if (obj.userData?.isPlayer) {
                 socket.emit("hit", { targetId: obj.userData.id, damage: 40 });
               } else {
                 useStore.getState().damageEnemy(obj.userData.id, 40, [hit.point.x, hit.point.y, hit.point.z]);
               }
               hitEnemy = true;
               break;
             }
             obj = obj.parent;
           }
           if (hitEnemy || hit.object.userData?.isWall || hit.object.userData?.isFloor || hit.object.userData?.isJumpPad) {
             removeProjectile(id);
             return;
           }
        } else {
          // Check for walls
          if (hit.object.userData?.isWall || hit.object.userData?.isFloor || hit.object.userData?.isJumpPad) {
            removeProjectile(id);
            return;
          }
        }
      }
    }
  });

  return (
    <mesh ref={meshRef} position={position}>
      <sphereGeometry args={[0.3, 8, 8]} />
      <meshBasicMaterial color={fromPlayer ? "#00f5d4" : "#f72585"} />
    </mesh>
  );
};
