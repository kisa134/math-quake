import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { EffectComposer, Bloom, Vignette, SMAA, HueSaturation, BrightnessContrast, ChromaticAberration } from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';
import { blackHoleSuck } from './VoxelCandles';

/**
 * Post-processing — the heart of the "expensive" look (docs/increments/03).
 * Bloom makes every emissive/`toneMapped={false}` neon actually GLOW; Vignette
 * focuses the frame; SMAA cleans the neon edges (canvas runs antialias:false).
 *
 * V7.6 М2: no longer static — during a black-hole SUCTION event the frame is
 * PULLED into the void: the vignette darkens and a chromatic-aberration smear
 * ramps up, then eases back. Driven by the blackHoleSuck scalar (same one that
 * flares the maw light + accelerates the dust spiral).
 */
export const PostFX = () => {
  const vigRef = useRef<{ darkness: number }>(null);
  const caRef = useRef<{ offset: THREE.Vector2 }>(null);

  useFrame(() => {
    const s = blackHoleSuck.v;
    if (vigRef.current) vigRef.current.darkness = 0.78 + s * 0.5;
    if (caRef.current) {
      const o = 0.0006 + s * 0.004;
      caRef.current.offset.set(o, o);
    }
  });

  return (
    <EffectComposer multisampling={0}>
      <Bloom
        intensity={1.1}
        luminanceThreshold={0.15}
        luminanceSmoothing={0.9}
        mipmapBlur
        radius={0.7}
      />
      {/* V5 minimal grade: calmer saturation, thinner vignette — gallery light */}
      <HueSaturation saturation={0.06} />
      <BrightnessContrast brightness={-0.01} contrast={0.07} />
      <ChromaticAberration ref={caRef} blendFunction={BlendFunction.NORMAL} offset={new THREE.Vector2(0.0006, 0.0006)} radialModulation={false} modulationOffset={0} />
      <Vignette ref={vigRef} offset={0.22} darkness={0.78} />
      <SMAA />
    </EffectComposer>
  );
};
