import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { BLACK_HOLE } from '../game/voxCandles';

/**
 * V3.1 — the all-consuming BLACK-HOLE DONUT at the heart of the candle
 * universe: a glitchy pure-black torus wrapped in a pulsing rainbow-glitch
 * rim. All the voxel-candle stars orbit it. 2 draw calls, raycast=noop,
 * shader-driven (zero CPU per frame beyond uniforms).
 */
const NO_RAYCAST = () => {};

const rimVertex = /* glsl */ `
  uniform float uTime;
  varying float vRing; // angle around the MAIN ring (0..1)
  void main() {
    vRing = fract(atan(position.z, position.x) / 6.28318 + 1.0);
    vec3 p = position;
    // glitch: tiny time-quantized radial jitter
    float g = fract(sin(dot(floor(position.xy * 0.7) + floor(uTime * 9.0), vec2(12.9898, 78.233))) * 43758.5453);
    p += normal * (g - 0.5) * 1.6;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const rimFragment = /* glsl */ `
  uniform float uTime;
  varying float vRing;
  vec3 hsv2rgb(vec3 c) {
    vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0);
    return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
  }
  void main() {
    float hue = fract(vRing * 3.0 - uTime * 0.22);
    float pulse = 0.75 + 0.45 * sin(uTime * 2.2 + vRing * 25.0);
    // glitch bands flickering around the ring
    float band = step(0.86, fract(vRing * 40.0 + floor(uTime * 7.0) * 0.37));
    vec3 c = hsv2rgb(vec3(hue, 1.0, 1.0)) * pulse * (1.0 + band * 1.2);
    gl_FragColor = vec4(c * 2.2, 0.92); // hot → Bloom eats it
  }
`;

const voidVertex = /* glsl */ `
  uniform float uTime;
  void main() {
    vec3 p = position;
    float g = fract(sin(dot(floor(position.yz * 0.5) + floor(uTime * 6.0), vec2(4.898, 7.23))) * 23421.631);
    p += normal * (g - 0.5) * 1.1;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const voidFragment = /* glsl */ `
  uniform float uTime;
  void main() {
    // all-consuming: pure black with rare dim glitch scanlines
    float sl = step(0.985, fract(gl_FragCoord.y * 0.05 + uTime * 1.7)) * 0.06;
    gl_FragColor = vec4(vec3(sl), 1.0);
  }
`;

export const BlackHole = () => {
  const groupRef = useRef<THREE.Group>(null);
  const rimMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: rimVertex,
    fragmentShader: rimFragment,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  } as THREE.ShaderMaterialParameters), []);
  const voidMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: voidVertex,
    fragmentShader: voidFragment,
  }), []);

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    rimMat.uniforms.uTime.value = t;
    voidMat.uniforms.uTime.value = t;
    if (groupRef.current) {
      groupRef.current.rotation.y += dt * 0.06;         // slow menace spin
      groupRef.current.rotation.x = Math.sin(t * 0.05) * 0.16; // lazy precession
      const s = 1 + Math.sin(t * 1.8) * 0.025;          // мега-пульс
      groupRef.current.scale.setScalar(s);
    }
  });

  return (
    <group ref={groupRef} position={[BLACK_HOLE.x, BLACK_HOLE.y, BLACK_HOLE.z]}>
      {/* the void: glitchy pure-black donut body */}
      <mesh material={voidMat} onUpdate={(m) => { m.raycast = NO_RAYCAST; }}>
        <torusGeometry args={[BLACK_HOLE.ringR, BLACK_HOLE.tubeR, 20, 56]} />
      </mesh>
      {/* rainbow-glitch mega-pulsing rim */}
      <mesh material={rimMat} onUpdate={(m) => { m.raycast = NO_RAYCAST; }}>
        <torusGeometry args={[BLACK_HOLE.ringR, BLACK_HOLE.tubeR + 2.6, 20, 72]} />
      </mesh>
      {/* faint magenta heart-light so the donut stains nearby stars */}
      <pointLight color="#ff2fd0" intensity={1.6} distance={420} decay={1.6} />
    </group>
  );
};
