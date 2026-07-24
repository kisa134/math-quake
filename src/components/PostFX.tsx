import { EffectComposer, Bloom, Vignette, SMAA, HueSaturation, BrightnessContrast } from '@react-three/postprocessing';

/**
 * Post-processing — the heart of the "expensive" look (docs/increments/03).
 * Bloom makes every emissive/`toneMapped={false}` neon actually GLOW; without
 * it the world is just "colored", not lit. Vignette focuses the frame; SMAA
 * cleans the neon edges (the canvas runs antialias:false).
 *
 * V3 Bosch-psychedelia grade: richer saturation + a touch more contrast + a
 * heavier storybook vignette — the ornate "dark fairytale plate" framing from
 * the owner's reference boards.
 */
export const PostFX = () => (
  <EffectComposer multisampling={0}>
    <Bloom
      intensity={1.1}
      luminanceThreshold={0.15}
      luminanceSmoothing={0.9}
      mipmapBlur
      radius={0.7}
    />
    <HueSaturation saturation={0.18} />
    <BrightnessContrast brightness={-0.015} contrast={0.09} />
    <Vignette offset={0.2} darkness={0.9} />
    <SMAA />
  </EffectComposer>
);
