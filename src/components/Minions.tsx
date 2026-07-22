import React, { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { RigidBody } from '@react-three/rapier';
import * as THREE from 'three';
import { useStore } from '../store';
import { socket } from '../socket';

// Local player's minions
export const LocalMinions = () => {
  const { commandTarget, isPlaying } = useStore();
  const minionRefs = [useRef<any>(null), useRef<any>(null), useRef<any>(null)];
  
  // Starting positions for 3 minions
  const startOffsets: [number, number, number][] = [[-2, 5, -2], [0, 5, -3], [2, 5, -2]];

  useFrame((_, delta) => {
    if (!isPlaying) return;
    
    const minionData: any[] = [];
    
    minionRefs.forEach((ref, idx) => {
      if (ref.current) {
        const pos = ref.current.translation();
        
        // Move towards command target
        if (commandTarget) {
           const target = new THREE.Vector3(
              commandTarget[0] + startOffsets[idx][0], 
              0, 
              commandTarget[2] + startOffsets[idx][2]
           );
           const current = new THREE.Vector3(pos.x, 0, pos.z);
           
           if (current.distanceTo(target) > 1.5) {
             const dir = target.sub(current).normalize();
             ref.current.applyImpulse({ x: dir.x * 0.5, y: 0, z: dir.z * 0.5 }, true);
           }
        }
        
        // Damping and speed limit
        const vel = ref.current.linvel();
        ref.current.setLinvel({ x: vel.x * 0.9, y: vel.y, z: vel.z * 0.9 }, true);
        
        minionData.push({ x: pos.x, y: pos.y, z: pos.z });
      }
    });
    
    // Broadcast minion positions occasionally, handled inside Player.tsx to batch updates?
    // Actually we can just update a local ref in the store and let Player.tsx pick it up
    useStore.setState({ localMinions: minionData });
  });

  if (!isPlaying) return null;

  return (
    <>
      {startOffsets.map((offset, i) => (
        <RigidBody key={`minion-${i}`} ref={minionRefs[i]} colliders="cuboid" type="dynamic" position={offset} mass={0.5} lockRotations>
          <mesh castShadow receiveShadow>
            <boxGeometry args={[0.8, 0.8, 0.8]} />
            <meshStandardMaterial color="#00f5d4" />
          </mesh>
          <mesh position={[0, 0.2, -0.41]}>
             <boxGeometry args={[0.4, 0.1, 0.1]} />
             <meshBasicMaterial color="#f72585" />
          </mesh>
        </RigidBody>
      ))}
    </>
  );
};

// Remote player's minions (rendered simply)
export const RemotePlayerMinions = ({ minions }: { minions?: {x: number, y: number, z: number}[] }) => {
  if (!minions) return null;
  
  return (
    <group>
       {minions.map((m, i) => (
          <mesh key={i} position={[m.x, m.y, m.z]} castShadow receiveShadow>
            <boxGeometry args={[0.8, 0.8, 0.8]} />
            <meshStandardMaterial color="#4361ee" />
            <mesh position={[0, 0.2, -0.41]}>
               <boxGeometry args={[0.4, 0.1, 0.1]} />
               <meshBasicMaterial color="#f72585" />
            </mesh>
          </mesh>
       ))}
    </group>
  );
};
