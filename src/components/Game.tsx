import { Canvas } from '@react-three/fiber';
import { Physics } from '@react-three/rapier';
import { Arena } from './Arena';
import { Player } from './Player';
import { Enemies } from './Enemies';
import { Projectiles } from './Projectiles';
import { RemotePlayers } from './RemotePlayers';
import { DamageNumbers } from './DamageNumbers';
import { LocalMinions } from './Minions';
import { WorldEntities } from './WorldEntities';
import { PostFX } from './PostFX';
import { useEffect } from 'react';
import { useStore } from '../store';
import { PALETTE } from '../theme';

const GameManager = () => {
  const { isPlaying, spawnEnemy } = useStore();

  useEffect(() => {
    if (!isPlaying) return;
    
    // Initial spawn
    for(let i=0; i<5; i++) spawnEnemy();

    const interval = setInterval(() => {
      spawnEnemy();
    }, 2000);

    return () => clearInterval(interval);
  }, [isPlaying, spawnEnemy]);

  return null;
};

export const Game = () => {
  return (
    <Canvas 
      shadows={false} 
      camera={{ fov: 80 }} 
      gl={{ powerPreference: "high-performance", antialias: false, stencil: false, depth: true }}
      dpr={[1, 1.5]}
    >
      <fog attach="fog" args={[PALETTE.voidDeep, 150, 650]} />
      <Physics gravity={[0, -30, 0]}>
        <GameManager />
        <ambientLight intensity={0.18} />
        <directionalLight
          position={[10, 20, 10]}
          intensity={0.6}
        />

        <Arena />
        <Player />
        <LocalMinions />
        <RemotePlayers />
        <Enemies />
        <WorldEntities />
        <Projectiles />
        <DamageNumbers />
      </Physics>
      <PostFX />
    </Canvas>
  );
};
