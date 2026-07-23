import { useStore } from '../store';
import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import { RemotePlayerMinions } from './Minions';
import { CharacterModel } from './CharacterModel';

export const RemotePlayers = () => {
  const remotePlayers = useStore(state => state.remotePlayers);
  
  return (
    <>
      {Object.entries(remotePlayers).map(([id, player]) => (
        <React.Fragment key={id}>
          <RemotePlayer player={player} />
          <RemotePlayerMinions minions={player.minions} />
        </React.Fragment>
      ))}
    </>
  );
};

const RemotePlayer = ({ player }: { player: any }) => {
  const groupRef = useRef<THREE.Group>(null);
  const flashRef = useRef<THREE.PointLight>(null);
  const targetPos = useRef(new THREE.Vector3(player.x, player.y, player.z));
  const targetRot = useRef(new THREE.Euler(0, player.rotation, 0));

  useMemo(() => {
    targetPos.current.set(player.x, player.y, player.z);
    targetRot.current.set(0, player.rotation, 0);
  }, [player.x, player.y, player.z, player.rotation]);

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    // Interpolate for smooth movement
    groupRef.current.position.lerp(targetPos.current, 10 * delta);
    
    // Simple rotation slerp
    const currentQuat = new THREE.Quaternion().setFromEuler(groupRef.current.rotation);
    const targetQuat = new THREE.Quaternion().setFromEuler(targetRot.current);
    currentQuat.slerp(targetQuat, 10 * delta);
    groupRef.current.rotation.setFromQuaternion(currentQuat);
    
    if (flashRef.current) {
       flashRef.current.intensity = player.isShooting ? 5 : 0;
    }
  });

  // The hit tag lives on the GROUP: hitscan/projectiles walk parents up from the
  // hit mesh (see Player.tsx / Projectiles.tsx), so the avatar's own meshes stay
  // tag-free while the whole figure remains shootable. Keep isEnemy/isPlayer/id.
  return (
    <group
      ref={groupRef}
      position={[player.x, player.y, player.z]}
      userData={{ isEnemy: true, isPlayer: true, id: player.id }}
    >
      {/* Their chosen figure (falls back to a Meshy creature). */}
      <CharacterModel avatar={player.avatar ?? 'skull'} />

      {/* Muzzle flash light */}
      <pointLight ref={flashRef} position={[0, 0, -1]} distance={10} color="#00f5d4" intensity={0} />
    </group>
  );
};
