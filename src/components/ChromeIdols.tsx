import { Suspense, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { AssetModel } from '../game/modelCache';
import { tag } from '../game/hitTags';

/**
 * V5 Wave C — THE CHROME IDOLS: the owner's three forge3d drops, meshopt'd
 * 11MB→463KB each, floating near the spawn temple. In the corpse-matte world
 * with the PMREM environment they read as pure liquid chrome — the maximalism
 * accent the minimalism earns. Slow spin + bob; grapple-able via invisible
 * proxies (raycast law: the 31k-tri meshes themselves go raycast-noop).
 */
const NO_RAYCAST = () => {};
const SPOTS: { asset: string; pos: [number, number, number]; scale: number }[] = [
  { asset: 'chrome1', pos: [45, 100, -38], scale: 5 },
  { asset: 'chrome2', pos: [-58, 112, 42], scale: 5 },
  { asset: 'chrome3', pos: [8, 130, 68], scale: 6 },
];

export const ChromeIdols = () => {
  const groups = useRef<Array<THREE.Group | null>>(Array(SPOTS.length).fill(null));
  const patched = useRef<boolean[]>(Array(SPOTS.length).fill(false));

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    for (let i = 0; i < SPOTS.length; i++) {
      const g = groups.current[i];
      if (!g) continue;
      g.rotation.y = t * (0.3 + i * 0.07);
      g.position.y = SPOTS[i].pos[1] + Math.sin(t * 0.5 + i * 2.1) * 2.5;
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
