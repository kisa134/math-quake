import { Suspense, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { AssetModel } from '../game/modelCache';
import { tag } from '../game/hitTags';
import { conductorState } from '../game/conductor';

/**
 * V5 Wave C — THE CHROME IDOLS: the owner's three forge3d drops, meshopt'd
 * 11MB→463KB each, floating near the spawn temple. In the corpse-matte world
 * with the PMREM environment they read as pure liquid chrome — the maximalism
 * accent the minimalism earns. Slow spin + bob; grapple-able via invisible
 * proxies (raycast law: the 31k-tri meshes themselves go raycast-noop).
 */
const NO_RAYCAST = () => {};
// V6 Ш2: MONUMENT II — the Chrome Triptych carousel over the SW corner
const CAROUSEL = { x: -120, y: 150, z: 120, r: 32 };
const SPOTS: { asset: string; pos: [number, number, number]; scale: number }[] = [
  { asset: 'chrome1', pos: [CAROUSEL.x + CAROUSEL.r, CAROUSEL.y, CAROUSEL.z], scale: 11 },
  { asset: 'chrome2', pos: [CAROUSEL.x - CAROUSEL.r * 0.5, CAROUSEL.y, CAROUSEL.z + CAROUSEL.r * 0.87], scale: 11 },
  { asset: 'chrome3', pos: [CAROUSEL.x - CAROUSEL.r * 0.5, CAROUSEL.y, CAROUSEL.z - CAROUSEL.r * 0.87], scale: 13 },
];

export const ChromeIdols = () => {
  const groups = useRef<Array<THREE.Group | null>>(Array(SPOTS.length).fill(null));
  const patched = useRef<boolean[]>(Array(SPOTS.length).fill(false));
  const lastEpoch = useRef(-1);
  const burstUntil = useRef(0);
  const extra = useRef(0);

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    // V7.5 Ц3: epoch turn → the carousel bursts into a 2s faster spin
    const cs = conductorState(t);
    if (cs.epoch !== lastEpoch.current) { lastEpoch.current = cs.epoch; burstUntil.current = t + 2; }
    const bk = Math.max(0, (burstUntil.current - t) / 2);
    extra.current += bk * dt * 1.5;
    const bw = Math.sin(bk * Math.PI);
    for (let i = 0; i < SPOTS.length; i++) {
      const g = groups.current[i];
      if (!g) continue;
      // carousel: the triptych orbits its shared axis (MONUMENT II)
      const a = t * 0.25 + extra.current + (i / SPOTS.length) * Math.PI * 2;
      g.position.x = CAROUSEL.x + Math.cos(a) * CAROUSEL.r;
      g.position.z = CAROUSEL.z + Math.sin(a) * CAROUSEL.r;
      g.rotation.y = t * 0.4 + i;
      g.position.y = CAROUSEL.y + Math.sin(t * 0.5 + i * 2.1) * (4 + bw * 8);
      if (!patched.current[i]) {
        let found = false;
        g.traverse((o) => {
          if ((o as THREE.Mesh).isMesh && o.name !== 'idol-proxy') { o.raycast = NO_RAYCAST; found = true; }
        });
        if (found) patched.current[i] = true;
      }
    }
  });

  return (
    <>
      {SPOTS.map((s, i) => (
        <group key={s.asset} ref={(g) => { groups.current[i] = g; }} position={s.pos} scale={s.scale}>
          <Suspense fallback={null}>
            <AssetModel assetId={s.asset} />
          </Suspense>
          {/* grapple proxy — a cheap sphere instead of 31k triangles */}
          <mesh name="idol-proxy" visible={false} userData={tag({ isWall: true })}>
            <sphereGeometry args={[0.7, 10, 10]} />
          </mesh>
        </group>
      ))}
    </>
  );
};
