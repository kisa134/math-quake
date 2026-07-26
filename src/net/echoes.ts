import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON } from './supabaseConfig';

/**
 * V8.6 У2 — W4 «ЭХО» (docs/WOLF_ARC.md §7.4). The dead join the horde:
 * a player's financial death (liquidation on an empty bag) writes an echo —
 * name + peak bag — into `mq_echoes`; the host pulls recent echoes of this
 * room plus the global hall of greed and marches them into the waves with
 * a nameplate. Ликвидность бессмертна — умирают только трейдеры.
 * The DB caps harm (CHECKs + hourly dedupe); honesty is not the goal.
 */

export interface Echo { name: string; bag: number }

const sb = SUPABASE_URL && SUPABASE_ANON ? createClient(SUPABASE_URL, SUPABASE_ANON) : null;

const BAD_WORDS = /(хуй|пизд|ебан|ебат|nigg|fagg)/i;

/** The player's chosen echo-name (Hub edits it; falls back to ANON-xxxx). */
export function echoName(): string {
  try {
    const n = (localStorage.getItem('mq-name') ?? '').trim().slice(0, 16);
    if (n && !BAD_WORDS.test(n)) return n;
  } catch { /* private mode */ }
  return 'ANON-' + Math.floor(Math.random() * 9000 + 1000);
}
export function setEchoName(n: string): void {
  try { localStorage.setItem('mq-name', n.trim().slice(0, 16)); } catch { /* ok */ }
}

let lastInsert = 0;
/** Fire-and-forget: write my echo (throttled 60s client-side; DB dedupes hourly). */
export function insertEcho(room: string, bag: number, cause: 'liq' | 'death'): void {
  if (!sb) return;
  const now = Date.now();
  if (now - lastInsert < 60000) return;
  lastInsert = now;
  const name = echoName();
  if (BAD_WORDS.test(name)) return;
  void sb.from('mq_echoes').insert({
    room,
    name,
    bag: Math.max(0, Math.min(1000000, Math.round(bag))),
    cause,
    heat: 0,
  }).then(() => { /* dedupe conflicts are fine */ });
}

/** Host: 5 freshest echoes of this room + 3 from the global hall of greed. */
export async function fetchEchoes(room: string): Promise<Echo[]> {
  if (!sb) return [];
  try {
    const [local, hall] = await Promise.all([
      sb.from('mq_echoes').select('name,bag').eq('room', room)
        .order('created_at', { ascending: false }).limit(5),
      sb.from('mq_echoes').select('name,bag')
        .order('bag', { ascending: false }).limit(3),
    ]);
    const seen = new Set<string>();
    const out: Echo[] = [];
    for (const r of [...(local.data ?? []), ...(hall.data ?? [])]) {
      if (seen.has(r.name)) continue;
      seen.add(r.name);
      out.push({ name: String(r.name).slice(0, 16), bag: Math.max(0, Math.min(1000000, r.bag | 0)) });
      if (out.length >= 8) break;
    }
    return out;
  } catch {
    return [];
  }
}
