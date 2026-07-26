import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { portalState } from '../game/portals';
import { worldT } from '../game/worldClock';

/**
 * V6 Ш4 — renders the two portals: oval rings (blue A / orange B) oriented to
 * their surface normals, breathing additively, with a dark «eye» inside.
 * Pure visual (raycast=noop); the teleport logic lives in game/portals.ts and
 * is invoked by Player (self) and BotHorde (боты тоже проваливаются).
 */
const NO_RAYCAST = () => {};
const _up = new THREE.Vector3(0, 0, 1);
const _n = new THREE.Vector3();
const _q = new THREE.Quaternion();

const RING_A = new THREE.MeshBasicMaterial({
  color: '#00b4d8', toneMapped: false, transparent: true, opacity: 0.9,
  blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
});
const RING_B = new THREE.MeshBasicMaterial({
  color: '#ff7b00', toneMapped: false, transparent: true, opacity: 0.9,
  blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
});
const EYE = new THREE.MeshBasicMaterial({ color: '#020204', side: THREE.DoubleSide });

const PortalMesh = ({ slot }: { slot: 'a' | 'b' }) => {
  const group = useRef<THREE.Group>(null);
  useFrame((state) => {
    const p = portalState[slot];
    const g = group.current;
    if (!g) return;
    g.visible = p.active;
    if (!p.active) return;
    _n.set(p.nx, p.ny, p.nz);
    _q.setFromUnitVectors(_up, _n);
    g.position.set(p.x + p.nx * 0.15, p.y + p.ny * 0.15, p.z + p.nz * 0.15);
    g.quaternion.copy(_q);
    const s = 1 + Math.sin(worldT() * 3 + (slot === 'a' ? 0 : Math.PI)) * 0.05;
    g.scale.set(s, s * 1.55, s); // oval
  });
  return (
    <group ref={group} visible={false}>
      <mesh material={slot === 'a' ? RING_A : RING_B} onUpdate={(m) => { m.raycast = NO_RAYCAST; }}>
        <torusGeometry args={[2.2, 0.22, 10, 40]} />
      </mesh>
      <mesh material={EYE} onUpdate={(m) => { m.raycast = NO_RAYCAST; }}>
        <circleGeometry args={[2.1, 32]} />
      </mesh>
    </group>
  );
};

export const Portals = () => (
  <>
    <PortalMesh slot="a" />
    <PortalMesh slot="b" />
  </>
);
