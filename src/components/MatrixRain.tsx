import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { PALETTE } from '../theme';

/**
 * Matrix "digital rain" as ONE big shader-shell wrapped around the arena
 * (METHOD A from docs/increments/03). All the rain is procedural in the
 * fragment shader — 1 draw call, fixed cost regardless of density. Not fogged
 * (raw ShaderMaterial), so it stays as a readable far backdrop while the world
 * geometry fades into it.
 */
const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform vec3  uColor;
  uniform vec3  uColorHot;
  uniform float uCols;
  varying vec2  vUv;

  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  void main(){
    vec2 uv = vUv * vec2(uCols, 1.0);
    float col = floor(uv.x);
    float speed = 0.3 + 0.7 * hash(vec2(col, 1.0));
    float head = fract(uv.y - uTime * speed * 0.05);
    float glyph = step(0.5, hash(vec2(col, floor(uv.y * 18.0 + uTime * speed))));
    float trail = smoothstep(0.0, 0.25, head) * (1.0 - head);
    float bright = glyph * trail;
    vec3 c = mix(uColor, uColorHot, pow(1.0 - head, 8.0));
    gl_FragColor = vec4(c * bright, bright * 0.9);
  }
`;

export const MatrixRain = () => {
  const matRef = useRef<THREE.ShaderMaterial>(null);

  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uColor: { value: new THREE.Color(PALETTE.uiCyan) },
    uColorHot: { value: new THREE.Color(PALETTE.bloomWhite) },
    uCols: { value: 90 },
  }), []);

  useFrame((_, dt) => {
    if (matRef.current) matRef.current.uniforms.uTime.value += dt;
  });

  return (
    <mesh renderOrder={-10}>
      <cylinderGeometry args={[600, 600, 700, 64, 1, true]} />
      <shaderMaterial
        ref={matRef}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        side={THREE.BackSide}
        transparent
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
};
