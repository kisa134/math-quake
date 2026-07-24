/**
 * V7.6 М1 — the audio-reactive scalar. The owner's looping track feeds an
 * AnalyserNode (utils/audio.ts); once per frame we reduce its spectrum into
 * three smoothed values that any component samples cheaply, no prop drilling
 * (the blackHoleFeed/gunState idiom). Client-local cosmetic (each client reads
 * its own analyser) — never gates world choreography, so the zero-net law holds.
 *
 * Smoothing is "tasty, not disco": fast attack (feel the hit) + slow release
 * (no strobing), so glow swells and eases rather than flickers on every kick.
 */
export const audioReactive = { level: 0, bass: 0, mid: 0 };
