import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { SPELLS } from '../config/spells';

/**
 * Radial spell wheel (WS-3). Hold E → this fades in; the highlighted wedge
 * follows the mouse (works under pointer-lock via movementX/Y, so it never
 * needs the cursor unlocked). Release E commits the highlight. Number keys or a
 * click also pick a wedge directly.
 *
 * DOM/SVG only — zero 3D cost. Mounted by UI.tsx over the HUD.
 */
const N = SPELLS.length;
const R_OUT = 190;   // outer radius (px)
const R_IN = 78;     // inner hole radius (px)
const R_LBL = 138;   // label ring radius
const GAP = 0.045;   // radians of gap between wedges

// Annular-sector path for wedge i, centered so the FIRST wedge points straight up.
const wedgePath = (i: number): string => {
  const step = (Math.PI * 2) / N;
  const a0 = -Math.PI / 2 + i * step - step / 2 + GAP;
  const a1 = -Math.PI / 2 + i * step + step / 2 - GAP;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const x = (r: number, a: number) => (r * Math.cos(a)).toFixed(2);
  const y = (r: number, a: number) => (r * Math.sin(a)).toFixed(2);
  return [
    `M ${x(R_IN, a0)} ${y(R_IN, a0)}`,
    `L ${x(R_OUT, a0)} ${y(R_OUT, a0)}`,
    `A ${R_OUT} ${R_OUT} 0 ${large} 1 ${x(R_OUT, a1)} ${y(R_OUT, a1)}`,
    `L ${x(R_IN, a1)} ${y(R_IN, a1)}`,
    `A ${R_IN} ${R_IN} 0 ${large} 0 ${x(R_IN, a0)} ${y(R_IN, a0)}`,
    'Z',
  ].join(' ');
};

// Unit angle at the center of wedge i (screen space, +x right, +y down).
const wedgeAngle = (i: number): number => -Math.PI / 2 + i * ((Math.PI * 2) / N);

export const SpellWheel = () => {
  const open = useStore((s) => s.spellWheelOpen);
  const selectedSpell = useStore((s) => s.selectedSpell);
  const setSelectedSpell = useStore((s) => s.setSelectedSpell);
  const setSpellWheel = useStore((s) => s.setSpellWheel);

  const [hover, setHover] = useState(0);
  const hoverRef = useRef(0);
  const dir = useRef({ x: 0, y: -1 }); // aim vector, starts pointing up
  const wasOpen = useRef(false);

  const commit = (i: number, close: boolean) => {
    setSelectedSpell(SPELLS[i].id);
    if (close) setSpellWheel(false);
  };

  // On open: seed the highlight from the current selection.
  useEffect(() => {
    if (open && !wasOpen.current) {
      const idx = Math.max(0, SPELLS.findIndex((s) => s.id === selectedSpell));
      hoverRef.current = idx;
      setHover(idx);
      const a = wedgeAngle(idx);
      dir.current = { x: Math.cos(a), y: Math.sin(a) };
    }
    // On release (open → closed): commit whatever is highlighted.
    if (!open && wasOpen.current) {
      commit(hoverRef.current, false);
    }
    wasOpen.current = open;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Mouse + keyboard selection while open. movementX/Y works under pointer lock.
  useEffect(() => {
    if (!open) return;
    const pickFromDir = () => {
      const ang = Math.atan2(dir.current.y, dir.current.x); // -PI..PI, up = -PI/2
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < N; i++) {
        let d = Math.abs(((ang - wedgeAngle(i) + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        if (d < bestD) { bestD = d; best = i; }
      }
      if (best !== hoverRef.current) { hoverRef.current = best; setHover(best); }
    };
    const onMove = (e: MouseEvent) => {
      // Accumulate deltas into an aim vector (lock-agnostic), clamp its length.
      dir.current.x += e.movementX * 0.06;
      dir.current.y += e.movementY * 0.06;
      const len = Math.hypot(dir.current.x, dir.current.y) || 1;
      dir.current.x /= len; dir.current.y /= len;
      pickFromDir();
    };
    const onKey = (e: KeyboardEvent) => {
      const m = e.code.match(/^Digit([1-9])$/);
      if (m) {
        const i = +m[1] - 1;
        if (i < N) { e.preventDefault(); e.stopPropagation(); hoverRef.current = i; setHover(i); commit(i, true); }
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('keydown', onKey, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const hovered = SPELLS[hover];

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center pointer-events-none select-none"
         style={{ background: 'radial-gradient(circle at center, rgba(0,0,0,0.35), rgba(0,0,0,0.72))' }}>
      <div className="relative pointer-events-auto" style={{ width: R_OUT * 2, height: R_OUT * 2 }}>
        <svg viewBox={`${-R_OUT} ${-R_OUT} ${R_OUT * 2} ${R_OUT * 2}`} width={R_OUT * 2} height={R_OUT * 2}
             style={{ filter: 'drop-shadow(0 0 24px rgba(0,0,0,0.6))' }}>
          <defs>
            {SPELLS.map((s) => (
              <radialGradient key={s.id} id={`sw-${s.id}`} cx="50%" cy="50%" r="75%">
                <stop offset="0%" stopColor={s.color} stopOpacity="0.35" />
                <stop offset="100%" stopColor={s.color} stopOpacity="0.9" />
              </radialGradient>
            ))}
          </defs>
          {SPELLS.map((s, i) => {
            const active = i === hover;
            return (
              <path
                key={s.id}
                d={wedgePath(i)}
                fill={`url(#sw-${s.id})`}
                stroke={s.color}
                strokeWidth={active ? 4 : 1.5}
                style={{
                  opacity: active ? 1 : 0.55,
                  filter: active ? `drop-shadow(0 0 16px ${s.color})` : 'none',
                  transform: active ? 'scale(1.04)' : 'scale(1)',
                  transformOrigin: 'center',
                  transition: 'opacity 90ms, stroke-width 90ms, transform 120ms',
                  cursor: 'pointer',
                }}
                onMouseEnter={() => { hoverRef.current = i; setHover(i); }}
                onClick={() => commit(i, true)}
              />
            );
          })}
          {/* labels + hotkey numbers */}
          {SPELLS.map((s, i) => {
            const a = wedgeAngle(i);
            const lx = R_LBL * Math.cos(a);
            const ly = R_LBL * Math.sin(a);
            const active = i === hover;
            return (
              <g key={s.id} style={{ pointerEvents: 'none' }}>
                <text x={lx} y={ly - 5} textAnchor="middle" dominantBaseline="middle"
                      style={{ fontFamily: 'monospace', fontWeight: 900, fontSize: 13,
                               fill: active ? '#fff' : '#e6e6e6', letterSpacing: 1,
                               textShadow: '0 0 6px #000' }}>{s.label}</text>
                <text x={lx} y={ly + 11} textAnchor="middle" dominantBaseline="middle"
                      style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 10,
                               fill: s.color, opacity: 0.9 }}>{i + 1}</text>
              </g>
            );
          })}
        </svg>
        {/* center readout */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <div className="text-[9px] font-mono tracking-[0.4em] uppercase" style={{ color: hovered.color, opacity: 0.85 }}>Cast</div>
          <div className="text-2xl font-black italic uppercase tracking-tight leading-none"
               style={{ color: '#fff', textShadow: `0 0 14px ${hovered.color}` }}>{hovered.label}</div>
          <div className="text-[9px] font-mono tracking-widest uppercase mt-1 text-white/50">{hovered.damage} dmg · release E</div>
        </div>
      </div>
    </div>
  );
};
