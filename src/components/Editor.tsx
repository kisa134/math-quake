import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../store';
import { useKeyboard } from '../hooks/useKeyboard';
import { socket } from '../socket';
import { getAsset, BUILD_IDS } from '../config/assets';
import { buildCost, isSupportedAt, type BuiltPiece } from '../game/builtProps';
import { isTower } from '../config/maps';
import { PropVisual } from './PlacedProps';

/**
 * Valheim × Fortnite build editor (toggle B). ONLY cheap primitive build pieces
 * (BUILD_IDS — no model loads in the palette). Aim at any surface; placement
 * snaps to a 2-unit grid (x/y/z) and 90° rotation steps. Scroll = cycle piece,
 * R = rotate 90°, [ / ] = size ×1–×2, G = static⇄physics, LMB place, RMB delete.
 * Ghost tints green when placement is valid, red when nothing is hit.
 * Placements broadcast (+ late-join snapshot in socket.ts). Weapons/grapple are
 * suppressed while editing (Player.tsx).
 */
const _center = new THREE.Vector2(0, 0);
const _ray = new THREE.Raycaster();

const GRID = 2;                    // grid snap (units)
const ROT_STEP = Math.PI / 2;      // 90° rotation steps
const SCALE_MIN = 0.25;            // V8.5: sandbox range — tiny…
const SCALE_MAX = 30;              // …to гигантизм (×3-правило)
const GHOST_RANGE = 30;            // where the red ghost floats when nothing is hit

const snap = (v: number) => Math.round(v / GRID) * GRID;
const snapRot = (r: number) => Math.round(r / ROT_STEP) * ROT_STEP;

// Ghost-only tintable holo material (module-level, mutated in useFrame — never
// shared with placed pieces, so tinting it can't leak into the world).
const GHOST_MAT = new THREE.MeshStandardMaterial({
  transparent: true,
  opacity: 0.55,
  toneMapped: false,
  depthWrite: false,
  metalness: 0,
  roughness: 0.5,
});
const COL_VALID = new THREE.Color('#00f5d4');   // PALETTE.bull
const COL_INVALID = new THREE.Color('#ff2d2d'); // PALETTE.alertRed

export const Editor = () => {
  const { camera, scene } = useThree();
  const keys = useKeyboard();
  const editorSelect = useStore((s) => s.editorSelect); // ghost model swaps on this
  const ghostRef = useRef<THREE.Group>(null);
  const prevPlace = useRef(false);
  const prevDelete = useRef(false);
  const hitPt = useRef(new THREE.Vector3());   // raw surface hit (delete search)
  const snapPt = useRef(new THREE.Vector3());  // grid-snapped placement point
  const hasHit = useRef(false);

  // Editor-only input: scroll cycles build piece, R/[/]/G tweak the transform.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useStore.getState();
      if (!st.editorMode) return;
      if (e.code === 'KeyR') st.setEditorRotY(snapRot(st.editorRotY) + ROT_STEP);
      else if (e.code === 'BracketRight' || e.code === 'Equal') st.setEditorScale(Math.min(SCALE_MAX, st.editorScale * 1.25));
      else if (e.code === 'BracketLeft' || e.code === 'Minus') st.setEditorScale(Math.max(SCALE_MIN, st.editorScale / 1.25));
      else if (e.code === 'KeyG') st.setEditorBody(st.editorBody === 'fixed' ? 'dynamic' : 'fixed');
    };
    const onWheel = (e: WheelEvent) => {
      const st = useStore.getState();
      if (!st.editorMode) return;
      const i = BUILD_IDS.indexOf(st.editorSelect);
      const n = (i + (e.deltaY > 0 ? 1 : -1) + BUILD_IDS.length) % BUILD_IDS.length;
      st.setEditorSelect(BUILD_IDS[n]);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('wheel', onWheel, { passive: true });
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('wheel', onWheel); };
  }, []);

  useFrame(() => {
    const st = useStore.getState();
    // V8.5: clicks belong to the HUB when the pointer is free — never place
    if (!st.editorMode || !document.pointerLockElement) {
      if (ghostRef.current) ghostRef.current.visible = false;
      prevPlace.current = keys.shoot;
      prevDelete.current = keys.grapple;
      return;
    }
    const sel = st.editorSelect;
    const spec = getAsset(sel);
    // V8.5: the whole catalogue is placeable — no buildable guard anymore.
    const off = spec.prim === 'pad' ? 0.5 : 0; // legacy pad is center-origin
    const rotY = snapRot(st.editorRotY);
    const scl = Math.min(SCALE_MAX, Math.max(SCALE_MIN, st.editorScale));

    _ray.setFromCamera(_center, camera);
    const hits = _ray.intersectObjects(scene.children, true);
    hasHit.current = false;
    for (const h of hits) {
      // The always-visible ghost carries hit tags too — never raycast ourselves.
      let o: THREE.Object3D | null = h.object;
      let isGhost = false;
      while (o) { if (o === ghostRef.current) { isGhost = true; break; } o = o.parent; }
      if (isGhost) continue;
      const ud = h.object.userData;
      if (ud?.isFloor || ud?.isWall || ud?.isJumpPad) {
        hitPt.current.copy(h.point);
        hasHit.current = true;
        break;
      }
    }

    if (hasHit.current) {
      snapPt.current.set(snap(hitPt.current.x), snap(hitPt.current.y) + off, snap(hitPt.current.z));
    } else {
      _ray.ray.at(GHOST_RANGE, snapPt.current); // free-floating red ghost
    }

    if (ghostRef.current) {
      ghostRef.current.visible = true;
      ghostRef.current.position.copy(snapPt.current);
      ghostRef.current.rotation.y = rotY;
      ghostRef.current.scale.setScalar(spec.baseScale * scl);
      GHOST_MAT.color.copy(hasHit.current ? COL_VALID : COL_INVALID);
      GHOST_MAT.emissive.copy(hasHit.current ? COL_VALID : COL_INVALID);
      GHOST_MAT.emissiveIntensity = hasHit.current ? 0.9 : 0.6;
    }

    // place (LMB edge) — only on a valid snapped surface hit
    if (keys.shoot && !prevPlace.current && hasHit.current) {
      const prop = {
        id: Math.random().toString(36).slice(2, 9),
        assetId: sel,
        x: snapPt.current.x, y: snapPt.current.y, z: snapPt.current.z,
        rotY,
        scale: scl,
        body: st.editorBody,
      };
      // МАТ-БАШНЯ: стройка стоит ДЕНЕГ и требует ОПОРЫ (Valheim-правило)
      if (isTower()) {
        const cost = buildCost(sel, scl);
        const cand: BuiltPiece = { id: prop.id, assetId: sel, x: prop.x, y: prop.y, z: prop.z, scale: scl };
        const existing: BuiltPiece[] = st.placedProps.map((q) => ({
          id: q.id, assetId: q.assetId, x: q.x, y: q.y, z: q.z, scale: q.scale,
        }));
        if (st.money < cost || !isSupportedAt(cand, existing)) {
          prevPlace.current = keys.shoot;
          return; // нет денег или висит в воздухе — не ставим
        }
        st.addMoney(-cost);
      }
      st.addProp(prop);
      socket.emit('place', { prop });
    }
    prevPlace.current = keys.shoot;

    // delete (RMB edge) — nearest placed prop to the aim point
    if (keys.grapple && !prevDelete.current && hasHit.current) {
      let best: string | null = null;
      let bestD = 12 * 12;
      for (const p of st.placedProps) {
        const dx = p.x - hitPt.current.x, dy = p.y - hitPt.current.y, dz = p.z - hitPt.current.z;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bestD) { bestD = d; best = p.id; }
      }
      if (best) { st.removeProp(best); socket.emit('remove', { id: best }); }
    }
    prevDelete.current = keys.grapple;
  });

  // Ghost = the real piece with a tintable override material (swaps when
  // editorSelect changes); transform + tint driven imperatively each frame.
  return (
    <group ref={ghostRef} visible={false}>
      <PropVisual assetId={editorSelect} material={GHOST_MAT} />
    </group>
  );
};
