/**
 * V4 БРУТАЛ — the voxel-dude BOT HORDE (pure data/logic; renderer+sim in
 * components/BotHorde.tsx). Bots are the same white blocky class as the player
 * plus deranged MUTATIONS of it — per-instance color/scale/behavior. No
 * RigidBodies: analytic steering + manual gravity + round-robin ground rays.
 * Host-authoritative; peers mirror via the 'bots' broadcast and relay hits
 * through botHitInbox (the proven inbox pattern — no import cycles).
 */

export type BotBehavior = 'rush' | 'flee' | 'hop' | 'strafe' | 'swarm' | 'tank' | 'devour';

export interface MutationSpec {
  id: string;
  color: string;
  scale: number;
  hp: number;
  speed: number;       // u/s ground chase speed
  behavior: BotBehavior;
  weight: number;      // spawn weight (0 = never random — scheduled only)
}

// Безумное многообразие класса «белый чувак»
export const MUTATIONS: MutationSpec[] = [
  { id: 'BONE',    color: '#f5f0e6', scale: 1.0, hp: 100, speed: 6,   behavior: 'rush',   weight: 30 },
  { id: 'BERSERK', color: '#e63946', scale: 1.05, hp: 80,  speed: 11,  behavior: 'rush',   weight: 18 },
  { id: 'GOLDBOY', color: '#ffd166', scale: 1.0, hp: 60,  speed: 8.5, behavior: 'flee',   weight: 10 },
  { id: 'WINE',    color: '#9d174d', scale: 1.1, hp: 120, speed: 6.5, behavior: 'hop',    weight: 14 },
  { id: 'GLITCH',  color: '#b5179e', scale: 0.95, hp: 90, speed: 7.5, behavior: 'strafe', weight: 12 },
  { id: 'MIDGET',  color: '#efe2c8', scale: 0.6, hp: 45,  speed: 9,   behavior: 'swarm',  weight: 12 },
  { id: 'GIANT',   color: '#8d99ae', scale: 1.8, hp: 300, speed: 4,   behavior: 'tank',   weight: 4 },
  // Пожиратель: не выпадает случайно — приходит по расписанию раундов.
  { id: 'DEVOURER', color: '#12060c', scale: 3.2, hp: 900, speed: 3.2, behavior: 'devour', weight: 0 },
];
export const MUT_BY_ID: Record<string, MutationSpec> = Object.fromEntries(MUTATIONS.map((m) => [m.id, m]));

export interface Bot {
  id: number;
  mut: string;          // mutation id
  x: number; y: number; z: number;
  vy: number;           // manual gravity
  heading: number;
  hp: number;
  limbMask: number;
  phase: number;        // walk-anim phase
  scale: number;        // live scale (devourer grows)
  strafeDir: number;    // for strafe behavior
  nextHopAt: number;
}

export const BOT_CAP = 40;

/** Weighted mutation roll (host spawn). */
export function rollMutation(rand: () => number): MutationSpec {
  const total = MUTATIONS.reduce((s, m) => s + m.weight, 0);
  let r = rand() * total;
  for (const m of MUTATIONS) {
    r -= m.weight;
    if (r <= 0 && m.weight > 0) return m;
  }
  return MUTATIONS[0];
}

let _nextId = 1;
export function makeBot(mut: MutationSpec, x: number, y: number, z: number): Bot {
  return {
    id: _nextId++,
    mut: mut.id,
    x, y, z,
    vy: 0,
    heading: Math.random() * Math.PI * 2,
    hp: mut.hp,
    limbMask: 0,
    phase: Math.random() * Math.PI * 2,
    scale: mut.scale,
    strafeDir: Math.random() > 0.5 ? 1 : -1,
    nextHopAt: 0,
  };
}

// ---- cross-module inboxes (socket/Player push, BotHorde drains) -------------
export const botHitInbox: { id: number; damage: number }[] = [];
export const botFxInbox: { x: number; y: number; z: number; big: boolean }[] = [];
// V4.1 dopamine: bot deaths sometimes drop a personal buff orb (client-local loot)
export const orbSpawnInbox: { x: number; y: number; z: number }[] = [];

// Non-host mirror snapshot (socket writes, BotHorde renders when !isHost)
export interface NetBot {
  id: number; mut: string; x: number; y: number; z: number;
  h: number; lm: number; hp: number; s: number;
}
export const netBots: { list: NetBot[] } = { list: [] };
