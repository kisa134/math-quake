import { useMemo } from 'react';
import { RigidBody } from '@react-three/rapier';
import { tag } from '../game/hitTags';
import { generateLevels, type PlatformDesc, type AnchorDesc } from '../game/levelgen';

/**
 * WS-4 — renders the data-driven 30-floor vertical climb produced by
 * generateLevels(). Every descriptor becomes a fixed RigidBody with a properly
 * typed `userData` (via tag()) so the Player ground-probe / shooting / grapple
 * raycasts pick up isFloor / isWall / isJumpPad plus the new friction & isMetal
 * surface flags. Neon-emissive, toneMapped=false so the Bloom pass catches it.
 *
 * generateLevels() is seeded + pure, so this is memoised once and identical on
 * every client. Meshes keep default frustumCulling, so off-screen floors of the
 * tower cost nothing to draw.
 */

const Piece = ({ p }: { p: PlatformDesc }) => {
  if (p.kind === 'pad') {
    const r = p.size[0] / 2;
    return (
      <RigidBody type="fixed">
        <mesh position={p.pos} userData={tag({ isJumpPad: true, jumpForce: p.jumpForce })}>
          <cylinderGeometry args={[r, r, p.size[1], 16]} />
          <meshStandardMaterial
            color={p.color}
            emissive={p.color}
            emissiveIntensity={1.0}
            toneMapped={false}
          />
        </mesh>
      </RigidBody>
    );
  }

  const isWall = p.kind === 'wall';
  const ud = isWall
    ? tag({ isWall: true, isMetal: p.isMetal })
    : tag({ isFloor: true, friction: p.friction, isMetal: p.isMetal });

  // Ice reads glassy (low emissive, high metalness), metal reads like brushed
  // plating (mid metalness), normal decks glow like the rest of the matrix world.
  const ice = p.friction !== undefined;
  const metal = !!p.isMetal;
  return (
    <RigidBody type="fixed">
      <mesh position={p.pos} userData={ud}>
        <boxGeometry args={p.size} />
        <meshStandardMaterial
          color={p.color}
          emissive={p.color}
          emissiveIntensity={ice ? 0.25 : metal ? 0.35 : 0.5}
          roughness={ice ? 0.05 : metal ? 0.25 : 0.3}
          metalness={ice ? 0.9 : metal ? 0.95 : 0.6}
          toneMapped={false}
        />
      </mesh>
    </RigidBody>
  );
};

/** Visual-only placeholder marking a named set-piece slot (no collider). */
const Anchor = ({ a }: { a: AnchorDesc }) => (
  <mesh position={a.pos}>
    <boxGeometry args={[10, 10, 10]} />
    <meshBasicMaterial color="#4cc9f0" wireframe transparent opacity={0.12} toneMapped={false} />
  </mesh>
);

export const Levels = () => {
  const data = useMemo(() => generateLevels(), []);
  return (
    <group>
      {data.floors.map((f) =>
        f.platforms.map((p, i) => <Piece key={`f${f.index}-${i}`} p={p} />),
      )}
      {data.anchors.map((a) => (
        <Anchor key={a.id} a={a} />
      ))}
    </group>
  );
};
