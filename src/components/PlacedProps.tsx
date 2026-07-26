import { Suspense, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { RigidBody } from '@react-three/rapier';
import { useStore } from '../store';
import { PALETTE } from '../theme';
import { tag } from '../game/hitTags';
import { getAsset } from '../config/assets';
import { AssetModel } from '../game/modelCache';
import { addTrauma } from '../game/shake';
import { playExplosionSound, playImpactSound } from '../utils/audio';
import { ringInbox } from '../game/botHorde';
import { chron } from '../game/chronicle';
import { builtHitInbox, findUnsupported, maxHp, dims, type BuiltPiece } from '../game/builtProps';

/**
 * Renders player-built props (Valheim × Fortnite build kit) — plus, for the
 * МАТЕМАТИЧЕСКАЯ БАШНЯ, the GIANT CANDLES you climb: they take damage, and
 * when a piece dies everything that loses its support chain COLLAPSES with it
 * (game/builtProps.ts holds the rules). Shared geometries/materials: 300
 * pieces = 300 draws of the same box, zero material churn.
 */

const BOX = new THREE.BoxGeometry(1, 1, 1);
const PAD_GEO = new THREE.CylinderGeometry(4, 4, 1, 20);

const holo = (hex: string, intensity = 0.9) =>
  new THREE.MeshStandardMaterial({
    color: hex, emissive: hex, emissiveIntensity: intensity, toneMapped: false,
    transparent: true, opacity: 0.92, metalness: 0.1, roughness: 0.35,
  });

const MAT_FLOOR = holo(PALETTE.bull);
const MAT_WALL = holo(PALETTE.uiCyan);
const MAT_PAD = holo(PALETTE.bull, 1.1);
// свечи башни: тело быка/медведя + светящийся фитиль
const MAT_BULL = new THREE.MeshStandardMaterial({ color: '#2fbf71', emissive: '#2fbf71', emissiveIntensity: 0.5, roughness: 0.4, metalness: 0.35, toneMapped: false });
const MAT_BEAR = new THREE.MeshStandardMaterial({ color: '#c9184a', emissive: '#c9184a', emissiveIntensity: 0.5, roughness: 0.4, metalness: 0.35, toneMapped: false });
const MAT_WICK = new THREE.MeshBasicMaterial({ color: '#ffe8b0', toneMapped: false });

const TAG_FLOOR = tag({ isFloor: true });
const TAG_WALL = tag({ isWall: true });
const TAG_PAD = tag({ isJumpPad: true, jumpForce: 95 });

const R45 = Math.PI / 4;

export const PropVisual = ({ assetId, material, id }: { assetId: string; material?: THREE.Material; id?: string }) => {
  const spec = getAsset(assetId);
  if (spec.loader === 'primitive') {
    switch (spec.prim) {
      case 'candle': {
        // ГИГАНТСКАЯ СВЕЧА: тело 6×24×6 (низ в нуле) + фитиль. Верх — пол:
        // по свечам ЛАЗЯТ. Тело — цель для оружия (isBuilt + id).
        const body = material ?? (assetId === 'gcandle_b' ? MAT_BEAR : MAT_BULL);
        const hit = id ? tag({ isFloor: true, isBuilt: true, id }) : TAG_FLOOR;
        return (
          <group>
            <mesh geometry={BOX} material={body} userData={hit} position={[0, 12, 0]} scale={[6, 24, 6]} />
            <mesh geometry={BOX} material={material ?? MAT_WICK} userData={hit} position={[0, 26, 0]} scale={[1.2, 4, 1.2]} />
          </group>
        );
      }
      case 'floor':
        return <mesh geometry={BOX} material={material ?? MAT_FLOOR} userData={TAG_FLOOR} position={[0, 0.2, 0]} scale={[4, 0.4, 4]} />;
      case 'platform':
        return <mesh geometry={BOX} material={material ?? MAT_FLOOR} userData={TAG_FLOOR} position={[0, 0.2, 0]} scale={[8, 0.4, 8]} />;
      case 'ramp':
        return <mesh geometry={BOX} material={material ?? MAT_FLOOR} userData={TAG_FLOOR} position={[0, 2, 0]} rotation={[-R45, 0, 0]} scale={[4, 0.4, 5.66]} />;
      case 'stairs':
        return (
          <group>
            {[0, 1, 2, 3].map((i) => (
              <mesh key={i} geometry={BOX} material={material ?? MAT_FLOOR} userData={TAG_FLOOR}
                    position={[0, ((i + 1) * 0.75) / 2, 1.5 - i]} scale={[4, (i + 1) * 0.75, 1]} />
            ))}
          </group>
        );
      case 'wall':
        return <mesh geometry={BOX} material={material ?? MAT_WALL} userData={TAG_WALL} position={[0, 1.5, 0]} scale={[4, 3, 0.4]} />;
      case 'halfwall':
        return <mesh geometry={BOX} material={material ?? MAT_WALL} userData={TAG_WALL} position={[0, 0.75, 0]} scale={[4, 1.5, 0.4]} />;
      case 'pillar':
        return <mesh geometry={BOX} material={material ?? MAT_WALL} userData={TAG_WALL} position={[0, 2, 0]} scale={[0.6, 4, 0.6]} />;
      case 'pad':
        return <mesh geometry={PAD_GEO} material={material ?? MAT_PAD} userData={TAG_PAD} />;
      default:
        return null;
    }
  }
  return (
    <Suspense fallback={null}>
      <AssetModel assetId={assetId} />
    </Suspense>
  );
};

const MAX_VISIBLE = 300;

export const PlacedProps = () => {
  const props = useStore((s) => s.placedProps);
  const hp = useRef<Map<string, number>>(new Map());

  // ── урон по постройкам + ОБВАЛ по-вальхеймски ────────────────────────────
  useFrame(() => {
    if (!builtHitInbox.length) return;
    const st = useStore.getState();
    const list = st.placedProps;
    const doomed: string[] = [];

    while (builtHitInbox.length) {
      const h = builtHitInbox.pop()!;
      const p = list.find((x) => x.id === h.id);
      if (!p) continue;
      const key = p.id;
      const left = (hp.current.get(key) ?? maxHp(p.assetId, p.scale)) - h.damage;
      if (left <= 0) {
        hp.current.delete(key);
        if (!doomed.includes(key)) doomed.push(key);
      } else {
        hp.current.set(key, left);
        playImpactSound();
      }
    }
    if (!doomed.length) return;

    // каскад: всё, что потеряло опору, падает следом
    const survivors: BuiltPiece[] = list
      .filter((p) => !doomed.includes(p.id))
      .map((p) => ({ id: p.id, assetId: p.assetId, x: p.x, y: p.y, z: p.z, scale: p.scale }));
    const orphans = findUnsupported(survivors);
    const all = [...doomed, ...orphans];

    const chunks: Parameters<typeof st.addDebris>[0] = [];
    for (const id of all) {
      const p = list.find((x) => x.id === id);
      if (!p) continue;
      const d = dims(p.assetId, p.scale);
      const bull = p.assetId !== 'gcandle_b';
      for (let i = 0; i < 12; i++) {
        const a = Math.random() * Math.PI * 2;
        chunks.push({
          x: p.x + (Math.random() - 0.5) * d.hw * 2,
          y: p.y + Math.random() * d.h,
          z: p.z + (Math.random() - 0.5) * d.hd * 2,
          vx: Math.cos(a) * (3 + Math.random() * 7),
          vy: 3 + Math.random() * 9,
          vz: Math.sin(a) * (3 + Math.random() * 7),
          color: bull ? '#2fbf71' : '#c9184a',
          size: 0.5 + Math.random() * 1.4,
          rx: Math.random() * 7, ry: Math.random() * 7, rz: Math.random() * 7,
          life: 1200 + Math.random() * 900,
        });
      }
      ringInbox.push({ x: p.x, y: p.y + d.h * 0.5, z: p.z });
      hp.current.delete(id);
      st.removeProp(id);
    }
    st.addDebris(chunks);
    playExplosionSound();
    addTrauma(orphans.length ? 0.45 : 0.2);
    if (orphans.length) chron(`⌁ ОБВАЛ: ${all.length} свечей рухнуло`);
  });

  const visible = props.length > MAX_VISIBLE ? props.slice(props.length - MAX_VISIBLE) : props;
  return (
    <>
      {visible.map((p) => (
        <RigidBody
          key={p.id}
          type={p.body}
          position={[p.x, p.y, p.z]}
          colliders="cuboid"
          enabledRotations={p.body === 'dynamic' ? undefined : [false, false, false]}
        >
          <group rotation={[0, p.rotY, 0]} scale={getAsset(p.assetId).baseScale * p.scale}>
            <PropVisual assetId={p.assetId} id={p.id} />
          </group>
        </RigidBody>
      ))}
    </>
  );
};
