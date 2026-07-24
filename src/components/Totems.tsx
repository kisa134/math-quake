import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../store';
import { tag } from '../game/hitTags';
import { AssetModel } from '../game/modelCache';
import { Suspense } from 'react';
import { ringInbox } from '../game/botHorde';
import { chron } from '../game/chronicle';
import { addTrauma } from '../game/shake';
import { playExplosionSound } from '../utils/audio';
import { conductorState } from '../game/conductor';

/**
 * V5 C3 — TOTEMS OF VICE: the Synty money-icons return to the WORLD. Ten
 * golden idols (bitcoin/dollar/gem/crown/star) float at grapple-able heights
 * around the arena, slowly spinning. Shoot one down (120 hp) → a RAIN OF
 * COINS (+$400) + shockwave + chronicle line; it reforms in 90s. Personal
 * loot (client-local) — každý собирает свой грех сам.
 */
export const totemHitInbox: { id: number; damage: number }[] = [];

const TOTEM_DEFS = [
  { asset: 'bitcoin', pos: [180, 74, -120] as const },
  { asset: 'dollar', pos: [-210, 83, 165] as const },
  { asset: 'gem', pos: [285, 112, 240] as const },
  { asset: 'crown', pos: [-330, 141, -285] as const },
  { asset: 'star', pos: [390, 96, -360] as const },
  { asset: 'bitcoin', pos: [-450, 152, 390] as const },
  { asset: 'dollar', pos: [510, 176, 120] as const },
  { asset: 'gem', pos: [-180, 192, -480] as const },
  { asset: 'crown', pos: [120, 224, 540] as const },
  { asset: 'star', pos: [-540, 216, -120] as const },
];
const HP0 = 120;
const RESPAWN_MS = 90000;
const REWARD = 400;

export const Totems = () => {
  const groups = useRef<Array<THREE.Group | null>>(Array(TOTEM_DEFS.length).fill(null));
  const hp = useRef<Float32Array>(new Float32Array(TOTEM_DEFS.length).fill(HP0));
  const deadUntil = useRef<Float64Array>(new Float64Array(TOTEM_DEFS.length));

  const lastEpoch = useRef(-1);
  const pulseUntil = useRef(0);

  useFrame((state) => {
    const now = Date.now();
    const t = state.clock.elapsedTime;
    while (totemHitInbox.length) {
      const h = totemHitInbox.pop()!;
      if (deadUntil.current[h.id] > now) continue;
      hp.current[h.id] -= h.damage;
      if (hp.current[h.id] <= 0) {
        deadUntil.current[h.id] = now + RESPAWN_MS;
        const d = TOTEM_DEFS[h.id];
        // THE RAIN OF COINS
        const chunks = [];
        for (let i = 0; i < 26; i++) {
          const a = Math.random() * Math.PI * 2;
          chunks.push({
            x: d.pos[0], y: d.pos[1] + 1, z: d.pos[2],
            vx: Math.cos(a) * (2 + Math.random() * 5),
            vy: 6 + Math.random() * 7,
            vz: Math.sin(a) * (2 + Math.random() * 5),
            color: i % 3 === 0 ? '#ffe8b0' : '#e9c46a',
            size: 0.14 + Math.random() * 0.12,
            rx: Math.random() * 8, ry: Math.random() * 8, rz: Math.random() * 8,
            life: 1400 + Math.random() * 800,
          });
        }
        useStore.getState().addDebris(chunks);
        useStore.getState().addMoney(REWARD);
        ringInbox.push({ x: d.pos[0], y: d.pos[1], z: d.pos[2] });
        chron(`$ ТОТЕМ ${d.asset.toUpperCase()} ОБРУШЕН +$${REWARD}`);
        addTrauma(0.15);
        playExplosionSound();
      }
    }
    // V7.5 Ц3: смена эпохи — тотемы порока вздрагивают вместе с рынком
    const csT = conductorState(t);
    if (csT.epoch !== lastEpoch.current) { lastEpoch.current = csT.epoch; pulseUntil.current = t + 1.2; }
    const pw = Math.sin(Math.max(0, (pulseUntil.current - t) / 1.2) * Math.PI);
    for (let i = 0; i < TOTEM_DEFS.length; i++) {
      const g = groups.current[i];
      if (!g) continue;
      const dead = deadUntil.current[i] > now;
      if (!dead && deadUntil.current[i] !== 0) { deadUntil.current[i] = 0; hp.current[i] = HP0; }
      g.visible = !dead;
      if (!dead) {
        g.rotation.y = t * 0.5 + i + pw * 0.8;
        g.position.y = TOTEM_DEFS[i].pos[1] + Math.sin(t * 0.8 + i * 1.3) * (1.2 + pw * 4);
      }
    }
  });

  return (
    <>
      {TOTEM_DEFS.map((d, i) => (
        <group
          key={i}
          ref={(g) => { groups.current[i] = g; }}
          position={[d.pos[0], d.pos[1], d.pos[2]]}
          scale={0.09}
        >
          <Suspense fallback={null}>
            <AssetModel assetId={d.asset} />
          </Suspense>
          {/* hit proxy (unscaled units via inverse — keep simple: big box in local units) */}
          <mesh visible={false} userData={tag({ isTotem: true, isWall: true, id: String(i) })}>
            <boxGeometry args={[40, 40, 14]} />
          </mesh>
        </group>
      ))}
    </>
  );
};
