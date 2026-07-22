import { useRef, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { RigidBody } from '@react-three/rapier';
import { useStore } from '../store';
import { Debris } from './Debris';

const _enemyPos = new THREE.Vector3();
const _enemyDir = new THREE.Vector3();
const _aimDir = new THREE.Vector3();

const EnemyMesh = ({ id, position, type }: { id: string, position: [number, number, number], type: string }) => {
  const rbRef = useRef<any>(null);
  const { camera } = useThree();
  const takeDamage = useStore((s) => s.takeDamage);
  const removeEnemy = useStore((s) => s.removeEnemy);
  
  // Random speeds
  const speed = useMemo(() => 4 + Math.random() * 4, []);
  const isCandle = type === 'candle';
  
  const geometry = useMemo(() => {
    switch (type) {
      case 'torus': return <torusGeometry args={[1, 0.4, 16, 100]} />;
      case 'torusKnot': return <torusKnotGeometry args={[1, 0.3, 100, 16]} />;
      case 'icosahedron': return <icosahedronGeometry args={[1, 0]} />;
      case 'octahedron': return <octahedronGeometry args={[1, 0]} />;
      case 'dodecahedron': return <dodecahedronGeometry args={[1, 0]} />;
      case 'candle': return <boxGeometry args={[1.5, 6, 1.5]} />;
      default: return <boxGeometry args={[1, 1, 1]} />;
    }
  }, [type]);

  const material = useMemo(() => {
    if (isCandle) {
      return new THREE.MeshStandardMaterial({ 
        color: '#ffb703',
        emissive: '#ffb703',
        emissiveIntensity: 0.2,
      });
    }
    const hue = Math.random();
    const color = new THREE.Color().setHSL(hue, 1, 0.5);
    return new THREE.MeshStandardMaterial({ 
      color,
      emissive: color,
      emissiveIntensity: 0.5,
      roughness: 0.2,
      metalness: 0.8,
      wireframe: Math.random() > 0.5
    });
  }, [isCandle]);

  useFrame((state, delta) => {
    if (!rbRef.current || isCandle) return;
    
    const rbPos = rbRef.current.translation();
    _enemyPos.set(rbPos.x, rbPos.y, rbPos.z);
    
    // Move towards player
    _enemyDir.subVectors(camera.position, _enemyPos).normalize();
    _enemyDir.y = 0; // Only move horizontally
    
    // Apply a force or velocity
    rbRef.current.applyImpulse({ x: _enemyDir.x * speed * delta, y: 0, z: _enemyDir.z * speed * delta }, true);

    // Shooting
    if (Math.random() < 0.005 * (speed / 4)) { // Random chance to shoot based on speed
      _aimDir.subVectors(camera.position, _enemyPos).normalize();
      _aimDir.y += 0.1; // arc up a bit
      const projSpeed = 20 + Math.random() * 10;
      
      useStore.getState().addProjectile({
        position: [_enemyPos.x, _enemyPos.y + 1, _enemyPos.z], // shoot from slightly above center
        velocity: [_aimDir.x * projSpeed, _aimDir.y * projSpeed, _aimDir.z * projSpeed],
        fromPlayer: false
      });
    }

    // Check collision with player manually via distance, because player has a collider too
    const dist = _enemyPos.distanceTo(camera.position);
    if (dist < 2.5) {
      takeDamage(10);
      removeEnemy(id);
    }
  });

  return (
    <RigidBody ref={rbRef} position={position} type="dynamic" linearDamping={2} angularDamping={1} mass={1}>
      <mesh 
        castShadow 
        receiveShadow
        userData={{ isEnemy: true, id }}
      >
        {geometry}
        <primitive object={material} attach="material" />
      </mesh>
    </RigidBody>
  );
};

export const Enemies = () => {
  const enemies = useStore((s) => s.enemies);

  return (
    <>
      {enemies.map((e) => (
        <EnemyMesh key={e.id} {...e} />
      ))}
      <Debris />
    </>
  );
};
