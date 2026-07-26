import { serverNow } from '../net/worldBuffer';

/**
 * V8.6 У1 — THE WORLD CLOCK. The liturgy used to tick on each client's local
 * canvas clock (t=0 at mount) — two players saw the god's epochs SHIFTED.
 * Now every world layer samples wall-clock time anchored to one epoch, via
 * serverNow() (EMA-offset against the host's snapshots, falls back to
 * Date.now before the first sync). Both players finally watch the SAME
 * liturgy — the game's central promise made true.
 *
 * Rules:
 * - Sample worldT() ONCE per useFrame and reuse — never once per call site.
 * - float32 shader uniforms take shaderT() (worldT % 3600 — exactly 48
 *   cycles AND 6 trading days, so epoch/day phase survives the wrap) or
 *   wrapPhase() for accumulated phases (heartPhase is exact: PH_CYCLE=114.0).
 * - Viewmodel cosmetics / weapon timing / HUD stay on their local clocks.
 */
export const WORLD_EPOCH0 = 1735689600000; // 2025-01-01T00:00:00Z — UTC midnight, multiple of 600s & 3600s

export const worldT = (): number => (serverNow() - WORLD_EPOCH0) / 1000;
export const shaderT = (): number => worldT() % 3600;
export const wrapPhase = (p: number): number => p % (2 * Math.PI);
