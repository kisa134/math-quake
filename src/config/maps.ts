/**
 * КВЕЙК-АРЕНЫ — the map registry. On load you pick a map: the full donut
 * universe OR one of five classic Quake-style arenas (corridors, jump pads,
 * item spots — наш стиль, квейковский масштаб). The map id lives in the URL
 * (?map=) and is BAKED INTO THE ROOM ID, so two players on the same link are
 * always in the same world and different maps can never mix.
 */
export type MapId = 'donut' | 'tower' | 'cs' | 'q1' | 'q2' | 'q3' | 'q4' | 'q5';

export interface MapSpec {
  id: MapId;
  name: string;
  desc: string;
  color: string;
}

export const MAPS: MapSpec[] = [
  { id: 'donut', name: 'МИР ПОНЧИКА', desc: 'вся вселенная: литургия · город · драконы · рынок', color: '#c8b273' },
  { id: 'tower', name: 'МАТЕМАТИЧЕСКАЯ БАШНЯ', desc: 'строй свечи за деньги · лезь ВВЕРХ · пончики, торы, узлы', color: '#b5179e' },
  { id: 'cs', name: 'ПЕСЧАНКА', desc: 'как в контре: два спавна · мид · точки A и B', color: '#e9c46a' },
  { id: 'q1', name: 'ДЛИННЕЙШИЙ ЛОНГ', desc: 'платформы в пустоте · батуты · рейл-дуэли', color: '#4cc9f0' },
  { id: 'q2', name: 'КЕМПИНГ МАРЖИ', desc: 'атриум · балконы · мега-орб на выступе', color: '#2fbf71' },
  { id: 'q3', name: 'КРОВАВЫЙ ПРОГОН', desc: 'тесная дуэль · два этажа · комната ярости', color: '#ff2d55' },
  { id: 'q4', name: 'АЭРОХОД', desc: 'вертикаль · пады вверх · контроль верха', color: '#ffe8b0' },
  { id: 'q5', name: 'ПЛОХОЕ МЕСТО', desc: 'низкие потолки · злые углы · яма-ловушка', color: '#ff7b00' },
];

export function currentMap(): MapId {
  try {
    const m = new URLSearchParams(window.location.search).get('map') as MapId | null;
    if (m && MAPS.some((x) => x.id === m)) return m;
  } catch { /* ssr/tests */ }
  return 'donut';
}

export const isArena = (): boolean => currentMap() !== 'donut';
/** МАТЕМАТИЧЕСКАЯ БАШНЯ: строим свечи, лезем вверх, оружие крупнее и злее. */
export const isTower = (): boolean => currentMap() === 'tower';

/** Rewrite ?map= in the URL (keeps ?room= etc.) — used by MapSelect / Hub. */
export function setMapInUrl(id: MapId): void {
  const u = new URL(window.location.href);
  u.searchParams.set('map', id);
  window.history.replaceState(null, '', u.toString());
}
