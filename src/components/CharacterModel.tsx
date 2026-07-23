import { Suspense, useMemo } from 'react';
import { useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { getAsset } from '../config/assets';

/**
 * The chosen avatar figure, reused for BOTH the local player (third-person body)
 * and every remote player (WS-5). Loads the asset's GLB/FBX, clones it, strips
 * any placeable hit tags (a character is not walkable/wall — the shootable tag
 * lives on the OUTER group the caller owns), and normalizes it to a ~2m figure
 * centered on the group origin so it reads like a body standing where the player
 * is. The default avatar is a Meshy creature (getAsset falls back to 'skull').
 *
 * Wrapped in its own <Suspense fallback={null}> so a still-loading model never
 * suspends the caller's tree.
 */
const base = import.meta.env.BASE_URL;

// World-units tall. The player capsule is ~2 units (radius .5 + length 1); this
// makes the avatar read as a matching ~2m figure. Owner can tune.
const AVATAR_HEIGHT = 2.2;

// Clone → clear tags → uniformly scale to AVATAR_HEIGHT → recenter on origin.
function toAvatar(src: THREE.Object3D): THREE.Object3D {
  const root = src.clone(true);
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.userData = {};           // not floor/wall — the group carries the hit tag
      m.castShadow = true;
      m.receiveShadow = true;
    }
  });

  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  const s = AVATAR_HEIGHT / (size.y || 1);
  root.position.sub(center);      // center the model on the origin (matches the old capsule)

  const holder = new THREE.Group();
  holder.add(root);
  holder.scale.setScalar(s);
  return holder;
}

function GlbCharacter({ src }: { src: string }) {
  const gltf = useLoader(GLTFLoader, base + src, (loader) => {
    (loader as GLTFLoader).setMeshoptDecoder(MeshoptDecoder);
  });
  const model = useMemo(
    () => toAvatar((gltf as unknown as { scene: THREE.Object3D }).scene),
    [gltf],
  );
  return <primitive object={model} />;
}

function FbxCharacter({ src }: { src: string }) {
  const fbx = useLoader(FBXLoader, base + src);
  const model = useMemo(() => toAvatar(fbx), [fbx]);
  return <primitive object={model} />;
}

export function CharacterModel({ avatar }: { avatar: string }) {
  const spec = getAsset(avatar); // unknown id → 'skull' (a Meshy creature)
  const inner =
    spec.loader === 'glb' ? <GlbCharacter src={spec.src} /> :
    spec.loader === 'fbx' ? <FbxCharacter src={spec.src} /> :
    null;
  return <Suspense fallback={null}>{inner}</Suspense>;
}
