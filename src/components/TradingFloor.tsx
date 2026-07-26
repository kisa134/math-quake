import { useMemo, useRef, Suspense } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { RigidBody } from '@react-three/rapier';
import { tag } from '../game/hitTags';
import { MATTE_WORLD, MATTE_WORLD_SOFT } from '../game/materials';
import { AssetModel } from '../game/modelCache';
import { getDudeParts, JOINTS } from '../game/voxHumanoid';
import { accent } from '../game/accent';
import { conductorState } from '../game/conductor';
import { BLACK_HOLE } from '../game/voxCandles';
import { PALETTE } from '../theme';
import { worldT } from '../game/worldClock';

/**
 * V6 Ш2 — THE TRADING FLOOR: the new spawn scene (старая арена с 4 углами —
 * снесена). A 300×300 corpse-matte mega-plate engraved with a giant candle
 * chart (shader), the ЖЕРЛО at its heart (light beam up into the donut's maw —
 * the enemy spawn mouth), and FOUR MEGA-MONUMENTS on the corners:
 *   I.   Planet-Skull on a 200m black column
 *   II.  (Chrome Triptych — carousel, lives in ChromeIdols.tsx)
 *   III. BULL & BEAR — two 40m voxel giants locked in the eternal fight
 *   IV.  The Ticker Obelisk — 250m stela with scrolling price-glyphs
 * Six bridge-beams reach toward the city. Physics ≤20 bodies for it all.
 */
const NO_RAYCAST = () => {};
const PLATE_Y = 82; // plate top (spawn at y=84 lands here)

// ---- floor engraving shader (giant candle chart + running ticker) ----------
const floorVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const floorFragment = /* glsl */ `
  uniform float uTime;
  uniform vec3 uAccent;
  varying vec2 vUv;
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  void main() {
    vec2 uv = vUv;
    // giant engraved candle chart: 26 columns of hollow candle bodies
    float col = floor(uv.x * 26.0);
    float h1 = hash(vec2(col, 3.0));
    float bodyLo = 0.25 + 0.3 * hash(vec2(col, 7.0));
    float bodyHi = bodyLo + 0.08 + 0.25 * h1;
    float inCol = step(0.18, fract(uv.x * 26.0)) * step(fract(uv.x * 26.0), 0.82);
    float edgeX = max(
      smoothstep(0.18, 0.21, fract(uv.x * 26.0)) - smoothstep(0.24, 0.27, fract(uv.x * 26.0)),
      smoothstep(0.79, 0.82, fract(uv.x * 26.0)) * (1.0 - smoothstep(0.82, 0.85, fract(uv.x * 26.0)))
    );
    float inBody = step(bodyLo, uv.y) * step(uv.y, bodyHi);
    float edgeY = max(
      smoothstep(bodyLo - 0.006, bodyLo, uv.y) - smoothstep(bodyLo, bodyLo + 0.006, uv.y) + 0.0,
      smoothstep(bodyHi - 0.006, bodyHi, uv.y) * (1.0 - smoothstep(bodyHi, bodyHi + 0.006, uv.y))
    );
    float chart = inCol * max(edgeX * inBody, edgeY) * 0.5;
    // wick line
    float wick = inCol * step(abs(fract(uv.x * 26.0) - 0.5), 0.015)
      * step(bodyLo - 0.14 * h1, uv.y) * step(uv.y, bodyHi + 0.14 * h1) * 0.25;
    // running ticker rows near the edges
    float row = step(0.955, uv.y) + step(uv.y, 0.045);
    float glyph = step(0.55, hash(vec2(floor(uv.x * 160.0 + uTime * 6.0), floor(uv.y * 40.0)))) * row * 0.6;
    vec3 c = uAccent * (chart + wick + glyph);
    gl_FragColor = vec4(c, (chart + wick + glyph) * 0.85);
  }
`;

// ---- giant dude (Bull vs Bear monument) ------------------------------------
const GiantDude = ({ color, mirror }: { color: string; mirror: boolean }) => {
  const parts = useMemo(() => getDudeParts(), []);
  const mat = useMemo(() => new THREE.MeshStandardMaterial({
    color, emissive: color, emissiveIntensity: 0.25, roughness: 0.6,
  }), [color]);
  const armL = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);

  useFrame((state) => {
    const t = worldT(); // V8.6 shared wall clock
    const cs = conductorState(t);
    // the eternal fight: lean + swing harder on epoch extremes (микросценка v1)
    const aggr = 0.4 + 0.6 * Math.abs(cs.S);
    const sw = Math.sin(t * 1.4 + (mirror ? Math.PI : 0)) * 0.9 * aggr;
    if (armL.current) armL.current.rotation.x = -1.1 + sw;
    if (armR.current) armR.current.rotation.x = -1.1 - sw;
    if (body.current) {
      body.current.rotation.z = Math.sin(t * 1.4 + (mirror ? Math.PI : 0)) * 0.06 * aggr;
      body.current.position.y = Math.abs(Math.sin(t * 2.8)) * 0.02;
    }
  });

  return (
    <group ref={body}>
      <group position={[-JOINTS.hipX, JOINTS.hips, 0]}>
        <mesh geometry={parts.leg} material={mat} />
      </group>
      <group position={[JOINTS.hipX, JOINTS.hips, 0]}>
        <mesh geometry={parts.leg} material={mat} />
      </group>
      <mesh geometry={parts.torso} material={mat} position={[0, JOINTS.hips, 0]} />
      <group ref={armL} position={[-JOINTS.shoulderX, JOINTS.shoulderY, 0]}>
        <mesh geometry={parts.arm} material={mat} />
      </group>
      <group ref={armR} position={[JOINTS.shoulderX, JOINTS.shoulderY, 0]}>
        <mesh geometry={parts.arm} material={mat} />
      </group>
      <group position={[0, JOINTS.neck, 0]}>
        <mesh geometry={parts.head} material={mat} />
      </group>
    </group>
  );
};

// ---- ticker obelisk shader strip -------------------------------------------
const obeliskFragment = /* glsl */ `
  uniform float uTime;
  uniform vec3 uAccent;
  varying vec2 vUv;
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  void main() {
    float glyph = step(0.5, hash(vec2(floor(vUv.x * 6.0), floor(vUv.y * 90.0 - uTime * 8.0))));
    float fade = smoothstep(0.0, 0.15, vUv.y) * (1.0 - smoothstep(0.85, 1.0, vUv.y));
    gl_FragColor = vec4(uAccent * glyph * fade * 1.6, glyph * fade * 0.9);
  }
`;

export const TradingFloor = () => {
  const floorMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uAccent: { value: new THREE.Color('#c8b273') } },
    vertexShader: floorVertex, fragmentShader: floorFragment,
    transparent: true, depthWrite: false, toneMapped: false,
  } as THREE.ShaderMaterialParameters), []);
  const obeliskMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uAccent: { value: new THREE.Color('#c8b273') } },
    vertexShader: floorVertex, fragmentShader: obeliskFragment,
    transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
  } as THREE.ShaderMaterialParameters), []);
  const beamMat = useMemo(() => new THREE.MeshBasicMaterial({
    color: '#ff2d55', transparent: true, opacity: 0.1, toneMapped: false,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  }), []);
  const skullRef = useRef<THREE.Group>(null);
  const patched = useRef(false);

  useFrame((state, dt) => {
    const t = worldT(); // V8.6 shared wall clock
    (floorMat.uniforms.uTime as { value: number }).value = t;
    ((floorMat.uniforms.uAccent as { value: THREE.Color }).value).copy(accent);
    (obeliskMat.uniforms.uTime as { value: number }).value = t;
    ((obeliskMat.uniforms.uAccent as { value: THREE.Color }).value).copy(accent);
    beamMat.opacity = 0.07 + 0.05 * Math.sin(conductorState(t).heartPhase);
    if (skullRef.current) {
      skullRef.current.rotation.y += dt * 0.1;
      if (!patched.current) {
        let found = false;
        skullRef.current.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.raycast = NO_RAYCAST; found = true; } });
        if (found) patched.current = true;
      }
    }
  });

  return (
    <group>
      {/* ===== THE MEGA-PLATE 300×300 ===== */}
      <RigidBody type="fixed">
        <mesh position={[0, PLATE_Y - 2, 0]} userData={tag({ isFloor: true })} material={MATTE_WORLD}>
          <boxGeometry args={[300, 4, 300]} />
        </mesh>
      </RigidBody>
      {/* engraved candle-chart + ticker overlay */}
      <mesh
        position={[0, PLATE_Y + 0.06, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        material={floorMat}
        onUpdate={(m) => { m.raycast = NO_RAYCAST; }}
      >
        <planeGeometry args={[298, 298]} />
      </mesh>

      {/* ===== ЖЕРЛО: the spawn mouth + light beam into the donut ===== */}
      <mesh position={[0, PLATE_Y + 0.1, 0]} rotation={[-Math.PI / 2, 0, 0]} onUpdate={(m) => { m.raycast = NO_RAYCAST; }}>
        <ringGeometry args={[16, 20, 48]} />
        <meshBasicMaterial color="#ff2d55" toneMapped={false} transparent opacity={0.8} />
      </mesh>
      <mesh position={[0, PLATE_Y + 0.12, 0]} rotation={[-Math.PI / 2, 0, 0]} onUpdate={(m) => { m.raycast = NO_RAYCAST; }}>
        <circleGeometry args={[16, 48]} />
        <meshBasicMaterial color="#000000" />
      </mesh>
      <mesh position={[0, (PLATE_Y + BLACK_HOLE.y) / 2, 0]} material={beamMat} onUpdate={(m) => { m.raycast = NO_RAYCAST; }}>
        <cylinderGeometry args={[16, 18, BLACK_HOLE.y - PLATE_Y, 32, 1, true]} />
      </mesh>

      {/* jump-pad ring around the mouth */}
      {[0, 1, 2, 3].map((i) => {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        return (
          <RigidBody key={i} type="fixed">
            <mesh position={[Math.cos(a) * 34, PLATE_Y + 0.5, Math.sin(a) * 34]} userData={tag({ isJumpPad: true, jumpForce: 95 })}>
              <cylinderGeometry args={[4, 4, 1, 16]} />
              <meshStandardMaterial color={PALETTE.bull} emissive={PALETTE.bull} emissiveIntensity={1.0} toneMapped={false} />
            </mesh>
          </RigidBody>
        );
      })}

      {/* ===== MONUMENT I: Planet-Skull on a 200m column ===== */}
      <RigidBody type="fixed">
        <mesh position={[-120, PLATE_Y + 60, -120]} userData={tag({ isWall: true })} material={MATTE_WORLD}>
          <boxGeometry args={[20, 200, 20]} />
        </mesh>
      </RigidBody>
      <group ref={skullRef} position={[-120, PLATE_Y + 185, -120]} scale={38}>
        <Suspense fallback={null}>
          <AssetModel assetId="skull" />
        </Suspense>
        <mesh name="skull-proxy" visible={false} userData={tag({ isWall: true })}>
          <sphereGeometry args={[0.6, 10, 10]} />
        </mesh>
      </group>

      {/* ===== MONUMENT III: BULL & BEAR — the eternal fight (40m giants) ===== */}
      <group position={[120, PLATE_Y, -120]}>
        <group position={[-14, 0, 0]} rotation={[0, Math.PI / 2, 0]} scale={22}>
          <GiantDude color="#2fbf71" mirror={false} />
        </group>
        <group position={[14, 0, 0]} rotation={[0, -Math.PI / 2, 0]} scale={22}>
          <GiantDude color="#c9184a" mirror={true} />
        </group>
      </group>

      {/* ===== MONUMENT IV: the Ticker Obelisk 250m ===== */}
      <RigidBody type="fixed">
        <mesh position={[120, PLATE_Y + 125, 120]} userData={tag({ isWall: true })} material={MATTE_WORLD_SOFT}>
          <boxGeometry args={[16, 250, 16]} />
        </mesh>
      </RigidBody>
      <mesh position={[120, PLATE_Y + 125, 120 - 8.2]} material={obeliskMat} onUpdate={(m) => { m.raycast = NO_RAYCAST; }}>
        <planeGeometry args={[12, 240]} />
      </mesh>

      {/* ===== six bridge-beams reaching toward the city ===== */}
      {[0, 1, 2, 3, 4, 5].map((i) => {
        const a = (i / 6) * Math.PI * 2;
        return (
          <RigidBody key={`b${i}`} type="fixed">
            <mesh
              position={[Math.cos(a) * 190, PLATE_Y - 1, Math.sin(a) * 190]}
              rotation={[0, -a, 0]}
              userData={tag({ isFloor: true })}
              material={MATTE_WORLD_SOFT}
            >
              <boxGeometry args={[80, 2, 8]} />
            </mesh>
          </RigidBody>
        );
      })}
    </group>
  );
};
