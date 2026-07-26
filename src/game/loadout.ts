import { WEAPONS } from '../config/weapons';

/**
 * ЛОАДАУТ — колесо мыши листает ВСЁ, что можно взять в руки (стволы, крюк,
 * прицел, свечи, батут), а клик мышью в момент листания ПРИВЯЗЫВАЕТ выбранное
 * к этой кнопке: «покрутил → кликнул ту кнопку → забил». Крюк можно повесить
 * на ПКМ, дробовик на ЛКМ, свечу на ПКМ — как удобно.
 */
export type AbilityKind = 'weapon' | 'grapple' | 'aim' | 'build';

export interface Ability {
  id: string;
  label: string;
  kind: AbilityKind;
  weapon?: number;   // index into WEAPONS
  asset?: string;    // build asset id
  color: string;
}

export const ABILITIES: Ability[] = [
  ...WEAPONS.map((w, i) => ({
    id: 'w' + i,
    label: w.name,
    kind: 'weapon' as const,
    weapon: i,
    color: '#' + w.tracer.toString(16).padStart(6, '0'),
  })),
  { id: 'grapple', label: 'КРЮК-КОШКА', kind: 'grapple', color: '#00f5d4' },
  { id: 'aim', label: 'ПРИЦЕЛ (ADS)', kind: 'aim', color: '#ffe8b0' },
  { id: 'candle', label: 'СВЕЧА БЫКА', kind: 'build', asset: 'gcandle', color: '#2fbf71' },
  { id: 'candle_b', label: 'СВЕЧА МЕДВЕДЯ', kind: 'build', asset: 'gcandle_b', color: '#c9184a' },
  { id: 'pad', label: 'БАТУТ', kind: 'build', asset: 'pad', color: '#c8b273' },
];

const idx = (id: string) => ABILITIES.findIndex((a) => a.id === id);

export const loadout = {
  left: 0,                   // ЛКМ — первый ствол
  right: idx('grapple'),     // ПКМ — крюк (как было)
  hi: 0,                     // подсвеченное колесом
  bindUntil: 0,              // пока идёт — клики привязывают, а не стреляют
};

export const BIND_WINDOW_MS = 2600;

export function wheelStep(dir: number): void {
  const n = ABILITIES.length;
  loadout.hi = (loadout.hi + dir + n) % n;
  loadout.bindUntil = performance.now() + BIND_WINDOW_MS;
}
export const isBinding = (): boolean => performance.now() < loadout.bindUntil;
export function bindTo(side: 'left' | 'right'): Ability {
  loadout[side] = loadout.hi;
  loadout.bindUntil = 0;
  return ABILITIES[loadout.hi];
}
export const leftAb = (): Ability => ABILITIES[loadout.left] ?? ABILITIES[0];
export const rightAb = (): Ability => ABILITIES[loadout.right] ?? ABILITIES[0];

/** ADS 0..1 — WeaponModel/Player читают каждый кадр. */
export const adsState = { v: 0 };
