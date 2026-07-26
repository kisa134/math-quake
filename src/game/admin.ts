import { MOVE } from './movement';
import { ringInbox, orbSpawnInbox } from './botHorde';
import { DRAGONS, wildDragonPos } from './voxDragon';

/**
 * V8.5 П2 — THE ADMIN SANDBOX core (docs/V8_VISION.md: «максимум песочницы»).
 * Module-mutable context + registered callbacks (the _spawn idiom): Player
 * registers its teleport, Cars its car-recall; the Hub's admin panel calls
 * these. MOVE is a live mutable object — knobs take effect next frame; the
 * defaults snapshot lets every knob reset. All client-local (закон 6) except
 * bot/creature spawns which are host-authoritative (buttons marked in Hub).
 */

// Player writes this each frame (camera position + liturgy clock)
export const adminCtx = { x: 0, y: 90, z: 0, t: 0 };

const DEF = {
  maxGroundSpeed: MOVE.maxGroundSpeed,
  hardSpeedCap: MOVE.hardSpeedCap,
  jumpVelocity: MOVE.jumpVelocity,
  jetDrain: MOVE.jetDrain,
};

// ---- teleport (Player registers) -------------------------------------------
let _teleport: ((x: number, y: number, z: number) => void) | null = null;
export const registerTeleport = (fn: typeof _teleport) => { _teleport = fn; };
export const adminTeleport = (x: number, y: number, z: number) => { _teleport?.(x, y, z); };

export const tpToDragon = (id: number) => {
  const d = DRAGONS[id];
  if (!d) return;
  const out = { x: 0, y: 0, z: 0, heading: 0 };
  wildDragonPos(d, adminCtx.t, out);
  adminTeleport(out.x, out.y + d.scale * 4 + 8, out.z);
};

// ---- car recall (Cars registers) -------------------------------------------
let _carToMe: ((x: number, y: number, z: number) => void) | null = null;
export const registerCarRecall = (fn: typeof _carToMe) => { _carToMe = fn; };
export const adminCarToMe = () => { _carToMe?.(adminCtx.x, adminCtx.y, adminCtx.z); };

// ---- world knobs (live MOVE mutation, snapshot-resettable) ------------------
export const setSpeedMult = (mult: number) => {
  MOVE.maxGroundSpeed = DEF.maxGroundSpeed * mult;
  MOVE.hardSpeedCap = DEF.hardSpeedCap * Math.max(1, mult);
};
export const getSpeedMult = () => Math.round((MOVE.maxGroundSpeed / DEF.maxGroundSpeed) * 10) / 10;
export const setJumpMult = (mult: number) => { MOVE.jumpVelocity = DEF.jumpVelocity * mult; };
export const getJumpMult = () => Math.round((MOVE.jumpVelocity / DEF.jumpVelocity) * 10) / 10;
export const setJetInfinite = (on: boolean) => { MOVE.jetDrain = on ? 0 : DEF.jetDrain; };
export const isJetInfinite = () => MOVE.jetDrain === 0;

// ---- quick FX at my feet ----------------------------------------------------
export const ringAtMe = () => { ringInbox.push({ x: adminCtx.x, y: adminCtx.y - 1, z: adminCtx.z }); };
export const orbAtMe = (kind: 'buff' | 'cash') => {
  orbSpawnInbox.push({ x: adminCtx.x + 2, y: adminCtx.y, z: adminCtx.z + 1, kind });
};
