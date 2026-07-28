import { useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { LIMB } from '../game/voxHumanoid';
import { WEAPONS } from '../config/weapons';
import { buildVoxGun, type VoxGunKind } from '../game/voxGuns';
import { PART, PARTS, BV, pristineGeometry, buildPartGeometry, type PartId } from '../game/anatomy';
import { peekTrauma } from '../game/trauma';

/**
 * ВОКС-ЧУВАК — теперь СЛОИСТОЕ тело (docs/BODY_DESTRUCTION.md).
 * Шесть частей рисуются из воксельных МАСОК: пока боец цел, все шесть берут одну
 * общую «нетронутую» геометрию (ноль ребилдов и ноль лишней памяти на всю толпу);
 * как только в тело прилетело — часть перестраивается из своей маски и открывает
 * то, что под кожей: жир, мышцу, кость, рёбра, органы, мозг. Рендерятся только
 * ОТКРЫТЫЕ воксели, поэтому целый боец стоит не дороже прежнего.
 * Перестройки идут по бюджету — не больше 2 на кадр на всю сцену.
 * Процедурная походка (руки/ноги в противофазе) и позы прицела — как были.
 */

// одна общая материя тела: цвет слоя приходит из вершинных цветов геометрии
const BODY_MAT = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.55,
  metalness: 0.05,
  emissive: '#2a2622',
  emissiveIntensity: 0.35,
});
const EYE_MAT = new THREE.MeshBasicMaterial({ color: '#1a1a1a' });
const EYE_GEO = new THREE.BoxGeometry(0.07, 0.07, 0.03);

// V9 К: чужой ствол — те же вокс-геометрии, что и от первого лица.
const NO_RAYCAST = () => {};
const HELD_BODY_MAT = new THREE.MeshStandardMaterial({ color: '#0f0e0d', roughness: 0.55, metalness: 0.55 });
const HELD_GLOW_MAT = new THREE.MeshStandardMaterial({
  color: '#c8b273', emissive: '#c8b273', emissiveIntensity: 1.2, toneMapped: false,
});

const HeldGun = ({ weapon }: { weapon: number }) => {
  const spec = WEAPONS[weapon] ?? WEAPONS[0];
  const kind = (spec.voxel ?? 'smg') as VoxGunKind;
  const build = useMemo(() => buildVoxGun(kind), [kind]);
  return (
    <group position={[0, -0.5, 0.26]} rotation={[0.12, 0, 0]} scale={0.92}>
      <mesh geometry={build.body} material={HELD_BODY_MAT} raycast={NO_RAYCAST} />
      <mesh geometry={build.glow} material={HELD_GLOW_MAT} raycast={NO_RAYCAST} />
      {build.moving && (
        <mesh geometry={build.moving.geo} material={HELD_BODY_MAT} position={build.moving.pos} raycast={NO_RAYCAST} />
      )}
    </group>
  );
};

// ---- бюджет перестроек: не больше 2 на кадр на всю сцену (§13.1) ----
let rebuildFrame = -1;
let rebuildsThisFrame = 0;
function claimRebuild(frame: number): boolean {
  if (frame !== rebuildFrame) { rebuildFrame = frame; rebuildsThisFrame = 0; }
  if (rebuildsThisFrame >= 2) return false;
  rebuildsThisFrame++;
  return true;
}

/** Одна часть тела: общая нетронутая геометрия, пока в неё не попали. */
const PartMesh = ({ part, traumaId }: { part: PartId; traumaId?: string }) => {
  const [geo, setGeo] = useState<THREE.BufferGeometry>(() => pristineGeometry(part));
  const seen = useRef(0);
  const own = useRef<THREE.BufferGeometry | null>(null);

  useFrame((state) => {
    if (!traumaId) return;
    const t = peekTrauma(traumaId);
    if (!t || t.geoVersion[part] === seen.current) return;
    if (!claimRebuild(state.clock.elapsedTime * 1000 | 0)) return;
    seen.current = t.geoVersion[part];
    const next = buildPartGeometry(part, t.masks[part]);
    own.current?.dispose();
    own.current = next;
    setGeo(next);
  });

  return <mesh geometry={geo} material={BODY_MAT} />;
};

export const VoxDude = ({
  limbMask = 0,
  getSpeed,
  weapon,
  aiming = false,
  traumaId,
}: {
  limbMask?: number;
  getSpeed?: () => number;
  weapon?: number;       // ствол в правой руке — видно, чем в тебя целят
  aiming?: boolean;      // жмёт на курок → руки вскинуты вперёд
  traumaId?: string;     // id в реестре травм → тело рисуется из масок
}) => {
  const armL = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const legL = useRef<THREE.Group>(null);
  const legR = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const phase = useRef(Math.random() * Math.PI * 2);
  const aimK = useRef(0);
  const crawlK = useRef(0);

  const gone = (bit: number) => (limbMask & (1 << bit)) !== 0;
  // ползёт, если обеих ног нет — по старой маске ИЛИ по травме
  const t = traumaId ? peekTrauma(traumaId) : undefined;
  const legLGone = gone(LIMB.legL) || (t ? t.limbs[PART.legL].fn < 0.15 : false);
  const legRGone = gone(LIMB.legR) || (t ? t.limbs[PART.legR].fn < 0.15 : false);
  const noLegs = legLGone && legRGone;

  useFrame((_, dt) => {
    const spd = getSpeed ? getSpeed() : 0;
    const k = Math.min(1, spd / 12);
    phase.current += dt * (4 + spd * 0.55);
    const s = Math.sin(phase.current) * 0.75 * k;
    aimK.current += ((aiming ? 1 : 0) - aimK.current) * Math.min(1, dt * 10);
    crawlK.current += ((noLegs ? 1 : 0) - crawlK.current) * Math.min(1, dt * 6);
    const a = aimK.current;
    if (armL.current) armL.current.rotation.x = s * (1 - a) + -1.15 * a;
    if (armR.current) armR.current.rotation.x = -s * (1 - a) + -1.45 * a;
    if (legL.current) legL.current.rotation.x = -s;
    if (legR.current) legR.current.rotation.x = s;
    if (body.current) {
      const c = crawlK.current;
      body.current.position.y = Math.abs(Math.sin(phase.current)) * 0.06 * k - 0.62 * c;
      body.current.rotation.x = -1.25 * c;
    }
  });

  const piv = (p: PartId): [number, number, number] =>
    [PARTS[p].pivot[0] * BV, PARTS[p].pivot[1] * BV, PARTS[p].pivot[2] * BV];

  return (
    <group ref={body}>
      {/* ноги (вращение в бедре) */}
      {!gone(LIMB.legL) && (
        <group ref={legL} position={piv(PART.legL)}>
          <PartMesh part={PART.legL} traumaId={traumaId} />
        </group>
      )}
      {!gone(LIMB.legR) && (
        <group ref={legR} position={piv(PART.legR)}>
          <PartMesh part={PART.legR} traumaId={traumaId} />
        </group>
      )}
      {/* торс (вращение в тазу) */}
      <group position={piv(PART.torso)}>
        <PartMesh part={PART.torso} traumaId={traumaId} />
      </group>
      {/* руки (вращение в плече) */}
      {!gone(LIMB.armL) && (
        <group ref={armL} position={piv(PART.armL)}>
          <PartMesh part={PART.armL} traumaId={traumaId} />
        </group>
      )}
      {!gone(LIMB.armR) && (
        <group ref={armR} position={piv(PART.armR)}>
          <PartMesh part={PART.armR} traumaId={traumaId} />
          {weapon !== undefined && <HeldGun weapon={weapon} />}
        </group>
      )}
      {/* голова (вращение в шее) + глаза */}
      {!gone(LIMB.head) && (
        <group position={piv(PART.head)}>
          <PartMesh part={PART.head} traumaId={traumaId} />
          <mesh geometry={EYE_GEO} material={EYE_MAT} position={[-0.1, 0.28, -0.22]} />
          <mesh geometry={EYE_GEO} material={EYE_MAT} position={[0.1, 0.28, -0.22]} />
        </group>
      )}
    </group>
  );
};
