import { useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../store';
import { orbSpawnInbox } from '../game/botHorde';
import { playJumpSound } from '../utils/audio';

/**
 * V4.1 dopamine buffs — glowing orbs dropped by dead bots (client-local loot,
 * every player gets their own rolls). Walk into one (<2.6u) to eat it:
 *   RAGE  (crimson) — fire-rate ×1.6, 12s
 *   SURGE (cyan)    — move speed ×1.35, 12s
 *   MIDAS (gold)    — money gained ×2, 15s
 * Orbs float + spin, despawn after 20s. ≤10 alive; plain meshes (cheap).
 */
interface Orb { id: number; type: 'rage' | 'surge' | 'midas'; x: number; y: number; z: number; born: number }
const ORB_COLORS: Record<Orb['type'], string> = { rage: '#e63946', surge: '#00b4d8', midas: '#ffd166' };
const ORB_DUR: Record<Orb['type'], number> = { rage: 12000, surge: 12000, midas: 15000 };
let nextOrb = 1;

export const BuffOrbs = () => {
  const [orbs, setOrbs] = useState<Orb[]>([]);
  const { camera } = useThree();
  const groupRefs = useRef<Map<number, THREE.Group>>(new Map());

  useFrame((state) => {
    // spawn from dead bots
    let changed: Orb[] | null = null;
    while (orbSpawnInbox.length) {
      const s = orbSpawnInbox.pop()!;
      const roll = Math.random();
      const type: Orb['type'] = roll < 0.34 ? 'rage' : roll < 0.67 ? 'surge' : 'midas';
      (changed ??= [...orbs]).push({ id: nextOrb++, type, x: s.x, y: s.y, z: s.z, born: Date.now() });
      if (changed.length > 10) changed.shift();
    }
    // float anim + pickup + expiry
    const now = Date.now();
    const t = state.clock.elapsedTime;
    let picked: number[] | null = null;
    for (const o of changed ?? orbs) {
      const g = groupRefs.current.get(o.id);
      if (g) {
        g.position.set(o.x, o.y + Math.sin(t * 2 + o.id) * 0.4, o.z);
        g.rotation.y = t * 2.2 + o.id;
      }
      const dx = camera.position.x - o.x, dy = camera.position.y - o.y, dz = camera.position.z - o.z;
      if (dx * dx + dy * dy + dz * dz < 2.6 * 2.6) {
        useStore.getState().setBuff(o.type, now + ORB_DUR[o.type]);
        playJumpSound();
        (picked ??= []).push(o.id);
      } else if (now - o.born > 20000) {
        (picked ??= []).push(o.id);
      }
    }
    if (picked || changed) {
      const base = changed ?? orbs;
      setOrbs(picked ? base.filter((o) => !picked!.includes(o.id)) : base);
    }
  });

  return (
    <>
      {orbs.map((o) => (
        <group key={o.id} ref={(g) => { if (g) groupRefs.current.set(o.id, g); else groupRefs.current.delete(o.id); }} position={[o.x, o.y, o.z]}>
          <mesh>
            <octahedronGeometry args={[0.85, 0]} />
            <meshStandardMaterial
              color={ORB_COLORS[o.type]}
              emissive={ORB_COLORS[o.type]}
              emissiveIntensity={1.4}
              toneMapped={false}
            />
          </mesh>
        </group>
      ))}
    </>
  );
};
