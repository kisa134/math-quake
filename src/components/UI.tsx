import { useStore } from '../store';
import { initAudio } from '../utils/audio';
import { initMultiplayer } from '../socket';
import { useState, useEffect } from 'react';
import type { CSSProperties } from 'react';
import { onHitmarker } from '../game/fx';

export const UI = () => {
  const { score, health, isPlaying, startGame, roomId, setRoomId, currentWeapon } = useStore();
  const [inputRoom, setInputRoom] = useState(roomId || 'global');

  const WEAPON_NAMES = ['AUTO RIFLE', 'SPREAD GUN', 'PLASMA LAUNCHER', 'RAILGUN'];
  const weaponName = WEAPON_NAMES[currentWeapon] || 'UNKNOWN';

  const handleStart = () => {
    initAudio();
    setRoomId(inputRoom);
    initMultiplayer(inputRoom);
    startGame();
  };

  return (
    <div className="absolute inset-0 pointer-events-none font-sans overflow-hidden flex flex-col text-white">
      {isPlaying ? (
        <>
          {/* Top HUD: Game Info */}
          <div className="relative z-10 flex justify-between p-8 items-start">
            <div className="flex flex-col">
              <span className="text-emerald-500 font-black text-xs tracking-[0.3em] uppercase mb-1">Room: {roomId}</span>
              <h1 className="text-5xl font-black italic tracking-tighter leading-none">KLEIN_04</h1>
              <div className="flex gap-4 mt-2">
                <span className="text-[10px] bg-emerald-500 text-black px-2 py-0.5 font-bold uppercase">Euclidean Drift: 0.003%</span>
                <span className="text-[10px] border border-white/30 px-2 py-0.5 font-bold uppercase">Rank: Topology Master</span>
              </div>
            </div>
            
            <div className="text-right">
              <span className="text-emerald-500 font-black text-xs tracking-[0.3em] uppercase mb-1">Uptime / Sync</span>
              <div className="text-4xl font-mono font-bold tabular-nums">12:44.<span className="text-xl opacity-50">02</span></div>
              <div className="text-[10px] opacity-40 uppercase tracking-widest mt-1">Fractal Sync Stable</div>
            </div>
          </div>

          {/* Center Crosshair & Targeter */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="relative w-24 h-24">
              <div className="absolute inset-0 border border-emerald-500/40 rounded-full scale-110"></div>
              <div className="absolute top-1/2 left-0 w-full h-[1px] bg-emerald-500"></div>
              <div className="absolute left-1/2 top-0 h-full w-[1px] bg-emerald-500"></div>
              <div className="absolute inset-4 border-2 border-emerald-500 rotate-45"></div>
              <div className="absolute -top-12 left-1/2 -translate-x-1/2 text-[10px] font-mono text-emerald-400">θ: 1.414</div>
              <div className="absolute -right-20 top-1/2 -translate-y-1/2 text-[10px] font-mono text-emerald-400">φ: 3.141</div>
            </div>
          </div>

          <Hitmarker />

          {/* Peripheral HUD Elements */}
          <div className="absolute top-1/2 left-8 -translate-y-1/2 flex flex-col gap-4 opacity-50">
            <div className="text-[10px] font-mono rotate-90 origin-left translate-x-4 mb-12">LATENCY: 12MS</div>
            <div className="w-1 h-24 bg-emerald-500/20 relative">
              <div className="absolute top-4 left-0 w-full h-8 bg-emerald-500"></div>
            </div>
          </div>

          <div className="absolute top-1/2 right-8 -translate-y-1/2 flex flex-col gap-4 items-end opacity-50">
            <div className="text-[10px] font-mono -rotate-90 origin-right -translate-x-4 mb-12 uppercase">Packet Gain</div>
            <div className="w-1 h-24 bg-emerald-500/20 relative">
              <div className="absolute bottom-2 left-0 w-full h-12 bg-emerald-500"></div>
            </div>
          </div>

          {/* Bottom Decorative Border */}
          <div className="absolute bottom-0 left-0 w-full h-1 bg-emerald-500/50"></div>

          {/* Bottom HUD: Status Bars */}
          <div className="mt-auto relative z-10 p-8 grid grid-cols-3 gap-12 items-end w-full">
            {/* Integrity / Health */}
            <div className="flex flex-col gap-2">
              <div className="flex justify-between items-end">
                <span className="text-[10px] font-bold uppercase tracking-widest opacity-60">Topology Integrity</span>
                <span className="text-6xl font-black tracking-tighter leading-none">{health}</span>
              </div>
              <div className="h-4 bg-emerald-950 border border-emerald-500/30 overflow-hidden relative">
                <div className="h-full bg-emerald-500 transition-all duration-300" style={{ width: `${health}%` }}></div>
                <div className="absolute inset-0 bg-white/10 w-1/2"></div>
              </div>
            </div>

            {/* Weapon / Tool */}
            <div className="flex flex-col items-center">
              <div className="w-full text-center">
                <div className="text-emerald-500 font-black text-xs tracking-[0.4em] uppercase mb-2">Projector Active</div>
                <div className="text-2xl font-black italic uppercase tracking-widest bg-white text-black py-1 px-4 mb-2">
                  {weaponName}
                </div>
                <div className="flex gap-1 justify-center">
                  <div className="text-xs text-emerald-400 font-mono">[1-4] SWITCH</div>
                </div>
              </div>
            </div>

            {/* Flux / Armor -> Score */}
            <div className="flex flex-col gap-2">
              <div className="flex justify-between items-end">
                <span className="text-6xl font-black tracking-tighter leading-none">{score}</span>
                <span className="text-[10px] font-bold uppercase tracking-widest opacity-60 text-right">Vector Flux</span>
              </div>
              <div className="h-4 bg-emerald-950 border border-emerald-500/30 overflow-hidden relative">
                <div className="h-full bg-emerald-400 transition-all duration-300" style={{ width: `${Math.min(100, score)}%` }}></div>
                <div className="absolute top-0 left-0 h-full w-[10%] bg-white/20"></div>
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center pointer-events-auto backdrop-blur-sm">
          
          {/* Start Screen Wireframe Art */}
          <div className="absolute inset-0 z-0 opacity-20 pointer-events-none overflow-hidden">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[600px] border-[1px] border-emerald-500/30 rounded-[50%] skew-x-12 rotate-45"></div>
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] border-[1px] border-emerald-500/20 rounded-[50%] -skew-x-12 -rotate-12"></div>
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[200px] border-[1px] border-emerald-400/10 rounded-[50%] skew-y-6"></div>
          </div>

          <div className="relative z-10 flex flex-col items-center">
            <div className="text-emerald-500 font-black text-xs tracking-[0.4em] uppercase mb-4">Geometric Survival</div>
            <h1 className="text-7xl font-black italic tracking-tighter text-white mb-2 uppercase drop-shadow-[0_0_15px_rgba(16,185,129,0.5)]">
              Math Quake
            </h1>
            <p className="text-emerald-500/80 mb-12 max-w-md text-center font-mono text-xs uppercase tracking-widest">
              WASD to Move &bull; Space to Jump &bull; Click to Discard Geometry
            </p>
            
            {score > 0 && (
              <div className="flex flex-col items-center gap-2 mb-12">
                <span className="text-[10px] font-bold uppercase tracking-widest opacity-60">Final Vector Flux</span>
                <div className="text-5xl font-black tracking-tighter text-emerald-400">{score}</div>
              </div>
            )}
            
            <div className="mb-8 pointer-events-auto">
              <input 
                type="text" 
                value={inputRoom} 
                onChange={(e) => setInputRoom(e.target.value)} 
                placeholder="Room Name"
                className="bg-black/50 border border-emerald-500/50 text-emerald-400 font-mono text-center px-4 py-2 outline-none focus:border-emerald-400 transition-colors uppercase tracking-widest"
              />
            </div>

            <button 
              onClick={handleStart}
              className="px-12 py-4 bg-emerald-500 text-black font-black text-xl hover:bg-white hover:text-black transition-colors uppercase tracking-[0.2em] cursor-pointer skew-x-[-10deg] pointer-events-auto"
            >
              <div className="skew-x-[10deg]">{score > 0 ? 'Reinitialize' : 'Initialize'}</div>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// Center hitmarker — a quick white X that pops on every landed shot.
const Hitmarker = () => {
  const [id, setId] = useState(0);
  useEffect(() => onHitmarker(() => setId((x) => x + 1)), []);
  if (!id) return null;
  return <HitmarkerFlash key={id} />;
};

const HitmarkerFlash = () => {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const r = requestAnimationFrame(() => setOn(true));
    return () => cancelAnimationFrame(r);
  }, []);
  const bar: CSSProperties = {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: 18,
    height: 3,
    marginLeft: -9,
    marginTop: -1.5,
    background: '#ffffff',
    borderRadius: 2,
    boxShadow: '0 0 6px rgba(255,255,255,0.9)',
    transition: 'opacity 200ms ease-out, transform 200ms ease-out',
    opacity: on ? 0 : 1,
  };
  return (
    <div className="absolute inset-0 pointer-events-none">
      <div style={{ ...bar, transform: `rotate(45deg) scale(${on ? 0.9 : 1.5})` }} />
      <div style={{ ...bar, transform: `rotate(-45deg) scale(${on ? 0.9 : 1.5})` }} />
    </div>
  );
};
