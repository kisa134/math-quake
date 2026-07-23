import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { WEAPONS } from '../config/weapons';
import { weaponTune } from '../game/weaponTune';
import { onFire } from '../game/fx';

/**
 * First-person 3D weapon viewmodel. Loads the Synty FBX for the active weapon
 * (cached by useLoader), re-shades every mesh to a neon emissive tint matching
 * the weapon's tracer color so it catches Bloom and reads in the matrix world.
 * Held pose comes from weaponTune (live-tunable); a per-shot punch (driven by
 * the fx fire event) kicks it back + twists. Rendered inside Player's weaponRef
 * group, which handles camera-follow + sway.
 */
export const WeaponModel = ({ weapon }: { weapon: number }) => {
  const spec = WEAPONS[weapon] ?? WEAPONS[0];
  const url = `${import.meta.env.BASE_URL}${spec.model}`;
  const fbx = useLoader(FBXLoader, url);

  const model = useMemo(() => {
    const clone = fbx.clone(true);
    const mat = new THREE.MeshStandardMaterial({
      color: spec.tracer,
      emissive: spec.tracer,
      emissiveIntensity: 0.85,
      metalness: 0.55,
      roughness: 0.3,
      toneMapped: false,
    });
    clone.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.material = mat;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
      }
    });
    return clone;
  }, [fbx, spec.tracer]);

  const ref = useRef<THREE.Group>(null);
  const punch = useRef(0);

  useEffect(() => onFire((recoil) => { punch.current = Math.min(1.2, punch.current + recoil); }), []);

  useFrame((_, delta) => {
    const t = weaponTune[weapon];
    const g = ref.current;
    if (t && g) {
      const p = punch.current;
      g.position.set(t.pos[0], t.pos[1] + p * 0.04, t.pos[2] + p * 0.12); // kick toward camera
      g.rotation.set(t.rot[0] - p * 0.25, t.rot[1], t.rot[2]);
      g.scale.setScalar(t.scale);
    }
    punch.current = Math.max(0, punch.current - delta * 7);
  });

  return <primitive ref={ref} object={model} />;
};
