import { create } from 'zustand';
import * as THREE from 'three';

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

interface DebrisChunk {
  id: string;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  color: string;
  size: number;
  createdAt: number;
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
    
    deadEnemies.forEach(e => {
      if (e.type === 'candle') {
        const color = Math.random() > 0.5 ? '#00f5d4' : '#f72585';
        const chunks = Array(12).fill(0).map(() => ({
          x: e.position[0] + (Math.random() - 0.5) * 2,
          y: e.position[1] + Math.random() * 5,
          z: e.position[2] + (Math.random() - 0.5) * 2,
          vx: (Math.random() - 0.5) * 15,
          vy: Math.random() * 20,
          vz: (Math.random() - 0.5) * 15,
          color,
          size: 0.5 + Math.random() * 1.5,
        }));
        
        newDebris = [...newDebris, ...chunks.map(c => ({
          ...c,
          id: Math.random().toString(36).substring(2, 9),
          createdAt: Date.now()
        }))];
      }
    });

    const scoreGain = deadEnemies.length * 10;
    
    return {
      enemies: aliveEnemies,
      score: state.score + scoreGain,
      damageNumbers: newDamageNumbers,
      debris: newDebris
    };
  }),
  
  removeEnemy: (id) => set((state) => ({
    enemies: state.enemies.filter(e => e.id !== id)
  })),
  
  takeDamage: (amount) => set((state) => {
    const newHealth = Math.max(0, state.health - amount);
    if (newHealth === 0) {
      return { health: 0, isPlaying: false };
    }
    return { health: newHealth };
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

  setWeapon: (index) => set({ currentWeapon: index }),
  
  startGame: () => set({ isPlaying: true, health: 100, score: 0, enemies: [], projectiles: [], damageNumbers: [], debris: [], localMinions: [] }),
  gameOver: () => set({ isPlaying: false }),
  reset: () => set({ isPlaying: false, health: 100, score: 0, enemies: [], projectiles: [], damageNumbers: [], debris: [], localMinions: [] })
}));
