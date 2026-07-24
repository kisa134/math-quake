import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { BLACK_HOLE, conductorState } from '../game/voxCandles';
import { blackHoleFeed } from './VoxelCandles';
import { accent } from '../game/accent';
import { audioReactive } from '../game/audioReactive';

/**
 * V6 — THE VILLAIN DONUT. Абсолютно чёрное тело (свет не существует внутри),
 * светится ТОЛЬКО КРОМКА: тонкий fresnel-контур по силуэту, злой кримзон-белый,
 * пульсирует тахикардией рынка, вспыхивает и «облизывается» при пожирании.
 * Вокруг — тонкий аккреционный диск и ВЕЧНОЕ ВСАСЫВАНИЕ: 800 пылинок со всей
 * сцены стекают спиралями в пасть (1 InstancedMesh, аналитика, raycast=noop).
 */
const NO_RAYCAST = () => {};
const DUST_N = 800;
const DUMMY = new THREE.Object3D();

const rimVertex = /* glsl */ `
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vN = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const rimFragment = /* glsl */ `
  uniform float uHeart;
  uniform float uFeed;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    // ONLY the silhouette edge exists — the villain outline
    float fres = pow(1.0 - abs(dot(vN, vV)), 4.0);
    float pulse = 0.7 + 0.5 * sin(uHeart);
    vec3 evil = mix(vec3(1.0, 0.18, 0.33), vec3(1.0, 0.95, 0.9), 0.25 + uFeed * 0.5);
    vec3 c = evil * fres * pulse * (2.4 + uFeed * 3.0);
    gl_FragColor = vec4(c, fres * (0.85 + uFeed * 0.15));
  }
`;

const diskVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const diskFragment = /* glsl */ `
  uniform float uTime;
  uniform vec3 uAccent;
  varying vec2 vUv;
  void main() {
    // rotating radial streaks — the accretion of everything ever traded
    float ang = atan(vUv.y - 0.5, vUv.x - 0.5);
    float r = length(vUv - 0.5) * 2.0;
    float streak = pow(0.5 + 0.5 * sin(ang * 34.0 + uTime * 0.9 + r * 14.0), 6.0);
    float band = smoothstep(0.55, 0.72, r) * (1.0 - smoothstep(0.85, 1.0, r));
    vec3 c = mix(uAccent, vec3(1.0, 0.2, 0.35), 0.5) * streak * band;
    gl_FragColor = vec4(c * 1.6, streak * band * 0.55);
  }
`;

export const BlackHole = () => {
  const groupRef = useRef<THREE.Group>(null);
  const dustRef = useRef<THREE.InstancedMesh>(null);
  const frame = useRef(0);

  const rimMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { uHeart: { value: 0 }, uFeed: { value: 0 } },
    vertexShader: rimVertex,
    fragmentShader: rimFragment,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.FrontSide,
    toneMapped: false,
  } as THREE.ShaderMaterialParameters), []);
  const diskMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uAccent: { value: new THREE.Color('#ff2d55') } },
    vertexShader: diskVertex,
    fragmentShader: diskFragment,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  } as THREE.ShaderMaterialParameters), []);

  // suction dust: per-particle analytic spiral params (seeded once)
  const dust = useMemo(() => {
    const arr = new Float32Array(DUST_N * 4); // R0, phase, speed, incline
    for (let i = 0; i < DUST_N; i++) {
      arr[i * 4] = 1100 + Math.random() * 1900;      // R0 — со всей сцены
      arr[i * 4 + 1] = Math.random() * Math.PI * 2;  // phase
      arr[i * 4 + 2] = 0.02 + Math.random() * 0.05;  // cycle speed
      arr[i * 4 + 3] = (Math.random() - 0.5) * 600;  // start height offset
    }
    return arr;
  }, []);

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    const cs = conductorState(t);
    blackHoleFeed.v = Math.max(0, blackHoleFeed.v - blackHoleFeed.v * 2 * dt);
    (rimMat.uniforms.uHeart as { value: number }).value = cs.heartPhase;
    // V7.6: the villain rim breathes with the track's bass (on top of feed flash)
    (rimMat.uniforms.uFeed as { value: number }).value = blackHoleFeed.v + audioReactive.bass * 0.6;
    (diskMat.uniforms.uTime as { value: number }).value = t;
    ((diskMat.uniforms.uAccent as { value: THREE.Color }).value).copy(accent);
    if (groupRef.current) {
      groupRef.current.rotation.y += dt * 0.05 * (1 + 0.5 * Math.abs(cs.S));
      groupRef.current.rotation.x = Math.sin(t * 0.04) * 0.12;
    }
    // suction spiral — round-robin quarter per frame
    const m = dustRef.current;
    if (m) {
      frame.current = (frame.current + 1) % 4;
      for (let i = frame.current; i < DUST_N; i += 4) {
        const R0 = dust[i * 4];
        const phase = dust[i * 4 + 1];
        const speed = dust[i * 4 + 2];
        const h0 = dust[i * 4 + 3];
        const k = (t * speed + phase / (Math.PI * 2)) % 1;
        const kk = Math.pow(k, 1.4);
        const R = R0 + (BLACK_HOLE.ringR * 0.85 - R0) * kk;
        const th = phase + t * 0.12 + kk * 7; // spiral tightens toward the maw
        DUMMY.position.set(
          BLACK_HOLE.x + Math.cos(th) * R,
          BLACK_HOLE.y + h0 * (1 - kk),
          BLACK_HOLE.z + Math.sin(th) * R,
        );
        const s = 2.4 * (1 - kk * 0.8);
        DUMMY.scale.set(s, s * 0.5, s);
        DUMMY.rotation.set(0, th, 0);
        DUMMY.updateMatrix();
        m.setMatrixAt(i, DUMMY.matrix);
      }
      m.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <group position={[BLACK_HOLE.x, BLACK_HOLE.y, BLACK_HOLE.z]}>
      <group ref={groupRef}>
        {/* THE VOID: absolute black — no light, no pattern, nothing */}
        <mesh onUpdate={(m) => { m.raycast = NO_RAYCAST; }}>
          <torusGeometry args={[BLACK_HOLE.ringR, BLACK_HOLE.tubeR, 24, 64]} />
          <meshBasicMaterial color="#000000" />
        </mesh>
        {/* the villain rim — fresnel silhouette only */}
        <mesh material={rimMat} onUpdate={(m) => { m.raycast = NO_RAYCAST; }}>
          <torusGeometry args={[BLACK_HOLE.ringR, BLACK_HOLE.tubeR * 1.02, 24, 72]} />
        </mesh>
        {/* thin accretion disk */}
        <mesh material={diskMat} rotation={[-Math.PI / 2, 0, 0]} onUpdate={(m) => { m.raycast = NO_RAYCAST; }}>
          <ringGeometry args={[BLACK_HOLE.ringR * 1.15, BLACK_HOLE.ringR * 2.1, 64, 1]} />
        </mesh>
      </group>
      {/* the eternal suction — dust of the whole world spiralling in */}
      <instancedMesh
        ref={dustRef}
        args={[undefined, undefined, DUST_N]}
        frustumCulled={false}
        onUpdate={(m) => { m.raycast = NO_RAYCAST; }}
        position={[-BLACK_HOLE.x, -BLACK_HOLE.y, -BLACK_HOLE.z]}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial color="#8a8078" toneMapped={false} transparent opacity={0.55} />
      </instancedMesh>
    </group>
  );
};
