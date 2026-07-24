/**
 * V6 Ш4 — PORTAL state (data module, no imports → no cycles). Two portals,
 * A (blue) and B (orange), placed alternately by the PORTAL RIG. Both players
 * see both (synced via the 'portal' broadcast); ANY entity near an active
 * portal's plane teleports out of the twin with its speed redirected along the
 * exit normal. Per-entity cooldown kills ping-pong.
 */
export interface PortalDef {
  active: boolean;
  x: number; y: number; z: number;
  nx: number; ny: number; nz: number;
}

export const portalState: { a: PortalDef; b: PortalDef; nextIsB: boolean } = {
  a: { active: false, x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0 },
  b: { active: false, x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0 },
  nextIsB: false,
};

const cooldowns = new Map<string, number>();
const RADIUS = 3.2;
const COOLDOWN_MS = 650;

export function placePortal(slot: 'a' | 'b', x: number, y: number, z: number, nx: number, ny: number, nz: number) {
  const p = portalState[slot];
  p.active = true;
  p.x = x; p.y = y; p.z = z;
  p.nx = nx; p.ny = ny; p.nz = nz;
}

/**
 * If `id` is close to an active portal, returns the exit spec {x,y,z,nx,ny,nz}
 * (spawn at exit + 2u along the normal; redirect speed along it). Else null.
 */
export function tryPortal(id: string, x: number, y: number, z: number): PortalDef | null {
  if (!portalState.a.active || !portalState.b.active) return null;
  const now = Date.now();
  if ((cooldowns.get(id) ?? 0) > now) return null;
  const near = (p: PortalDef) => {
    const dx = x - p.x, dy = y - p.y, dz = z - p.z;
    return dx * dx + dy * dy + dz * dz < RADIUS * RADIUS;
  };
  let exit: PortalDef | null = null;
  if (near(portalState.a)) exit = portalState.b;
  else if (near(portalState.b)) exit = portalState.a;
  if (exit) cooldowns.set(id, now + COOLDOWN_MS);
  return exit;
}
