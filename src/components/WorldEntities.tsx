import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { sampleWorld } from '../net/worldBuffer';
import { PALETTE } from '../theme';

/**
 * Increment 05 MVP renderer: draws the server-authoritative "dummy" world
 * entity by reading the interpolated snapshot buffer each frame (no React/
 * zustand in the hot path, no allocations). Proof that server tick →
 * world_snapshot → client interpolation works before the train/creatures.
 * Later this generalizes to a pooled/instanced renderer keyed by entity id.
 */
export const WorldEntities = () => {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const w = sampleWorld();
    let first: { x: number; y: number; z: number; yaw: number } | null = null;
    for (const v of w.creatures.values()) { first = v; break; }
    if (first) {
      mesh.visible = true;
      mesh.position.set(first.x, first.y, first.z);
      mesh.rotation.y = first.yaw;
    } else {
      mesh.visible = false;
    }
  });

  return (
    <mesh ref={meshRef} visible={false}>
      <octahedronGeometry args={[1.2, 0]} />
      <meshBasicMaterial color={PALETTE.uiCyan} toneMapped={false} wireframe />
    </mesh>
  );
};
