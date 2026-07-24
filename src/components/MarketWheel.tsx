import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { marketNow, LEVERAGES, LOCKED_LEV } from '../game/market';
import { playHitTick } from '../utils/audio';

/**
 * V7 W1 — THE MARKET ROSE (docs/WOLF_ARC.md §7.1). Hold Q → this fades in
 * around the crosshair: top half LONG (emerald), bottom half SHORT (crimson),
 * live $SOUL price in the middle. Flick the mouse up/down and release Q to
 * open a position; scroll while holding to cycle leverage. Release near the
 * center = cancel. DOM only, works under pointer lock via movementY —
 * the two-second rule: the mouse never leaves the fight.
 */

const EPOCH_RU = ['НАКОПЛЕНИЕ', 'ПАМП', 'ЭЙФОРИЯ', 'РАСПРОДАЖА', 'КАПИТУЛЯЦИЯ', 'ТИШИНА'];
const EPOCH_COLOR = ['#c8b273', '#2fbf71', '#ffe8b0', '#ff7b00', '#ff2d55', '#8fa3ad'];
const THRESH = 18; // px of accumulated flick before a side arms

export const MarketWheel = () => {
  const open = useStore((s) => s.marketWheelOpen);
  const lev = useStore((s) => s.marketLev);
  const money = useStore((s) => s.money);

  const [aim, setAim] = useState<0 | 1 | -1>(0); // 0 = cancel zone
  const [, force] = useState(0);
  const dy = useRef(0);
  const wasOpen = useRef(false);

  // live price readout while open
  useEffect(() => {
    if (!open) return;
    const iv = setInterval(() => force((x) => x + 1), 100);
    return () => clearInterval(iv);
  }, [open]);

  // commit on release (open → closed)
  useEffect(() => {
    if (open && !wasOpen.current) { dy.current = 0; setAim(0); }
    if (!open && wasOpen.current && dy.current !== 0) {
      const side = dy.current < -THRESH ? 1 : dy.current > THRESH ? -1 : 0;
      if (side !== 0) {
        useStore.getState().openPosition(side as 1 | -1, marketNow.price);
        playHitTick();
      }
    }
    wasOpen.current = open;
  }, [open]);

  // flick accumulation + leverage scroll while open
  useEffect(() => {
    if (!open) return;
    const onMove = (e: MouseEvent) => {
      dy.current = Math.max(-80, Math.min(80, dy.current + e.movementY));
      const next = dy.current < -THRESH ? 1 : dy.current > THRESH ? -1 : 0;
      setAim((prev) => (prev === next ? prev : (next as 0 | 1 | -1)));
    };
    const onWheel = (e: WheelEvent) => {
      const st = useStore.getState();
      const i = LEVERAGES.indexOf(st.marketLev);
      const n = LEVERAGES.length;
      st.setMarketLev(LEVERAGES[((i < 0 ? 0 : i) + (e.deltaY > 0 ? 1 : n - 1)) % n]);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('wheel', onWheel, { passive: true });
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('wheel', onWheel);
    };
  }, [open]);

  if (!open) return null;

  const price = marketNow.price;
  const epoch = marketNow.epoch;
  const stake = Math.max(200, Math.floor(money * 0.2));
  const broke = money < 200;

  const half = (side: 1 | -1) => {
    const active = aim === side;
    const color = side === 1 ? '#2fbf71' : '#ff2d55';
    return (
      <div
        className="flex flex-col items-center justify-center"
        style={{
          height: 120,
          border: `1px solid ${color}${active ? '' : '44'}`,
          background: active ? `${color}22` : 'rgba(0,0,0,0.55)',
          boxShadow: active ? `0 0 32px ${color}55, inset 0 0 24px ${color}22` : 'none',
          transition: 'background 90ms, box-shadow 90ms',
        }}
      >
        <div className="font-black text-2xl tracking-[0.35em] uppercase" style={{ color, opacity: active ? 1 : 0.55 }}>
          {side === 1 ? '▲ LONG' : '▼ SHORT'}
        </div>
        <div className="font-mono text-[10px] tracking-widest uppercase mt-1" style={{ color: '#fff', opacity: active ? 0.85 : 0.35 }}>
          {side === 1 ? 'флик вверх' : 'флик вниз'}
        </div>
      </div>
    );
  };

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center pointer-events-none select-none"
         style={{ background: 'radial-gradient(circle at center, rgba(0,0,0,0.25), rgba(0,0,0,0.7))' }}>
      <div className="flex flex-col gap-2" style={{ width: 360 }}>
        {half(1)}
        {/* center readout */}
        <div className="flex flex-col items-center justify-center py-3 border border-white/20 bg-black/80">
          <div className="font-mono text-[9px] tracking-[0.4em] uppercase" style={{ color: EPOCH_COLOR[epoch] }}>
            $SOUL · {EPOCH_RU[epoch]}
          </div>
          <div className="font-mono font-bold text-3xl tabular-nums text-white leading-tight">
            ${price.toFixed(2)}
          </div>
          {broke ? (
            <div className="font-mono text-[10px] tracking-widest uppercase mt-1 text-red-400">нужно ≥ $200</div>
          ) : (
            <div className="font-mono text-[10px] tracking-widest uppercase mt-1 text-white/60">
              ставка ${stake} · плечо{' '}
              {LEVERAGES.map((l) => (
                <span key={l} style={{ color: l === lev ? '#e9c46a' : '#ffffff55', fontWeight: l === lev ? 700 : 400 }}>×{l} </span>
              ))}
              <span className="text-white/25">×{LOCKED_LEV}🔒хром</span>
            </div>
          )}
          <div className="font-mono text-[9px] tracking-widest uppercase mt-1 text-white/35">
            скролл = плечо · отпусти Q в центре = отмена
          </div>
        </div>
        {half(-1)}
      </div>
    </div>
  );
};
