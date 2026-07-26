import { useEffect, useState } from 'react';
import { ABILITIES, loadout, isBinding } from '../game/loadout';

/**
 * ЛОАДАУТ-HUD — снизу всегда видно, что на ЛКМ и что на ПКМ. Крутанул колесо —
 * всплывает карусель: подсвеченная способность и подсказка «кликни ту кнопку,
 * на которую вешаешь». Клик по ЛКМ/ПКМ в этот момент привязывает, а не стреляет.
 */
export const LoadoutHUD = () => {
  const [, force] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => force((x) => x + 1), 90);
    return () => clearInterval(iv);
  }, []);

  const L = ABILITIES[loadout.left] ?? ABILITIES[0];
  const R = ABILITIES[loadout.right] ?? ABILITIES[0];
  const binding = isBinding();
  const hi = ABILITIES[loadout.hi] ?? ABILITIES[0];
  const n = ABILITIES.length;
  const ring = [-2, -1, 0, 1, 2].map((d) => ABILITIES[(loadout.hi + d + n) % n]);

  return (
    <>
      {/* постоянные бинды */}
      <div className="absolute bottom-28 left-1/2 -translate-x-1/2 z-20 pointer-events-none flex gap-3 font-mono text-[11px] uppercase tracking-widest">
        <div className="px-3 py-1 border bg-black/50" style={{ borderColor: `${L.color}77`, color: L.color }}>
          ЛКМ · {L.label}
        </div>
        <div className="px-3 py-1 border bg-black/50" style={{ borderColor: `${R.color}77`, color: R.color }}>
          ПКМ · {R.label}
        </div>
      </div>

      {/* карусель выбора (пока крутишь колесо) */}
      {binding && (
        <div className="absolute inset-x-0 bottom-44 z-30 pointer-events-none flex flex-col items-center">
          <div className="flex items-center gap-2 mb-2">
            {ring.map((a, i) => {
              const mid = i === 2;
              return (
                <div key={a.id + i}
                     className={`px-3 py-2 border font-mono uppercase tracking-wider ${mid ? 'text-base font-black' : 'text-[10px] opacity-50'}`}
                     style={{
                       borderColor: mid ? a.color : `${a.color}44`,
                       color: a.color,
                       background: mid ? 'rgba(0,0,0,0.75)' : 'rgba(0,0,0,0.4)',
                       boxShadow: mid ? `0 0 22px ${a.color}55` : 'none',
                       transform: mid ? 'scale(1.06)' : 'none',
                     }}>
                  {a.label}
                </div>
              );
            })}
          </div>
          <div className="font-mono text-[12px] uppercase tracking-[0.25em] px-4 py-1.5 bg-black/70 border border-white/25 text-white">
            кликни <span style={{ color: hi.color }}>ЛКМ</span> или <span style={{ color: hi.color }}>ПКМ</span> — повесить «{hi.label}»
          </div>
        </div>
      )}
    </>
  );
};
