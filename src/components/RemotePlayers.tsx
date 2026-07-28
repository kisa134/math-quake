import { useStore } from '../store';
import React, { useRef, useMemo, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import { RemotePlayerMinions } from './Minions';
import { VoxDude } from './VoxDude';
import { goreInbox, makeGore, LIMB, DUDE_FEET_Y } from '../game/voxHumanoid';
import { peekTrauma, severInbox } from '../game/trauma';
import { PARTS, BV } from '../game/anatomy';

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
  const bleedTick = useRef(0);

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

    // V9 Р: его рост (L/K) — гигант виден гигантом, мышь мышью
    {
      const want = player.scale ?? 1;
      const cur = groupRef.current.scale.x;
      if (Math.abs(cur - want) > 0.001) {
        groupRef.current.scale.setScalar(cur + (want - cur) * Math.min(1, delta * 8));
      }
    }

    // --- V10: КРОВЬ из открытых ран + отрывы конечностей ------------------
    {
      const tr = peekTrauma(player.id);
      if (tr && tr.bleeds.length) {
        bleedTick.current += delta;
        if (bleedTick.current > 0.09) {
          bleedTick.current = 0;
          const p = groupRef.current.position;
          for (const b of tr.bleeds) {
            if (b.stopAt) continue;
            const pv = PARTS[b.part].pivot;
            const bx = p.x + pv[0] * BV, by = p.y + DUDE_FEET_Y + pv[1] * BV, bz = p.z + pv[2] * BV;
            // артериальное БЬЁТ струёй, венозное течёт, капиллярное сочится
            const n = b.type === 'arterial' ? 3 : b.type === 'venous' ? 2 : 1;
            const jet = b.type === 'arterial' ? 7 : b.type === 'venous' ? 2.2 : 0.8;
            const pulse = b.type === 'arterial' ? 0.55 + Math.abs(Math.sin(performance.now() * 0.0035)) : 1;
            useStore.getState().addDebris(Array.from({ length: n }, () => ({
              x: bx, y: by, z: bz,
              vx: (Math.random() - 0.5) * jet * pulse,
              vy: 1.2 + Math.random() * jet * 0.5 * pulse,
              vz: (Math.random() - 0.5) * jet * pulse,
              color: b.type === 'arterial' ? '#ff2d55' : '#7a0c2e',
              size: 0.05 + Math.random() * 0.07,
              rx: 0, ry: 0, rz: 0,
              life: 900 + Math.random() * 700,
            })));
          }
        }
      }
    }
    for (let i = severInbox.length - 1; i >= 0; i--) {
      if (severInbox[i].id !== player.id) continue;
      const ev = severInbox.splice(i, 1)[0];
      const p = groupRef.current.position;
      const pv = PARTS[ev.part].pivot;
      useStore.getState().addDebris(makeGore(
        p.x + pv[0] * BV, p.y + DUDE_FEET_Y + pv[1] * BV, p.z + pv[2] * BV, 22, 11,
      ));
    }

    // --- gore: drain hits addressed to THIS player -----------------------
    for (let i = goreInbox.length - 1; i >= 0; i--) {
      if (goreInbox[i].targetId !== player.id) continue;
      const { damage, limb } = goreInbox.splice(i, 1)[0];
      const p = groupRef.current.position;
      useStore.getState().addDebris(makeGore(p.x, p.y + 0.4, p.z, Math.min(16, 6 + Math.round(damage * 0.12))));
      // V9 К (Kenshi): отрывается ИМЕННО та конечность, в которую попали.
      // Прицельный выстрел по руке/ноге рвёт её легче, чем шальной в корпус.
      const aimed = limb === 'legs' || limb === 'arms' || limb === 'head';
      if (damage >= (aimed ? 20 : 35)) {
        // сторона детерминирована уроном → у всех в комнате отрывается одна и та же
        const pair = limb === 'legs' ? [LIMB.legL, LIMB.legR]
          : limb === 'arms' ? [LIMB.armL, LIMB.armR]
          : limb === 'head' ? [LIMB.head] : POPPABLE;
        const wanted = pair[Math.round(damage) % pair.length];
        const candidates = (limbMask & (1 << wanted))
          ? pair.filter((b) => !(limbMask & (1 << b)))
          : [wanted];
        if (candidates.length) {
          const bit = candidates[0];
          setLimbMask((m) => m | (1 << bit));
          useStore.getState().addDebris(makeGore(p.x, p.y + (bit === LIMB.head ? 0.8 : DUDE_FEET_Y + 0.4), p.z, 12, 9));
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
      {/* the white blocky voxel dude (breaks apart). Стоит СТУПНЯМИ на низу
          капсулы (сеть шлёт центр тела) — иначе бойцы парили над полом. */}
      <group position={[0, DUDE_FEET_Y, 0]}>
        <VoxDude
          limbMask={limbMask}
          getSpeed={() => speedRef.current}
          weapon={player.currentWeapon ?? 0}
          aiming={!!player.isShooting}
          traumaId={player.id}
        />
      </group>

      {/* Muzzle flash light */}
      <pointLight ref={flashRef} position={[0, 0, -1]} distance={10} color="#e9c46a" intensity={0} />
    </group>
  );
};
