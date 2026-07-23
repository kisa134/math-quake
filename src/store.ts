import { create } from 'zustand';
import * as THREE from 'three';
import { addTrauma } from './game/shake';
import { type DebrisChunk, DEBRIS_CAP, makeChunks } from './game/voxel';

interface Enemy {
  id: string;
  position: [number, number, number];
  type: 'torus' | 'torusKnot' | 'icosahedron' | 'octahedron' | 'dodecahedron' | 'candle';
  health: number;
}

interface Projectile {
  id: string;
  position: [number, number, number];
  velocity: [number, number, number];
  fromPlayer: boolean;
  createdAt: number;
}

interface DamageNumber {
  id: string;
  x: number;
  y: number;
  z: number;
  amount: number;
  createdAt: number;
  color?: string;
}

// DebrisChunk now lives in game/voxel.ts (imported above).

// Transient "an enemy just died" pulse — the juice layer (Debris) reads it,
// compares the timestamp, and fires shake + sound once per death.
interface DeathFx {
  x: number; y: number; z: number;
  big: boolean;
  t: number;
}

interface PlacedProp {
  id: string;
  type: 'pad' | 'candle' | 'atm';
  x: number; y: number; z: number;
}

interface PlayerState {
  id: string;
  x: number;
  y: number;
  z: number;
  rotation: number;
  health: number;
  score: number;
  isShooting: boolean;
  currentWeapon: number;
  minions?: {x: number, y: number, z: number}[];
}

interface GameState {
  score: number;
  health: number;
  enemies: Enemy[];
  projectiles: Projectile[];
  damageNumbers: DamageNumber[];
  debris: DebrisChunk[];
  lastDeathFx: DeathFx | null;
  jetpackFuel: number;        // 0..100 (throttled from Player for the HUD bar)
  jetpackStunUntil: number;   // Date.now() ms until which the jetpack is knocked out
  god: boolean;               // immortal + no fall-death (admin/sandbox)
  editorMode: boolean;        // build/editor mode: place & delete props
  editorSelect: 'pad' | 'candle' | 'atm';
  placedProps: PlacedProp[];
  isHost: boolean;            // this client owns/simulates the shared enemies
  netEnemies: { id: string; type: string; x: number; y: number; z: number; hp: number }[];
  setIsHost: (v: boolean) => void;
  setNetEnemies: (e: { id: string; type: string; x: number; y: number; z: number; hp: number }[]) => void;
  spawnDeathFx: (x: number, y: number, z: number, big: boolean) => void;
  isPlaying: boolean;
  roomId: string;
  playerId: string | null;
  remotePlayers: Record<string, PlayerState>;
  currentWeapon: number;
  commandTarget: [number, number, number] | null;
  localMinions: {x: number, y: number, z: number}[];
  setCommandTarget: (target: [number, number, number] | null) => void;
  setRoomId: (id: string) => void;
  setPlayerId: (id: string) => void;
  setRemotePlayers: (players: Record<string, PlayerState>) => void;
  updateRemotePlayer: (id: string, data: Partial<PlayerState>) => void;
  removeRemotePlayer: (id: string) => void;
  spawnEnemy: () => void;
  damageEnemy: (id: string, amount: number, pos?: [number, number, number]) => void;
  removeEnemy: (id: string) => void;
  takeDamage: (amount: number) => void;
  addProjectile: (p: Omit<Projectile, 'id' | 'createdAt'>) => void;
  removeProjectile: (id: string) => void;
  addDamageNumber: (pos: [number, number, number], amount: number, color?: string) => void;
  removeDamageNumber: (id: string) => void;
  addDebris: (chunks: Omit<DebrisChunk, 'id' | 'createdAt'>[]) => void;
  removeDebris: (id: string) => void;
  setJetpackFuel: (v: number) => void;
  toggleEditor: () => void;
  setEditorSelect: (t: 'pad' | 'candle' | 'atm') => void;
  addProp: (p: PlacedProp) => void;
  removeProp: (id: string) => void;
  setWeapon: (index: number) => void;
  startGame: () => void;
  gameOver: () => void;
  reset: () => void;
}

const SHAPES: ('torus' | 'torusKnot' | 'icosahedron' | 'octahedron' | 'dodecahedron' | 'candle')[] = ['torus', 'torusKnot', 'icosahedron', 'octahedron', 'dodecahedron', 'candle'];

export const useStore = create<GameState>((set) => ({
  score: 0,
  health: 100,
  enemies: [],
  projectiles: [],
  damageNumbers: [],
  debris: [],
  lastDeathFx: null,
  jetpackFuel: 100,
  jetpackStunUntil: 0,
  god: true,              // immortal by default (admin sandbox)
  editorMode: false,
  editorSelect: 'pad',
  placedProps: [],
  isHost: true,           // solo/default = host (owns enemies); presence demotes non-hosts
  netEnemies: [],
  isPlaying: false,
  roomId: '',
  playerId: null,
  remotePlayers: {},
  currentWeapon: 0,
  commandTarget: null,
  localMinions: [],

  setCommandTarget: (target) => set({ commandTarget: target }),
  setRoomId: (id) => set({ roomId: id }),
  setPlayerId: (id) => set({ playerId: id }),
  setRemotePlayers: (players) => set({ remotePlayers: players }),
  updateRemotePlayer: (id, data) => set((state) => ({
    remotePlayers: {
      ...state.remotePlayers,
      [id]: { ...state.remotePlayers[id], ...data }
    }
  })),
  removeRemotePlayer: (id) => set((state) => {
    const newPlayers = { ...state.remotePlayers };
    delete newPlayers[id];
    return { remotePlayers: newPlayers };
  }),
  
  spawnEnemy: () => set((state) => {
    if (!state.isPlaying) return state;
    if (state.enemies.length >= 20) return state; // Max 20 enemies
    
    const isCandle = Math.random() > 0.8;
    const type = isCandle ? 'candle' : SHAPES[Math.floor(Math.random() * (SHAPES.length - 1))];
    
    // Spawn somewhat far from center (0,0,0)
    const angle = Math.random() * Math.PI * 2;
    const radius = 30 + Math.random() * 20;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    
    const newEnemy: Enemy = {
      id: Math.random().toString(36).substring(2, 9),
      position: [x, isCandle ? 10 : 20, z], // Spawn higher up
      type,
      health: isCandle ? 200 : 100,
    };
    
    return { enemies: [...state.enemies, newEnemy] };
  }),

  damageEnemy: (id, amount, pos) => set((state) => {
    const enemies = state.enemies.map(e => {
      if (e.id === id) {
        return { ...e, health: e.health - amount };
      }
      return e;
    });
    
    let newDamageNumbers = state.damageNumbers;
    if (pos) {
      newDamageNumbers = [...state.damageNumbers, {
        id: Math.random().toString(36).substring(2, 9),
        x: pos[0], y: pos[1], z: pos[2],
        amount,
        createdAt: Date.now(),
        color: '#f72585'
      }];
    }
    
    let newDebris = state.debris || [];
    const aliveEnemies = enemies.filter(e => e.health > 0);
    const deadEnemies = enemies.filter(e => e.health <= 0);

    // Every dead enemy shatters into voxels, blown away from the impact point.
    deadEnemies.forEach(e => {
      const impact = pos ?? e.position;
      newDebris = newDebris.concat(makeChunks(e, impact));
    });
    if (newDebris.length > DEBRIS_CAP) {
      newDebris = newDebris.slice(newDebris.length - DEBRIS_CAP);
    }

    // Death-FX pulse for the juice layer (last dead this frame wins — fine).
    const dead = deadEnemies[deadEnemies.length - 1];
    const lastDeathFx: DeathFx | null = dead
      ? { x: dead.position[0], y: dead.position[1], z: dead.position[2], big: dead.type === 'candle', t: Date.now() }
      : state.lastDeathFx;

    const scoreGain = deadEnemies.length * 10;

    return {
      enemies: aliveEnemies,
      score: state.score + scoreGain,
      damageNumbers: newDamageNumbers,
      debris: newDebris,
      lastDeathFx,
    };
  }),
  
  removeEnemy: (id) => set((state) => ({
    enemies: state.enemies.filter(e => e.id !== id)
  })),
  
  takeDamage: (amount) => set((state) => {
    addTrauma(0.3); // getting hit kicks the camera
    const jetpackStunUntil = Date.now() + 1200; // a hit knocks the jetpack out briefly
    if (state.god) return { jetpackStunUntil }; // immortal: feel the hit, never lose HP
    const newHealth = Math.max(0, state.health - amount);
    if (newHealth === 0) {
      return { health: 0, isPlaying: false, jetpackStunUntil };
    }
    return { health: newHealth, jetpackStunUntil };
  }),

  addProjectile: (p) => set((state) => ({
    projectiles: [...state.projectiles, { ...p, id: Math.random().toString(36).substring(2, 9), createdAt: Date.now() }]
  })),

  removeProjectile: (id) => set((state) => ({
    projectiles: state.projectiles.filter(p => p.id !== id)
  })),

  addDamageNumber: (pos, amount, color = '#00f5d4') => set((state) => ({
    damageNumbers: [...state.damageNumbers, {
      id: Math.random().toString(36).substring(2, 9),
      x: pos[0], y: pos[1], z: pos[2],
      amount,
      createdAt: Date.now(),
      color
    }]
  })),
  
  removeDamageNumber: (id) => set((state) => ({
    damageNumbers: state.damageNumbers.filter(d => d.id !== id)
  })),

  addDebris: (chunks) => set((state) => ({
    debris: [...state.debris, ...chunks.map(c => ({
      ...c,
      id: Math.random().toString(36).substring(2, 9),
      createdAt: Date.now()
    }))]
  })),

  removeDebris: (id) => set((state) => ({
    debris: state.debris.filter(d => d.id !== id)
  })),

  setJetpackFuel: (v) => set({ jetpackFuel: v }),
  toggleEditor: () => set((s) => ({ editorMode: !s.editorMode })),
  setEditorSelect: (t) => set({ editorSelect: t }),
  addProp: (p) => set((s) => ({ placedProps: [...s.placedProps, p] })),
  removeProp: (id) => set((s) => ({ placedProps: s.placedProps.filter((p) => p.id !== id) })),
  setIsHost: (v) => set({ isHost: v }),
  setNetEnemies: (e) => set({ netEnemies: e }),
  // Replay a kill's voxel burst + shake/sound locally (non-host, when a shared
  // enemy vanishes from the host snapshot).
  spawnDeathFx: (x, y, z, big) => set((state) => {
    const fake: Enemy = { id: 'net', type: big ? 'candle' : 'icosahedron', position: [x, y, z], health: 0 };
    let newDebris = state.debris.concat(makeChunks(fake, [x, y, z]));
    if (newDebris.length > DEBRIS_CAP) newDebris = newDebris.slice(newDebris.length - DEBRIS_CAP);
    return { debris: newDebris, lastDeathFx: { x, y, z, big, t: Date.now() } };
  }),

  setWeapon: (index) => set({ currentWeapon: index }),
  
  startGame: () => set({ isPlaying: true, health: 100, score: 0, enemies: [], projectiles: [], damageNumbers: [], debris: [], localMinions: [] }),
  gameOver: () => set({ isPlaying: false }),
  reset: () => set({ isPlaying: false, health: 100, score: 0, enemies: [], projectiles: [], damageNumbers: [], debris: [], localMinions: [] })
}));
