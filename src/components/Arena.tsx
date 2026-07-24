import React from 'react';
import { Grid, Stars } from '@react-three/drei';
import { RigidBody } from '@react-three/rapier';
import * as THREE from 'three';
import { MatrixRain } from './MatrixRain';
import { PALETTE } from '../theme';

/** Deterministic PRNG (mulberry32) — same seed → identical candlestick paths
 *  on every client (physics platforms MUST match across the network). */
const mulberry32 = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export const Arena = () => {
  // Seeded candlestick platforms connecting temples (no Math.random at render)
  const candlesticks = React.useMemo(() => {
    const rnd = mulberry32(0xa11ce);
    const out: React.ReactElement[] = [];
    const addCandles = (startX: number, startZ: number, endX: number, endZ: number, count: number) => {
      for (let i = 1; i <= count; i++) {
        const t = i / (count + 1);
        const x = startX + (endX - startX) * t + (rnd() - 0.5) * 20;
        const z = startZ + (endZ - startZ) * t + (rnd() - 0.5) * 20;
        const height = 10 + rnd() * 30 + (1 - Math.abs(t - 0.5) * 2) * 20;
        const width = 4 + rnd() * 6;
        const isGreen = rnd() > 0.5;
        out.push(
          <Candlestick key={`candle-${startX}_${startZ}-to-${endX}_${endZ}-${i}`} position={[x, height / 2, z]} height={height} width={width} isGreen={isGreen} />
        );
      }
    };

    // Paths from outer to center
    addCandles(-200, -200, 0, 0, 15);
    addCandles(200, -200, 0, 0, 15);
    addCandles(-200, 200, 0, 0, 15);
    addCandles(200, 200, 0, 0, 15);
    // Paths between outer temples
    addCandles(-200, -200, 200, -200, 10);
    addCandles(200, -200, 200, 200, 10);
    addCandles(200, 200, -200, 200, 10);
    addCandles(-200, 200, -200, -200, 10);
    return out;
  }, []);

  return (
    <group>
      <MatrixRain />
      <Stars radius={300} depth={100} count={10000} factor={4} saturation={1} fade speed={1.5} />
      
      {/* Massive Void Floor - basically a kill plane visual */}
      <RigidBody type="fixed">
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -50, 0]} receiveShadow userData={{ isFloor: true }}>
          <planeGeometry args={[1000, 1000]} />
          <meshStandardMaterial color="#050510" roughness={0.9} metalness={0.1} />
        </mesh>
      </RigidBody>
      
      <Grid infiniteGrid fadeDistance={400} cellColor={PALETTE.gridCell} sectionColor={PALETTE.gridSect} position={[0, -49, 0]} />

      {/* Central High Temple */}
      <Temple position={[0, 80, 0]} size={60} color="#f72585" name="CORE_EXCHANGE" />
      <JumpPad position={[0, -48, 0]} force={150} /> {/* Giant center jump pad from bottom */}
      
      {/* 4 Outer Temples */}
      <Temple position={[-200, 20, -200]} size={40} color="#4361ee" name="NODE_NW" />
      <Temple position={[200, 20, -200]} size={40} color="#4361ee" name="NODE_NE" />
      <Temple position={[-200, 20, 200]} size={40} color="#4361ee" name="NODE_SW" />
      <Temple position={[200, 20, 200]} size={40} color="#4361ee" name="NODE_SE" />

      {candlesticks}
    </group>
  );
};

const Temple = ({ position, size, color, name }: { position: [number, number, number], size: number, color: string, name: string }) => {
  const half = size / 2;
  return (
    <group position={position}>
      {/* Main floor */}
      <Platform position={[0, 0, 0]} args={[size, 2, size]} color={color} />
      
      {/* Corner Pillars */}
      <Pillar position={[-half + 2, 10, -half + 2]} args={[4, 20, 4]} color={color} />
      <Pillar position={[half - 2, 10, -half + 2]} args={[4, 20, 4]} color={color} />
      <Pillar position={[-half + 2, 10, half - 2]} args={[4, 20, 4]} color={color} />
      <Pillar position={[half - 2, 10, half - 2]} args={[4, 20, 4]} color={color} />

      {/* Central altar/cover */}
      <Pillar position={[0, 5, 0]} args={[8, 10, 8]} color="#111" />
      <JumpPad position={[0, 11, 0]} force={80} />
      
      {/* Walls around edges with gaps */}
      <Wall position={[0, 5, -half]} args={[size * 0.6, 10, 1]} color="#111122" />
      <Wall position={[0, 5, half]} args={[size * 0.6, 10, 1]} color="#111122" />
      <Wall position={[-half, 5, 0]} args={[1, 10, size * 0.6]} color="#111122" />
      <Wall position={[half, 5, 0]} args={[1, 10, size * 0.6]} color="#111122" />
    </group>
  );
}

const Candlestick = ({ position, height, width, isGreen }: { position: [number, number, number], height: number, width: number, isGreen: boolean }) => {
  const color = isGreen ? '#00f5d4' : '#f72585';
  const wickHeight = height * 1.5;
  return (
    <group position={position}>
      {/* The Body (Platform) */}
      <RigidBody type="fixed">
        <mesh receiveShadow castShadow userData={{ isFloor: true }}>
          <boxGeometry args={[width, height, width]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.6} toneMapped={false} roughness={0.25} metalness={0.7} />
        </mesh>
      </RigidBody>
      {/* The Wick (Visual only, no collision) */}
      <mesh position={[0, 0, 0]}>
        <cylinderGeometry args={[0.5, 0.5, wickHeight]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
    </group>
  );
}

const Wall = ({ position, args, color = "#22223b" }: { position: [number, number, number], args: [number, number, number], color?: string }) => (
  <RigidBody type="fixed">
    <mesh position={position} receiveShadow castShadow userData={{ isWall: true }}>
      <boxGeometry args={args} />
      <meshStandardMaterial color={color} />
    </mesh>
  </RigidBody>
);

const Platform = ({ position, args, color = "#3a0ca3" }: { position: [number, number, number], args: [number, number, number], color?: string }) => (
  <RigidBody type="fixed">
    <mesh position={position} receiveShadow castShadow userData={{ isFloor: true }}>
      <boxGeometry args={args} />
      <meshStandardMaterial color={color} roughness={0.25} metalness={0.6} emissive={color} emissiveIntensity={0.5} toneMapped={false} />
    </mesh>
  </RigidBody>
);

const Pillar = ({ position, args, color = "#7209b7" }: { position: [number, number, number], args: [number, number, number], color?: string }) => (
  <RigidBody type="fixed">
    <mesh position={position} receiveShadow castShadow userData={{ isWall: true }}>
      <boxGeometry args={args} />
      <meshStandardMaterial color={color} roughness={0.3} metalness={0.7} emissive={color} emissiveIntensity={0.35} toneMapped={false} />
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
