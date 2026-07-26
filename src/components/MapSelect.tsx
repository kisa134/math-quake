import { MAPS, setMapInUrl, type MapId } from '../config/maps';

/**
 * КВЕЙК-АРЕНЫ — the map picker, shown once before the world boots (only when
 * the URL carries no ?map=). Click a card → the map id is written into the
 * URL (?map=) and the world mounts. A friend opening YOUR link (with ?map=)
 * skips this screen and lands straight in your world — карта вшита в комнату,
 * перепутать невозможно.
 */
export const MapSelect = ({ onPick }: { onPick: (id: MapId) => void }) => (
  <div className="absolute inset-0 z-50 pointer-events-auto flex items-center justify-center"
       style={{ background: 'radial-gradient(circle at center, rgba(8,7,5,0.94), #000)' }}>
    <div className="max-w-4xl w-full p-8">
      <div className="text-amber-200 font-black text-xs tracking-[0.5em] uppercase mb-2 text-center">Math Quake</div>
      <div className="text-white font-black text-4xl uppercase tracking-widest mb-8 text-center">Выбери карту</div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {MAPS.map((m) => (
          <div
            key={m.id}
            onClick={() => onPick(m.id)}
            className="border bg-black/60 p-5 cursor-pointer transition-all duration-100 hover:-translate-y-1"
            style={{ borderColor: `${m.color}55` }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = m.color; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = `${m.color}55`; }}
          >
            <div className="font-black text-lg uppercase tracking-wider mb-1" style={{ color: m.color }}>{m.name}</div>
            <div className="font-mono text-[11px] text-white/55 leading-relaxed">{m.desc}</div>
            {m.id === 'donut' && (
              <div className="font-mono text-[10px] text-amber-300/70 mt-2 uppercase tracking-widest">полный мир</div>
            )}
            {m.id !== 'donut' && (
              <div className="font-mono text-[10px] text-white/35 mt-2 uppercase tracking-widest">арена · лёгкая · дуэль</div>
            )}
          </div>
        ))}
      </div>
      <div className="font-mono text-[11px] text-white/40 mt-6 text-center uppercase tracking-widest">
        другу — просто ссылку из адресной строки: карта уже в ней
      </div>
    </div>
  </div>
);

export { setMapInUrl };
