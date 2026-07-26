import { useEffect, useState } from 'react';
import { useStore } from '../store';

/**
 * V9 Б — КОНТУЗИЯ и ДОМИНАЦИЯ. Прострелили ноги — экран плывёт, ты ползёшь.
 * Добили — своей же камерой снизу смотришь на палача: «ДОМИНАЦИЯ», 3.5 секунды
 * унижения, потом подъём. Чистый DOM поверх сцены.
 */
export const DownedOverlay = () => {
  const crippledUntil = useStore((s) => s.crippledUntil);
  const downedUntil = useStore((s) => s.downedUntil);
  const armsUntil = useStore((s) => s.armsUntil);
  const [, force] = useState(0);

  const active = Date.now() < Math.max(crippledUntil, downedUntil, armsUntil);
  useEffect(() => {
    if (!active) return;
    const iv = setInterval(() => force((x) => x + 1), 100);
    return () => clearInterval(iv);
  }, [active]);

  const now = Date.now();
  const downed = downedUntil > now;
  const crippled = !downed && crippledUntil > now;
  const armsOut = !downed && armsUntil > now; // V9 К: руки прострелены
  if (!downed && !crippled && !armsOut) return null;

  const left = downed ? (downedUntil - now) / 3500 : (crippledUntil - now) / 4200;

  return (
    <div className="absolute inset-0 z-40 pointer-events-none">
      <div className="absolute inset-0" style={{
        background: downed
          ? 'radial-gradient(circle at center, rgba(120,0,20,0.25) 20%, rgba(40,0,8,0.92) 100%)'
          : crippled
            ? `radial-gradient(circle at center, rgba(255,45,85,0) 35%, rgba(160,10,35,${0.35 + left * 0.25}) 100%)`
            : 'radial-gradient(circle at center, rgba(255,140,20,0) 45%, rgba(150,70,10,0.28) 100%)',
        transition: 'background 120ms linear',
      }} />
      {armsOut && !crippled && (
        <div className="absolute inset-x-0 bottom-[38%] flex flex-col items-center">
          <div className="font-black text-2xl tracking-[0.35em] uppercase text-amber-300"
               style={{ textShadow: '0 0 22px rgba(255,160,45,0.8)', opacity: 0.55 + Math.sin(now * 0.01) * 0.25 }}>
            руки прострелены
          </div>
          <div className="font-mono text-[11px] uppercase tracking-widest text-white/50 mt-1">
            ствол гуляет · темп упал
          </div>
        </div>
      )}
      {crippled && (
        <div className="absolute inset-x-0 bottom-[38%] flex flex-col items-center">
          <div className="font-black text-2xl tracking-[0.35em] uppercase text-rose-300"
               style={{ textShadow: '0 0 22px rgba(255,45,85,0.8)', opacity: 0.55 + Math.sin(now * 0.01) * 0.25 }}>
            контужен
          </div>
          <div className="font-mono text-[11px] uppercase tracking-widest text-white/50 mt-1">
            ноги перебиты · ты ползёшь
          </div>
        </div>
      )}
      {downed && (
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="font-black text-7xl tracking-[0.25em] uppercase text-rose-400"
               style={{ textShadow: '0 0 50px rgba(255,45,85,0.9)', transform: `scale(${1 + (1 - left) * 0.08})` }}>
            ДОМИНАЦИЯ
          </div>
          <div className="font-mono text-sm uppercase tracking-[0.4em] text-white/60 mt-3">
            тебя добили · смотри
          </div>
          <div className="font-mono text-[11px] uppercase tracking-widest text-white/35 mt-6">
            подъём через {Math.max(0, (downedUntil - now) / 1000).toFixed(1)}с
          </div>
        </div>
      )}
    </div>
  );
};
