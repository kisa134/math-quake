import { create } from 'zustand';
import * as THREE from 'three';
import { addTrauma } from './game/shake';
import { type DebrisChunk, DEBRIS_CAP, makeChunks } from './game/voxel';
import { WEAPON_PRICES, ECON } from './config/economy';
import type { Position } from './game/market';
import { chron } from './game/chronicle';
import { noteTrade, noteLiq } from './game/tradingDay';
import { loadMods, saveMods, nextMod, type WeaponModsState, type ModSocket } from './config/weaponMods';
import { isTower } from './config/maps';

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
  // Spell substrate (WS-3). Optional so plain gun shots keep the old behavior
  // (Projectiles.tsx falls back to damage 40 / cyan when these are absent).
  kind?: string;      // 'bolt' | 'beam' | 'nova' | 'homing' | ...
  color?: string;
  damage?: number;
  speed?: number;
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

// Valheim-editor placeable (WS-1). `assetId` keys into config/assets.ts; every
// instance carries its own transform + a static/physics flag.
interface PlacedProp {
  id: string;
  assetId: string;
  x: number; y: number; z: number;
  rotY: number;
  scale: number;
  body: 'fixed' | 'dynamic';
}

// Neutral roaming critter (WS-E): host-simulated, mirrored to peers like enemies.
export interface Creature {
  id: string;
  type: string;
  x: number; y: number; z: number;
  hp: number;
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
  avatar?: string; // selected third-person figure (WS-5)
  money?: number;  // V4 TOP BAG leaderboard
  dragon?: number | null; // V4.1: dragon id this player is riding
  scale?: number;  // V9 Р: его рост (L/K) — гигант виден гигантом
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
  editorSelect: string;       // active asset id from config/assets.ts (WS-1)
  editorRotY: number;         // ghost rotation (R to spin)
  editorScale: number;        // ghost scale ([ ] to resize)
  editorBody: 'fixed' | 'dynamic'; // G toggles static vs physics
  placedProps: PlacedProp[];
  // Spells (WS-3): hold E → radial wheel → selected skill fires
  selectedSpell: string;
  spellWheelOpen: boolean;
  // Avatar (WS-5): third-person figure chosen at start
  avatarId: string;
  // Vehicles (V2 WS-B): id of the car being driven, or null on foot
  driving: string | null;
  // CS economy + match (V2.2)
  money: number;
  ownedWeapons: boolean[];   // by WEAPONS index; free loadout owned from start
  buyMenuOpen: boolean;
  round: { num: number; phase: 'buy' | 'wave'; until: number }; // until = Date.now() ms deadline (buy phase)
  // V7 W1: playable $SOUL index (hold Q = rose, tap Q = close). game/market.ts
  position: Position | null;
  marketWheelOpen: boolean;
  marketLev: number;
  lastLiq: number;                          // ms timestamp of the last margin call (vignette)
  lastTrade: { amount: number; t: number }; // last realized PnL (HUD toast)
  setMarketWheel: (open: boolean) => void;
  setMarketLev: (lev: number) => void;
  // V8 Ф3: the weapon constructor — blueprints persist in localStorage
  weaponMods: WeaponModsState;
  workbenchOpen: boolean;
  setWorkbench: (open: boolean) => void;
  cycleMod: (weapon: number, socket: ModSocket) => void;
  // V8.5: the clickable HUB (Tab) + admin sandbox
  hubOpen: boolean;
  setHub: (open: boolean) => void;
  setGod: (v: boolean) => void;
  spawnEnemyAt: (type: Enemy['type'], x: number, y: number, z: number) => void;
  openPosition: (side: 1 | -1, entry: number) => void;
  closePosition: (exit: number) => void;
  liquidate: () => void;
  // V4.1: dragon riding + dopamine buffs (timestamps = active until)
  ridingDragon: number | null;
  buffs: { rage: number; surge: number; midas: number };
  setRidingDragon: (id: number | null) => void;
  setBuff: (b: 'rage' | 'surge' | 'midas', until: number) => void;
  // Neutral creatures (V2 WS-E): host sims `creatures`, peers mirror `netCreatures`
  creatures: Creature[];
  netCreatures: Creature[];
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
  takeDamage: (amount: number, limb?: string) => void;
  // V9 Б: контузия (отстрелили ноги — ползёшь) и добивание (камера доминации)
  crippledUntil: number;
  downedUntil: number;
  // V9 К: Kenshi — отстреленные РУКИ (ствол пляшет, темп падает)
  armsUntil: number;
  reviveMe: () => void;
  // V9 Р: свой рост — L больше, K меньше (песочница гигантов)
  bodyScale: number;
  setBodyScale: (s: number) => void;
  addProjectile: (p: Omit<Projectile, 'id' | 'createdAt'>) => void;
  removeProjectile: (id: string) => void;
  addDamageNumber: (pos: [number, number, number], amount: number, color?: string) => void;
  removeDamageNumber: (id: string) => void;
  addDebris: (chunks: Omit<DebrisChunk, 'id' | 'createdAt'>[]) => void;
  removeDebris: (id: string) => void;
  setJetpackFuel: (v: number) => void;
  toggleEditor: () => void;
  setEditorSelect: (t: string) => void;
  setEditorRotY: (r: number) => void;
  setEditorScale: (s: number) => void;
  setEditorBody: (b: 'fixed' | 'dynamic') => void;
  addProp: (p: PlacedProp) => void;
  removeProp: (id: string) => void;
  setPlacedProps: (props: PlacedProp[]) => void; // late-join snapshot (WS-1/net)
  setSelectedSpell: (id: string) => void;
  setSpellWheel: (open: boolean) => void;
  setAvatar: (id: string) => void;
  setDriving: (id: string | null) => void;
  addMoney: (n: number) => void;
  buyWeapon: (index: number) => void;
  setBuyMenu: (open: boolean) => void;
  setRound: (r: { num: number; phase: 'buy' | 'wave'; until: number }) => void;
  setCreatures: (c: Creature[]) => void;
  setNetCreatures: (c: Creature[]) => void;
  removeCreature: (id: string) => void;
  addMinion: (m: { x: number; y: number; z: number }) => void;
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
  crippledUntil: 0,
  downedUntil: 0,
  armsUntil: 0,
  bodyScale: 1,
  god: true,              // immortal by default (admin sandbox)
  editorMode: false,
  editorSelect: isTower() ? 'gcandle' : 'pad',
  editorRotY: 0,
  editorScale: 1,
  editorBody: 'fixed',
  placedProps: [],
  selectedSpell: 'none', // 'none' = fire the equipped weapon's own shot; wheel picks a spell override
  spellWheelOpen: false,
  avatarId: 'skull',
  driving: null,
  ridingDragon: null,
  buffs: { rage: 0, surge: 0, midas: 0 },
  money: ECON.startMoney,
  ownedWeapons: WEAPON_PRICES.map(() => true), // V7.5: арсенал открыт — BuyMenu = свитчер
  buyMenuOpen: false,
  round: { num: 1, phase: 'buy', until: 0 },
  position: null,
  marketWheelOpen: false,
  marketLev: 25,
  weaponMods: loadMods(),
  workbenchOpen: false,
  hubOpen: false,
  lastLiq: 0,
  lastTrade: { amount: 0, t: 0 },
  creatures: [],
  netCreatures: [],
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
    if (state.enemies.length >= 24) return state; // Max 24 (40 tanked fps — dynamic bodies are the CPU cost)
    
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
  
  takeDamage: (amount, limb) => set((state) => {
    addTrauma(0.3); // getting hit kicks the camera
    const jetpackStunUntil = Date.now() + 1200; // a hit knocks the jetpack out briefly
    if (state.god) return { jetpackStunUntil }; // immortal: feel the hit, never lose HP
    const newHealth = Math.max(0, state.health - amount);
    // V9 К (Kenshi): куда попали — то и отказывает.
    //   НОГИ → контузия, ползёшь;  РУКИ → ствол пляшет и темп падает.
    const now = Date.now();
    let crippledUntil = state.crippledUntil;
    let armsUntil = state.armsUntil;
    if (limb === 'legs' && amount >= 10) crippledUntil = Math.max(crippledUntil, now + 5200);
    else if (limb === 'arms' && amount >= 10) armsUntil = Math.max(armsUntil, now + 5200);
    else if (amount >= 26) crippledUntil = Math.max(crippledUntil, now + 4200); // тяжёлый удар валит и так
    if (newHealth === 0) {
      // ДОБИВАНИЕ: 3.5с своей камерой снизу смотришь на того, кто тебя добил
      return { health: 0, downedUntil: now + 3500, crippledUntil, armsUntil, jetpackStunUntil };
    }
    return { health: newHealth, crippledUntil, armsUntil, jetpackStunUntil };
  }),
  reviveMe: () => set({ health: 100, downedUntil: 0, crippledUntil: 0, armsUntil: 0 }),
  // V9 Р: рост игрока. 0.25× — мышь, 12× — колосс над свечами.
  setBodyScale: (s) => set({ bodyScale: Math.max(0.25, Math.min(12, s)) }),

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
  setEditorRotY: (r) => set({ editorRotY: r }),
  setEditorScale: (s) => set({ editorScale: s }),
  setEditorBody: (b) => set({ editorBody: b }),
  addProp: (p) => set((s) => ({ placedProps: [...s.placedProps, p] })),
  removeProp: (id) => set((s) => ({ placedProps: s.placedProps.filter((p) => p.id !== id) })),
  setPlacedProps: (props) => set({ placedProps: props }),
  setSelectedSpell: (id) => set({ selectedSpell: id }),
  setSpellWheel: (open) => set({ spellWheelOpen: open }),
  setAvatar: (id) => set({ avatarId: id }),
  setDriving: (id) => set({ driving: id }),
  setRidingDragon: (id) => set({ ridingDragon: id }),
  setBuff: (b, until) => set((s) => ({ buffs: { ...s.buffs, [b]: until } })),
  // MIDAS buff doubles the gold flowing IN (never the losses)
  addMoney: (n) => set((s) => {
    const gain = n > 0 && s.buffs.midas > Date.now() ? n * 2 : n;
    return { money: Math.min(ECON.maxMoney, Math.max(0, s.money + gain)) };
  }),
  buyWeapon: (index) => set((s) => {
    const price = WEAPON_PRICES[index];
    if (price === undefined || s.ownedWeapons[index] || s.money < price) return s;
    const owned = [...s.ownedWeapons];
    owned[index] = true;
    return { ownedWeapons: owned, money: s.money - price, currentWeapon: index };
  }),
  setBuyMenu: (open) => set({ buyMenuOpen: open }),
  setMarketWheel: (open) => set({ marketWheelOpen: open }),
  setMarketLev: (lev) => set({ marketLev: lev }),
  setWorkbench: (open) => set({ workbenchOpen: open }),
  setHub: (open) => set({ hubOpen: open }),
  setGod: (v) => set({ god: v }),
  // V8.5 admin: place a shape anomaly exactly where asked (spawnEnemy clone)
  spawnEnemyAt: (type, x, y, z) => set((state) => {
    if (state.enemies.length >= 24) return state;
    return {
      enemies: [...state.enemies, {
        id: Math.random().toString(36).substring(2, 9),
        position: [x, y, z] as [number, number, number],
        type,
        health: type === 'candle' ? 200 : 100,
      }],
    };
  }),
  cycleMod: (weapon, socket) => set((s) => {
    const cur = s.weaponMods[weapon]?.[socket];
    const mods: WeaponModsState = {
      ...s.weaponMods,
      [weapon]: { ...s.weaponMods[weapon], [socket]: nextMod(socket, cur) },
    };
    saveMods(mods);
    return { weaponMods: mods };
  }),
  // stake = 20% of the bag (min $200), no number entry — the two-second rule
  openPosition: (side, entry) => set((s) => {
    if (s.position || s.money < 200) return s;
    const stake = Math.max(200, Math.floor(s.money * 0.2));
    return {
      position: { side, lev: s.marketLev, stake, entry, openedAt: Date.now() },
      money: s.money - stake,
    };
  }),
  closePosition: (exit) => set((s) => {
    if (!s.position) return s;
    const p = s.position;
    const gain = Math.max(0, Math.round(p.stake * (1 + p.lev * p.side * (exit / p.entry - 1))));
    const profit = gain - p.stake;
    noteTrade(profit);
    if (profit >= 1000) chron(`▲ трейд закрыт: +$${profit}`);
    return {
      position: null,
      money: Math.min(ECON.maxMoney, s.money + gain),
      lastTrade: { amount: profit, t: Date.now() },
    };
  }),
  // margin call: the stake is gone and the body pays the difference — never fatal
  liquidate: () => set((s) => {
    if (!s.position) return s;
    addTrauma(0.5);
    noteLiq(s.position.stake);
    chron(`† МАРЖИН-КОЛЛ: −$${s.position.stake}`);
    return {
      position: null,
      lastLiq: Date.now(),
      lastTrade: { amount: -s.position.stake, t: Date.now() },
      jetpackStunUntil: Date.now() + 1500,
      health: s.god ? s.health : Math.max(25, s.health - 25),
    };
  }),
  setRound: (r) => set({ round: r }),
  setCreatures: (c) => set({ creatures: c }),
  setNetCreatures: (c) => set({ netCreatures: c }),
  removeCreature: (id) => set((s) => ({ creatures: s.creatures.filter((c) => c.id !== id) })),
  addMinion: (m) => set((s) => (s.localMinions.length >= 6 ? s : { localMinions: [...s.localMinions, m] })),
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
