import * as THREE from 'three';

/**
 * V5.1 «Трупный матовый» — THE surface of the world: matte near-black with a
 * faint sheen and GLITTER sprinkled on top. The sparkle is view-space hashed —
 * glints crawl and shimmer as the camera moves, like мелкие блёстки насыпали
 * сверху. One shared material (works with instancing: injected via
 * onBeforeCompile into MeshStandardMaterial, so instanceMatrix/instanceColor
 * keep working). Cost: ~6 extra flops per fragment.
 */
export function makeSparkleMatte(opts?: {
  color?: string;
  roughness?: number;
  metalness?: number;
  sparkle?: number; // glint brightness
}): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: opts?.color ?? '#0b0a09',   // трупный чёрный
    roughness: opts?.roughness ?? 0.82, // матовый…
    metalness: opts?.metalness ?? 0.28, // …но чуть-чуть блестит
    emissive: '#000000',
  });
  const sparkle = opts?.sparkle ?? 0.9;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSparkle = { value: sparkle };
    // V8 fix: the GLSL DECLARATION must be injected too — adding the uniform
    // to shader.uniforms uploads the value but never declares it, so the
    // fragment failed to compile («uSparkle: undeclared identifier») and the
    // matte surfaces silently dropped their glitter.
    shader.fragmentShader = ('uniform float uSparkle;\n' + shader.fragmentShader).replace(
      '#include <emissivemap_fragment>',
      /* glsl */ `
      #include <emissivemap_fragment>
      {
        // view-space quantized hash → glints that shimmer with camera motion
        vec3 cell = floor(vViewPosition * 9.0);
        float g = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
        float glint = smoothstep(0.984, 1.0, g);
        totalEmissiveRadiance += vec3(1.0, 0.96, 0.85) * glint * uSparkle;
      }
      `,
    );
  };
  // distinct program per sparkle value — the three shared instances otherwise
  // collide on the default cache key (identical onBeforeCompile source)
  mat.customProgramCacheKey = () => `sparkle-matte-${sparkle}`;
  return mat;
}

// Shared instances for the whole world (never per-mesh):
export const MATTE_WORLD = makeSparkleMatte();                                  // temples, decks
export const MATTE_WORLD_SOFT = makeSparkleMatte({ color: '#121110', sparkle: 0.55 }); // secondary surfaces
// Instanced meshes tint via instanceColor (final = base × instance), so the
// instanced variant keeps a WHITE base and lets the graphite tints darken it.
export const MATTE_INSTANCED = makeSparkleMatte({ color: '#ffffff', sparkle: 0.7 });
