import { useStore } from '../store';
import { WEAPONS } from '../config/weapons';

/**
 * Bottom weapon-select strip. Shows every weapon in the arsenal as a numbered
 * chip; the active one glows emerald and lifts. Pure DOM overlay (no per-frame
 * cost) — reads currentWeapon from the store and re-renders only on a swap.
 * Switch with [1-9], the mouse wheel, or by reading this strip. pointer-events
 * are off so it never eats clicks meant for the canvas.
 */
export const WeaponHUD = () => {
  const currentWeapon = useStore((s) => s.currentWeapon);

  return (
    <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
      <div className="flex gap-1 px-2 py-1.5 bg-black/40 backdrop-blur-sm border border-emerald-500/20 rounded-sm max-w-[96vw] flex-wrap justify-center">
        {WEAPONS.map((w, i) => {
          const active = i === currentWeapon;
          const hex = '#' + w.tracer.toString(16).padStart(6, '0');
          return (
            <div
              key={i}
              className={
                'flex items-center gap-1 px-2 py-1 rounded-sm border transition-all duration-150 ' +
                (active
                  ? 'bg-emerald-500/20 border-emerald-400 -translate-y-1 shadow-[0_0_10px_rgba(16,185,129,0.6)]'
                  : 'bg-white/[0.03] border-white/10')
              }
            >
              <span
                className={
                  'font-mono font-bold text-[10px] tabular-nums ' +
                  (active ? 'text-emerald-300' : 'text-white/40')
                }
              >
                {i + 1}
              </span>
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{
                  background: hex,
                  boxShadow: active ? `0 0 6px ${hex}` : 'none',
                  opacity: active ? 1 : 0.5,
                }}
              />
              <span
                className={
                  'text-[9px] font-black uppercase tracking-wider whitespace-nowrap ' +
                  (active ? 'text-white' : 'text-white/45')
                }
              >
                {w.name}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
