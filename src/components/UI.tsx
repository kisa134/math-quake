import { useStore } from '../store';
import { initAudio } from '../utils/audio';
import { initMultiplayer } from '../socket';
import { useState, useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { onHitmarker, onFire, onKillFlash } from '../game/fx';
import { weaponName as weaponNameOf } from '../config/weapons';
import { getAsset } from '../config/assets';
import { accentHex } from '../game/accent';
import { gunState } from '../game/gunState';
import { chronicle } from '../game/chronicle';
import { combo } from '../game/combo';
import { WeaponHUD } from './WeaponHUD';
import { SpellWheel } from './SpellWheel';
import { BuyMenu } from './BuyMenu';

export const UI = () => {
  const { score, health, isPlaying, roomId, setRoomId, startGame, currentWeapon, jetpackFuel, editorMode, editorSelect, editorScale, editorBody, money, round, remotePlayers } = useStore();
  // V4 TOP BAG: who holds the most money in the room
  const rivalMax = Object.values(remotePlayers).reduce((m, p) => Math.max(m, p.money ?? 0), 0);
  const iAmTop = money >= rivalMax;
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
              <span className="font-black text-xs tracking-[0.3em] uppercase mb-1" style={{ color: 'var(--accent, #c8b273)' }}>Room: {roomId}</span>
              <h1 className="text-5xl font-black italic tracking-tighter leading-none">KLEIN_04</h1>
              <div className="flex gap-4 mt-2">
                <span className="text-[10px] bg-amber-400 text-black px-2 py-0.5 font-bold uppercase">GOD MODE</span>
                <span className="text-[10px] border border-white/30 px-2 py-0.5 font-bold uppercase">B — BUILD</span>
              </div>
            </div>
            <div className="text-right">
              <span className="font-black text-xs tracking-[0.3em] uppercase mb-1" style={{ color: 'var(--accent, #c8b273)' }}>Round {round.num} · {round.phase === 'buy' ? 'BUY [P]' : 'WAVE'}</span>
              <div className="text-4xl font-mono font-bold tabular-nums text-amber-200">${money}</div>
              <div className={`text-[10px] uppercase tracking-widest mt-1 ${iAmTop ? 'text-amber-300 font-bold' : 'opacity-40'}`}>
                {iAmTop ? '👑 TOP BAG — YOU' : `TOP BAG $${rivalMax} — NOT YOU`}
              </div>
            </div>
          </div>

          <DynamicCrosshair />

          <Hitmarker />
          <KillFlash />
          <BuffBadges />
          <ChronicleFeed />
          <ComboBadge />
          <SpellWheel />
          <BuyMenu />

          {!editorMode && <WeaponHUD />}

          {/* Jetpack fuel */}
          <div className="absolute left-1/2 -translate-x-1/2 top-[60%] w-44 pointer-events-none">
            <div className="text-[9px] font-mono tracking-[0.3em] mb-1 text-center uppercase opacity-70" style={{ color: 'var(--accent, #c8b273)' }}>Jet Fuel · 2×Space</div>
            <div className="h-1.5 bg-black/50 border border-white/15 overflow-hidden">
              <div className="h-full" style={{ width: `${jetpackFuel}%`, background: jetpackFuel < 25 ? '#ff2d2d' : 'var(--accent, #c8b273)', transition: 'width 90ms linear' }} />
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
                <div className="text-xs text-amber-200 font-mono">{editorMode ? 'SCROLL piece · R rotate 90° · [ ] size ×1–2 · G static/phys · LMB place · RMB del' : '[1-8] WEAPON · [P] BUY · [B] BUILD'}</div>
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

// V5 C6 — the world narrates itself: last 3 chronicle lines, bottom-left.
const ChronicleFeed = () => {
  const [, force] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => force((x) => x + 1), 900);
    return () => clearInterval(iv);
  }, []);
  const now = Date.now();
  const items = chronicle.filter((c) => now - c.t < 9000).slice(-3);
  if (!items.length) return null;
  return (
    <div className="absolute left-8 bottom-40 flex flex-col gap-1 pointer-events-none">
      {items.map((c, i) => (
        <div
          key={c.t + i}
          className="text-[11px] font-mono uppercase tracking-widest"
          style={{ color: 'var(--accent, #c8b273)', opacity: 0.35 + 0.65 * (1 - (now - c.t) / 9000) }}
        >
          {c.msg}
        </div>
      ))}
    </div>
  );
};

// V5 C10 — kill combo badge near the crosshair (×2…×N, fades with the window).
const ComboBadge = () => {
  const [, force] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => force((x) => x + 1), 250);
    return () => clearInterval(iv);
  }, []);
  const now = Date.now();
  if (combo.n < 2 || now > combo.until) return null;
  return (
    <div className="absolute left-1/2 top-[56%] -translate-x-1/2 pointer-events-none">
      <div
        className="font-black italic text-2xl tracking-tighter"
        style={{ color: 'var(--accent, #c8b273)', textShadow: '0 0 12px currentColor' }}
      >
        ×{combo.n} COMBO
      </div>
    </div>
  );
};

// V4.1 dopamine buffs — active-buff badges with live countdowns.
const BUFF_META: Record<string, { label: string; color: string }> = {
  rage: { label: '🔥 RAGE ×1.6', color: '#e63946' },
  surge: { label: '⚡ SURGE ×1.35', color: '#00b4d8' },
  midas: { label: '👑 MIDAS ×2$', color: '#ffd166' },
};

const BuffBadges = () => {
  const buffs = useStore((s) => s.buffs);
  const [, force] = useState(0);
  const any = buffs.rage > Date.now() || buffs.surge > Date.now() || buffs.midas > Date.now();
  useEffect(() => {
    if (!any) return;
    const iv = setInterval(() => force((x) => x + 1), 500);
    return () => clearInterval(iv);
  }, [any]);
  if (!any) return null;
  const now = Date.now();
  return (
    <div className="absolute left-1/2 -translate-x-1/2 top-[68%] flex gap-2 pointer-events-none">
      {(Object.keys(BUFF_META) as Array<keyof typeof buffs>).map((k) => {
        const until = buffs[k];
        if (until <= now) return null;
        const meta = BUFF_META[k];
        return (
          <div
            key={k}
            className="px-2 py-1 text-[11px] font-mono font-bold uppercase tracking-widest border"
            style={{ color: meta.color, borderColor: meta.color, textShadow: `0 0 8px ${meta.color}` }}
          >
            {meta.label} · {Math.ceil((until - now) / 1000)}s
          </div>
        );
      })}
    </div>
  );
};

// V4 brutality register: a 120ms red flash when something dies CLOSE to you.
const KillFlash = () => {
  const [id, setId] = useState(0);
  useEffect(() => onKillFlash(() => setId((x) => x + 1)), []);
  if (!id) return null;
  return <KillFlashPulse key={id} />;
};

const KillFlashPulse = () => {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const r = requestAnimationFrame(() => setOn(true));
    return () => cancelAnimationFrame(r);
  }, []);
  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{
        background: 'radial-gradient(ellipse at center, transparent 40%, rgba(201,24,74,0.5) 100%)',
        opacity: on ? 0 : 1,
        transition: 'opacity 220ms ease-out',
      }}
    />
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
        // V5 C1 CS gap: shooting bloom + run speed + current spray inaccuracy
        const gap = 4 + bloom.current * 13 + Math.min(9, gunState.speed * 0.22) + gunState.spread * 14;
        el.style.setProperty('--g', `${gap}px`);
        el.style.opacity = String(0.75 + bloom.current * 0.25);
        el.style.color = accentHex.v; // V5: the crosshair wears the market accent
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const glow = '0 0 4px currentColor';
  const tick = (rot: number): CSSProperties => ({
    position: 'absolute', left: '50%', top: '50%', width: 2, height: 9,
    marginLeft: -1, background: 'currentColor', borderRadius: 2, boxShadow: glow,
    transform: `rotate(${rot}deg) translateY(calc(-1 * (var(--g,5px) + 4px)))`,
    transformOrigin: 'center top',
  });
  return (
    <div ref={rootRef} className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ color: '#c8b273' }}>
      <div className="relative" style={{ width: 0, height: 0 }}>
        <div style={{ position: 'absolute', left: -1.5, top: -1.5, width: 3, height: 3, borderRadius: '50%', background: 'currentColor', boxShadow: glow }} />
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
