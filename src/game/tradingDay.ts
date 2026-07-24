/**
 * V7 W2 — THE TRADING DAY (docs/WOLF_ARC.md §7.3), session-local edition.
 * day = floor(liturgyT / 600) — exactly 8 god-cycles, perfectly aligned with
 * the epochs the player reads overhead. Module-mutable stats (chronicle.ts
 * pattern), zero React in the hot path. The cross-client wall-clock anchor
 * (worldT) is a separate careful wave — see WOLF_ARC §7.0.
 */

export const DAY_LEN = 600;               // 8 × 75s cycles
export const BELL_AT = DAY_LEN - 3;       // gold freeze + force-close
export const LAST_HOUR_AT = DAY_LEN - 75; // final cycle = CLOSING BELL crescendo

export const dayIndex = (t: number): number => Math.floor(t / DAY_LEN);
export const dayT = (t: number): number => t - Math.floor(t / DAY_LEN) * DAY_LEN;

export interface DayStats {
  day: number;
  pnl: number;
  trades: number;
  wins: number;
  liqs: number;
  kills: number;
  bestTrade: number;
}

export const dayStats: DayStats = { day: 0, pnl: 0, trades: 0, wins: 0, liqs: 0, kills: 0, bestTrade: 0 };

export function resetDay(day: number): void {
  dayStats.day = day;
  dayStats.pnl = 0; dayStats.trades = 0; dayStats.wins = 0;
  dayStats.liqs = 0; dayStats.kills = 0; dayStats.bestTrade = 0;
}

export const noteTrade = (profit: number): void => {
  dayStats.pnl += profit;
  dayStats.trades++;
  if (profit > 0) dayStats.wins++;
  if (profit > dayStats.bestTrade) dayStats.bestTrade = profit;
};
export const noteLiq = (stake: number): void => {
  dayStats.pnl -= stake;
  dayStats.liqs++;
};
export const noteKill = (): void => { dayStats.kills++; };

/** The one big title of the day — order matters (shame before glory). */
export function titleFor(s: DayStats): { name: string; color: string } {
  if (s.liqs >= 2) return { name: 'ХОМЯК', color: '#ff7b00' };
  if (s.trades >= 2 && s.liqs === 0 && s.wins === s.trades) return { name: 'КЭШ-АУТ МОНАХ', color: '#ffe8b0' };
  if (s.pnl >= 1000) return { name: 'ВОЛК ДНЯ', color: '#e9c46a' };
  if (s.trades === 0 && s.kills >= 10) return { name: 'ЧИСТЫЕ РУКИ', color: '#c8b273' };
  return { name: 'ПЫЛЬ РЫНКА', color: '#8fa3ad' };
}
