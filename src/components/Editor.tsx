import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../store';
import { useKeyboard } from '../hooks/useKeyboard';
import { socket } from '../socket';
import { getAsset, ASSET_IDS } from '../config/assets';
import { PropVisual } from './PlacedProps';

/**
 * Valheim-style build editor (toggle B). Aim at any surface; the ghost is the
 * real model at the current transform. Scroll = cycle asset, R = rotate,
 * [ / ] = scale down/up, G = static⇄physics, LMB = place, RMB = delete nearest.
 * Placements broadcast (+ late-join snapshot in socket.ts). Weapons/grapple are
 * suppressed while editing (Player.tsx).
 */
const _center = new THREE.Vector2(0, 0);
const _ray = new THREE.Raycaster();

export const Editor = () => {
  const { camera, scene } = useThree();
  const keys = useKeyboard();
  const editorSelect = useStore((s) => s.editorSelect); // ghost model swaps on this
  const ghostRef = useRef<THREE.Group>(null);
  const prevPlace = useRef(false);
  const prevDelete = useRef(false);
  const hitPt = useRef(new THREE.Vector3());
  const hasHit = useRef(false);

  // Editor-only input: scroll cycles asset, R/[/]/G tweak the transform.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useStore.getState();
      if (!st.editorMode) return;
      if (e.code === 'KeyR') st.setEditorRotY(st.editorRotY + Math.PI / 8);
      else if (e.code === 'BracketRight' || e.code === 'Equal') st.setEditorScale(Math.min(30, st.editorScale * 1.15));
      else if (e.code === 'BracketLeft' || e.code === 'Minus') st.setEditorScale(Math.max(0.1, st.editorScale / 1.15));
      else if (e.code === 'KeyG') st.setEditorBody(st.editorBody === 'fixed' ? 'dynamic' : 'fixed');
    };
    const onWheel = (e: WheelEvent) => {
      const st = useStore.getState();
      if (!st.editorMode) return;
      const i = ASSET_IDS.indexOf(st.editorSelect);
      const n = (i + (e.deltaY > 0 ? 1 : -1) + ASSET_IDS.length) % ASSET_IDS.length;
      st.setEditorSelect(ASSET_IDS[n]);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('wheel', onWheel, { passive: true });
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('wheel', onWheel); };
  }, []);

  useFrame(() => {
    const st = useStore.getState();
    if (!st.editorMode) {
      if (ghostRef.current) ghostRef.current.visible = false;
      prevPlace.current = keys.shoot;
      prevDelete.current = keys.grapple;
      return;
    }
    const sel = st.editorSelect;
    const spec = getAsset(sel);
    const off = spec.prim === 'pad' ? 0.5 : 0;

    _ray.setFromCamera(_center, camera);
    const hits = _ray.intersectObjects(scene.children, true);
    hasHit.current = false;
    for (const h of hits) {
      const ud = h.object.userData;
      if (ud?.isFloor || ud?.isWall || ud?.isJumpPad) {
        hitPt.current.copy(h.point);
        hasHit.current = true;
        break;
      }
    }

    if (ghostRef.current) {
      ghostRef.current.visible = hasHit.current;
      if (hasHit.current) {
        ghostRef.current.position.set(hitPt.current.x, hitPt.current.y + off, hitPt.current.z);
        ghostRef.current.rotation.y = st.editorRotY;
        ghostRef.current.scale.setScalar(spec.baseScale * st.editorScale);
      }
    }

    // place (LMB edge)
    if (keys.shoot && !prevPlace.current && hasHit.current) {
      const prop = {
        id: Math.random().toString(36).slice(2, 9),
        assetId: sel,
        x: hitPt.current.x, y: hitPt.current.y + off, z: hitPt.current.z,
        rotY: st.editorRotY,
        scale: st.editorScale,
        body: st.editorBody,
      };
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

  // Ghost = the real model (swaps when editorSelect changes); transform driven
  // imperatively each frame above.
  return (
    <group ref={ghostRef} visible={false}>
      <PropVisual assetId={editorSelect} />
    </group>
  );
};
