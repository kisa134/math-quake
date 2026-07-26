import * as THREE from 'three';
import { useStore } from '../store';
import { socket } from '../socket';
import { getAsset } from '../config/assets';
import { buildCost, isSupportedAt, type BuiltPiece } from './builtProps';
import { isTower } from '../config/maps';

/**
 * Постановка детали ПРЯМО С КНОПКИ МЫШИ (без режима B) — свеча/батут висят в
 * лоадауте как «оружие»: навёл, кликнул, поставил. Стоит денег и требует
 * опоры в башне (Valheim-правила из builtProps).
 */
const _ray = new THREE.Raycaster();
const _center = new THREE.Vector2(0, 0);
const GRID = 2;
const snap = (v: number) => Math.round(v / GRID) * GRID;

export function placeBuildPiece(
  assetId: string,
  camera: THREE.Camera,
  scene: THREE.Scene,
  scale: number,
): boolean {
  _ray.setFromCamera(_center, camera);
  _ray.far = 60;
  const hits = _ray.intersectObjects(scene.children, true);
  _ray.far = Infinity;
  let point: THREE.Vector3 | null = null;
  for (const h of hits) {
    const ud = h.object.userData as { isFloor?: boolean; isWall?: boolean; isJumpPad?: boolean; isBuilt?: boolean };
    if (ud?.isFloor || ud?.isWall || ud?.isJumpPad || ud?.isBuilt) { point = h.point; break; }
  }
  if (!point) return false;

  const st = useStore.getState();
  const spec = getAsset(assetId);
  const prop = {
    id: Math.random().toString(36).slice(2, 9),
    assetId,
    x: snap(point.x),
    y: spec.prim === 'pad' ? point.y + 0.5 : snap(point.y),
    z: snap(point.z),
    rotY: 0,
    scale,
    body: 'fixed' as const,
  };

  if (isTower()) {
    const cost = buildCost(assetId, scale);
    const cand: BuiltPiece = { id: prop.id, assetId, x: prop.x, y: prop.y, z: prop.z, scale };
    const existing: BuiltPiece[] = st.placedProps.map((q) => ({
      id: q.id, assetId: q.assetId, x: q.x, y: q.y, z: q.z, scale: q.scale,
    }));
    if (st.money < cost || !isSupportedAt(cand, existing)) return false;
    st.addMoney(-cost);
  }
  st.addProp(prop);
  socket.emit('place', { prop });
  return true;
}
