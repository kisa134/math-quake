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
  const clock = useRef(0);

  useEffect(() => onFire((recoil) => { punch.current = Math.min(1.4, punch.current + recoil); }), []);

  useFrame((_, delta) => {
    clock.current += delta;
    const t = weaponTune[weapon];
    const g = ref.current;
    if (t && g) {
      const p = punch.current;
      // Juicy recoil: snap back toward camera + up, twist (roll) and yaw a touch,
      // plus a subtle idle breathing bob so the viewmodel feels alive at rest.
      const bobY = Math.sin(clock.current * 1.6) * 0.006;
      const bobX = Math.cos(clock.current * 1.1) * 0.004;
      g.position.set(
        t.pos[0] + bobX + p * 0.02,
        t.pos[1] + bobY + p * 0.05,
        t.pos[2] + p * 0.16, // kick toward camera
      );
      g.rotation.set(
        t.rot[0] - p * 0.32,        // muzzle rises
        t.rot[1] + p * 0.10,        // slight yaw flick
        t.rot[2] + p * 0.18,        // roll twist
      );
      g.scale.setScalar(t.scale);
    }
    // Snappy attack already applied on the fire event; fast spring-back out.
    punch.current = Math.max(0, punch.current - delta * 8);
  });

  return <primitive ref={ref} object={model} />;
};
