import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { RigidBody } from '@react-three/rapier';
import { tag } from '../game/hitTags';
import { MATTE_WORLD, MATTE_WORLD_SOFT } from '../game/materials';
import { accent } from '../game/accent';
import { orbSpawnInbox } from '../game/botHorde';
import { QUAKE_MAPS } from '../game/quakeMaps';
import type { MapId } from '../config/maps';

/**
 * КВЕЙК-АРЕНА — renders one authored map from game/quakeMaps.ts: fixed-body
 * box pieces (наш трупно-матовый + акцент-кромки), jump pads on the EXISTING
 * isJumpPad physics (player and bots both bounce), and Quake-style item
 * spots — buff/cash orbs respawn on a 20s timer through orbSpawnInbox.
 * Арены лёгкие: тяжёлый мир пончика не монтируется вовсе.
 */
const METAL_MAT = new THREE.MeshStandardMaterial({
  color: '#9a8f7a', emissive: '#9a8f7a', emissiveIntensity: 0.35,
  roughness: 0.25, metalness: 0.95, toneMapped: false,
});
const PAD_MAT = new THREE.MeshStandardMaterial({
  color: '#c8b273', emissive: '#c8b273', emissiveIntensity: 1.0, toneMapped: false,
});
const GLOW_MAT = new THREE.MeshBasicMaterial({ color: '#c8b273', toneMapped: false });

const ORB_RESPAWN_MS = 20000;

export const QuakeArena = ({ map }: { map: Exclude<MapId, 'donut'> }) => {
  const data = useMemo(() => QUAKE_MAPS[map], [map]);
  const nextOrbAt = useRef<Float64Array>(new Float64Array(data.orbs.length)); // 0 = spawn now
  const lastCheck = useRef(0);

  useFrame(() => {
    // квейковские айтемы: каждый спот роняет орб раз в 20с
    const now = performance.now();
    if (now - lastCheck.current < 1000) return;
    lastCheck.current = now;
    GLOW_MAT.color.copy(accent);
    PAD_MAT.emissive.copy(accent);
    for (let i = 0; i < data.orbs.length; i++) {
      if (now >= nextOrbAt.current[i]) {
        nextOrbAt.current[i] = now + ORB_RESPAWN_MS;
        const o = data.orbs[i];
        orbSpawnInbox.push({ x: o.p[0], y: o.p[1], z: o.p[2], kind: o.kind });
      }
    }
  });

  return (
    <group>
      {data.pieces.map((pc, i) => {
        if (pc.glow) {
          return (
            <mesh key={'g' + i} position={pc.p} material={GLOW_MAT} onUpdate={(m) => { m.raycast = () => {}; }}>
              <boxGeometry args={pc.s} />
            </mesh>
          );
        }
        const ud = pc.wall
          ? tag({ isWall: true, ...(pc.metal ? { isMetal: true } : {}) })
          : tag({ isFloor: true, ...(pc.metal ? { isMetal: true } : {}) });
        return (
          <RigidBody key={i} type="fixed">
            <mesh position={pc.p} material={pc.metal ? METAL_MAT : pc.wall ? MATTE_WORLD_SOFT : MATTE_WORLD} userData={ud}>
              <boxGeometry args={pc.s} />
            </mesh>
          </RigidBody>
        );
      })}
      {data.pads.map((pad, i) => (
        <RigidBody key={'p' + i} type="fixed">
          <mesh position={pad.p} material={PAD_MAT} userData={tag({ isJumpPad: true, jumpForce: pad.force })}>
            <cylinderGeometry args={[2.6, 2.6, 0.6, 16]} />
          </mesh>
        </RigidBody>
      ))}
    </group>
  );
};
