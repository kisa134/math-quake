import { useStore } from '../store';
import { initAudio } from '../utils/audio';
import { initMultiplayer } from '../socket';
import { useState, useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { onHitmarker, onFire } from '../game/fx';
import { weaponName as weaponNameOf } from '../config/weapons';
import { getAsset } from '../config/assets';
import { WeaponHUD } from './WeaponHUD';
import { SpellWheel } from './SpellWheel';
import { BuyMenu } from './BuyMenu';

export const UI = () => {
  const { score, health, isPlaying, roomId, setRoomId, startGame, currentWeapon, jetpackFuel, editorMode, editorSelect, editorScale, editorBody, money, round } = useStore();
  const [locked, setLocked] = useState(false);

  const weaponName = weaponNameOf(currentWeapon);
  const propName = getAsset(editorSelect).label;

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
              <span className="text-amber-300 font-black text-xs tracking-[0.3em] uppercase mb-1">Room: {roomId}</span>
              <h1 className="text-5xl font-black italic tracking-tighter leading-none">KLEIN_04</h1>
              <div className="flex gap-4 mt-2">
                <span className="text-[10px] bg-amber-400 text-black px-2 py-0.5 font-bold uppercase">GOD MODE</span>
                <span className="text-[10px] border border-white/30 px-2 py-0.5 font-bold uppercase">B — BUILD</span>
              </div>
            </div>
            <div className="text-right">
              <span className="text-amber-300 font-black text-xs tracking-[0.3em] uppercase mb-1">Round {round.num} · {round.phase === 'buy' ? 'BUY [P]' : 'WAVE'}</span>
              <div className="text-4xl font-mono font-bold tabular-nums text-amber-200">${money}</div>
              <div className="text-[10px] opacity-40 uppercase tracking-widest mt-1">Damage pays · rounds pay more</div>
            </div>
          </div>

          <DynamicCrosshair />

          <Hitmarker />
          <SpellWheel />
          <BuyMenu />

          {!editorMode && <WeaponHUD />}

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
              <div className="h-4 bg-rose-950 border border-amber-400/30 overflow-hidden relative">
                <div className="h-full bg-rose-500 transition-all duration-300" style={{ width: `${health}%` }}></div>
              </div>
            </div>

            <div className="flex flex-col items-center">
              <div className="w-full text-center">
                <div className="text-amber-300 font-black text-xs tracking-[0.4em] uppercase mb-2">{editorMode ? 'Build Mode' : 'Projector Active'}</div>
                <div className="text-2xl font-black italic uppercase tracking-widest bg-white text-black py-1 px-4 mb-2">
                  {editorMode ? propName : weaponName}
                </div>
                <div className="text-xs text-amber-200 font-mono">{editorMode ? 'SCROLL piece · R rotate 90° · [ ] size ×1–2 · G static/phys · LMB place · RMB del' : '[1-5] WEAPON · [B] BUILD'}</div>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex justify-between items-end">
                <span className="text-6xl font-black tracking-tighter leading-none">{score}</span>
                <span className="text-[10px] font-bold uppercase tracking-widest opacity-60 text-right">Vector Flux</span>
              </div>
              <div className="h-4 bg-rose-950 border border-amber-400/30 overflow-hidden relative">
                <div className="h-full bg-amber-400 transition-all duration-300" style={{ width: `${Math.min(100, score)}%` }}></div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Build-mode banner */}
      {isPlaying && editorMode && (
        <div className="absolute top-24 left-1/2 -translate-x-1/2 text-center pointer-events-none">
          <div className="text-amber-300 font-black tracking-[0.3em] text-sm uppercase">🔧 Build — {propName} · ×{editorScale.toFixed(2)} · {editorBody === 'dynamic' ? 'PHYSICS' : 'STATIC'}</div>
          <div className="text-[10px] font-mono text-white/60 mt-1 uppercase tracking-widest">SCROLL piece · R rotate 90° · [ ] size · G static/phys &nbsp;|&nbsp; GRID SNAP · LMB place · RMB delete · B exit</div>
        </div>
      )}

      {/* Click-to-play overlay (also re-locks after Esc — never ejects) */}
      {isPlaying && !locked && (
        <div
          onClick={grabLock}
          className="absolute inset-0 z-30 flex flex-col items-center justify-center pointer-events-auto cursor-pointer bg-black/50 backdrop-blur-sm"
        >
          <div className="text-amber-200 font-black text-xs tracking-[0.4em] uppercase mb-3">Math Quake</div>
          <div className="text-white font-black text-4xl uppercase tracking-widest mb-4">Click to play</div>
          <div className="text-amber-300/70 font-mono text-[11px] uppercase tracking-widest text-center max-w-md">
            WASD · Mouse · LMB fire · Space jump · 2×Space jetpack · RMB grapple · B build · E magic · C boots · V 3rd-person
          </div>
        </div>
      )}

      {/* V3.2: all player bodies are the white voxel dude — picker retired */}
    </div>
  );
};

// Dynamic crosshair — four ticks that bloom outward on every shot, then ease
// back. Runs its own rAF and mutates the DOM imperatively (no React re-render
// per shot, so the 120ms auto-rifle stays cheap). Emerald, combat-readable.
const DynamicCrosshair = () => {
  const rootRef = useRef<HTMLDivElement>(null);
  const bloom = useRef(0);

  useEffect(() => onFire(() => { bloom.current = Math.min(1, bloom.current + 0.55); }), []);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      bloom.current = Math.max(0, bloom.current - 0.055);
      const el = rootRef.current;
      if (el) {
        const gap = 5 + bloom.current * 15; // px each tick is pushed from center
        el.style.setProperty('--g', `${gap}px`);
        el.style.opacity = String(0.75 + bloom.current * 0.25);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const c = '#e9c46a'; // antique gold (V3 Bosch grade)
  const glow = '0 0 4px rgba(233,196,106,0.9)';
  const tick = (rot: number): CSSProperties => ({
    position: 'absolute', left: '50%', top: '50%', width: 2, height: 9,
    marginLeft: -1, background: c, borderRadius: 2, boxShadow: glow,
    transform: `rotate(${rot}deg) translateY(calc(-1 * (var(--g,5px) + 4px)))`,
    transformOrigin: 'center top',
  });
  return (
    <div ref={rootRef} className="absolute inset-0 flex items-center justify-center pointer-events-none">
      <div className="relative" style={{ width: 0, height: 0 }}>
        <div style={{ position: 'absolute', left: -1.5, top: -1.5, width: 3, height: 3, borderRadius: '50%', background: c, boxShadow: glow }} />
        <div style={tick(0)} />
        <div style={tick(90)} />
        <div style={tick(180)} />
        <div style={tick(270)} />
      </div>
    </div>
  );
};

// Center hitmarker — a quick X that pops on every landed shot: white on a hit,
// bigger + gold on a kill (fireHitmarker(true)).
const Hitmarker = () => {
  const [state, setState] = useState<{ id: number; kill: boolean }>({ id: 0, kill: false });
  useEffect(() => onHitmarker((kill) => setState((s) => ({ id: s.id + 1, kill }))), []);
  if (!state.id) return null;
  return <HitmarkerFlash key={state.id} kill={state.kill} />;
};

const HitmarkerFlash = ({ kill }: { kill: boolean }) => {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const r = requestAnimationFrame(() => setOn(true));
    return () => cancelAnimationFrame(r);
  }, []);
  const color = kill ? '#ffd700' : '#ffffff';
  const len = kill ? 26 : 18;
  const bar: CSSProperties = {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: len,
    height: kill ? 4 : 3,
    marginLeft: -len / 2,
    marginTop: -1.5,
    background: color,
    borderRadius: 2,
    boxShadow: `0 0 ${kill ? 10 : 6}px ${kill ? 'rgba(255,215,0,0.95)' : 'rgba(255,255,255,0.9)'}`,
    transition: 'opacity 220ms ease-out, transform 220ms ease-out',
    opacity: on ? 0 : 1,
  };
  return (
    <div className="absolute inset-0 pointer-events-none">
      <div style={{ ...bar, transform: `rotate(45deg) scale(${on ? 0.9 : kill ? 1.8 : 1.5})` }} />
      <div style={{ ...bar, transform: `rotate(-45deg) scale(${on ? 0.9 : kill ? 1.8 : 1.5})` }} />
    </div>
  );
};
