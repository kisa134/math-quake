import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { marketNow } from '../game/market';
import {
  dayIndex, dayT, BELL_AT, LAST_HOUR_AT,
  dayStats, resetDay, titleFor, type DayStats,
} from '../game/tradingDay';
import { chron } from '../game/chronicle';
import { playHitTick } from '../utils/audio';

/**
 * V7 W2 — the session frame (docs/WOLF_ARC.md §7.3): opening gong banner,
 * CLOSING BELL crescendo through the day's final cycle, the 3s golden freeze
 * with a forced market close, and the 20s closing report over ТИШИНА —
 * podium (TOP BAG money is already gossiped in the update payload), your day
 * line, and ONE big title. Enter dismisses. DOM only, 4Hz interval.
 */

const PODIUM_COLORS = ['#e9c46a', '#c9c9c9', '#a8743d'];

export const ClosingBell = () => {
  const [, force] = useState(0);
  const [report, setReport] = useState<DayStats | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const curDay = useRef(-1);
  const belled = useRef(false);

  useEffect(() => {
    const iv = setInterval(() => {
      const t = marketNow.t;
      const d = dayIndex(t);
      if (curDay.current === -1) { curDay.current = d; resetDay(d); }
      const dt = dayT(t);
      if (dt >= BELL_AT && !belled.current) {
        belled.current = true;
        const st = useStore.getState();
        if (st.position) {
          st.closePosition(marketNow.price);
          chron('🔔 звонок: позиция закрыта по рынку');
        }
        playHitTick();
      }
      if (d !== curDay.current) {
        setReport({ ...dayStats });
        setDismissed(false);
        curDay.current = d;
        belled.current = false;
        resetDay(d);
        chron(`▸ ДЕНЬ ${d + 1} — РЫНОК ОТКРЫТ`);
      }
      force((x) => x + 1);
    }, 250);
    return () => clearInterval(iv);
  }, []);

  // Enter dismisses the closing report (pointer stays locked)
  useEffect(() => {
    if (!report || dismissed) return;
    const onKey = (e: KeyboardEvent) => { if (e.code === 'Enter') setDismissed(true); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [report, dismissed]);

  const money = useStore((s) => s.money);
  const remotes = useStore((s) => s.remotePlayers);

  const t = marketNow.t;
  const dt = dayT(t);
  const day = dayIndex(t);
  const showReport = !!report && !dismissed && dt < 20;

  const rows = [
    { name: 'ТЫ', money },
    ...Object.entries(remotes).map(([id, p]) => ({ name: id.slice(0, 8), money: p.money ?? 0 })),
  ].sort((a, b) => b.money - a.money).slice(0, 3);

  return (
    <>
      {/* opening banner (suppressed while the report is up) */}
      {dt < 3 && !showReport && (
        <div className="absolute inset-x-0 top-[18%] flex justify-center pointer-events-none z-20">
          <div className="font-black text-3xl tracking-[0.4em] uppercase px-6 py-2 bg-black/60 border border-amber-300/40"
               style={{ color: '#e9c46a', textShadow: '0 0 22px #e9c46a' }}>
            ▸ ДЕНЬ {day + 1} — РЫНОК ОТКРЫТ
          </div>
        </div>
      )}

      {/* final-cycle crescendo banner */}
      {dt >= LAST_HOUR_AT && dt < BELL_AT && (
        <div className="absolute inset-x-0 top-4 flex justify-center pointer-events-none z-20">
          <div className="font-mono text-[11px] tracking-[0.5em] uppercase px-4 py-1 bg-black/50 border border-amber-400/50 text-amber-300"
               style={{ animation: 'bell-blink 1.2s infinite' }}>
            CLOSING BELL · до звонка {Math.max(0, Math.ceil(BELL_AT - dt))}с
          </div>
        </div>
      )}

      {/* the 3s golden freeze */}
      {dt >= BELL_AT && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-30"
             style={{ background: 'radial-gradient(circle at center, rgba(233,196,106,0.08), rgba(233,196,106,0.22))' }}>
          <div className="font-black text-6xl tracking-[0.3em] uppercase" style={{ color: '#e9c46a', textShadow: '0 0 40px #e9c46a' }}>
            🔔 ЗВОНОК
          </div>
        </div>
      )}

      {/* closing report over ТИШИНА */}
      {showReport && report && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-40"
             style={{ background: 'radial-gradient(circle at center, rgba(0,0,0,0.55), rgba(0,0,0,0.85))' }}>
          <div className="flex flex-col items-center gap-4 px-10 py-8 bg-black/80 border border-amber-300/30 min-w-[440px]">
            <div className="font-black text-2xl tracking-[0.35em] uppercase text-white">
              ДЕНЬ {report.day + 1} ЗАКРЫТ
            </div>
            {/* podium */}
            <div className="flex flex-col gap-1 w-full">
              {rows.map((r, i) => (
                <div key={r.name + i} className="flex justify-between font-mono tabular-nums text-sm px-3 py-1 border"
                     style={{ borderColor: `${PODIUM_COLORS[i]}55`, color: PODIUM_COLORS[i] }}>
                  <span className="font-bold">{i === 0 ? '👑' : i === 1 ? '▪' : '·'} {r.name}</span>
                  <span>${r.money}</span>
                </div>
              ))}
            </div>
            {/* your line */}
            <div className="grid grid-cols-4 gap-4 font-mono text-center w-full">
              {[
                ['PNL ДНЯ', `${report.pnl >= 0 ? '+' : '−'}$${Math.abs(report.pnl)}`, report.pnl >= 0 ? '#e9c46a' : '#ff2d55'],
                ['ТРЕЙДОВ', `${report.trades}`, '#ffffffaa'],
                ['ЛИКВИДАЦИЙ', `${report.liqs}`, report.liqs ? '#ff2d55' : '#ffffff55'],
                ['КИЛЛОВ', `${report.kills}`, '#ffffffaa'],
              ].map(([l, v, c]) => (
                <div key={l as string}>
                  <div className="text-[9px] tracking-[0.25em] uppercase text-white/40">{l}</div>
                  <div className="font-bold text-lg tabular-nums" style={{ color: c as string }}>{v}</div>
                </div>
              ))}
            </div>
            {/* the one big title */}
            {(() => {
              const tt = titleFor(report);
              return (
                <div className="font-black text-3xl tracking-[0.3em] uppercase"
                     style={{ color: tt.color, textShadow: `0 0 26px ${tt.color}` }}>
                  {tt.name}
                </div>
              );
            })()}
            <div className="font-mono text-[10px] tracking-widest uppercase text-white/40">
              Enter — следующий день
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes bell-blink { 0%,100% { opacity: 1; } 50% { opacity: 0.45; } }`}</style>
    </>
  );
};
