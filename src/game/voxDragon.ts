import * as THREE from 'three';
import { voxGrid } from './voxHumanoid';
import { BLACK_HOLE } from './voxCandles';

/**
 * V4.1 — VOXEL DRAGONS. Same blocky construction language as the player dude,
 * scaled to beast size. FOUR live in the world: three hidden riders + ONE HUGE
 * apex circling the black hole. Wild dragons fly DETERMINISTIC analytic
 * patrol loops (pure f(t) — zero net traffic); HP is event-sourced ('dhit'
 * broadcast, every client applies the same stream → converges); mount state
 * via 'dmount'/'ddismount'. Ride one and the mouth becomes a RAINBOW
 * MEGA-CANNON with foam. Killable, damageable, resurrect after 60s.
 */
export const DVOX = 0.3; // dragon voxel (2.1× the dude voxel — a beast)

export interface DragonDef {
  id: number;
  name: string;
  scale: number;      // 1 = ~6u long; the apex is 2.6
  hp: number;
  speed: number;      // mounted flight speed
  home: [number, number, number];
  circleR: number;
  circleSpeed: number; // rad/s
  phase: number;
}

export const DRAGONS: DragonDef[] = [
  // circles RIGHT OVER the spawn temple — you see your first dragon in second one
  { id: 0, name: 'BONE WYRM',   scale: 3,   hp: 700,  speed: 70, home: [0, 170, 0], circleR: 95, circleSpeed: 0.2, phase: 0.4 },
  // circling a mid-city rooftop cluster
  { id: 1, name: 'GLITCH DRAKE', scale: 3,  hp: 700,  speed: 70, home: [-700, 800, 530], circleR: 140, circleSpeed: 0.16, phase: 2.2 },
  // deep in the outer halo — the far hunter
  { id: 2, name: 'VOID SERPENT', scale: 3.6, hp: 900, speed: 75, home: [650, 1400, 650], circleR: 190, circleSpeed: 0.13, phase: 4.1 },
  // THE APEX — huge, circling the black hole itself
  { id: 3, name: 'MARKET MAKER', scale: 8, hp: 3200, speed: 110, home: [BLACK_HOLE.x, BLACK_HOLE.y + 150, BLACK_HOLE.z], circleR: 1050, circleSpeed: 0.07, phase: 1.0 },
];

/** Analytic wild patrol position + heading (pure f(t), deterministic). */
export function wildDragonPos(d: DragonDef, t: number, out: { x: number; y: number; z: number; heading: number }) {
  const a = d.phase + t * d.circleSpeed;
  out.x = d.home[0] + Math.cos(a) * d.circleR;
  out.y = d.home[1] + Math.sin(a * 0.7) * 8 * d.scale;
  out.z = d.home[2] + Math.sin(a) * d.circleR;
  // heading = tangent of the circle
  out.heading = Math.atan2(-Math.sin(a), Math.cos(a));
  // V6 Ш5 микросценка: раз в 3 цикла (225с) АПЕКС ныряет НИЗКО над Полом —
  // тень маркетмейкера накрывает арену (детерминировано, оба клиента видят)
  if (d.id === 3) {
    const ct = t % 225;
    if (ct < 16) {
      const k = Math.sin((ct / 16) * Math.PI); // плавно вниз и обратно
      out.y = out.y * (1 - k) + 150 * k;
      const rr = d.circleR * (1 - k * 0.85);   // и почти к центру
      out.x = d.home[0] + Math.cos(a) * rr;
      out.z = d.home[2] + Math.sin(a) * rr;
    }
  }
}

// ---- live state (event-sourced across peers) --------------------------------
export interface DragonState { hp: number; riddenBy: string | null; deadUntil: number }
export const dragonState: DragonState[] = DRAGONS.map((d) => ({ hp: d.hp, riddenBy: null, deadUntil: 0 }));

export const RESURRECT_MS = 60000;

/** Apply damage (locally AND from 'dhit' broadcasts — same stream everywhere).
 *  Returns true if this hit killed the dragon. */
export function applyDragonHit(id: number, damage: number): boolean {
  const s = dragonState[id];
  if (!s || s.deadUntil > Date.now()) return false;
  s.hp -= damage;
  if (s.hp <= 0) {
    s.hp = 0;
    s.deadUntil = Date.now() + RESURRECT_MS;
    s.riddenBy = null;
    return true;
  }
  return false;
}

export function dragonAlive(id: number): boolean {
  const s = dragonState[id];
  if (!s) return false;
  if (s.deadUntil > 0 && s.deadUntil <= Date.now()) { // resurrect
    s.deadUntil = 0;
    s.hp = DRAGONS[id].hp;
  }
  return s.deadUntil === 0;
}

// death FX inbox (renderer drains; pushed locally + от 'ddead' пиров)
export const dragonFxInbox: { x: number; y: number; z: number; scale: number }[] = [];

// ---- geometry (module-shared, built once) -----------------------------------
let _parts: {
  body: THREE.BufferGeometry;
  head: THREE.BufferGeometry;
  wing: THREE.BufferGeometry;
  tail: THREE.BufferGeometry;
} | null = null;

export function getDragonParts() {
  if (_parts) return _parts;
  const v = DVOX;
  _parts = {
    // body 3×2×6 (long axis −z = forward), pivot center
    body: voxGrid(3, 2, 6, -1.5 * v, -1 * v, -3 * v, v),
    // head 2×2×2 + implied jaw, pivot at neck (attaches to body front)
    head: voxGrid(2, 2, 3, -1 * v, -0.5 * v, -3 * v, v),
    // wing: flat 5×1×3 plate, pivot at the root (extends +x; mirror for left)
    wing: voxGrid(5, 1, 3, 0, 0, -1.5 * v, v),
    // tail 1×1×5 tapering back (+z), pivot at base
    tail: voxGrid(1, 1, 5, -0.5 * v, -0.5 * v, 0, v),
  };
  return _parts;
}

// joint anchors in dragon-local space (forward = −z)
export const DJOINT = {
  head: [0, 0.25, -1.9] as const,
  wingL: [-0.45, 0.35, -0.3] as const,
  wingR: [0.45, 0.35, -0.3] as const,
  tail: [0, 0, 1.8] as const,
  mouth: [0, 0.15, -2.8] as const, // rainbow cannon origin
};

// rainbow spectrum for the mega-cannon + foam
export const RAINBOW = ['#ff0055', '#ff7b00', '#ffd500', '#2fbf71', '#00b4d8', '#7209b7', '#ff2fd0'];
export const FOAM = ['#ffffff', '#fff3dc', '#e8f7ff', '#ffe9f5'];
