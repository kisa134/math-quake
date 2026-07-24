/**
 * Locked palette for Math Quake — V3 «Босх-психоделия» art direction (owner
 * reference boards, 2026-07-24): burgundy/crimson + antique gold + deep forest
 * green + bone-cream on warm black. Maximalist fairytale-creepy, not synthwave.
 *
 * Rule stays: the WORLD uses the wine/gold/forest set; the warm/alert actor set
 * (amber, pure red, white) is reserved for enemies/tracers/hitmarkers so the
 * eye instantly separates gameplay from the psychedelia.
 *
 * Keys are stable — components read PALETTE.*, so re-valuing this file reskins
 * the world in one place.
 */
export const PALETTE = {
  // world (wine / gold / forest)
  void: '#0a0508',          // warm black
  voidDeep: '#060305',      // fog + horizon
  gridCell: '#3a2418',      // dark bronze grid
  gridSect: '#8a5a1e',      // antique gold sections
  bull: '#2fbf71',          // forest-emerald (bull candles, pads)
  bullHot: '#7fe0a8',
  bear: '#c9184a',          // deep crimson (bear candles)
  bearHot: '#ff4d6d',
  node: '#a4133c',          // wine — structural accents
  accentViolet: '#9d174d',  // magenta-wine
  accentIndigo: '#6d1a36',  // dark wine
  uiCyan: '#e8c468',        // ← antique gold now (matrix-rain runes, trims)
  dataEmerald: '#e9c46a',   // soft gold (screens, data)
  bloomWhite: '#fff3dc',    // warm bone-white

  // actors (warm / alert) — world must NOT use these as big surfaces
  enemyAmber: '#ffb703',
  alertRed: '#ff2d2d',
  actorWhite: '#ffffff',
} as const;
