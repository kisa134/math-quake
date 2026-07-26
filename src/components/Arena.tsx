import React from 'react';
import { Grid, Stars } from '@react-three/drei';
import { RigidBody } from '@react-three/rapier';
import * as THREE from 'three';
import { MatrixRain } from './MatrixRain';
import { PALETTE } from '../theme';
import { MATTE_WORLD, MATTE_WORLD_SOFT } from '../game/materials';
import { useStore } from '../store';


const NO_RAYCAST = () => {};

export const Arena = () => {
  // Sky/backdrop layer (rain shell, 10k star points, infinite grid) must NEVER
  // be raycast — the per-frame ground-probe and projectile rays were paying a
  // 10k-point sphere test on Stars alone. Visual only.
  const lite = useStore((s) => s.lite); // V8.6 PERF: matrix shells are pure fillrate
  const skyRef = React.useRef<THREE.Group>(null);
  React.useEffect(() => {
    skyRef.current?.traverse((o) => { o.raycast = NO_RAYCAST; });
  }, []);

  return (
    <group>
      <group ref={skyRef}>
        {!lite && <MatrixRain />}
        <Stars radius={300} depth={100} count={10000} factor={4} saturation={1} fade speed={1.5} />
        <Grid infiniteGrid fadeDistance={2000} cellColor={PALETTE.gridCell} sectionColor={PALETTE.gridSect} position={[0, -49, 0]} />
      </group>

      {/* Massive Void Floor - basically a kill plane visual */}
      <RigidBody type="fixed">
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -50, 0]} receiveShadow userData={{ isFloor: true }}>
          <planeGeometry args={[6000, 6000]} />
          <meshStandardMaterial color="#050510" roughness={0.9} metalness={0.1} />
        </mesh>
      </RigidBody>
      
      {/* V6 Ш2: старая арена снесена — сцена = TradingFloor.tsx.
          Остался гигантский пад со дна пустоты на Пол. */}
      <JumpPad position={[0, -48, 0]} force={150} />
    </group>
  );
};



// V5.1 «трупный матовый»: ALL structural surfaces share ONE matte-black
// glitter material (color prop kept for API compat, ignored by design).
const Wall = ({ position, args }: { position: [number, number, number], args: [number, number, number], color?: string }) => (
  <RigidBody type="fixed">
    <mesh position={position} receiveShadow castShadow userData={{ isWall: true }} material={MATTE_WORLD_SOFT}>
      <boxGeometry args={args} />
    </mesh>
  </RigidBody>
);

const Platform = ({ position, args }: { position: [number, number, number], args: [number, number, number], color?: string }) => (
  <RigidBody type="fixed">
    <mesh position={position} receiveShadow castShadow userData={{ isFloor: true }} material={MATTE_WORLD}>
      <boxGeometry args={args} />
    </mesh>
  </RigidBody>
);

const Pillar = ({ position, args }: { position: [number, number, number], args: [number, number, number], color?: string }) => (
  <RigidBody type="fixed">
    <mesh position={position} receiveShadow castShadow userData={{ isWall: true }} material={MATTE_WORLD}>
      <boxGeometry args={args} />
    </mesh>
  </RigidBody>
);

const JumpPad = ({ position, force = 60 }: { position: [number, number, number], force?: number }) => (
  <RigidBody type="fixed">
    <mesh position={position} receiveShadow castShadow userData={{ isJumpPad: true, jumpForce: force }}>
      <cylinderGeometry args={[4, 4, 1, 16]} />
      <meshStandardMaterial color={PALETTE.bull} emissive={PALETTE.bull} emissiveIntensity={1.0} toneMapped={false} />
    </mesh>
  </RigidBody>
);
