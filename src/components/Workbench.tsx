import { useStore } from '../store';
import { WEAPONS } from '../config/weapons';
import { MODS, MOD_BY_ID, SOCKETS, SOCKET_RU } from '../config/weaponMods';

/**
 * V8 Ф3 — THE WORKBENCH (МАСТЕРСКАЯ). Press N: four socket rows for the
 * current weapon; digits 1-4 cycle each socket's module (none → … → none).
 * Blueprints persist per weapon in localStorage. Pure DOM, keyboard-only —
 * works under pointer lock (Player owns the keys, this is display).
 */
export const Workbench = () => {
  const open = useStore((s) => s.workbenchOpen);
  const weapon = useStore((s) => s.currentWeapon);
  const mods = useStore((s) => s.weaponMods[weapon]);

  if (!open) return null;
  const spec = WEAPONS[weapon] ?? WEAPONS[0];
  const hex = '#' + spec.tracer.toString(16).padStart(6, '0');

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none"
         style={{ background: 'radial-gradient(circle at center, rgba(0,0,0,0.4), rgba(0,0,0,0.78))' }}>
      <div className="bg-black/85 border backdrop-blur-md p-6 min-w-[520px]" style={{ borderColor: `${hex}66` }}>
        <div className="flex justify-between items-baseline mb-1">
          <div className="font-black text-sm tracking-[0.3em] uppercase" style={{ color: hex }}>Мастерская</div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-white/40">N — закрыть</div>
        </div>
        <div className="font-black text-2xl uppercase tracking-tight text-white mb-4">{spec.name}</div>
        <div className="flex flex-col gap-1.5">
          {SOCKETS.map((sock, i) => {
            const id = mods?.[sock];
            const m = id ? MOD_BY_ID[id] : undefined;
            const options = MODS.filter((x) => x.socket === sock).length;
            return (
              <div key={sock} className="flex items-center gap-3 px-3 py-2 border font-mono text-sm"
                   style={{ borderColor: m ? `${m.color}88` : 'rgba(255,255,255,0.15)' }}>
                <span className="font-bold text-white/50 w-6">[{i + 1}]</span>
                <span className="text-[10px] tracking-[0.25em] uppercase text-white/45 w-24">{SOCKET_RU[sock]}</span>
                {m ? (
                  <>
                    <span className="font-bold" style={{ color: m.color }}>{m.label}</span>
                    <span className="text-[11px] text-white/55 ml-auto">{m.desc}</span>
                  </>
                ) : (
                  <span className="text-white/30">— пусто ({options} модуля)</span>
                )}
              </div>
            );
          })}
        </div>
        <div className="font-mono text-[10px] uppercase tracking-widest text-white/40 mt-4 text-center">
          1-4 — крутить слот · чертёж сохраняется сам · обвес виден на стволе
        </div>
      </div>
    </div>
  );
};
