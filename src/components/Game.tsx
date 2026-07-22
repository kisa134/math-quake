import { Canvas } from '@react-three/fiber';
import { Physics } from '@react-three/rapier';
import { Arena } from './Arena';
import { Player } from './Player';
import { Enemies } from './Enemies';
import { Projectiles } from './Projectiles';
import { RemotePlayers } from './RemotePlayers';
import { DamageNumbers } from './DamageNumbers';
import { LocalMinions } from './Minions';
import { useEffect } from 'react';
import { useStore } from '../store';

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
      <Physics gravity={[0, -30, 0]}>
        <GameManager />
        <ambientLight intensity={0.2} />
        <directionalLight 
          castShadow 
          position={[10, 20, 10]} 
          intensity={1.5} 
          shadow-mapSize={[1024, 1024]}
        />
        
        <Arena />
        <Player />
        <LocalMinions />
        <RemotePlayers />
        <Enemies />
        <Projectiles />
        <DamageNumbers />
      </Physics>
    </Canvas>
  );
};
