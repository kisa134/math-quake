import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useStore } from '../store';
import { conductorState, epochBounds, hash01 } from '../game/conductor';
import { getCity } from '../game/cityscape';
import { makeFlames } from '../game/voxel';
import { ringInbox } from '../game/botHorde';

/**
 * V7.5 Ц3 — EUPHORIA FIREWORKS. During epoch 2 ten golden salvos launch from
 * the 12 spur rooftops on a hash schedule — deterministic times/places (both
 * clients watch the same show, zero net), local-random particle spread (like
 * gore — allowed cosmetic divergence). Pure reuse of Debris + ShockRings:
 * no new render path, zero draw calls.
 */
/** One golden salvo from a rooftop — extracted so the admin panel can fire it. */
export function fireSalvo(spot: [number, number, number], gold = '#e9c46a'): void {
  const chunks = makeFlames([spot[0], spot[1] + 6, spot[2]], gold, 10);
  for (const c of chunks) { c.vy = 26 + Math.random() * 22; c.vx *= 2.2; c.vz *= 2.2; c.life = 1600 + Math.random() * 900; }
  useStore.getState().addDebris(chunks);
  ringInbox.push({ x: spot[0], y: spot[1] + 4, z: spot[2] });
}

export const Euphoria = () => {
  const fired = useRef<number>(-1);   // epochIdx the mask belongs to
  const mask = useRef(0);             // bitmask of salvos already fired

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const cs = conductorState(t);
    if (cs.epoch !== 2) return;
    if (fired.current !== cs.epochIdx) { fired.current = cs.epochIdx; mask.current = 0; }
    const spots = getCity().roofSpots;
    if (!spots.length) return;
    const b = epochBounds(t);
    for (let k = 0; k < 10; k++) {
      if (mask.current & (1 << k)) continue;
      const tk = b.startT + 1 + hash01(cs.epochIdx, 100 + k) * 10;
      if (t < tk) continue;
      mask.current |= 1 << k;
      const spot = spots[Math.floor(hash01(cs.epochIdx, 200 + k) * spots.length)];
      fireSalvo(spot, k % 3 === 0 ? '#ffe8b0' : '#e9c46a');
    }
  });

  return null;
};
