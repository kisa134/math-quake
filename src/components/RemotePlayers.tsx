import { useStore } from '../store';
import React, { useRef, useMemo, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import { RemotePlayerMinions } from './Minions';
import { VoxDude } from './VoxDude';
import { goreInbox, makeGore, LIMB } from '../game/voxHumanoid';

/**
 * V3.2 — remote players are WHITE BLOCKY VOXEL DUDES that break apart.
 * Every 'hit' broadcast lands in goreInbox; the victim's dude bursts voxel
 * gore (bone/blood/organ chunks through the Debris pool) and heavy hits POP a
 * limb off (regrows after a few seconds — god-mode sandbox, nobody truly dies).
 */
const POPPABLE = [LIMB.armL, LIMB.armR, LIMB.legL, LIMB.legR, LIMB.head];
const REGROW_MS = 6000;

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
  const speedRef = useRef(0);
  const prevPos = useRef(new THREE.Vector3(player.x, player.y, player.z));
  const [limbMask, setLimbMask] = useState(0);
  const regrow = useRef<number[]>([]);

  useMemo(() => {
    targetPos.current.set(player.x, player.y, player.z);
    targetRot.current.set(0, player.rotation, 0);
  }, [player.x, player.y, player.z, player.rotation]);

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    // Interpolate for smooth movement
    groupRef.current.position.lerp(targetPos.current, 10 * delta);

    // walk-anim speed estimate from interpolated motion
    if (delta > 0) {
      speedRef.current = prevPos.current.distanceTo(groupRef.current.position) / delta;
      prevPos.current.copy(groupRef.current.position);
    }

    // Simple rotation slerp
    const currentQuat = new THREE.Quaternion().setFromEuler(groupRef.current.rotation);
    const targetQuat = new THREE.Quaternion().setFromEuler(targetRot.current);
    currentQuat.slerp(targetQuat, 10 * delta);
    groupRef.current.rotation.setFromQuaternion(currentQuat);

    if (flashRef.current) {
      flashRef.current.intensity = player.isShooting ? 5 : 0;
    }

    // --- gore: drain hits addressed to THIS player -----------------------
    for (let i = goreInbox.length - 1; i >= 0; i--) {
      if (goreInbox[i].targetId !== player.id) continue;
      const { damage } = goreInbox.splice(i, 1)[0];
      const p = groupRef.current.position;
      useStore.getState().addDebris(makeGore(p.x, p.y + 0.4, p.z, Math.min(16, 6 + Math.round(damage * 0.12))));
      // heavy hit → a limb POPS off (extra chunk fountain), regrows later
      if (damage >= 35) {
        const candidates = POPPABLE.filter((b) => !(limbMask & (1 << b)));
        if (candidates.length) {
          const bit = candidates[Math.floor(Math.random() * candidates.length)];
          setLimbMask((m) => m | (1 << bit));
          useStore.getState().addDebris(makeGore(p.x, p.y + (bit === LIMB.head ? 0.8 : 0), p.z, 12, 9));
          const at = Date.now() + REGROW_MS;
          regrow.current.push(at);
          setTimeout(() => setLimbMask((m) => m & ~(1 << bit)), REGROW_MS);
        }
      }
    }
  });

  // The hit tag lives on the GROUP: hitscan/projectiles walk parents up from the
  // hit mesh, so the dude's own meshes stay tag-free while the whole figure
  // remains shootable. Keep isEnemy/isPlayer/id.
  return (
    <group
      ref={groupRef}
      position={[player.x, player.y, player.z]}
      userData={{ isEnemy: true, isPlayer: true, id: player.id }}
    >
      {/* the white blocky voxel dude (breaks apart) */}
      <VoxDude limbMask={limbMask} getSpeed={() => speedRef.current} />

      {/* Muzzle flash light */}
      <pointLight ref={flashRef} position={[0, 0, -1]} distance={10} color="#e9c46a" intensity={0} />
    </group>
  );
};
