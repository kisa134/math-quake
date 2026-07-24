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
export const setAmbientMood = (epoch: number) => {
  if (!audioCtx || !ambientFilter || !ambientBus || !ambientLfo) return;
  const t = audioCtx.currentTime;
  ambientFilter.frequency.linearRampToValueAtTime(MOOD_CUTOFF[epoch] ?? 320, t + 2);
  ambientBus.gain.linearRampToValueAtTime(MOOD_GAIN[epoch] ?? 0.05, t + 2);
  ambientLfo.frequency.linearRampToValueAtTime(MOOD_LFO[epoch] ?? 0.07, t + 2);
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
