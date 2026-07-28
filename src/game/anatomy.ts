import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * АНАТОМИЯ — слоистое воксельное тело (docs/BODY_DESTRUCTION.md §1-4, Фаза 1).
 *
 * Тело = 6 частей и ~1300 вокселей по 0.07. Материал воксела НЕ ХРАНИТСЯ — он
 * вычисляется из позиции внутри части (`materialAt`), поэтому слоистое тело
 * (кожа → жир → мышца → кость → мозг/органы) стоит ноль байт памяти.
 * Конечности сужаются к кисти/стопе: бедро и плечо трёхслойные (r=2), голень и
 * предплечье двухслойные (r=1) — поэтому кисть отлетает легко, а бедро почти
 * не оторвать. Всё здесь — чистые функции без состояния; состояние живёт в
 * game/trauma.ts.
 */

export const BV = 0.07;                    // размер воксела тела (мира)

// ------------------------------- ЧАСТИ --------------------------------------

export const PART = { head: 0, torso: 1, armL: 2, armR: 3, legL: 4, legR: 5 } as const;
export type PartId = 0 | 1 | 2 | 3 | 4 | 5;
export const PART_COUNT = 6;
export const PART_LABEL = ['ГОЛОВА', 'ТОРС', 'РУКА-Л', 'РУКА-П', 'НОГА-Л', 'НОГА-П'];

export interface PartDef {
  id: PartId;
  grid: [number, number, number];      // размеры воксельной сетки
  off: [number, number, number];       // угол сетки в координатах чувака (воксели, ступни = 0)
  pivot: [number, number, number];     // точка вращения (воксели) — сустав с родителем
  profile: 'head' | 'torso' | 'limb';
  vitalWeight: number;                 // вклад в общий HP
  massKg: number;
}

export const PARTS: PartDef[] = [
  { id: 0, grid: [6, 6, 6],  off: [-3, 20, -3], pivot: [0, 20, 0],  profile: 'head',  vitalWeight: 0.30, massKg: 5 },
  { id: 1, grid: [8, 10, 6], off: [-4, 10, -3], pivot: [0, 10, 0],  profile: 'torso', vitalWeight: 0.40, massKg: 34 },
  { id: 2, grid: [5, 8, 5],  off: [-7, 11, -2], pivot: [-5, 19, 0], profile: 'limb',  vitalWeight: 0.06, massKg: 4 },
  { id: 3, grid: [5, 8, 5],  off: [3, 11, -2],  pivot: [5, 19, 0],  profile: 'limb',  vitalWeight: 0.06, massKg: 4 },
  { id: 4, grid: [5, 10, 5], off: [-4, 0, -2],  pivot: [-2, 10, 0], profile: 'limb',  vitalWeight: 0.09, massKg: 11 },
  { id: 5, grid: [5, 10, 5], off: [0, 0, -2],   pivot: [2, 10, 0],  profile: 'limb',  vitalWeight: 0.09, massKg: 11 },
];

export const voxCount = (p: PartId) => PARTS[p].grid[0] * PARTS[p].grid[1] * PARTS[p].grid[2];
export const voxIndex = (p: PartId, x: number, y: number, z: number) => {
  const g = PARTS[p].grid;
  return (y * g[2] + z) * g[0] + x;
};

// --------------------------- СУБ-ОБЪЁМЫ (по локальному Y) --------------------

export const SUB_LABEL: Record<string, string> = {
  jaw: 'ЧЕЛЮСТЬ', skull: 'ЧЕРЕП', pelvis: 'ТАЗ', abdomen: 'ЖИВОТ', chest: 'ГРУДЬ',
  hand: 'КИСТЬ', forearm: 'ПРЕДПЛЕЧЬЕ', upperArm: 'ПЛЕЧО',
  foot: 'СТОПА', shin: 'ГОЛЕНЬ', thigh: 'БЕДРО',
};

/** Суб-объём по локальной высоте внутри части. */
export function subVolumeAt(part: PartId, iy: number): string {
  switch (PARTS[part].profile) {
    case 'head': return iy <= 1 ? 'jaw' : 'skull';
    case 'torso': return iy <= 1 ? 'pelvis' : iy <= 5 ? 'abdomen' : 'chest';
    default:
      if (part === PART.armL || part === PART.armR) return iy === 0 ? 'hand' : iy <= 3 ? 'forearm' : 'upperArm';
      return iy === 0 ? 'foot' : iy <= 4 ? 'shin' : 'thigh';
  }
}

// ------------------------------ МАТЕРИАЛЫ -----------------------------------

export const MAT = { SKIN: 0, FAT: 1, MUSCLE: 2, TENDON: 3, BONE: 4, MARROW: 5, BRAIN: 6, ORGAN: 7 } as const;
export type MatId = number;
export type DamageType = 'sharp' | 'blunt' | 'pierce' | 'explosive' | 'energy';

export interface MatDef {
  label: string;
  hp: number;                                   // порог разрушения одного воксела
  resist: Record<DamageType, number>;           // множитель ВХОДЯЩЕГО урона
  blood: number;                                // 0..1 выход крови
  color: string;
}

export const MATERIALS: MatDef[] = [
  { label: 'КОЖА',   hp: 6,  resist: { sharp: 1.6, blunt: 0.4, pierce: 1.3, explosive: 1.2, energy: 1.4 }, blood: 0.15, color: '#f5f0e6' },
  { label: 'ЖИР',    hp: 8,  resist: { sharp: 1.4, blunt: 0.7, pierce: 1.1, explosive: 1.2, energy: 1.3 }, blood: 0.20, color: '#ffe8b0' },
  { label: 'МЫШЦА',  hp: 18, resist: { sharp: 1.3, blunt: 0.9, pierce: 1.0, explosive: 1.3, energy: 1.1 }, blood: 0.55, color: '#c9184a' },
  { label: 'СВЯЗКА', hp: 26, resist: { sharp: 1.8, blunt: 0.5, pierce: 0.7, explosive: 1.0, energy: 1.0 }, blood: 0.10, color: '#e8d5c0' },
  { label: 'КОСТЬ',  hp: 60, resist: { sharp: 0.5, blunt: 1.8, pierce: 0.6, explosive: 1.4, energy: 0.8 }, blood: 0.05, color: '#fffaf0' },
  { label: 'МОЗГ-К', hp: 12, resist: { sharp: 1.0, blunt: 1.0, pierce: 1.0, explosive: 1.3, energy: 1.0 }, blood: 0.75, color: '#ff758f' },
  { label: 'МОЗГ',   hp: 10, resist: { sharp: 1.5, blunt: 1.6, pierce: 1.5, explosive: 1.8, energy: 1.2 }, blood: 0.60, color: '#ffb3c6' },
  { label: 'ОРГАН',  hp: 14, resist: { sharp: 1.5, blunt: 1.3, pierce: 1.4, explosive: 1.6, energy: 1.2 }, blood: 0.90, color: '#7a0c2e' },
];

// -------------------------------- ОРГАНЫ ------------------------------------

export const ORGAN = {
  BRAIN: 0, HEART: 1, AORTA: 2, LUNG_L: 3, LUNG_R: 4, LIVER: 5,
  SPLEEN: 6, STOMACH: 7, KIDNEY_L: 8, KIDNEY_R: 9, INTESTINES: 10,
} as const;
export type OrganId = number;
export type BleedType = 'arterial' | 'venous' | 'capillary' | 'internal';

export interface OrganDef {
  id: OrganId;
  label: string;
  host: PartId;
  box: [number, number, number, number, number, number]; // ixMin,ixMax,iyMin,iyMax,izMin,izMax
  hp: number;
  vital: boolean;
  deathDelayMs: number;
  bleed: BleedType;
  bleedRate: number;      // мл/с
  canSpill: boolean;
}

/** Порядок ВАЖЕН: первое совпадение выигрывает (сердце перед лёгкими и т.д.). */
export const ORGANS: OrganDef[] = [
  { id: 0,  label: 'МОЗГ',      host: 0, box: [0, 0, 0, 0, 0, 0],   hp: 10, vital: true,  deathDelayMs: 0,    bleed: 'internal',  bleedRate: 30,  canSpill: false },
  { id: 1,  label: 'СЕРДЦЕ',    host: 1, box: [3, 4, 7, 8, 2, 3],   hp: 14, vital: true,  deathDelayMs: 900,  bleed: 'arterial',  bleedRate: 260, canSpill: false },
  { id: 2,  label: 'АОРТА',     host: 1, box: [3, 4, 6, 9, 3, 3],   hp: 8,  vital: true,  deathDelayMs: 2500, bleed: 'arterial',  bleedRate: 400, canSpill: false },
  { id: 3,  label: 'ЛЁГКОЕ-Л',  host: 1, box: [2, 3, 6, 9, 2, 3],   hp: 20, vital: false, deathDelayMs: 0,    bleed: 'venous',    bleedRate: 70,  canSpill: false },
  { id: 4,  label: 'ЛЁГКОЕ-П',  host: 1, box: [4, 5, 6, 9, 2, 3],   hp: 20, vital: false, deathDelayMs: 0,    bleed: 'venous',    bleedRate: 70,  canSpill: false },
  { id: 5,  label: 'ПЕЧЕНЬ',    host: 1, box: [4, 5, 4, 5, 2, 3],   hp: 22, vital: false, deathDelayMs: 0,    bleed: 'venous',    bleedRate: 130, canSpill: false },
  { id: 6,  label: 'СЕЛЕЗЁНКА', host: 1, box: [2, 2, 5, 5, 3, 3],   hp: 10, vital: false, deathDelayMs: 0,    bleed: 'arterial',  bleedRate: 110, canSpill: false },
  { id: 7,  label: 'ЖЕЛУДОК',   host: 1, box: [2, 3, 4, 5, 2, 3],   hp: 16, vital: false, deathDelayMs: 0,    bleed: 'capillary', bleedRate: 35,  canSpill: false },
  { id: 8,  label: 'ПОЧКА-Л',   host: 1, box: [2, 2, 3, 4, 2, 2],   hp: 12, vital: false, deathDelayMs: 0,    bleed: 'arterial',  bleedRate: 90,  canSpill: false },
  { id: 9,  label: 'ПОЧКА-П',   host: 1, box: [5, 5, 3, 4, 2, 2],   hp: 12, vital: false, deathDelayMs: 0,    bleed: 'arterial',  bleedRate: 90,  canSpill: false },
  { id: 10, label: 'КИШКИ',     host: 1, box: [2, 5, 2, 3, 2, 3],   hp: 26, vital: false, deathDelayMs: 0,    bleed: 'venous',    bleedRate: 60,  canSpill: true },
];

/** Какой орган лежит в этом вокселе торса (−1 = никакой). */
function organAtTorso(ix: number, iy: number, iz: number): OrganId {
  for (let i = 1; i < ORGANS.length; i++) {
    const b = ORGANS[i].box;
    if (ix >= b[0] && ix <= b[1] && iy >= b[2] && iy <= b[3] && iz >= b[4] && iz <= b[5]) return ORGANS[i].id;
  }
  return -1;
}

// ----------------------- ГЕОМЕТРИЯ ТЕЛА: ЖИВ / МАТЕРИАЛ ---------------------

/** Радиус сечения конечности на этой высоте: 2 = трёхслойно (бедро/плечо), 1 = тонко. */
function limbRadius(part: PartId, iy: number): number {
  if (part === PART.armL || part === PART.armR) return iy >= 4 ? 2 : 1;
  return iy >= 5 ? 2 : 1;                       // нога: бедро толстое, голень тонкая
}

/** Есть ли вообще воксель в этой клетке сетки (конечности сужаются). */
export function voxelExists(part: PartId, ix: number, iy: number, iz: number): boolean {
  const p = PARTS[part];
  if (ix < 0 || iy < 0 || iz < 0 || ix >= p.grid[0] || iy >= p.grid[1] || iz >= p.grid[2]) return false;
  if (p.profile !== 'limb') return true;
  const r = limbRadius(part, iy);
  return Math.max(Math.abs(ix - 2), Math.abs(iz - 2)) <= r;
}

/** МАТЕРИАЛ ВОКСЕЛА — чистая функция от позиции (ноль памяти на материалы). */
export function materialAt(part: PartId, ix: number, iy: number, iz: number): MatId {
  const p = PARTS[part];

  if (p.profile === 'head') {
    const dx = ix - 2.5, dy = iy - 2.5, dz = iz - 2.5;
    if (dx * dx + dy * dy + dz * dz <= 3.7) return MAT.BRAIN;          // мозг — сфера в центре
    const shell = ix === 0 || ix === 5 || iy === 0 || iy === 5 || iz === 0 || iz === 5;
    return shell ? MAT.SKIN : MAT.BONE;                                 // череп
  }

  if (p.profile === 'torso') {
    const dx = Math.min(ix, p.grid[0] - 1 - ix);
    const dz = Math.min(iz, p.grid[2] - 1 - iz);
    const d = Math.min(dx, dz);
    if (d === 0) return MAT.SKIN;
    const org = organAtTorso(ix, iy, iz);
    if (org >= 0) return MAT.ORGAN;
    if (iy <= 1) return MAT.BONE;                                       // таз
    if (ix >= 3 && ix <= 4 && iz === 1) return MAT.BONE;                // позвоночник
    if (iy >= 6 && d === 1 && iy % 2 === 0) return MAT.BONE;            // РЁБРА (щели между ними!)
    if (d === 1 && iy <= 5) return MAT.FAT;
    return MAT.MUSCLE;
  }

  // конечность: кость по оси → мышца → кожа
  const r = limbRadius(part, iy);
  const cheb = Math.max(Math.abs(ix - 2), Math.abs(iz - 2));
  if (cheb >= r) return MAT.SKIN;
  if (cheb === 0) return (r === 2 && iy % 3 === 0) ? MAT.MARROW : MAT.BONE;
  return MAT.MUSCLE;
}

/** Какой орган в этом вокселе (для торса и головы). */
export function organAt(part: PartId, ix: number, iy: number, iz: number): OrganId {
  if (part === PART.head) return materialAt(part, ix, iy, iz) === MAT.BRAIN ? ORGAN.BRAIN : -1;
  if (part === PART.torso) return organAtTorso(ix, iy, iz);
  return -1;
}

// -------------------------------- СУСТАВЫ -----------------------------------

export interface JointDef {
  id: number;
  label: string;
  part: PartId;              // часть, у которой отваливается низ
  cutY: number;              // всё с iy <= cutY уходит
  hp: number;
  tissueRatioToFail: number; // доля разрушенной ткани в поясе сустава
  sharpBonus: number;
  bluntBonus: number;
  detachImpulse: number;
  killIfSevered: boolean;
}

export const JOINTS: JointDef[] = [
  { id: 0,  label: 'ШЕЯ',      part: 0, cutY: 5, hp: 55, tissueRatioToFail: 0.65, sharpBonus: 3.0, bluntBonus: 0.5, detachImpulse: 9,  killIfSevered: true },
  { id: 1,  label: 'ПЛЕЧО-Л',  part: 2, cutY: 7, hp: 70, tissueRatioToFail: 0.72, sharpBonus: 2.5, bluntBonus: 0.6, detachImpulse: 12, killIfSevered: false },
  { id: 2,  label: 'ЛОКОТЬ-Л', part: 2, cutY: 3, hp: 45, tissueRatioToFail: 0.60, sharpBonus: 2.8, bluntBonus: 0.6, detachImpulse: 10, killIfSevered: false },
  { id: 3,  label: 'КИСТЬ-Л',  part: 2, cutY: 0, hp: 28, tissueRatioToFail: 0.50, sharpBonus: 3.2, bluntBonus: 0.7, detachImpulse: 8,  killIfSevered: false },
  { id: 4,  label: 'ПЛЕЧО-П',  part: 3, cutY: 7, hp: 70, tissueRatioToFail: 0.72, sharpBonus: 2.5, bluntBonus: 0.6, detachImpulse: 12, killIfSevered: false },
  { id: 5,  label: 'ЛОКОТЬ-П', part: 3, cutY: 3, hp: 45, tissueRatioToFail: 0.60, sharpBonus: 2.8, bluntBonus: 0.6, detachImpulse: 10, killIfSevered: false },
  { id: 6,  label: 'КИСТЬ-П',  part: 3, cutY: 0, hp: 28, tissueRatioToFail: 0.50, sharpBonus: 3.2, bluntBonus: 0.7, detachImpulse: 8,  killIfSevered: false },
  { id: 7,  label: 'БЕДРО-Л',  part: 4, cutY: 9, hp: 95, tissueRatioToFail: 0.80, sharpBonus: 2.0, bluntBonus: 0.5, detachImpulse: 14, killIfSevered: false },
  { id: 8,  label: 'КОЛЕНО-Л', part: 4, cutY: 4, hp: 60, tissueRatioToFail: 0.65, sharpBonus: 2.6, bluntBonus: 0.6, detachImpulse: 11, killIfSevered: false },
  { id: 9,  label: 'СТОПА-Л',  part: 4, cutY: 0, hp: 32, tissueRatioToFail: 0.52, sharpBonus: 3.0, bluntBonus: 0.7, detachImpulse: 8,  killIfSevered: false },
  { id: 10, label: 'БЕДРО-П',  part: 5, cutY: 9, hp: 95, tissueRatioToFail: 0.80, sharpBonus: 2.0, bluntBonus: 0.5, detachImpulse: 14, killIfSevered: false },
  { id: 11, label: 'КОЛЕНО-П', part: 5, cutY: 4, hp: 60, tissueRatioToFail: 0.65, sharpBonus: 2.6, bluntBonus: 0.6, detachImpulse: 11, killIfSevered: false },
  { id: 12, label: 'СТОПА-П',  part: 5, cutY: 0, hp: 32, tissueRatioToFail: 0.52, sharpBonus: 3.0, bluntBonus: 0.7, detachImpulse: 8,  killIfSevered: false },
];

/**
 * Суставы этой части, от БЛИЖНЕГО к телу (плечо/бедро) к дальнему (кисть/стопа).
 * Порядок важен: если разнесло бедро, отлетает ВСЯ нога, а не только стопа —
 * побеждает самый проксимальный отказ.
 */
export const JOINTS_OF: JointDef[][] = PARTS.map((p) =>
  JOINTS.filter((j) => j.part === p.id).sort((a, b) => b.cutY - a.cutY),
);

// ------------------------- ПОПАДАНИЕ → ЧАСТЬ/ВОКСЕЛЬ ------------------------

const LIMB_ORDER: PartId[] = [PART.armL, PART.armR, PART.legL, PART.legR, PART.head];
/**
 * Часть тела по локальной точке чувака (ступни = 0), в ВОКСЕЛЯХ.
 * Сначала пробуем конечности — точка засчитывается той части, в чьей сетке
 * РЕАЛЬНО есть воксель (плечи перекрывают торс, и рука должна выигрывать);
 * если ни одна не подошла — это торс.
 */
export function partAtVox(vx: number, vy: number, vz: number): PartId {
  for (const p of LIMB_ORDER) {
    const d = PARTS[p];
    if (voxelExists(p, Math.round(vx - d.off[0]), Math.round(vy - d.off[1]), Math.round(vz - d.off[2]))) return p;
  }
  return PART.torso;
}

/** Локальные координаты воксела внутри части (могут выйти за сетку — зажимаем). */
export function voxelOf(part: PartId, vx: number, vy: number, vz: number): [number, number, number] {
  const p = PARTS[part];
  const ix = Math.min(p.grid[0] - 1, Math.max(0, Math.round(vx - p.off[0])));
  const iy = Math.min(p.grid[1] - 1, Math.max(0, Math.round(vy - p.off[1])));
  const iz = Math.min(p.grid[2] - 1, Math.max(0, Math.round(vz - p.off[2])));
  return [ix, iy, iz];
}

/** Ступни вокс-чувака лежат на root.y − 1 (сеть шлёт центр капсулы). */
export const FEET_Y = -1;

const _vp = new THREE.Vector3();
/**
 * Мировая точка попадания → ВОКСЕЛЬНЫЕ координаты чувака (ступни = 0).
 * `worldToLocal` сам снимает поворот И масштаб (рост L/K), поэтому у гиганта
 * попадания ложатся туда же, куда у обычного бойца.
 */
export function voxAt(root: THREE.Object3D, point: THREE.Vector3): [number, number, number] {
  _vp.copy(point);
  root.worldToLocal(_vp);
  return [_vp.x / BV, (_vp.y - FEET_Y) / BV, _vp.z / BV];
}

const _vd = new THREE.Vector3();
const _vq = new THREE.Quaternion();
/** Мировое направление удара → локальное направление внутри тела (для канала). */
export function dirAt(root: THREE.Object3D, dir: THREE.Vector3): [number, number, number] {
  root.getWorldQuaternion(_vq).invert();
  _vd.copy(dir).applyQuaternion(_vq).normalize();
  return [_vd.x, _vd.y, _vd.z];
}

// --------------------------- ГЕОМЕТРИЯ ИЗ МАСКИ -----------------------------

const _box = new THREE.BoxGeometry(BV * 0.94, BV * 0.94, BV * 0.94);

/** Нетронутая маска части (единицы там, где воксель существует). */
export function pristineMask(part: PartId): Uint8Array {
  const m = new Uint8Array(voxCount(part));
  const g = PARTS[part].grid;
  for (let y = 0; y < g[1]; y++)
    for (let z = 0; z < g[2]; z++)
      for (let x = 0; x < g[0]; x++)
        if (voxelExists(part, x, y, z)) m[voxIndex(part, x, y, z)] = 1;
  return m;
}

/**
 * Меш части из маски. Рендерим ТОЛЬКО ОТКРЫТЫЕ воксели (у которых есть мёртвый
 * сосед) — внутренности не тратят треугольники, пока их не вскрыли. Координаты
 * относительно pivot части, чтобы вращение в суставе осталось прежним.
 */
export function buildPartGeometry(part: PartId, mask: Uint8Array): THREE.BufferGeometry {
  const p = PARTS[part];
  const g = p.grid;
  const out: THREE.BufferGeometry[] = [];
  const colors: number[] = [];
  const c = new THREE.Color();

  for (let y = 0; y < g[1]; y++) {
    for (let z = 0; z < g[2]; z++) {
      for (let x = 0; x < g[0]; x++) {
        if (!mask[voxIndex(part, x, y, z)]) continue;
        // открыт ли воксель наружу
        const hidden =
          alive(x - 1, y, z) && alive(x + 1, y, z) &&
          alive(x, y - 1, z) && alive(x, y + 1, z) &&
          alive(x, y, z - 1) && alive(x, y, z + 1);
        if (hidden) continue;

        const b = _box.clone();
        b.translate(
          (x + p.off[0] - p.pivot[0] + 0.5) * BV,
          (y + p.off[1] - p.pivot[1] + 0.5) * BV,
          (z + p.off[2] - p.pivot[2] + 0.5) * BV,
        );
        out.push(b);
        c.set(MATERIALS[materialAt(part, x, y, z)].color);
        for (let v = 0; v < b.attributes.position.count; v++) colors.push(c.r, c.g, c.b);
      }
    }
  }

  function alive(x: number, y: number, z: number) {
    if (x < 0 || y < 0 || z < 0 || x >= g[0] || y >= g[1] || z >= g[2]) return false;
    return mask[voxIndex(part, x, y, z)] === 1;
  }

  if (!out.length) return new THREE.BufferGeometry();
  const merged = mergeGeometries(out);
  out.forEach((b) => b.dispose());
  merged.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return merged;
}

// нетронутая геометрия — ОДНА на всех целых бойцов (ноль ребилдов в бою)
const _pristineGeo: (THREE.BufferGeometry | null)[] = [null, null, null, null, null, null];
export function pristineGeometry(part: PartId): THREE.BufferGeometry {
  let g = _pristineGeo[part];
  if (!g) { g = buildPartGeometry(part, pristineMask(part)); _pristineGeo[part] = g; }
  return g;
}
