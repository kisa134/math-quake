import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../store';
import { useKeyboard } from '../hooks/useKeyboard';
import { socket } from '../socket';
import { PALETTE } from '../theme';

/**
 * Build/editor mode (toggle B). Aims from the crosshair at any arena surface;
 * LMB places the selected prop (pad/candle/atm), RMB deletes the nearest placed
 * prop under the aim. Placements are broadcast so a friend sees them too.
 * Weapons/grapple are suppressed while editing (see Player.tsx).
 */
const _center = new THREE.Vector2(0, 0);
const _ray = new THREE.Raycaster();
const OFFSET: Record<string, number> = { pad: 0.5, candle: 10, atm: 2.5 };

export const Editor = () => {
  const { camera, scene } = useThree();
  const keys = useKeyboard();
  const ghostRef = useRef<THREE.Mesh>(null);
  const prevPlace = useRef(false);
  const prevDelete = useRef(false);
  const hitPt = useRef(new THREE.Vector3());
  const hasHit = useRef(false);

  useFrame(() => {
    const st = useStore.getState();
    if (!st.editorMode) {
      if (ghostRef.current) ghostRef.current.visible = false;
      prevPlace.current = keys.shoot;
      prevDelete.current = keys.grapple;
      return;
    }
    const sel = st.editorSelect;
    const off = OFFSET[sel] ?? 1;

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
      if (hasHit.current) ghostRef.current.position.set(hitPt.current.x, hitPt.current.y + off, hitPt.current.z);
    }

    // place (LMB edge)
    if (keys.shoot && !prevPlace.current && hasHit.current) {
      const prop = {
        id: Math.random().toString(36).slice(2, 9),
        type: sel,
        x: hitPt.current.x, y: hitPt.current.y + off, z: hitPt.current.z,
      };
      st.addProp(prop);
      socket.emit('place', { prop });
    }
    prevPlace.current = keys.shoot;

    // delete (RMB edge) — nearest placed prop to the aim point
    if (keys.grapple && !prevDelete.current && hasHit.current) {
      let best: string | null = null;
      let bestD = 8 * 8;
      for (const p of st.placedProps) {
        const dx = p.x - hitPt.current.x, dy = p.y - hitPt.current.y, dz = p.z - hitPt.current.z;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bestD) { bestD = d; best = p.id; }
      }
      if (best) { st.removeProp(best); socket.emit('remove', { id: best }); }
    }
    prevDelete.current = keys.grapple;
  });

  return (
    <mesh ref={ghostRef} visible={false}>
      <boxGeometry args={[4, 4, 4]} />
      <meshBasicMaterial color={PALETTE.bloomWhite} transparent opacity={0.4} wireframe toneMapped={false} />
    </mesh>
  );
};
