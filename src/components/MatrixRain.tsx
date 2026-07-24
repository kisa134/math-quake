import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { accent } from '../game/accent';
import { blackHoleSuck } from './VoxelCandles';

/**
 * V5.1 — THE MATRIX SKY, multi-layered, «до бесконечности». Two shader shells
 * wrap the world with parallax between them:
 *   FAR  (r1350×h3600): slow monumental glyph columns + aurora bands breathing
 *        in the market accent — the deep pattern of the universe.
 *   NEAR (r 900×h2800): finer, faster rain with data-burst columns that flare.
 * All procedural, 2 draw calls, accent-tinted live. Not fogged — it IS the
 * infinity the geometry fades into.
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
  uniform vec3  uAccent;
  uniform vec3  uHot;
  uniform float uCols;
  uniform float uSpeed;
  uniform float uAlpha;
  uniform float uAurora;
  uniform float uSuck;
  varying vec2  vUv;

  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  void main(){
    vec2 uv = vUv * vec2(uCols, 1.0);
    float col = floor(uv.x);
    float h1 = hash(vec2(col, 1.0));
    float speed = (0.25 + 0.75 * h1) * uSpeed;

    // layer 1 — the rain: falling heads with glyph flicker
    float head = fract(uv.y - uTime * speed * 0.05);
    float glyph = step(0.45, hash(vec2(col, floor(uv.y * 22.0 + uTime * speed))));
    float flick = 0.75 + 0.25 * hash(vec2(col, floor(uTime * (6.0 + h1 * 8.0))));
    float trail = smoothstep(0.0, 0.3, head) * (1.0 - head);
    float rain = glyph * trail * flick;

    // layer 2 — DATA BURSTS: rare columns flare bright for a beat
    float burst = step(0.965, hash(vec2(col, floor(uTime * 0.4)))) * (0.5 + 0.5 * sin(uTime * 9.0 + col));
    rain += burst * glyph * trail * 1.6;

    // layer 3 — slow giant glyph wall behind (the deep pattern)
    vec2 guv = vUv * vec2(uCols * 0.14, 3.0);
    float gg = step(0.6, hash(floor(guv + vec2(0.0, uTime * 0.03))));
    float deep = gg * 0.06;

    // layer 4 — aurora bands breathing in the accent
    float aur = uAurora * 0.12 *
      (0.5 + 0.5 * sin(vUv.y * 9.0 - uTime * 0.12 + sin(vUv.x * 12.566 + uTime * 0.05) * 1.6));

    // V7.6 М2: SUCTION WIND — fast horizontal streaks tearing toward center
    float wind = 0.0;
    if (uSuck > 0.001) {
      float band = hash(vec2(floor(vUv.y * 40.0), 3.0));
      float streak = fract(vUv.x * 2.0 - uTime * (2.0 + band * 4.0));
      wind = smoothstep(0.85, 1.0, streak) * band * uSuck;
    }

    vec3 c = mix(uAccent, uHot, pow(1.0 - head, 8.0)) * rain
           + uAccent * (deep + aur + wind * 1.5);
    float a = clamp(rain * 0.9 + deep + aur * 0.8 + wind, 0.0, 1.0) * uAlpha;
    gl_FragColor = vec4(c, a);
  }
`;

function makeUniforms(cols: number, speed: number, alpha: number, aurora: number) {
  return {
    uTime: { value: 0 },
    uAccent: { value: new THREE.Color('#c8b273') },
    uHot: { value: new THREE.Color('#fff3dc') },
    uCols: { value: cols },
    uSpeed: { value: speed },
    uAlpha: { value: alpha },
    uAurora: { value: aurora },
    uSuck: { value: 0 },
  };
}

export const MatrixRain = () => {
  const farMat = useRef<THREE.ShaderMaterial>(null);
  const nearMat = useRef<THREE.ShaderMaterial>(null);
  const farU = useMemo(() => makeUniforms(70, 0.6, 0.85, 1.0), []);
  const nearU = useMemo(() => makeUniforms(150, 1.4, 0.55, 0.0), []);

  useFrame((_, dt) => {
    const suck = blackHoleSuck.v;
    if (farMat.current) {
      farMat.current.uniforms.uTime.value += dt;
      (farMat.current.uniforms.uAccent.value as THREE.Color).copy(accent);
      farMat.current.uniforms.uSuck.value = suck;
    }
    if (nearMat.current) {
      nearMat.current.uniforms.uTime.value += dt;
      (nearMat.current.uniforms.uAccent.value as THREE.Color).copy(accent);
      nearMat.current.uniforms.uSuck.value = suck;
    }
  });

  return (
    <>
      {/* FAR shell — monumental, slow, with aurora (reaches «infinity») */}
      <mesh renderOrder={-11} position={[0, 2500, 0]}>
        <cylinderGeometry args={[5500, 5500, 14000, 72, 1, true]} />
        <shaderMaterial
          ref={farMat}
          vertexShader={vertexShader}
          fragmentShader={fragmentShader}
          uniforms={farU}
          side={THREE.BackSide}
          transparent
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      {/* NEAR shell — fine fast rain, parallax against the far wall */}
      <mesh renderOrder={-10} position={[0, 1600, 0]}>
        <cylinderGeometry args={[3500, 3500, 9000, 64, 1, true]} />
        <shaderMaterial
          ref={nearMat}
          vertexShader={vertexShader}
          fragmentShader={fragmentShader}
          uniforms={nearU}
          side={THREE.BackSide}
          transparent
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </>
  );
};
