/**
 * Client-side world snapshot buffer + interpolation (increment 05).
 *
 * Snapshots arrive on `world_snapshot` (20Hz) and are pushed here — straight
 * into a ring buffer, NEVER through React/zustand. Each render frame calls
 * sampleWorld() which returns interpolated entity roots ~RENDER_DELAY ms in the
 * past. Reuses view objects (no per-frame allocations), same discipline that
 * keeps Player.tsx at 60fps.
 */

const RENDER_DELAY = 100; // ms behind server for smooth interpolation
const BUFFER_MAX = 20;    // ~1s of history at 20Hz

export interface CreatureView {
  x: number; y: number; z: number; yaw: number;
  state: number; hp: number; gaitId: number;
  vx: number; vz: number;
}
interface Snap {
  seq: number;
  serverT: number;
  cr: Map<string, CreatureView>;
  train: { t: number; speed: number; pilotId: string; derailed: boolean };
}

const buffer: Snap[] = [];
let clockOffset = 0;
let clockInited = false;
let lastSeq = -1;

export function serverNow() {
  return Date.now() + clockOffset;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
// shortest-arc angle interpolation (radians)
function slerpAngle(a: number, b: number, t: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function decode(raw: any): Snap {
  const cr = new Map<string, CreatureView>();
  const list: any[] = raw.cr || [];
  for (const c of list) {
    cr.set(c[0], {
      x: c[1] / 100, y: c[2] / 100, z: c[3] / 100, yaw: c[4] / 1000,
      state: c[5], hp: c[6], gaitId: c[7],
      vx: (c[8] || 0) / 10, vz: (c[9] || 0) / 10,
    });
  }
  const tr = raw.train || [0, 0, '', 0];
  return {
    seq: raw.seq,
    serverT: raw.t,
    cr,
    train: { t: tr[0] / 1e4, speed: tr[1] / 1e3, pilotId: tr[2], derailed: !!tr[3] },
  };
}

function updateClock(serverT: number) {
  const sample = serverT - Date.now();
  if (!clockInited) { clockOffset = sample; clockInited = true; }
  else clockOffset = 0.9 * clockOffset + 0.1 * sample;
}

export function pushSnapshot(raw: any) {
  if (raw.seq <= lastSeq) return; // drop out-of-order/dupes
  lastSeq = raw.seq;
  buffer.push(decode(raw));
  if (buffer.length > BUFFER_MAX) buffer.shift();
  updateClock(raw.t);
}

/** Seed the buffer from a full world_init so late-join renders immediately. */
export function seedWorld(serverTime: number) {
  updateClock(serverTime);
}

// Reused output — never reallocated per frame.
const _out = { creatures: new Map<string, CreatureView>(), train: { t: 0, speed: 0, pilotId: '', derailed: false } };

function getView(id: string): CreatureView {
  let v = _out.creatures.get(id);
  if (!v) { v = { x: 0, y: 0, z: 0, yaw: 0, state: 0, hp: 0, gaitId: 0, vx: 0, vz: 0 }; _out.creatures.set(id, v); }
  return v;
}

export function sampleWorld() {
  if (buffer.length === 0) return _out;
  const renderT = serverNow() - RENDER_DELAY;

  let a = buffer[0];
  let b = buffer[buffer.length - 1];
  for (let i = 0; i < buffer.length - 1; i++) {
    if (buffer[i].serverT <= renderT && buffer[i + 1].serverT >= renderT) { a = buffer[i]; b = buffer[i + 1]; break; }
  }
  const span = Math.max(1, b.serverT - a.serverT);
  const alpha = clamp01((renderT - a.serverT) / span);

  _out.train.t = lerp(a.train.t, b.train.t, alpha);
  _out.train.speed = b.train.speed;
  _out.train.pilotId = b.train.pilotId;
  _out.train.derailed = b.train.derailed;

  for (const [id, cb] of b.cr) {
    const ca = a.cr.get(id);
    const v = getView(id);
    if (ca) {
      v.x = lerp(ca.x, cb.x, alpha); v.y = lerp(ca.y, cb.y, alpha); v.z = lerp(ca.z, cb.z, alpha);
      v.yaw = slerpAngle(ca.yaw, cb.yaw, alpha);
    } else {
      v.x = cb.x; v.y = cb.y; v.z = cb.z; v.yaw = cb.yaw;
    }
    v.state = cb.state; v.hp = cb.hp; v.gaitId = cb.gaitId; v.vx = cb.vx; v.vz = cb.vz;
  }
  // prune entities no longer present
  for (const id of _out.creatures.keys()) if (!b.cr.has(id)) _out.creatures.delete(id);
  return _out;
}
