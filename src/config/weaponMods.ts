import type { VoxGunKind } from '../game/voxGuns';

/**
 * V8 Ф3 — THE WEAPON CONSTRUCTOR, MVP (docs/V8_VISION.md §8).
 * Chassis = the existing voxel-gun kinds. Four sockets (muzzle / under /
 * core / scope), ten functional modules with REAL stat effects, voxel
 * attachment blocks on the viewmodel, and the blueprint persists in
 * localStorage. Балансовый закон: параметры от chassis + модулей, оболочка
 * почти косметика — «самый огромный кирпич» не побеждает.
 */

export type ModSocket = 'muzzle' | 'under' | 'core' | 'scope';
export const SOCKETS: ModSocket[] = ['muzzle', 'under', 'core', 'scope'];
export const SOCKET_RU: Record<ModSocket, string> = {
  muzzle: 'ДУЛО', under: 'ПОДСТВОЛ', core: 'ЯДРО', scope: 'ПРИЦЕЛ',
};

export interface ModSpec {
  id: string;
  socket: ModSocket;
  label: string;
  desc: string;
  color: string; // attachment voxel color
  // multiplicative stat effects (1 = neutral). rate<1 = быстрее.
  rate?: number;
  recoil?: number;
  spread?: number;
  therm?: number;
}

export const MODS: ModSpec[] = [
  // — дуло —
  { id: 'comp', socket: 'muzzle', label: 'КОМПЕНСАТОР', desc: 'отдача −30%', color: '#8d99ae', recoil: 0.7 },
  { id: 'supp', socket: 'muzzle', label: 'ГЛУШИТЕЛЬ-ОФШОР', desc: 'разброс −25%', color: '#2b2b2b', spread: 0.75 },
  { id: 'overbore', socket: 'muzzle', label: 'РАСТОЧКА', desc: 'скорострельность +15%, отдача +20%, жар +50%', color: '#ff5714', rate: 0.85, recoil: 1.2, therm: 1.5 },
  // — подствол —
  { id: 'grip', socket: 'under', label: 'РУКОЯТЬ АРБИТРАЖА', desc: 'разброс −30%', color: '#c8b273', spread: 0.7 },
  { id: 'laser', socket: 'under', label: 'ЛАЗЕР-НАВОДКА', desc: 'разброс −40%', color: '#ff2d55', spread: 0.6 },
  // — ядро —
  { id: 'cryo', socket: 'core', label: 'КРИО-ЯЧЕЙКА', desc: 'нагрев −45%', color: '#4cc9f0', therm: 0.55 },
  { id: 'coil', socket: 'core', label: 'ГЛИТЧ-КАТУШКА', desc: 'скорострельность +15%, жар +35%', color: '#b5179e', rate: 0.85, therm: 1.35 },
  { id: 'stable', socket: 'core', label: 'СТАБИЛИЗАТОР', desc: 'отдача −20%, разброс −15%', color: '#2fbf71', recoil: 0.8, spread: 0.85 },
  // — прицел —
  { id: 'reflex', socket: 'scope', label: 'РЕФЛЕКС', desc: 'разброс −15%', color: '#ffe8b0', spread: 0.85 },
  { id: 'oracle', socket: 'scope', label: 'ОРАКУЛ', desc: 'разброс −30%, скорострельность −8%', color: '#ffffff', spread: 0.7, rate: 1.08 },
];
export const MOD_BY_ID: Record<string, ModSpec> = Object.fromEntries(MODS.map((m) => [m.id, m]));

/** Equipped mods per weapon index: { [weapon]: { muzzle?: 'comp', ... } } */
export type WeaponModsState = Record<number, Partial<Record<ModSocket, string>>>;

const LS_KEY = 'mq-blueprints-v1';
export function loadMods(): WeaponModsState {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as WeaponModsState) : {};
  } catch { return {}; }
}
export function saveMods(mods: WeaponModsState): void {
  try { localStorage.setItem(LS_KEY, JSON.stringify(mods)); } catch { /* private mode */ }
}

/** Next module in the socket's cycle: none → m1 → m2 → … → none. */
export function nextMod(socket: ModSocket, current: string | undefined): string | undefined {
  const pool = MODS.filter((m) => m.socket === socket);
  if (!current) return pool[0]?.id;
  const i = pool.findIndex((m) => m.id === current);
  return i >= 0 && i < pool.length - 1 ? pool[i + 1].id : undefined;
}

export interface ModMults { rate: number; recoil: number; spread: number; therm: number }
const _mm: ModMults = { rate: 1, recoil: 1, spread: 1, therm: 1 };
/** Combined multipliers for a weapon's equipped mods (zero-alloc shared). */
export function modMults(mods: Partial<Record<ModSocket, string>> | undefined): ModMults {
  _mm.rate = 1; _mm.recoil = 1; _mm.spread = 1; _mm.therm = 1;
  if (mods) {
    for (const s of SOCKETS) {
      const m = mods[s] ? MOD_BY_ID[mods[s]!] : undefined;
      if (!m) continue;
      _mm.rate *= m.rate ?? 1;
      _mm.recoil *= m.recoil ?? 1;
      _mm.spread *= m.spread ?? 1;
      _mm.therm *= m.therm ?? 1;
    }
  }
  return _mm;
}

// Attachment anchor per chassis, in gun-voxel units (×V in the viewmodel).
// core is internal (no visible block — it tints the glow instead).
export const MOD_ANCHORS: Record<VoxGunKind, { muzzle: [number, number, number]; under: [number, number, number]; scope: [number, number, number] }> = {
  ak:      { muzzle: [0, 1, -25],   under: [0, -1.8, -18], scope: [0, 3.6, -12] },
  deagle:  { muzzle: [0, 1, -13],   under: [0, -1.6, -9],  scope: [0, 4.2, -8] },
  smg:     { muzzle: [0, 1, -16.5], under: [0, -1.6, -13], scope: [0, 3.2, -9] },
  shotgun: { muzzle: [0, 1.4, -24], under: [0, -1.6, -17], scope: [0, 3.4, -8] },
  rail:    { muzzle: [0, 0, -29],   under: [0, -1.8, -18], scope: [0, 3.4, -12] },
  minigun: { muzzle: [0, 0.5, -30], under: [0, -3, -14],   scope: [0, 4, -7] },
  db:      { muzzle: [0, 0.6, -24], under: [0, -1.6, -14], scope: [0, 3, -6] },
  printer: { muzzle: [0, 0.5, -14], under: [0, -1.6, -10], scope: [0, 3.6, -7] },
  harpoon: { muzzle: [0, 0.5, -27], under: [0, -1.6, -12], scope: [0, 3, -6] },
  swan:    { muzzle: [0, 3.2, -25], under: [0, -1.6, -11], scope: [0, 4.2, -9] },
};
