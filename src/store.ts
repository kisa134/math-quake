import { create } from 'zustand';
import * as THREE from 'three';
import { addTrauma } from './game/shake';

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
  rx?: number; ry?: number; rz?: number;   // current rotation (rad)
  sx?: number; sy?: number; sz?: number;   // spin velocity (rad/s)
  life?: number;                           // seconds to live
}

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

// ---- Voxel destruction (see docs/increments/02-voxel-destruction.md) ----
const DEBRIS_CAP = 256;
const SMALL_COUNT = 10, CANDLE_COUNT = 18;
const RADIAL = 12, SCATTER = 8, POP_UP = 6, SPIN = 8;
const NEON = ['#f72585', '#00f5d4', '#4361ee', '#7209b7', '#4cc9f0', '#b5179e'];

const colorForEnemy = (e: Enemy): string =>
  e.type === 'candle'
    ? (Math.random() > 0.5 ? '#00f5d4' : '#f72585')
    : NEON[Math.floor(Math.random() * NEON.length)];

// Pre-fractured voxel chunks launched radially away from the impact point.
function makeChunks(enemy: Enemy, impact: [number, number, number]): DebrisChunk[] {
  const isCandle = enemy.type === 'candle';
  const count = isCandle ? CANDLE_COUNT : SMALL_COUNT;
  const [cx, cy, cz] = enemy.position;
  const baseHalf = isCandle ? 1.5 : 1;
  const color = colorForEnemy(enemy);
  const now = Date.now();
  const out: DebrisChunk[] = [];
  for (let i = 0; i < count; i++) {
    const px = cx + (Math.random() - 0.5) * baseHalf * 2;
    const py = cy + (isCandle ? Math.random() * 5 : (Math.random() - 0.5) * baseHalf * 2);
    const pz = cz + (Math.random() - 0.5) * baseHalf * 2;
    let dx = px - impact[0], dy = py - impact[1], dz = pz - impact[2];
    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len; dy /= len; dz /= len;
    out.push({
      id: Math.random().toString(36).substring(2, 9),
      x: px, y: py, z: pz,
      vx: dx * RADIAL + (Math.random() - 0.5) * SCATTER,
      vy: dy * RADIAL + (Math.random() - 0.5) * SCATTER + POP_UP,
      vz: dz * RADIAL + (Math.random() - 0.5) * SCATTER,
      color,
      size: baseHalf * (0.25 + Math.random() * 0.35),
      createdAt: now,
      rx: 0, ry: 0, rz: 0,
      sx: (Math.random() - 0.5) * 2 * SPIN,
      sy: (Math.random() - 0.5) * 2 * SPIN,
      sz: (Math.random() - 0.5) * 2 * SPIN,
      life: isCandle ? 2.8 : 2.5,
    });
  }
  return out;
}

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

  setWeapon: (index) => set({ currentWeapon: index }),
  
  startGame: () => set({ isPlaying: true, health: 100, score: 0, enemies: [], projectiles: [], damageNumbers: [], debris: [], localMinions: [] }),
  gameOver: () => set({ isPlaying: false }),
  reset: () => set({ isPlaying: false, health: 100, score: 0, enemies: [], projectiles: [], damageNumbers: [], debris: [], localMinions: [] })
}));
