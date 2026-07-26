import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { WEAPONS, type WeaponSpec } from '../config/weapons';
import { weaponTune } from '../game/weaponTune';
import { onFire } from '../game/fx';
import { buildVoxGun, type VoxGunKind } from '../game/voxGuns';
import { accent } from '../game/accent';
import { gunState } from '../game/gunState';

/**
 * First-person 3D weapon viewmodel — V2.
 *
 * VISIBILITY IS SYSTEMIC: after loading + cloning the Synty FBX we measure its
 * Box3, uniformly scale so the longest dimension equals spec.vLen, and recenter
 * the geometry on the origin. The tune pose then only supplies pos/rot plus a
 * scale MULTIPLIER (default 1). A weapon can never be microscopic or off-screen
 * because of FBX units again.
 *
 * JUICE: every mesh is re-shaded to a neon emissive tint (catches Bloom), a
 * colored <pointLight> inside the weapon group washes the hands/walls in the
 * weapon's tracer color (pulses +50% on fire, decays with the punch), and each
 * weapon class has a procedural fire animation (clock+punch driven, zero-alloc):
 * slash / pump / thrust / swing.
 */
export const WeaponModel = ({ weapon }: { weapon: number }) => {
  const spec = WEAPONS[weapon] ?? WEAPONS[0];
  // V6 Ш3: shooting irons are procedural VOXEL GUNS; only magic keeps its FBX.
  if (spec.voxel) return <VoxWeapon weapon={weapon} spec={spec} />;
  return <FbxWeapon weapon={weapon} spec={spec} />;
};

// ── V6 Ш3: the voxel gun — black matte + market-accent glow + moving parts ──
const GUN_BODY_MAT = new THREE.MeshStandardMaterial({
  color: '#0f0e0d', roughness: 0.55, metalness: 0.55,
});
const GUN_GLOW_MAT = new THREE.MeshStandardMaterial({
  color: '#c8b273', emissive: '#c8b273', emissiveIntensity: 1.4, toneMapped: false,
});
const GUN_MOVE_MAT = new THREE.MeshStandardMaterial({
  color: '#1b1918', roughness: 0.45, metalness: 0.7,
});

const VoxWeapon = ({ weapon, spec }: { weapon: number; spec: WeaponSpec }) => {
  const build = useMemo(() => buildVoxGun(spec.voxel as VoxGunKind), [spec.voxel]);
  const ref = useRef<THREE.Group>(null);
  const movingRef = useRef<THREE.Mesh>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const punch = useRef(0);
  const clock = useRef(0);
  const spin = useRef(0);

  useEffect(() => onFire((recoil) => { punch.current = Math.min(1.4, punch.current + recoil); }), []);

  useFrame((_, delta) => {
    clock.current += delta;
    const t = weaponTune[weapon];
    const g = ref.current;
    if (t && g) {
      const p = punch.current;
      const arc = Math.sin(Math.min(1, p) * Math.PI);
      // V8 Ф1 idle+run life: breathing at rest, WALK-CYCLE SWAY at speed
      const spd01 = Math.min(1, gunState.speed / 20);
      const swayF = 1.6 + spd01 * 5.5;
      const bobY = Math.sin(clock.current * swayF) * 0.006 * (1 + spd01 * 2.2);
      const bobX = Math.cos(clock.current * swayF * 0.7) * 0.004 * (1 + spd01 * 2.6);
      const swayRoll = Math.sin(clock.current * swayF * 0.5) * 0.02 * spd01;
      g.position.set(t.pos[0] + bobX, t.pos[1] + bobY + p * 0.03, t.pos[2] + p * 0.14);
      g.rotation.set(t.rot[0] - p * 0.3, t.rot[1], t.rot[2] + p * 0.05 + swayRoll);
      g.scale.setScalar(spec.vLen * t.scale);

      // moving part: bolt kicks back / pump racks / minigun barrels spin
      const mv = movingRef.current;
      if (mv && build.moving) {
        if (build.moving.kind === 'bolt') mv.position.z = p * 0.11;
        else if (build.moving.kind === 'pump') mv.position.z = arc * 0.16;
        else if (build.moving.kind === 'barrels') {
          spin.current += delta * (2 + gunState.heat * 42); // тртртр раскрутка
          mv.rotation.z = spin.current;
        }
      }
      GUN_GLOW_MAT.color.copy(accent);
      GUN_GLOW_MAT.emissive.copy(accent);
      const light = lightRef.current;
      if (light) {
        light.color.copy(accent);
        light.intensity = 2.2 * (1 + 0.08 * Math.sin(clock.current * 3)) + p * 2.4;
      }
    }
    // V8 Ф1 heft: heavy guns' bolt returns slower — mass you can feel
    punch.current = Math.max(0, punch.current - delta * (spec.recoil > 0.5 ? 7.5 : 11));
  });

  return (
    <group ref={ref}>
      <mesh geometry={build.body} material={GUN_BODY_MAT} />
      <mesh geometry={build.glow} material={GUN_GLOW_MAT} />
      {build.moving && (
        <mesh ref={movingRef} geometry={build.moving.geo} material={GUN_MOVE_MAT} position={build.moving.pos} />
      )}
      <pointLight ref={lightRef} intensity={2.2} distance={4} decay={2} position={[0, 0.06, -0.12]} />
    </group>
  );
};

const FbxWeapon = ({ weapon, spec }: { weapon: number; spec: WeaponSpec }) => {
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
    // ── Systemic bbox normalization (same pattern as CharacterModel) ─────────
    // Longest dimension → spec.vLen, geometry centered on the origin. The tune
    // pose is applied to the OUTER group, so pose numbers are always in sane,
    // human-scale view units no matter what the FBX was authored in.
    const box = new THREE.Box3().setFromObject(clone);
    const size = new THREE.Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const k = spec.vLen / maxDim;
    const center = new THREE.Vector3();
    box.getCenter(center);
    const holder = new THREE.Group();
    clone.scale.setScalar(k);
    clone.position.set(-center.x * k, -center.y * k, -center.z * k);
    holder.add(clone);
    return holder;
  }, [fbx, spec]);

  const ref = useRef<THREE.Group>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const punch = useRef(0);
  const clock = useRef(0);

  useEffect(() => onFire((recoil) => { punch.current = Math.min(1.4, punch.current + recoil); }), []);

  useFrame((_, delta) => {
    clock.current += delta;
    const t = weaponTune[weapon];
    const g = ref.current;
    if (t && g) {
      const p = punch.current;
      // 0→1→0 arc over the punch decay — turns the linear decay into a sweep
      // that goes OUT and comes BACK (the soul of a slash/pump/swing).
      const arc = Math.sin(Math.min(1, p) * Math.PI);
      // V8 Ф1: breathing at rest, walk-cycle sway at speed.
      const spd01 = Math.min(1, gunState.speed / 20);
      const swayF = 1.6 + spd01 * 5.5;
      const bobY = Math.sin(clock.current * swayF) * 0.006 * (1 + spd01 * 2.2);
      const bobX = Math.cos(clock.current * swayF * 0.7) * 0.004 * (1 + spd01 * 2.6);

      // ── Procedural fire animation per weapon class (zero-alloc) ────────────
      let px = 0, py = 0, pz = 0, rx = 0, ry = 0, rz = 0;
      switch (spec.anim) {
        case 'slash': // dagger: quick diagonal cut — roll sweep + forward jab
          rz = -arc * 0.9;
          rx = -arc * 0.25;
          pz = -arc * 0.22; // jab TOWARD the target, not away
          py = -arc * 0.04;
          break;
        case 'pump': // shotgun: kick back, then rack the pump forward
          pz = p * 0.2 - arc * 0.06;
          rx = -p * 0.38; // muzzle rises hard
          py = p * 0.03;
          break;
        case 'thrust': // wand/staff: sharp forward thrust + tip flick
          pz = -arc * 0.18;
          rx = arc * 0.15;
          ry = arc * 0.08;
          break;
        case 'swing': // heavy blade: big lateral arc with body behind it
          rz = -arc * 1.2;
          rx = -arc * 0.5;
          px = arc * 0.08;
          pz = -arc * 0.1;
          py = -arc * 0.06;
          break;
      }

      g.position.set(t.pos[0] + bobX + px, t.pos[1] + bobY + py, t.pos[2] + pz);
      g.rotation.set(t.rot[0] + rx, t.rot[1] + ry, t.rot[2] + rz);
      g.scale.setScalar(t.scale); // multiplier on the vLen-normalized model

      // ── Colored glow: idle shimmer + fire flare (decays with the punch) ────
      const light = lightRef.current;
      if (light) {
        light.intensity = 2.5 * (1 + 0.08 * Math.sin(clock.current * 3)) + p * 2.2;
      }
    }
    // V5 C1 CS recovery: snappier spring-back — the barrel «доводится» home.
    // V8 Ф1 heft: heavy weapons come home slower.
    punch.current = Math.max(0, punch.current - delta * (spec.recoil > 0.5 ? 7.5 : 11));
  });

  return (
    <group ref={ref}>
      <primitive object={model} />
      {/* Weapon-colored light: washes the "hands"/nearby walls in tracer color */}
      <pointLight
        ref={lightRef}
        color={spec.tracer}
        intensity={2.5}
        distance={4}
        decay={2}
        position={[0, 0.06, -0.12]}
      />
    </group>
  );
};
