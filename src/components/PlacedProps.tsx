import { RigidBody } from '@react-three/rapier';
import { useStore } from '../store';
import { PALETTE } from '../theme';
import { tag } from '../game/hitTags';

/**
 * Renders player-built props (placed in the Editor). Each is a FUNCTIONAL fixed
 * body carrying the same userData the game reads: pads bounce (Player's ground
 * ray reads isJumpPad+jumpForce), candles/ATMs are stand-on/grapple-able
 * (isFloor/isWall). Neon + toneMapped=false so Bloom catches them.
 */
export const PlacedProps = () => {
  const props = useStore((s) => s.placedProps);
  return (
    <>
      {props.map((p) => (
        <PropMesh key={p.id} type={p.type} x={p.x} y={p.y} z={p.z} />
      ))}
    </>
  );
};

const PropMesh = ({ type, x, y, z }: { type: string; x: number; y: number; z: number }) => {
  if (type === 'pad') {
    return (
      <RigidBody type="fixed" position={[x, y, z]}>
        <mesh userData={tag({ isJumpPad: true, jumpForce: 95 })}>
          <cylinderGeometry args={[4, 4, 1, 20]} />
          <meshStandardMaterial color={PALETTE.bull} emissive={PALETTE.bull} emissiveIntensity={1.1} toneMapped={false} />
        </mesh>
      </RigidBody>
    );
  }
  if (type === 'candle') {
    return (
      <RigidBody type="fixed" position={[x, y, z]}>
        <mesh userData={tag({ isFloor: true })}>
          <boxGeometry args={[5, 20, 5]} />
          <meshStandardMaterial color={PALETTE.bear} emissive={PALETTE.bear} emissiveIntensity={0.7} toneMapped={false} roughness={0.25} metalness={0.7} />
        </mesh>
      </RigidBody>
    );
  }
  // atm — a neon terminal box with a glowing screen
  return (
    <RigidBody type="fixed" position={[x, y, z]}>
      <mesh userData={tag({ isWall: true })}>
        <boxGeometry args={[3, 5, 2]} />
        <meshStandardMaterial color={PALETTE.node} emissive={PALETTE.node} emissiveIntensity={0.6} toneMapped={false} metalness={0.6} roughness={0.3} />
      </mesh>
      <mesh position={[0, 0.7, 1.02]}>
        <planeGeometry args={[2, 1.5]} />
        <meshBasicMaterial color={PALETTE.dataEmerald} toneMapped={false} />
      </mesh>
    </RigidBody>
  );
};
