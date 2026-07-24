/**
 * CS-style economy + match config (V2.2). Pure data.
 *
 * Weapons are BOUGHT (press P → buy menu → digit). You start with the free
 * loadout (wand = «pistol», dagger = «knife»); the rest cost money. Money comes
 * from damage dealt (client-local, works for host and peers alike) + round-win
 * bonuses. Matches vs bots run in rounds: BUY phase (no spawns) → WAVE (host
 * spawns a scaled pack of bots) → all dead = round won → bigger wave.
 */

// Prices by WEAPONS index:
// [GLITCH WAND, SCATTER SHOT, PLASMA STAFF, RAIL BLADE, DELTA DAGGER,
//  KALASH GLITCH, SALARY SHREDDER (minigun), MARGIN CALL (deagle)]
export const WEAPON_PRICES = [0, 1200, 2700, 4750, 0, 2900, 6500, 900];

export const ECON = {
  startMoney: 800,
  maxMoney: 16000,
  moneyPerDamage: 2,     // $ per point of damage you land (smooth, always local)
  killBonus: 150,        // extra when your shot visibly kills (host-side detect)
  roundWinBase: 1000,    // + roundWinPerRound × round
  roundWinPerRound: 150,
};

export const MATCH = {
  buySeconds: 12,        // buy-phase length between rounds
  waveBase: 4,           // bots in round 1
  wavePerRound: 2,       // +bots each round
  waveCap: 24,           // never exceed the physics budget
  spawnGapMs: 900,       // spacing between bot spawns within a wave
};

export const wavesSize = (round: number) =>
  Math.min(MATCH.waveCap, MATCH.waveBase + MATCH.wavePerRound * (round - 1));

export const roundWinReward = (round: number) =>
  ECON.roundWinBase + ECON.roundWinPerRound * round;
