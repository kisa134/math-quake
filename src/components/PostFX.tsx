import { EffectComposer, Bloom, Vignette, SMAA } from '@react-three/postprocessing';

/**
 * Post-processing — the heart of the "expensive" look (docs/increments/03).
 * Bloom makes every emissive/`toneMapped={false}` neon actually GLOW; without
 * it the world is just "colored", not lit. Vignette focuses the frame; SMAA
 * cleans the neon edges (the canvas runs antialias:false).
 *
 * MVP stack only — chromatic aberration / scanline / glitch / selective-bloom
 * are deferred polish (see spec §3).
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
    <Vignette offset={0.25} darkness={0.75} />
    <SMAA />
  </EffectComposer>
);
