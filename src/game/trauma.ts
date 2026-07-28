import {
  PARTS, PART, PART_COUNT, PART_LABEL, JOINTS, JOINTS_OF, MATERIALS, MAT, ORGANS, ORGAN,
  BV, voxIndex, voxelExists, materialAt, organAt, pristineMask, partAtVox, voxelOf, subVolumeAt,
  type PartId, type MatId, type DamageType, type BleedType, type JointDef,
} from './anatomy';

/**
 * ТРАВМА — состояние тела и конвейер урона (docs/BODY_DESTRUCTION.md §5-9).
 *
 * Один источник правды на бойца: воксельные маски 6 частей, органы, раны,
 * кровотечения, витальные показатели. Карв ДЕТЕРМИНИРОВАН — ни одного
 * Math.random() в решениях (только в косметике, и та от переданного seed), иначе
 * в мультиплеере у двух игроков будут разные дырки. Урон применяет ЖЕРТВА
 * (как и раньше), в сеть уходят причины (попадание) и дискретные состояния
 * (отрыв / кровотечение / FSM), а не маски.
 */

export type FsmState = 'healthy' | 'wounded' | 'crawling' | 'shock' | 'unconscious' | 'dead';

export interface Bleed {
  type: BleedType;
  rate: number;          // мл/с базовый
  part: PartId;
  startedAt: number;
  stopAt: number;        // 0 = течёт
}

export interface LimbState {
  integrity: number;     // 0..1 доля живой ткани
  boneIntact: boolean;
  severedAt: number;     // -1 = цела, иначе cutY отрубленного сустава
  hanging: boolean;
  fn: number;            // 0..1 работоспособность
}

export interface TraumaState {
  id: string;
  masks: Uint8Array[];
  jointDmg: Float32Array;      // накопленный урон по 13 суставам
  organHp: Float32Array;       // 11 органов, 0..1
  limbs: LimbState[];
  bleeds: Bleed[];
  blood: number;               // мл
  pain: number;
  shock: number;
  state: FsmState;
  deadAt: number;              // запланированная смерть (агония органа), 0 = нет
  geoVersion: number[];        // растёт при карве части → рендер перестраивает
  version: number;             // для сети
  lastHitAt: number;
}

export const BLOOD_MAX = 5000;
export const UNCONSCIOUS_AT = 1800;
export const DEATH_AT = 1200;
const BLEED_CAP = 6;

const BLEED_BASE: Record<BleedType, number> = { arterial: 180, venous: 60, capillary: 8, internal: 40 };

// ---- кросс-модульные инбоксы (тот же паттерн, что botHitInbox/goreInbox) ----

/** Брызги/фонтаны: компоненты сливают в пул Debris. */
export const bloodInbox: {
  part: PartId; type: BleedType; amount: number; ox: number; oy: number; oz: number; id: string;
}[] = [];
/** Выбитые воксели: компоненты превращают в обломки нужного цвета. */
export const chunkInbox: { id: string; ox: number; oy: number; oz: number; color: string; n: number }[] = [];
/** Отрывы: компоненты спавнят физическое тело улетевшей части. */
export const severInbox: { id: string; part: PartId; cutY: number; impulse: [number, number, number] }[] = [];

// ------------------------------- реестр -------------------------------------

const _states = new Map<string, TraumaState>();

export function makeTrauma(id: string): TraumaState {
  const masks: Uint8Array[] = [];
  for (let p = 0; p < PART_COUNT; p++) masks.push(pristineMask(p as PartId));
  return {
    id,
    masks,
    jointDmg: new Float32Array(JOINTS.length),
    organHp: new Float32Array(ORGANS.length).fill(1),
    limbs: Array.from({ length: PART_COUNT }, () => ({
      integrity: 1, boneIntact: true, severedAt: -1, hanging: false, fn: 1,
    })),
    bleeds: [],
    blood: BLOOD_MAX,
    pain: 0,
    shock: 0,
    state: 'healthy',
    deadAt: 0,
    geoVersion: [0, 0, 0, 0, 0, 0],
    version: 0,
    lastHitAt: 0,
  };
}

export function getTrauma(id: string): TraumaState {
  let s = _states.get(id);
  if (!s) { s = makeTrauma(id); _states.set(id, s); }
  return s;
}
export function peekTrauma(id: string): TraumaState | undefined { return _states.get(id); }
export function resetTrauma(id: string): TraumaState {
  const s = makeTrauma(id);
  _states.set(id, s);
  return s;
}
export function dropTrauma(id: string) { _states.delete(id); }

// ----------------------------- ПРОФИЛИ КАРВА --------------------------------

const carveRadius = (type: DamageType, dmg: number): number => {
  if (type === 'explosive') return Math.min(9, 3 + dmg * 0.05);
  if (type === 'blunt') return Math.min(4, 1.5 + dmg * 0.025);
  if (type === 'sharp') return Math.min(5, 2 + dmg * 0.03);
  return Math.min(2.5, 1 + dmg * 0.012);            // pierce / energy — узкий канал
};

export interface HitResult {
  part: PartId;
  sub: string;
  deepest: MatId;
  organ: number;
  carved: number;
  bloodYield: number;
  severed: JointDef | null;
  killed: boolean;
}

/**
 * ГЛАВНЫЙ ВХОД. `vox` — точка попадания в ВОКСЕЛЬНЫХ координатах чувака
 * (ступни = 0, +Y вверх), `dir` — направление удара (нормализованное).
 */
export function applyBodyHit(
  id: string, vox: [number, number, number], dir: [number, number, number],
  damage: number, type: DamageType, seed: number,
): HitResult {
  const t = getTrauma(id);
  t.lastHitAt = Date.now();

  const part = partAtVox(vox[0], vox[1], vox[2]);
  const [ix, iy, iz] = voxelOf(part, vox[0], vox[1], vox[2]);
  const res: HitResult = {
    part, sub: subVolumeAt(part, iy), deepest: MAT.SKIN, organ: -1,
    carved: 0, bloodYield: 0, severed: null, killed: false,
  };
  if (t.limbs[part].severedAt >= iy) return res;          // бьёшь в пустоту — часть уже оторвана

  const r = carveRadius(type, damage);
  const p = PARTS[part];
  const g = p.grid;
  const R = Math.ceil(r);
  // канал по направлению для пробивающих: смещаем центр вглубь
  const march = type === 'pierce' || type === 'energy' ? 2 : 0;
  // Бюджет пробития — только у ПУЛЬ и лучей (застревают в кости). Взрыв, клинок
  // и дубина сносят весь свой объём: у них «бюджет» — это радиус, а не глубина.
  let budget = type === 'pierce' || type === 'energy' ? damage * 1.6 : Infinity;

  for (let step = 0; step <= march; step++) {
    const cx = ix + dir[0] * step, cy = iy + dir[1] * step, cz = iz + dir[2] * step;
    for (let y = Math.floor(cy - R); y <= Math.ceil(cy + R); y++) {
      for (let z = Math.floor(cz - R); z <= Math.ceil(cz + R); z++) {
        for (let x = Math.floor(cx - R); x <= Math.ceil(cx + R); x++) {
          if (x < 0 || y < 0 || z < 0 || x >= g[0] || y >= g[1] || z >= g[2]) continue;
          const dx = x - cx, dy = y - cy, dz = z - cz;
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (dist > r) continue;
          const vi = voxIndex(part, x, y, z);
          if (!t.masks[part][vi]) continue;

          const mat = materialAt(part, x, y, z);
          const falloff = 1 - (dist / (r + 0.001)) * 0.65;
          const eff = damage * MATERIALS[mat].resist[type] * falloff;
          if (eff < MATERIALS[mat].hp) continue;

          t.masks[part][vi] = 0;
          res.carved++;
          res.bloodYield += MATERIALS[mat].blood;
          if (mat > res.deepest) res.deepest = mat;
          budget -= MATERIALS[mat].hp * 0.25;

          const org = organAt(part, x, y, z);
          if (org >= 0) {
            t.organHp[org] = Math.max(0, t.organHp[org] - eff / ORGANS[org].hp);
            if (res.organ < 0) res.organ = org;
          }
          if (budget <= 0) { y = 1e9; z = 1e9; x = 1e9; }   // пуля застряла
        }
      }
    }
  }

  if (res.carved) {
    t.geoVersion[part]++;
    chunkInbox.push({
      id, color: MATERIALS[res.deepest].color,
      ox: (vox[0]) * BV, oy: vox[1] * BV, oz: vox[2] * BV,
      n: Math.min(14, 3 + Math.round(res.carved * 0.3)),
    });
  }

  // орган-убийца
  if (res.organ >= 0) {
    const o = ORGANS[res.organ];
    if (o.vital && t.organHp[res.organ] <= 0) {
      if (o.deathDelayMs === 0) { t.state = 'dead'; res.killed = true; }
      else if (!t.deadAt) t.deadAt = Date.now() + o.deathDelayMs;
    }
    spawnBleed(t, res.organ >= 0 ? o.bleed : 'venous', part, o.bleedRate);
  }

  // кровотечение от разрушенной ткани (энергия прижигает — ничего не течёт)
  if (type !== 'energy' && res.carved) {
    const bt: BleedType = res.deepest === MAT.ORGAN || res.deepest === MAT.MARROW ? 'arterial'
      : res.deepest === MAT.MUSCLE ? 'venous'
      : res.deepest === MAT.BONE ? 'internal' : 'capillary';
    spawnBleed(t, bt, part, BLEED_BASE[bt] * (0.6 + res.bloodYield * 0.5));
  } else if (type === 'blunt') {
    spawnBleed(t, 'internal', part, BLEED_BASE.internal * 0.7);
  }

  // ---- суставы: от дальнего к ближнему, первый сработавший и рвём ----
  for (const j of JOINTS_OF[part]) {
    if (t.limbs[part].severedAt >= j.cutY) continue;
    const verdict = evaluateJointFailure(t, j, type, damage, iy);
    if (verdict === 'full') {
      severLimb(t, j, dir);
      res.severed = j;
      if (j.killIfSevered) { t.state = 'dead'; res.killed = true; }
      break;
    }
    if (verdict === 'partial') t.limbs[part].hanging = true;
  }

  t.pain = Math.min(1, t.pain + damage * 0.004 + (res.severed ? 0.35 : 0));
  recomputeFunction(t);
  t.version++;
  return res;
}

/** Пояс сустава разрушен? Ноль рандома — иначе десинк. */
function evaluateJointFailure(
  t: TraumaState, j: JointDef, type: DamageType, dmg: number, hitY: number,
): 'none' | 'partial' | 'full' {
  const p = PARTS[j.part];
  const g = p.grid;
  let alive = 0, total = 0, boneAlive = 0;
  for (let z = 0; z < g[2]; z++)
    for (let x = 0; x < g[0]; x++) {
      if (!voxelExists(j.part, x, j.cutY, z)) continue;
      total++;
      if (t.masks[j.part][voxIndex(j.part, x, j.cutY, z)]) {
        alive++;
        const m = materialAt(j.part, x, j.cutY, z);
        if (m === MAT.BONE || m === MAT.MARROW) boneAlive++;
      }
    }
  if (!total) return 'none';
  const tissueRatio = 1 - alive / total;

  // урон копится в суставе, только если бил близко к нему
  if (Math.abs(hitY - j.cutY) <= 2) {
    const bonus = type === 'sharp' ? j.sharpBonus : type === 'blunt' ? j.bluntBonus : 1;
    t.jointDmg[j.id] += dmg * bonus;
  }

  const wouldSever = tissueRatio >= j.tissueRatioToFail || t.jointDmg[j.id] >= j.hp;
  // ГЛАВНОЕ ПРАВИЛО: пока КОСТЬ цела, конечность не отрывается — только виснет.
  // Пули кость не берут (resist 0.6 против hp 60) → пистолетом руку не оторвать,
  // а рельса/гарпун/чёрный лебедь/взрыв — отрывают.
  if (boneAlive > 0 && type !== 'explosive') return wouldSever ? 'partial' : 'none';
  if (wouldSever) return 'full';
  if (tissueRatio >= j.tissueRatioToFail * 0.8) return 'partial';
  return 'none';
}

function severLimb(t: TraumaState, j: JointDef, dir: [number, number, number]) {
  const p = PARTS[j.part];
  const g = p.grid;
  for (let y = 0; y <= j.cutY; y++)
    for (let z = 0; z < g[2]; z++)
      for (let x = 0; x < g[0]; x++) t.masks[j.part][voxIndex(j.part, x, y, z)] = 0;

  t.limbs[j.part].severedAt = Math.max(t.limbs[j.part].severedAt, j.cutY);
  t.limbs[j.part].hanging = false;
  t.geoVersion[j.part]++;
  severInbox.push({
    id: t.id, part: j.part, cutY: j.cutY,
    impulse: [dir[0] * j.detachImpulse, dir[1] * j.detachImpulse + 3, dir[2] * j.detachImpulse],
  });
  spawnBleed(t, 'arterial', j.part, BLEED_BASE.arterial * (j.cutY > 4 ? 1 : 0.55));
}

/**
 * Аркадный масштаб кровопотери. Анатомические темпы (сердце 260 мл/с) убивают
 * за секунды — честно, но в арена-шутере это не игра. Держим драму, срезая темп:
 * одно попадание пугает, три без передышки валят.
 */
const BLEED_SCALE = 0.28;

function spawnBleed(t: TraumaState, type: BleedType, part: PartId, rate0: number) {
  const rate = rate0 * BLEED_SCALE;
  // один тип на часть — не плодим эмиттеры
  const same = t.bleeds.find((b) => b.part === part && b.type === type && !b.stopAt);
  if (same) { same.rate = Math.max(same.rate, rate); return; }
  if (t.bleeds.length >= BLEED_CAP) {
    let worstIdx = 0;
    for (let i = 1; i < t.bleeds.length; i++) if (t.bleeds[i].rate < t.bleeds[worstIdx].rate) worstIdx = i;
    if (t.bleeds[worstIdx].rate >= rate) return;
    t.bleeds.splice(worstIdx, 1);
  }
  t.bleeds.push({ type, rate, part, startedAt: Date.now(), stopAt: 0 });
}

// ------------------------- ПЕРЕСЧЁТ ФУНКЦИЙ ТЕЛА -----------------------------

export function recomputeFunction(t: TraumaState) {
  for (let p = 0; p < PART_COUNT; p++) {
    const L = t.limbs[p];
    let alive = 0, total = 0;
    const g = PARTS[p].grid;
    for (let y = 0; y < g[1]; y++)
      for (let z = 0; z < g[2]; z++)
        for (let x = 0; x < g[0]; x++) {
          if (!voxelExists(p as PartId, x, y, z)) continue;
          total++;
          if (t.masks[p][voxIndex(p as PartId, x, y, z)]) alive++;
        }
    L.integrity = total ? alive / total : 0;

    if (L.severedAt >= PARTS[p].grid[1] - 1) L.fn = 0;
    else if (L.hanging) L.fn = 0.15;
    else {
      let base = L.integrity;
      if (L.severedAt >= 0) base *= 1 - (L.severedAt + 1) / PARTS[p].grid[1];
      if (!L.boneIntact) base *= 0.35;
      base *= 1 - t.pain * 0.4;
      L.fn = Math.max(0, Math.min(1, base));
    }
  }
}

/** Итоговые множители для движения и стрельбы (§9.3). */
export interface BodyMods {
  mobility: number;   // 0..1 множитель скорости
  canJump: boolean;
  crawling: boolean;
  aimSway: number;    // добавка к разбросу, рад
  fireRate: number;   // множитель интервала (>1 = медленнее)
  armsFn: number;
  legsFn: number;
  canGrapple: boolean;
}

export function bodyMods(t: TraumaState): BodyMods {
  const legs = (t.limbs[PART.legL].fn + t.limbs[PART.legR].fn) / 2;
  const arms = (t.limbs[PART.armL].fn + t.limbs[PART.armR].fn) / 2;
  const lungs = 1 - (t.organHp[ORGAN.LUNG_L] + t.organHp[ORGAN.LUNG_R]) / 2;
  const crawling = legs < 0.2 || t.state === 'crawling' || t.state === 'unconscious';
  return {
    legsFn: legs,
    armsFn: arms,
    crawling,
    mobility: crawling ? 0.18 : legs < 0.55 ? 0.5 + legs * 0.5 : 1,
    canJump: legs >= 0.35,
    aimSway: (1 - arms) * 0.055 + lungs * 0.012,
    fireRate: 1 / Math.max(0.3, arms),
    canGrapple: arms > 0.4,
  };
}

// ------------------------------ ТИК ------------------------------------------

/** Кровопотеря, шок, пороги сознания. Зовётся раз в кадр на своего бойца. */
export function traumaTick(t: TraumaState, dt: number): void {
  if (t.state === 'dead') return;
  const now = Date.now();

  const pressure = Math.pow(Math.max(0, t.blood) / BLOOD_MAX, 0.7);
  let loss = 0;
  for (const b of t.bleeds) {
    if (b.stopAt) continue;
    // Фаза 1: СВЁРТЫВАНИЕ. Пока нет полевой медицины (§10 — Фаза 4), рана
    // затягивается сама: капиллярная быстро, артериальная долго и страшно.
    const clotMs = b.type === 'arterial' ? 22000 : b.type === 'venous' ? 14000 : 9000;
    if (now - b.startedAt > clotMs) { b.stopAt = now; continue; }
    const r = b.type === 'arterial' ? b.rate * pressure * (1 + t.shock * 0.3) : b.rate;
    loss += r;
  }
  t.blood = Math.max(0, t.blood - loss * dt);
  // всё зажило → кровь потихоньку восстанавливается (иначе без аптечек не выжить)
  if (!loss) t.blood = Math.min(BLOOD_MAX, t.blood + 25 * dt);

  t.shock = Math.max(0, Math.min(1, t.shock + (loss / 400) * dt + t.pain * 0.15 * dt - (loss ? 0 : 0.09 * dt)));
  t.pain = Math.max(0, t.pain - 0.05 * dt);

  if (t.deadAt && now >= t.deadAt) { t.state = 'dead'; return; }
  if (t.blood <= DEATH_AT) { t.state = 'dead'; return; }
  if (t.blood <= UNCONSCIOUS_AT) { t.state = 'unconscious'; return; }
  const m = bodyMods(t);
  t.state = m.crawling ? 'crawling' : t.shock > 0.7 ? 'shock' : t.blood < BLOOD_MAX * 0.85 ? 'wounded' : 'healthy';
}

/** Суммарная кровопотеря в секунду — для VFX и HUD. */
export function bleedRateOf(t: TraumaState): number {
  let s = 0;
  for (const b of t.bleeds) if (!b.stopAt) s += b.rate;
  return s;
}
export function worstBleed(t: TraumaState): BleedType | null {
  let best: BleedType | null = null;
  for (const b of t.bleeds) {
    if (b.stopAt) continue;
    if (b.type === 'arterial') return 'arterial';
    if (!best || (b.type === 'venous' && best !== 'arterial')) best = b.type;
  }
  return best;
}

// ------------------------------- МЕДИЦИНА ------------------------------------

export type MedAction = 'bandage' | 'tourniquet' | 'cauterize' | 'splint';

/** §10, Фаза 1: три действия, которых хватает для цикла «ранен → жив». */
export function applyMedical(t: TraumaState, action: MedAction, part?: PartId): boolean {
  const now = Date.now();
  let did = false;
  switch (action) {
    case 'bandage':
      for (const b of t.bleeds) if (!b.stopAt && b.type !== 'arterial') { b.stopAt = now; did = true; }
      break;
    case 'tourniquet':
      for (const b of t.bleeds) {
        if (b.stopAt || b.part === PART.torso || b.part === PART.head) continue;
        if (part !== undefined && b.part !== part) continue;
        b.stopAt = now; did = true;
        t.limbs[b.part].fn *= 0.4;               // конечность мертвеет
      }
      break;
    case 'cauterize':
      for (const b of t.bleeds) if (!b.stopAt && b.type !== 'internal') { b.stopAt = now; did = true; }
      if (did) { t.pain = Math.min(1, t.pain + 0.45); t.shock = Math.min(1, t.shock + 0.2); }
      break;
    case 'splint':
      for (const L of t.limbs) if (!L.boneIntact) { L.boneIntact = true; did = true; }
      break;
  }
  if (did) { recomputeFunction(t); t.version++; }
  return did;
}

// ------------------------------- СЕТЬ ----------------------------------------

/** Дискретное состояние — 3 числа вместо масок (§12.1). */
export function serializeTrauma(t: TraumaState) {
  let flags = 0;
  for (let i = 0; i < PART_COUNT; i++) {
    if (t.limbs[i].severedAt >= 0) flags |= 1 << i;
    if (t.limbs[i].hanging) flags |= 1 << (6 + i);
  }
  return { f: flags, s: t.state, b: Math.round(t.blood), v: t.version };
}

export function applyTraumaSnapshot(id: string, snap: { f: number; s: FsmState; b: number; v: number }) {
  const t = getTrauma(id);
  if (snap.v <= t.version && t.version > 0) return;
  for (let i = 0; i < PART_COUNT; i++) {
    const severed = (snap.f & (1 << i)) !== 0;
    t.limbs[i].hanging = (snap.f & (1 << (6 + i))) !== 0;
    if (severed && t.limbs[i].severedAt < 0) {
      // приняли отрыв «сверху»: рубим по ближнему суставу
      const j = JOINTS_OF[i][JOINTS_OF[i].length - 1];
      if (j) severLimb(t, j, [0, 1, 0]);
    }
  }
  t.blood = snap.b;
  t.state = snap.s;
  t.version = snap.v;
  recomputeFunction(t);
}

export const partLabel = (p: PartId) => PART_LABEL[p];
