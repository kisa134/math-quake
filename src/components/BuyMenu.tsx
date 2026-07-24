import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { WEAPONS } from '../config/weapons';
import { WEAPON_PRICES } from '../config/economy';

/**
 * CS-style buy menu (V2.2). Opens with P (and auto-opens each BUY phase).
 * Digit 1-5 buys (or equips if owned) — keyboard-only, so it works under
 * pointer lock. Player.tsx owns the key handling; this is pure display.
 */
export const BuyMenu = () => {
  const open = useStore((s) => s.buyMenuOpen);
  const money = useStore((s) => s.money);
  const owned = useStore((s) => s.ownedWeapons);
  const current = useStore((s) => s.currentWeapon);
  const round = useStore((s) => s.round);
  const setBuyMenu = useStore((s) => s.setBuyMenu);

  // Auto-open on BUY phase, auto-close when the wave starts.
  useEffect(() => {
    setBuyMenu(round.phase === 'buy' && round.num > 0);
  }, [round.phase, round.num, setBuyMenu]);

  // Countdown re-render during the buy phase.
  const [, force] = useState(0);
  useEffect(() => {
    if (!open || round.phase !== 'buy') return;
    const iv = setInterval(() => force((x) => x + 1), 500);
    return () => clearInterval(iv);
  }, [open, round.phase]);

  if (!open) return null;
  const secsLeft = round.phase === 'buy' ? Math.max(0, Math.ceil((round.until - Date.now()) / 1000)) : 0;

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
      <div className="bg-black/80 border border-emerald-500/40 backdrop-blur-md p-6 min-w-[420px]">
        <div className="flex justify-between items-baseline mb-4">
          <div className="text-emerald-400 font-black text-sm tracking-[0.3em] uppercase">Buy Menu</div>
          <div className="text-2xl font-mono font-bold text-emerald-300">${money}</div>
        </div>
        {round.phase === 'buy' && (
          <div className="text-[11px] font-mono text-amber-300 mb-3 uppercase tracking-widest">
            Round {round.num} — wave in {secsLeft}s
          </div>
        )}
        <div className="flex flex-col gap-1">
          {WEAPONS.map((w, i) => {
            const price = WEAPON_PRICES[i] ?? 0;
            const isOwned = owned[i];
            const affordable = money >= price;
            return (
              <div
                key={w.name}
                className={`flex justify-between items-center px-3 py-2 border font-mono text-sm ${
                  i === current
                    ? 'border-emerald-400 bg-emerald-500/15 text-emerald-200'
                    : isOwned
                      ? 'border-white/25 text-white/85'
                      : affordable
                        ? 'border-amber-400/50 text-amber-200'
                        : 'border-white/10 text-white/30'
                }`}
              >
                <span className="font-bold">[{i + 1}] {w.name}</span>
                <span>{isOwned ? (i === current ? 'EQUIPPED' : 'OWNED') : price === 0 ? 'FREE' : `$${price}`}</span>
              </div>
            );
          })}
        </div>
        <div className="text-[10px] font-mono text-white/50 mt-4 uppercase tracking-widest text-center">
          1-8 buy / equip · P close · money = damage dealt + round wins
        </div>
      </div>
    </div>
  );
};
