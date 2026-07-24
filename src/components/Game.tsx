import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { Physics } from '@react-three/rapier';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Arena } from './Arena';
import { Cityscape } from './Cityscape';
import { Player } from './Player';
import { Enemies } from './Enemies';
import { NetEnemies } from './NetEnemies';
import { Projectiles } from './Projectiles';
import { RemotePlayers } from './RemotePlayers';
import { DamageNumbers } from './DamageNumbers';
import { LocalMinions } from './Minions';
import { WorldEntities } from './WorldEntities';
import { PlacedProps } from './PlacedProps';
import { Train } from './Train';
import { Cars } from './Cars';
import { Creatures } from './Creatures';
import { VoxelCandles } from './VoxelCandles';
import { Dreamscape } from './Dreamscape';
import { BlackHole } from './BlackHole';
import { MovingAverages } from './MovingAverages';
import { Editor } from './Editor';
import { PostFX } from './PostFX';
import { useEffect, useRef } from 'react';
import { useStore } from '../store';
import { PALETTE } from '../theme';
import { socket } from '../socket';
import { MATCH, wavesSize, roundWinReward } from '../config/economy';
import { conductorState } from '../game/conductor';
import { updateAccent } from '../game/accent';
import { chron, EPOCH_CHRONICLE } from '../game/chronicle';
import { setAmbientMood } from '../utils/audio';
import { BotHorde } from './BotHorde';
import { spawnBotWave, aliveBotCount } from './BotHorde';
import { Dragons } from './Dragons';
import { BuffOrbs } from './BuffOrbs';
import { Ragdolls } from './Ragdolls';
import { ShockRings } from './ShockRings';
import { PhysProps } from './PhysProps';
import { Totems } from './Totems';

/**
 * CS-style match vs bots (V2.2), host-driven: BUY phase (no spawns, stock up)
 * → WAVE (host staggers in a scaled pack of bots) → all dead = round WON →
 * everyone gets the win bonus → next BUY. Peers mirror phase via 'round' and
 * pay themselves the bonus on 'roundwin' (money is client-local like HP).
 */
/** V5: the market conducts THE ONE ACCENT COLOR of the world — plus the
 *  chronicle line and the ambient drone on every epoch turn. */
let _lastEpoch = -1;
const AccentDriver = () => {
  useFrame((state, dt) => {
    const cs = conductorState(state.clock.elapsedTime);
    updateAccent(cs.epoch, dt, performance.now());
    if (cs.epoch !== _lastEpoch) {
      _lastEpoch = cs.epoch;
      chron(EPOCH_CHRONICLE[cs.epoch]);
      setAmbientMood(cs.epoch);
    }
  });
  return null;
};

/** V4.1 digital-maximalism CHROME: a procedural environment map (no network,
 *  no HDR download) so every metallic surface actually REFLECTS — instant
 *  hrom-glянец across towers, weapons, dragons. One-time PMREM bake. */
const ChromeEnv = () => {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = env.texture;
    return () => { scene.environment = null; env.texture.dispose(); pmrem.dispose(); };
  }, [gl, scene]);
  return null;
};

const GameManager = () => {
  const { isPlaying, isHost } = useStore();
  const spawnLeft = useRef(0);
  const lastSpawn = useRef(0);

  useEffect(() => {
    if (!isPlaying || !isHost) return;

    const startBuy = (num: number) => {
      const r = { num, phase: 'buy' as const, until: Date.now() + MATCH.buySeconds * 1000 };
      useStore.getState().setRound(r);
      socket.emit('round', r);
      spawnLeft.current = wavesSize(num);
    };
    startBuy(Math.max(1, useStore.getState().round.num));

    const iv = setInterval(() => {
      const st = useStore.getState();
      const r = st.round;
      const now = Date.now();
      if (r.phase === 'buy') {
        if (now >= r.until) {
          const nr = { num: r.num, phase: 'wave' as const, until: 0 };
          st.setRound(nr);
          socket.emit('round', nr);
          // V4: the wave is mostly voxel-dude BOTS (70%) + shape anomalies (30%)
          const total = wavesSize(r.num);
          const botCount = Math.round(total * 0.7);
          spawnBotWave(botCount, r.num);
          spawnLeft.current = total - botCount;
        }
      } else {
        if (spawnLeft.current > 0 && now - lastSpawn.current > MATCH.spawnGapMs) {
          lastSpawn.current = now;
          st.spawnEnemy();
          spawnLeft.current--;
        }
        if (spawnLeft.current === 0 && st.enemies.length === 0 && aliveBotCount() === 0) {
          st.addMoney(roundWinReward(r.num));
          socket.emit('roundwin', { num: r.num });
          startBuy(r.num + 1);
        }
      }
    }, 400);
    return () => clearInterval(iv);
  }, [isPlaying, isHost]);

  return null;
};

export const Game = () => {
  return (
    <Canvas 
      shadows={false} 
      camera={{ fov: 80, far: 2500 }}
      gl={{ powerPreference: "high-performance", antialias: false, stencil: false, depth: true }}
      dpr={[1, 1.5]}
    >
      <fog attach="fog" args={[PALETTE.voidDeep, 200, 1800]} />
      <ChromeEnv />
      <AccentDriver />
      <Physics gravity={[0, -30, 0]}>
        <GameManager />
        {/* V3 Bosch grade: wine ambient + antique-gold key light (moonlight) */}
        <ambientLight intensity={0.22} color="#c9a0b0" />
        <directionalLight
          position={[60, 50, -90]} // from the crescent moon's corner
          intensity={0.7}
          color="#ffd9a0"
        />

        <Arena />
        <Cityscape />
        <Dreamscape />
        <BlackHole />
        <MovingAverages />
        <VoxelCandles />
        <Player />
        <LocalMinions />
        <RemotePlayers />
        <Enemies />
        <NetEnemies />
        <BotHorde />
        <Dragons />
        <BuffOrbs />
        <Ragdolls />
        <ShockRings />
        <PhysProps />
        <Totems />
        <Creatures />
        <WorldEntities />
        <Train />
        <Cars />
        <PlacedProps />
        <Editor />
        <Projectiles />
        <DamageNumbers />
      </Physics>
      <PostFX />
    </Canvas>
  );
};
