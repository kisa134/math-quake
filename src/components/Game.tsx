import { Canvas } from '@react-three/fiber';
import { Physics } from '@react-three/rapier';
import { Arena } from './Arena';
import { Levels } from './Levels';
import { Player } from './Player';
import { Enemies } from './Enemies';
import { NetEnemies } from './NetEnemies';
import { Projectiles } from './Projectiles';
import { RemotePlayers } from './RemotePlayers';
import { DamageNumbers } from './DamageNumbers';
import { LocalMinions } from './Minions';
import { WorldEntities } from './WorldEntities';
import { PlacedProps } from './PlacedProps';
import { Editor } from './Editor';
import { PostFX } from './PostFX';
import { useEffect } from 'react';
import { useStore } from '../store';
import { PALETTE } from '../theme';

const GameManager = () => {
  const { isPlaying, isHost, spawnEnemy } = useStore();

  useEffect(() => {
    // Only the host spawns/owns the shared enemies (non-hosts mirror them).
    if (!isPlaying || !isHost) return;

    for (let i = 0; i < 5; i++) spawnEnemy();
    const interval = setInterval(() => spawnEnemy(), 2000);
    return () => clearInterval(interval);
  }, [isPlaying, isHost, spawnEnemy]);

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
        <Levels />
        <Player />
        <LocalMinions />
        <RemotePlayers />
        <Enemies />
        <NetEnemies />
        <WorldEntities />
        <PlacedProps />
        <Editor />
        <Projectiles />
        <DamageNumbers />
      </Physics>
      <PostFX />
    </Canvas>
  );
};
