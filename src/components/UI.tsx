import { useStore } from '../store';
import { initAudio } from '../utils/audio';
import { initMultiplayer } from '../socket';
import { useState, useEffect } from 'react';
import type { CSSProperties } from 'react';
import { onHitmarker } from '../game/fx';

export const UI = () => {
  const { score, health, isPlaying, roomId, setRoomId, startGame, currentWeapon, jetpackFuel, editorMode, editorSelect } = useStore();
  const [locked, setLocked] = useState(false);

  const WEAPON_NAMES = ['AUTO RIFLE', 'SPREAD GUN', 'PLASMA LAUNCHER', 'RAILGUN'];
  const weaponName = WEAPON_NAMES[currentWeapon] || 'UNKNOWN';
  const PROP_NAMES: Record<string, string> = { pad: 'JUMP PAD', candle: 'CANDLE', atm: 'ATM' };

  // Auto-enter (no menu). Room from ?room= (default 'arena'); a friend on the
  // same link + same room joins your match.
  useEffect(() => {
    const room = new URLSearchParams(window.location.search).get('room') || 'arena';
    setRoomId(room);
    initMultiplayer(room);
    startGame();
  }, [setRoomId, startGame]);

  // Track pointer lock → click-to-play overlay (losing lock never ejects).
  useEffect(() => {
    const h = () => setLocked(!!document.pointerLockElement);
    document.addEventListener('pointerlockchange', h);
    return () => document.removeEventListener('pointerlockchange', h);
  }, []);

  const grabLock = () => {
    initAudio();
    (document.querySelector('canvas') as HTMLCanvasElement | null)?.requestPointerLock();
  };

  return (
    <div className="absolute inset-0 pointer-events-none font-sans overflow-hidden flex flex-col text-white">
      {isPlaying && (
        <>
          {/* Top HUD */}
          <div className="relative z-10 flex justify-between p-8 items-start">
            <div className="flex flex-col">
              <span className="text-emerald-500 font-black text-xs tracking-[0.3em] uppercase mb-1">Room: {roomId}</span>
              <h1 className="text-5xl font-black italic tracking-tighter leading-none">KLEIN_04</h1>
              <div className="flex gap-4 mt-2">
                <span className="text-[10px] bg-amber-400 text-black px-2 py-0.5 font-bold uppercase">GOD MODE</span>
                <span className="text-[10px] border border-white/30 px-2 py-0.5 font-bold uppercase">B — BUILD</span>
              </div>
            </div>
            <div className="text-right">
              <span className="text-emerald-500 font-black text-xs tracking-[0.3em] uppercase mb-1">Uptime / Sync</span>
              <div className="text-4xl font-mono font-bold tabular-nums">12:44.<span className="text-xl opacity-50">02</span></div>
              <div className="text-[10px] opacity-40 uppercase tracking-widest mt-1">Fractal Sync Stable</div>
            </div>
          </div>

          {/* Crosshair */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="relative w-24 h-24">
              <div className="absolute inset-0 border border-emerald-500/40 rounded-full scale-110"></div>
              <div className="absolute top-1/2 left-0 w-full h-[1px] bg-emerald-500"></div>
              <div className="absolute left-1/2 top-0 h-full w-[1px] bg-emerald-500"></div>
              <div className="absolute inset-4 border-2 border-emerald-500 rotate-45"></div>
            </div>
          </div>

          <Hitmarker />

          {/* Jetpack fuel */}
          <div className="absolute left-1/2 -translate-x-1/2 top-[60%] w-44 pointer-events-none">
            <div className="text-[9px] font-mono tracking-[0.3em] text-cyan-300/70 mb-1 text-center uppercase">Jet Fuel · 2×Space</div>
            <div className="h-2 bg-cyan-950/60 border border-cyan-500/30 overflow-hidden">
              <div className="h-full" style={{ width: `${jetpackFuel}%`, background: jetpackFuel < 25 ? '#ff2d2d' : '#00f5d4', transition: 'width 90ms linear' }} />
            </div>
          </div>

          {/* Bottom HUD */}
          <div className="mt-auto relative z-10 p-8 grid grid-cols-3 gap-12 items-end w-full">
            <div className="flex flex-col gap-2">
              <div className="flex justify-between items-end">
                <span className="text-[10px] font-bold uppercase tracking-widest opacity-60">Topology Integrity</span>
                <span className="text-6xl font-black tracking-tighter leading-none">{health}</span>
              </div>
              <div className="h-4 bg-emerald-950 border border-emerald-500/30 overflow-hidden relative">
                <div className="h-full bg-emerald-500 transition-all duration-300" style={{ width: `${health}%` }}></div>
              </div>
            </div>

            <div className="flex flex-col items-center">
              <div className="w-full text-center">
                <div className="text-emerald-500 font-black text-xs tracking-[0.4em] uppercase mb-2">{editorMode ? 'Build Mode' : 'Projector Active'}</div>
                <div className="text-2xl font-black italic uppercase tracking-widest bg-white text-black py-1 px-4 mb-2">
                  {editorMode ? PROP_NAMES[editorSelect] : weaponName}
                </div>
                <div className="text-xs text-emerald-400 font-mono">{editorMode ? '[1-3] PROP · LMB PLACE · RMB DELETE' : '[1-4] WEAPON · [B] BUILD'}</div>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex justify-between items-end">
                <span className="text-6xl font-black tracking-tighter leading-none">{score}</span>
                <span className="text-[10px] font-bold uppercase tracking-widest opacity-60 text-right">Vector Flux</span>
              </div>
              <div className="h-4 bg-emerald-950 border border-emerald-500/30 overflow-hidden relative">
                <div className="h-full bg-emerald-400 transition-all duration-300" style={{ width: `${Math.min(100, score)}%` }}></div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Build-mode banner */}
      {isPlaying && editorMode && (
        <div className="absolute top-24 left-1/2 -translate-x-1/2 text-center pointer-events-none">
          <div className="text-amber-300 font-black tracking-[0.3em] text-sm uppercase">🔧 Build Mode — {PROP_NAMES[editorSelect]}</div>
          <div className="text-[10px] font-mono text-white/60 mt-1 uppercase tracking-widest">1 Pad · 2 Candle · 3 ATM &nbsp;|&nbsp; LMB place · RMB delete · B exit</div>
        </div>
      )}

      {/* Click-to-play overlay (also re-locks after Esc — never ejects) */}
      {isPlaying && !locked && (
        <div
          onClick={grabLock}
          className="absolute inset-0 z-30 flex flex-col items-center justify-center pointer-events-auto cursor-pointer bg-black/50 backdrop-blur-sm"
        >
          <div className="text-emerald-400 font-black text-xs tracking-[0.4em] uppercase mb-3">Math Quake</div>
          <div className="text-white font-black text-4xl uppercase tracking-widest mb-4">Click to play</div>
          <div className="text-emerald-500/70 font-mono text-[11px] uppercase tracking-widest text-center max-w-md">
            WASD · Mouse · LMB fire · Space jump · 2×Space jetpack · RMB grapple · B build
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
