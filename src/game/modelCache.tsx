import { useMemo } from 'react';
import { useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { ASSETS, getAsset, type AssetSpec } from '../config/assets';
import type { HitTag } from './hitTags';

/**
 * Unified model loader for placeable assets + avatars (WS-1). Loads GLB
 * (Meshy creatures, meshopt-compressed) and FBX (Synty icons) through the same
 * `<AssetModel assetId>` surface, cloned per instance and optionally re-shaded
 * to a neon emissive tint (FBX icons whose texture atlas isn't shipped). GLB
 * keeps its baked textures. Mirrors the WeaponModel FBX pattern.
 */
const base = import.meta.env.BASE_URL;

function applyNeon(root: THREE.Object3D, color: string) {
  const mat = new THREE.MeshStandardMaterial({
    color, emissive: color, emissiveIntensity: 0.8,
    metalness: 0.5, roughness: 0.3, toneMapped: false,
  });
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) { m.material = mat; m.castShadow = false; m.receiveShadow = false; }
  });
}

// The ground probe + hitscan read userData on the HIT mesh directly (no
// parent-walk for floor/wall), so stamp the asset's tag onto every mesh.
function stampTags(root: THREE.Object3D, tags: HitTag) {
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.userData = { ...tags }; });
}

function prepare(root: THREE.Object3D, spec: AssetSpec): THREE.Object3D {
  if (spec.neon && spec.neonColor) applyNeon(root, spec.neonColor);
  stampTags(root, spec.tags);
  return root;
}

function GlbAsset({ spec }: { spec: AssetSpec }) {
  const gltf = useLoader(GLTFLoader, base + spec.src, (loader) => {
    (loader as GLTFLoader).setMeshoptDecoder(MeshoptDecoder);
  });
  const model = useMemo(
    () => prepare((gltf as unknown as { scene: THREE.Object3D }).scene.clone(true), spec),
    [gltf, spec],
  );
  return <primitive object={model} />;
}

function FbxAsset({ spec }: { spec: AssetSpec }) {
  const fbx = useLoader(FBXLoader, base + spec.src);
  const model = useMemo(() => prepare(fbx.clone(true), spec), [fbx, spec]);
  return <primitive object={model} />;
}

/** Renders the loaded model for an asset id (primitive-type assets return null;
 *  the caller draws those with built-in geometry). */
export function AssetModel({ assetId }: { assetId: string }) {
  const spec = getAsset(assetId);
  if (spec.loader === 'glb') return <GlbAsset spec={spec} />;
  if (spec.loader === 'fbx') return <FbxAsset spec={spec} />;
  return null;
}

/** Warm the loader cache so first placement doesn't hitch. */
export function preloadAssets() {
  for (const a of ASSETS) {
    if (a.loader === 'glb') {
      useLoader.preload(GLTFLoader, base + a.src, (loader) => {
        (loader as GLTFLoader).setMeshoptDecoder(MeshoptDecoder);
      });
    } else if (a.loader === 'fbx') {
      useLoader.preload(FBXLoader, base + a.src);
    }
  }
}
