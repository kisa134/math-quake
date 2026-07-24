import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { marketNow, posPnl, marginHealth } from '../game/market';

/**
 * V7 W1 — the position strip + margin-call vignette (docs/WOLF_ARC.md §7.1).
 * Invisible until your first trade (economy of attention). While a position
 * is open: side badge, live PnL ticking every 100ms (the wobbles make it
 * breathe), and a margin-health bar that starts pulsing near liquidation.
 * After close: a 2.6s toast — golden profit / crimson loss / † МАРЖИН-КОЛЛ.
 */
export const MarketStrip = () => {
  const position = useStore((s) => s.position);
  const lastTrade = useStore((s) => s.lastTrade);
  const lastLiq = useStore((s) => s.lastLiq);
  const [, force] = useState(0);

  const active = !!position || Date.now() - lastTrade.t < 2600 || Date.now() - lastLiq < 800;
  useEffect(() => {
    if (!active) return;
    const iv = setInterval(() => force((x) => x + 1), 100);
    return () => clearInterval(iv);
  }, [active]);

  if (!active) return null;

  const now = Date.now();
  const liqAge = now - lastLiq;

  // margin-call vignette: hard crimson flash fading over 0.7s
  const vignette = liqAge < 700 && (
    <div className="absolute inset-0 pointer-events-none z-30"
         style={{
           background: 'radial-gradient(circle at center, rgba(255,45,85,0) 30%, rgba(255,45,85,0.55) 100%)',
           opacity: 1 - liqAge / 700,
         }} />
  );

  let body = null;
  if (position) {
    const price = marketNow.price;
    const pnl = posPnl(position, price);
    const mh = marginHealth(position, price);
    const danger = mh < 0.3;
    const sideColor = position.side === 1 ? '#2fbf71' : '#ff2d55';
    body = (
      <div className="flex flex-col items-center gap-1 bg-black/70 border px-4 py-2"
           style={{ borderColor: danger ? '#ff2d55' : 'rgba(255,255,255,0.2)', animation: danger ? 'mkt-pulse 0.55s infinite' : 'none' }}>
        <div className="flex items-baseline gap-3 font-mono tabular-nums">
          <span className="font-black text-xs tracking-widest" style={{ color: sideColor }}>
            {position.side === 1 ? '▲ LONG' : '▼ SHORT'} ×{position.lev}
          </span>
          <span className="text-[11px] text-white/50">${position.entry.toFixed(2)} → ${price.toFixed(2)}</span>
          <span className="font-bold text-lg" style={{ color: pnl >= 0 ? '#e9c46a' : '#ff2d55' }}>
            {pnl >= 0 ? '+' : '−'}${Math.abs(Math.round(pnl))}
          </span>
          <span className="text-[9px] uppercase tracking-widest text-white/40">Q = закрыть</span>
        </div>
        <div className="w-full h-1 bg-black/60 border border-white/10 overflow-hidden">
          <div className="h-full" style={{
            width: `${mh * 100}%`,
            background: danger ? '#ff2d55' : sideColor,
            transition: 'width 100ms linear',
          }} />
        </div>
      </div>
    );
  } else if (now - lastTrade.t < 2600 && lastTrade.amount !== 0) {
    const isLiq = Math.abs(lastTrade.t - lastLiq) < 150;
    const win = lastTrade.amount > 0;
    body = (
      <div className="font-mono font-black text-xl tracking-widest px-5 py-2 bg-black/70 border"
           style={{
             color: isLiq ? '#ff2d55' : win ? '#e9c46a' : '#ff7b00',
             borderColor: isLiq ? '#ff2d55' : 'rgba(255,255,255,0.2)',
             textShadow: `0 0 14px ${isLiq ? '#ff2d55' : win ? '#e9c46a' : '#ff7b00'}`,
           }}>
        {isLiq ? `† МАРЖИН-КОЛЛ −$${Math.abs(lastTrade.amount)}` : `${win ? '+' : '−'}$${Math.abs(lastTrade.amount)} ЗАКРЫТО`}
      </div>
    );
  }

  return (
    <>
      {vignette}
      <div className="absolute left-1/2 -translate-x-1/2 bottom-[26%] pointer-events-none z-20 flex justify-center">
        {body}
      </div>
      <style>{`@keyframes mkt-pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(255,45,85,0); } 50% { box-shadow: 0 0 22px 2px rgba(255,45,85,0.6); } }`}</style>
    </>
  );
};
