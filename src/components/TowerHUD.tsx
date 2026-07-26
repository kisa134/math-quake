import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { heightState, buildCost } from '../game/builtProps';

/**
 * МАТЕМАТИЧЕСКАЯ БАШНЯ HUD — высота, рекорд и цена следующей свечи.
 * Дудл-джамп: единственная цель — выше. DOM, 5Гц.
 */
export const TowerHUD = () => {
  const [, force] = useState(0);
  const editorSelect = useStore((s) => s.editorSelect);
  const editorScale = useStore((s) => s.editorScale);
  const money = useStore((s) => s.money);
  const editorMode = useStore((s) => s.editorMode);

  useEffect(() => {
    const iv = setInterval(() => force((x) => x + 1), 200);
    return () => clearInterval(iv);
  }, []);

  const h = Math.max(0, Math.round(heightState.now));
  const best = Math.max(0, Math.round(heightState.best));
  const cost = buildCost(editorSelect, editorScale);
  const canAfford = money >= cost;

  return (
    <div className="absolute left-1/2 -translate-x-1/2 top-16 z-20 pointer-events-none flex flex-col items-center">
      <div className="font-mono text-[10px] tracking-[0.35em] uppercase text-white/40">высота</div>
      <div className="font-black text-5xl tabular-nums leading-none"
           style={{ color: 'var(--accent, #c8b273)', textShadow: '0 0 24px rgba(200,178,115,0.55)' }}>
        {h}
      </div>
      <div className="font-mono text-[11px] tracking-widest uppercase text-white/45 mt-1">
        рекорд {best}
      </div>
      {editorMode && (
        <div className="font-mono text-[11px] tracking-widest uppercase mt-2 px-3 py-1 border"
             style={{ color: canAfford ? '#2fbf71' : '#ff2d55', borderColor: canAfford ? '#2fbf7166' : '#ff2d5566' }}>
          свеча ${cost} {canAfford ? '· ЛКМ ставить' : '· не хватает денег'}
        </div>
      )}
    </div>
  );
};
