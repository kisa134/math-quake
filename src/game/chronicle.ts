/**
 * V5 C6 — THE CHRONICLE: the world narrates itself. A tiny ring buffer of
 * events (kills, swallowed souls, epoch turns, boss arrivals); the HUD shows
 * the last three, fading. Module-mutable, zero React in the hot path.
 */
export interface ChronicleEntry { msg: string; t: number }
export const chronicle: ChronicleEntry[] = [];

export function chron(msg: string) {
  chronicle.push({ msg, t: Date.now() });
  if (chronicle.length > 6) chronicle.shift();
}

export const EPOCH_CHRONICLE = [
  '· НАКОПЛЕНИЕ — рынок затаился',
  '↑ ПАМП — золотой крест',
  '☼ ЭЙФОРИЯ — быки горят',
  '↓ РАСПРОДАЖА — крест смерти',
  '† КАПИТУЛЯЦИЯ — пончик пирует',
  '… ТИШИНА — вдох',
];
