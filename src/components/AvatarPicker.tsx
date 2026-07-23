import { useState } from 'react';
import { useStore } from '../store';
import { ASSETS } from '../config/assets';

/**
 * Start-screen figure picker (WS-5). Lets the player choose the third-person
 * avatar they'll SEE (and that remotes see for them). The 4 Meshy creatures are
 * the avatar roster. DOM overlay (Tailwind, matches UI.tsx). Pinned to the right
 * edge so it never fights the centered "click to play" overlay; starts open and
 * collapses to a small "CHANGE FIGURE" pill after a pick. pointer-events-auto is
 * scoped to the panel only, so the rest of the HUD stays click-through.
 */

// The creatures are the pickable figures; a tinted tile per id so the card reads
// even before the model streams in.
const AVATARS = ASSETS.filter((a) => a.category === 'creature');

const TINT: Record<string, string> = {
  skull: '#e8e8f0',
  bomber: '#f7931a',
  zombie: '#f72585',
  throne: '#7209b7',
};

export const AvatarPicker = () => {
  const avatarId = useStore((s) => s.avatarId);
  const setAvatar = useStore((s) => s.setAvatar);
  const [open, setOpen] = useState(true);

  if (!open) {
    return (
      <div className="absolute right-6 top-1/2 -translate-y-1/2 z-40 pointer-events-auto">
        <button
          onClick={() => setOpen(true)}
          className="bg-black/70 border border-emerald-500/40 text-emerald-300 font-black text-[10px] tracking-[0.3em] uppercase px-3 py-2 hover:bg-emerald-500 hover:text-black transition-colors"
        >
          ▸ Change Figure
        </button>
      </div>
    );
  }

  return (
    <div className="absolute right-6 top-1/2 -translate-y-1/2 z-40 pointer-events-auto">
      <div className="bg-black/75 backdrop-blur-sm border border-emerald-500/30 p-4 w-52">
        <div className="flex items-center justify-between mb-3">
          <span className="text-emerald-400 font-black text-[10px] tracking-[0.3em] uppercase">
            Choose Figure
          </span>
          <button
            onClick={() => setOpen(false)}
            className="text-white/50 hover:text-white text-xs font-bold px-1"
            aria-label="Collapse figure picker"
          >
            ×
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {AVATARS.map((a) => {
            const selected = a.id === avatarId;
            const tint = TINT[a.id] ?? '#00f5d4';
            return (
              <button
                key={a.id}
                onClick={() => setAvatar(a.id)}
                className={`flex flex-col items-center gap-1.5 p-2 border transition-colors ${
                  selected
                    ? 'border-emerald-400 bg-emerald-500/15'
                    : 'border-white/10 hover:border-white/40 bg-white/5'
                }`}
              >
                <span
                  className="w-full h-12 border border-black/40"
                  style={{
                    background: `radial-gradient(circle at 50% 35%, ${tint}, ${tint}22 70%, transparent)`,
                    boxShadow: selected ? `0 0 12px ${tint}` : 'none',
                  }}
                />
                <span
                  className={`text-[8px] font-black uppercase tracking-wider text-center leading-tight ${
                    selected ? 'text-emerald-300' : 'text-white/70'
                  }`}
                >
                  {a.label}
                </span>
              </button>
            );
          })}
        </div>

        <div className="text-[8px] font-mono text-white/40 uppercase tracking-widest mt-3 text-center">
          Press V in game to see yourself
        </div>
      </div>
    </div>
  );
};
