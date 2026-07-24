import { useStore } from '../store';
import { WEAPONS } from '../config/weapons';

/**
 * Bottom weapon-select strip — V2: five BIG slots, one per weapon. Each slot
 * shows the key number, the weapon name, and a fat tracer-colored bar; the
 * active slot glows in ITS OWN weapon color (not generic emerald) and lifts.
 * Pure DOM overlay (no per-frame cost) — reads currentWeapon from the store
 * and re-renders only on a swap. Switch with [1-5] or the mouse wheel.
 * pointer-events are off so it never eats clicks meant for the canvas.
 */
export const WeaponHUD = () => {
  const currentWeapon = useStore((s) => s.currentWeapon);

  return (
    <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
      <div className="flex gap-2 px-3 py-2 bg-black/50 backdrop-blur-sm border border-white/10 rounded-sm">
        {WEAPONS.map((w, i) => {
          const active = i === currentWeapon;
          const hex = '#' + w.tracer.toString(16).padStart(6, '0');
          return (
            <div
              key={i}
              className={
                'flex flex-col gap-1 px-4 py-2 rounded-sm border transition-all duration-150 min-w-[120px] ' +
                (active ? '-translate-y-1.5 bg-white/[0.07]' : 'bg-white/[0.02] border-white/10')
              }
              style={
                active
                  ? { borderColor: hex, boxShadow: `0 0 16px ${hex}80, inset 0 0 12px ${hex}22` }
                  : undefined
              }
            >
              <div className="flex items-center gap-2">
                <span
                  className="font-mono font-bold text-sm tabular-nums"
                  style={{ color: active ? hex : 'rgba(255,255,255,0.35)' }}
                >
                  {i + 1}
                </span>
                <span
                  className={
                    'text-[11px] font-black uppercase tracking-wider whitespace-nowrap ' +
                    (active ? 'text-white' : 'text-white/45')
                  }
                >
                  {w.name}
                </span>
              </div>
              <span
                className="h-1 w-full rounded-full"
                style={{
                  background: hex,
                  boxShadow: active ? `0 0 8px ${hex}` : 'none',
                  opacity: active ? 1 : 0.35,
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};
