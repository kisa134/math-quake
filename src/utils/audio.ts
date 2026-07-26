let audioCtx: AudioContext | null = null;
let ambientOn = false;
// V5 C8: the drone follows the market epoch (refs kept for live re-tuning)
let ambientFilter: BiquadFilterNode | null = null;
let ambientBus: GainNode | null = null;
let ambientLfo: OscillatorNode | null = null;

export const initAudio = () => {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  startAmbient();
  void startMusic(); // V7.6: the owner's looping track (silent no-op if none shipped)
};

// Low, evolving matrix drone under everything — atmosphere, not melody. Two
// detuned oscillators through a slow-swept lowpass at a whisper-quiet gain.
// Started once on the first user gesture (initAudio) and left running.
const startAmbient = () => {
  if (!audioCtx || ambientOn) return;
  ambientOn = true;
  const t = audioCtx.currentTime;

  const bus = audioCtx.createGain();
  bus.gain.value = 0.05;
  const filter = audioCtx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 320;
  filter.Q.value = 4;
  bus.connect(filter);
  filter.connect(audioCtx.destination);
  ambientBus = bus;
  ambientFilter = filter;

  for (const [freq, type] of [[55, 'sine'], [82.5, 'triangle']] as const) {
    const osc = audioCtx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    osc.connect(bus);
    osc.start(t);
  }

  // Slow LFO breathes the filter cutoff so the drone shifts over ~14s.
  const lfo = audioCtx.createOscillator();
  const lfoGain = audioCtx.createGain();
  lfo.frequency.value = 0.07;
  lfoGain.gain.value = 180;
  lfo.connect(lfoGain);
  lfoGain.connect(filter.frequency);
  lfo.start(t);
  ambientLfo = lfo;
};

// V5 C8 — the drone follows the market: brighter+faster into euphoria, choked
// and slow in capitulation's dread, almost gone in silence. 2s ramps.
const MOOD_CUTOFF = [320, 430, 540, 380, 240, 180];
const MOOD_GAIN = [0.05, 0.06, 0.07, 0.05, 0.065, 0.028];
const MOOD_LFO = [0.07, 0.11, 0.16, 0.13, 0.24, 0.045];
// V7.6: the owner's track breathes with the market too — brighter/louder into
// euphoria, choked with the dub layer swelling in capitulation, near-silent in
// the SILENCE epoch. НАКОП / ПАМП / ЭЙФОР / РАСПРОД / КАПИТУЛ / ТИШИНА.
const MOOD_MUS_GAIN = [0.5, 0.62, 0.72, 0.52, 0.44, 0.3];
const MOOD_MUS_CUT = [1500, 2600, 3600, 1800, 1000, 700];
const MOOD_MUS_DUB = [0.1, 0.18, 0.26, 0.2, 0.34, 0.14];
export const setAmbientMood = (epoch: number) => {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  if (ambientFilter && ambientBus && ambientLfo) {
    ambientFilter.frequency.linearRampToValueAtTime(MOOD_CUTOFF[epoch] ?? 320, t + 2);
    ambientBus.gain.linearRampToValueAtTime(MOOD_GAIN[epoch] ?? 0.05, t + 2);
    ambientLfo.frequency.linearRampToValueAtTime(MOOD_LFO[epoch] ?? 0.07, t + 2);
  }
  if (musicMainGain && musicFilter && musicDubGain) {
    musicMainGain.gain.linearRampToValueAtTime(MOOD_MUS_GAIN[epoch] ?? 0.5, t + 2);
    musicFilter.frequency.linearRampToValueAtTime(MOOD_MUS_CUT[epoch] ?? 1600, t + 2);
    musicDubGain.gain.linearRampToValueAtTime(MOOD_MUS_DUB[epoch] ?? 0.15, t + 2);
  }
};

// ── V6.1 CAR AUDIO: engine loop + drift screech (created once, gain-driven) ──
let engOsc: OscillatorNode | null = null;
let engSub: OscillatorNode | null = null;
let engGain: GainNode | null = null;
let screechGain: GainNode | null = null;

const ensureEngine = () => {
  if (!audioCtx || engOsc) return;
  const t = audioCtx.currentTime;
  engGain = audioCtx.createGain();
  engGain.gain.value = 0;
  engGain.connect(audioCtx.destination);
  // rumbling sawtooth + sub square — the V8 growl
  engOsc = audioCtx.createOscillator();
  engOsc.type = 'sawtooth';
  engOsc.frequency.value = 55;
  const lp = audioCtx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 700;
  engOsc.connect(lp);
  lp.connect(engGain);
  engOsc.start(t);
  engSub = audioCtx.createOscillator();
  engSub.type = 'square';
  engSub.frequency.value = 27;
  const sg = audioCtx.createGain();
  sg.gain.value = 0.4;
  engSub.connect(sg);
  sg.connect(engGain);
  engSub.start(t);
  // drift screech: looped noise through a screaming bandpass
  const len = Math.floor(audioCtx.sampleRate * 1);
  const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const bp = audioCtx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1250;
  bp.Q.value = 6;
  screechGain = audioCtx.createGain();
  screechGain.gain.value = 0;
  src.connect(bp);
  bp.connect(screechGain);
  screechGain.connect(audioCtx.destination);
  src.start(t);
};

/** Per-frame from Cars.tsx: speed01 = |speed|/max, drifting = визг. */
export const updateEngine = (speed01: number, drifting: boolean) => {
  if (!audioCtx) return;
  ensureEngine();
  if (!engOsc || !engSub || !engGain || !screechGain) return;
  const t = audioCtx.currentTime;
  const rpm = 50 + speed01 * 210 + (drifting ? 20 : 0);
  engOsc.frequency.setTargetAtTime(rpm, t, 0.08);
  engSub.frequency.setTargetAtTime(rpm * 0.5, t, 0.1);
  engGain.gain.setTargetAtTime(0.035 + speed01 * 0.05, t, 0.1);
  screechGain.gain.setTargetAtTime(drifting ? 0.05 + speed01 * 0.05 : 0, t, 0.06);
};

export const stopEngine = () => {
  if (!audioCtx || !engGain || !screechGain) return;
  const t = audioCtx.currentTime;
  engGain.gain.setTargetAtTime(0, t, 0.15);
  screechGain.gain.setTargetAtTime(0, t, 0.08);
};

// ── V7.6 М1: THE OWNER'S TRACK — infinite evolving loop + analyser ──────────
// One file (public/music/owner-track.mp3), looped seamlessly, but never quite
// the same: a second detuned copy of the same buffer fades in/out over the top
// (the "dub" layer), a slow LFO sweeps the master filter, and the whole thing
// brightens/chokes with the market epoch (setAmbientMood). An AnalyserNode taps
// the master so game visuals can breathe with the music (game/audioReactive.ts).
import { audioReactive } from '../game/audioReactive';

let musicBuf: AudioBuffer | null = null;
let musicMain: AudioBufferSourceNode | null = null;
let musicDub: AudioBufferSourceNode | null = null;
let musicMainGain: GainNode | null = null;
let musicDubGain: GainNode | null = null;
let musicFilter: BiquadFilterNode | null = null;
let musicOn = false;
let analyser: AnalyserNode | null = null;
let freqBuf: Uint8Array | null = null;

const startMusic = async () => {
  if (!audioCtx || musicOn) return;
  musicOn = true;
  try {
    const url = `${import.meta.env.BASE_URL}music/owner-track.mp3`;
    const res = await fetch(url);
    if (!res.ok) { musicOn = false; return; } // no track shipped — game runs silent-music fine
    musicBuf = await audioCtx.decodeAudioData(await res.arrayBuffer());
    const t = audioCtx.currentTime;

    // master chain: [main + dub] → musicFilter (lowpass) → analyser → destination
    musicFilter = audioCtx.createBiquadFilter();
    musicFilter.type = 'lowpass';
    musicFilter.frequency.value = 1600;
    musicFilter.Q.value = 0.6;
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.6;
    freqBuf = new Uint8Array(analyser.frequencyBinCount);
    musicFilter.connect(analyser);
    analyser.connect(audioCtx.destination);

    // slow filter LFO — the loop breathes even when nothing else changes
    const lfo = audioCtx.createOscillator();
    const lfoGain = audioCtx.createGain();
    lfo.frequency.value = 0.035;
    lfoGain.gain.value = 500;
    lfo.connect(lfoGain);
    lfoGain.connect(musicFilter.frequency);
    lfo.start(t);

    // main loop (seamless)
    musicMainGain = audioCtx.createGain();
    musicMainGain.gain.value = 0.0;
    musicMainGain.connect(musicFilter);
    musicMain = audioCtx.createBufferSource();
    musicMain.buffer = musicBuf;
    musicMain.loop = true;
    musicMain.connect(musicMainGain);
    musicMain.start(t);
    musicMainGain.gain.setTargetAtTime(0.5, t, 1.5); // fade in

    // dub layer: same buffer, offset half a phrase + detuned — the evolving overlay
    musicDubGain = audioCtx.createGain();
    musicDubGain.gain.value = 0.0;
    musicDubGain.connect(musicFilter);
    musicDub = audioCtx.createBufferSource();
    musicDub.buffer = musicBuf;
    musicDub.loop = true;
    musicDub.playbackRate.value = 1.006; // +0.6% — slowly drifts against the main
    musicDub.connect(musicDubGain);
    musicDub.start(t, (musicBuf.duration * 0.5) % musicBuf.duration);
  } catch {
    musicOn = false; // decode/CORS/etc — never break the game over music
  }
};

/** Per-frame from AccentDriver: reduce the spectrum into smoothed bass/mid/level. */
export const updateAudioReactive = () => {
  if (!analyser || !freqBuf) return;
  analyser.getByteFrequencyData(freqBuf);
  const n = freqBuf.length;
  let bass = 0, mid = 0, all = 0;
  const bassEnd = Math.max(1, Math.floor(n * 0.12));
  const midEnd = Math.floor(n * 0.5);
  for (let i = 0; i < bassEnd; i++) bass += freqBuf[i];
  for (let i = bassEnd; i < midEnd; i++) mid += freqBuf[i];
  for (let i = 0; i < n; i++) all += freqBuf[i];
  bass = bass / bassEnd / 255;
  mid = mid / (midEnd - bassEnd) / 255;
  all = all / n / 255;
  // fast attack, slow release — swell not strobe («вкусно, не диско»)
  const ramp = (cur: number, tgt: number) => tgt > cur ? cur + (tgt - cur) * 0.5 : cur + (tgt - cur) * 0.08;
  audioReactive.bass = ramp(audioReactive.bass, bass);
  audioReactive.mid = ramp(audioReactive.mid, mid);
  audioReactive.level = ramp(audioReactive.level, all);
};

// V7.6 М2: the cinematic black-hole INHALE — a descending sine sweep under a
// filtered rising noise «breath». Called from the swallow set-piece.
export const playSuction = () => {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(220, t);
  osc.frequency.exponentialRampToValueAtTime(28, t + 1.1);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.3, t + 0.2);
  g.gain.exponentialRampToValueAtTime(0.001, t + 1.2);
  osc.connect(g); g.connect(audioCtx.destination);
  osc.start(t); osc.stop(t + 1.2);

  // rising filtered noise = the inhale of wind
  const len = Math.floor(audioCtx.sampleRate * 1.1);
  const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (i / len); // swells IN
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  const bp = audioCtx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(300, t);
  bp.frequency.exponentialRampToValueAtTime(2200, t + 1.1);
  bp.Q.value = 0.8;
  const ng = audioCtx.createGain();
  ng.gain.value = 0.22;
  src.connect(bp); bp.connect(ng); ng.connect(audioCtx.destination);
  src.start(t); src.stop(t + 1.1);
};

// Crisp high blip for a landed hit — the audible half of the hitmarker.
export const playHitTick = () => {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(1250, t);
  osc.frequency.exponentialRampToValueAtTime(820, t + 0.05);
  gain.gain.setValueAtTime(0.09, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(t);
  osc.stop(t + 0.06);
};

// ── V8 Ф1: THE FIVE-LAYER SHOT (docs/V8_VISION.md §7) ───────────────────────
// Mech (bolt click) + Body (carrier by character) + Punch (sub, удар в грудь)
// + Tail (decaying air) + Foley (delayed shell tink). Player's gun is the
// payoff — it gets the full stack; enemies keep the old thin blips.
const noiseBurst = (t: number, dur: number, gain: number, filterType: BiquadFilterType, freq: number, q = 0.8) => {
  if (!audioCtx) return;
  const len = Math.max(1, Math.floor(audioCtx.sampleRate * dur));
  const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  const f = audioCtx.createBiquadFilter();
  f.type = filterType; f.frequency.value = freq; f.Q.value = q;
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(gain, t);
  src.connect(f); f.connect(g); g.connect(audioCtx.destination);
  src.start(t); src.stop(t + dur);
};

export const playWeaponSound = (freq: number, sonic?: { body: 'crack' | 'blast' | 'zap' | 'bloom'; punch: number; tail: number }) => {
  if (!audioCtx) return;
  const s = sonic ?? { body: 'zap' as const, punch: 0.5, tail: 0.3 };
  const t = audioCtx.currentTime;
  const out = audioCtx.destination;

  // 1 MECH — 12ms metallic bolt click (the working machine)
  {
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'square';
    o.frequency.value = 2400 + Math.random() * 500;
    g.gain.setValueAtTime(0.045, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.012);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + 0.012);
  }

  // 2 BODY — the carrier, per character
  if (s.body === 'crack') {
    noiseBurst(t, 0.06, 0.22, 'bandpass', 1900, 1.1);
    const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
    o.type = 'square'; o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(40, freq / 5), t + 0.07);
    g.gain.setValueAtTime(0.09, t); g.gain.exponentialRampToValueAtTime(0.01, t + 0.07);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.07);
  } else if (s.body === 'blast') {
    noiseBurst(t, 0.12, 0.3, 'lowpass', 900, 0.7);
    noiseBurst(t, 0.05, 0.12, 'bandpass', 2600, 1.5); // top-end slap
  } else if (s.body === 'zap') {
    const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
    o.type = 'square'; o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(60, freq / 4), t + 0.08);
    g.gain.setValueAtTime(0.1, t); g.gain.exponentialRampToValueAtTime(0.01, t + 0.08);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.08);
    noiseBurst(t, 0.02, 0.06, 'highpass', 3200, 0.7); // crystalline fizz
  } else { // bloom — wet electric swell
    const o = audioCtx.createOscillator(); const o2 = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'triangle'; o2.type = 'sine';
    o.frequency.setValueAtTime(freq * 0.9, t);
    o.frequency.exponentialRampToValueAtTime(freq * 1.4, t + 0.09);
    o2.frequency.value = freq * 1.502; // detuned partner
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.01, t + 0.12);
    o.connect(g); o2.connect(g); g.connect(out);
    o.start(t); o.stop(t + 0.12); o2.start(t); o2.stop(t + 0.12);
  }

  // 3 PUNCH — the chest hit (depth per weapon)
  if (s.punch > 0.05) {
    const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(36, t + 0.1);
    g.gain.setValueAtTime(0.22 * s.punch, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.12);
  }

  // 4 TAIL — decaying air (length per weapon)
  if (s.tail > 0.05) {
    noiseBurst(t + 0.02, 0.12 + 0.5 * s.tail, 0.05 * s.tail + 0.02, 'lowpass', 750, 0.6);
  }

  // 5 FOLEY — the shell tink, 130ms later
  if (s.tail > 0.02 || s.punch > 0.4) {
    const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(3100, t + 0.13);
    o.frequency.exponentialRampToValueAtTime(2200, t + 0.16);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.setValueAtTime(0.03, t + 0.13);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.17);
    o.connect(g); g.connect(out); o.start(t + 0.13); o.stop(t + 0.17);
  }
};

// Layered AAA-ish shot: the classic square zap + a sub-bass thump underneath
// (the thump is what makes a gun feel heavy) + a 10ms noise click transient.
export const playShootSound = (freq = 400, dur = 0.1) => {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;

  // layer 1 — the zap (original)
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.type = 'square';
  osc.frequency.setValueAtTime(freq, t);
  osc.frequency.exponentialRampToValueAtTime(freq / 4, t + dur);
  gain.gain.setValueAtTime(0.1, t);
  gain.gain.exponentialRampToValueAtTime(0.01, t + dur);
  osc.start(t);
  osc.stop(t + dur);

  // layer 2 — sub thump (weight)
  const sub = audioCtx.createOscillator();
  const sg = audioCtx.createGain();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(110, t);
  sub.frequency.exponentialRampToValueAtTime(38, t + 0.09);
  sg.gain.setValueAtTime(0.16, t);
  sg.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
  sub.connect(sg);
  sg.connect(audioCtx.destination);
  sub.start(t);
  sub.stop(t + 0.11);

  // layer 3 — click transient (crack)
  const len = Math.floor(audioCtx.sampleRate * 0.012);
  const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const click = audioCtx.createBufferSource();
  click.buffer = buf;
  const cg = audioCtx.createGain();
  cg.gain.setValueAtTime(0.12, t);
  click.connect(cg);
  cg.connect(audioCtx.destination);
  click.start(t);
};

// Short noisy crunch for a small enemy shattering into voxels.
export const playImpactSound = () => {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  const len = Math.floor(audioCtx.sampleRate * 0.15);
  const buffer = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = audioCtx.createBufferSource();
  src.buffer = buffer;
  const filter = audioCtx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 900;
  filter.Q.value = 0.7;
  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(0.25, t);
  gain.gain.exponentialRampToValueAtTime(0.01, t + 0.15);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(audioCtx.destination);
  src.start(t);
  src.stop(t + 0.15);
};

// Deeper, longer boom for a candle / big kill: low body thump + noise tail.
export const playExplosionSound = () => {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(180, t);
  osc.frequency.exponentialRampToValueAtTime(40, t + 0.3);
  g.gain.setValueAtTime(0.35, t);
  g.gain.exponentialRampToValueAtTime(0.01, t + 0.3);
  osc.connect(g);
  g.connect(audioCtx.destination);
  osc.start(t);
  osc.stop(t + 0.3);

  const len = Math.floor(audioCtx.sampleRate * 0.3);
  const buffer = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = audioCtx.createBufferSource();
  src.buffer = buffer;
  const filter = audioCtx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 1200;
  const ng = audioCtx.createGain();
  ng.gain.setValueAtTime(0.3, t);
  ng.gain.exponentialRampToValueAtTime(0.01, t + 0.3);
  src.connect(filter);
  filter.connect(ng);
  ng.connect(audioCtx.destination);
  src.start(t);
  src.stop(t + 0.3);
};

export const playJumpSound = () => {
  if (!audioCtx) return;
  
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  
  osc.type = 'sine';
  osc.frequency.setValueAtTime(300, audioCtx.currentTime);
  osc.frequency.linearRampToValueAtTime(600, audioCtx.currentTime + 0.1);
  
  gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
  
  osc.start();
  osc.stop(audioCtx.currentTime + 0.1);
};
