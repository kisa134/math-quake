/**
 * Locked palette for Math Quake (see docs/increments/03-world-matrix-finance.md).
 * One source of truth so world + UI read as a single synthwave/finance system.
 *
 * Rule: the WORLD uses cold blues/violets/mint + data-cyan. The warm/alert set
 * (amber, red, pure white) is reserved for ACTORS (enemies, tracers, muzzle,
 * hitmarkers) so the eye instantly separates gameplay from the psychedelia.
 */
export const PALETTE = {
  // world (cold)
  void: '#050510',
  voidDeep: '#02020a',
  gridCell: '#1a2140',
  gridSect: '#4a2c73',
  bull: '#00f5d4',
  bullHot: '#5cffea',
  bear: '#f72585',
  bearHot: '#ff5fa8',
  node: '#4361ee',
  accentViolet: '#7209b7',
  accentIndigo: '#3a0ca3',
  uiCyan: '#4cc9f0',
  dataEmerald: '#34d399',
  bloomWhite: '#eafcff',

  // actors (warm / alert) — world must NOT use these as big surfaces
  enemyAmber: '#ffb703',
  alertRed: '#ff2d2d',
  actorWhite: '#ffffff',
} as const;
