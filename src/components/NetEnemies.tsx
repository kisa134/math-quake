import { useEffect, useRef, type ReactElement } from 'react';
import { useStore } from '../store';
import { tag } from '../game/hitTags';

/**
 * Non-host renderer for the shared, host-authoritative enemies. Draws them from
 * the host's broadcast snapshot (`netEnemies`) as shootable meshes (userData
 * isEnemy+id → Player relays hits to the host). When an enemy disappears from
 * the snapshot (killed on the host), we replay the voxel shatter locally so
 * both players see the same destruction.
 */
const geoFor = (type: string): ReactElement => {
  switch (type) {
    case 'torus': return <torusGeometry args={[1, 0.4, 16, 100]} />;
    case 'torusKnot': return <torusKnotGeometry args={[1, 0.3, 100, 16]} />;
    case 'icosahedron': return <icosahedronGeometry args={[1, 0]} />;
    case 'octahedron': return <octahedronGeometry args={[1, 0]} />;
    case 'dodecahedron': return <dodecahedronGeometry args={[1, 0]} />;
    case 'candle': return <boxGeometry args={[1.5, 6, 1.5]} />;
    default: return <boxGeometry args={[1, 1, 1]} />;
  }
};

export const NetEnemies = () => {
  const isHost = useStore((s) => s.isHost);
  const netEnemies = useStore((s) => s.netEnemies);
  const spawnDeathFx = useStore((s) => s.spawnDeathFx);
  const prev = useRef(new Map<string, { x: number; y: number; z: number; type: string }>());

  useEffect(() => {
    if (isHost) { prev.current.clear(); return; }
    const cur = new Map<string, { x: number; y: number; z: number; type: string }>();
    for (const e of netEnemies) cur.set(e.id, { x: e.x, y: e.y, z: e.z, type: e.type });
    // Guard against a glitchy empty snapshot wiping (and shattering) everything.
    if (!(netEnemies.length === 0 && prev.current.size > 2)) {
      for (const [id, p] of prev.current) {
        if (!cur.has(id)) spawnDeathFx(p.x, p.y, p.z, p.type === 'candle');
      }
      prev.current = cur;
    }
  }, [netEnemies, isHost, spawnDeathFx]);

  if (isHost) return null;
  return (
    <>
      {netEnemies.map((e) => (
        <mesh key={e.id} position={[e.x, e.y, e.z]} userData={tag({ isEnemy: true, id: e.id })}>
          {geoFor(e.type)}
          <meshStandardMaterial
            color={e.type === 'candle' ? '#ffb703' : '#f72585'}
            emissive={e.type === 'candle' ? '#ffb703' : '#f72585'}
            emissiveIntensity={0.5}
            toneMapped={false}
          />
        </mesh>
      ))}
    </>
  );
};
