import { useMemo, useRef, useLayoutEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../store';
import { tag } from '../game/hitTags';
import { socket } from '../socket';
import { addTrauma } from '../game/shake';
import { playExplosionSound, playImpactSound } from '../utils/audio';
import { getDudeParts, JOINTS, makeGore } from '../game/voxHumanoid';
import {
  MUTATIONS, MUT_BY_ID, rollMutation, makeBot, botHitInbox, botFxInbox, netBots,
  BOT_CAP, type Bot,
} from '../game/botHorde';
import { creatureLive, creatureHitInbox } from '../game/creatureNet';

/**
 * V4 БРУТАЛ — the voxel-dude BOT HORDE. Up to 40 mutated white-dude bots in
 * exactly SIX draw calls total (one InstancedMesh per body part for the WHOLE
 * horde, module-shared voxel geometries, per-instance mutation color). No
 * RigidBodies: analytic steering + manual gravity + round-robin ground rays
 * (6 bots/frame, far-clamped — the raycast law). Host simulates, peers mirror
 * the 6Hz 'bots' snapshot; hits flow through botHitInbox ('bhit' relay).
 * Gore: hits burst voxel gore, >=35 dmg pops a limb, death = FULL shatter.
 * DEVOURER eats bots/creatures and GROWS.
 */
const NO_RAYCAST = () => {};
const G = 30;
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scl = new THREE.Vector3();
const _mBot = new THREE.Matrix4();
const _mLocal = new THREE.Matrix4();
const _mOut = new THREE.Matrix4();
const _yAxis = new THREE.Vector3(0, 1, 0);
const _color = new THREE.Color();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const _rayDir = new THREE.Vector3(0, -1, 0);
const _rayOrigin = new THREE.Vector3();
const _groundRay = new THREE.Raycaster();

// module-level so Game/Player can drive the horde without prop drilling
let _spawn: ((count: number, round: number) => void) | null = null;
let _aliveCount = 0;
export function spawnBotWave(count: number, round: number) { _spawn?.(count, round); }
export function aliveBotCount() { return _aliveCount; }

const SPAWN_ANCHORS: [number, number, number][] = [
  [0, 84, 0], [200, 24, 200], [-200, 24, 200], [200, 24, -200], [-200, 24, -200],
];

/** Write one bot's 6 part matrices + proxy + color. */
function writeBot(
  i: number,
  x: number, y: number, z: number, heading: number, scale: number,
  limbMask: number, phase: number, spd: number,
  head: THREE.InstancedMesh, torso: THREE.InstancedMesh,
  arms: THREE.InstancedMesh, legs: THREE.InstancedMesh,
  proxy: THREE.Mesh | null,
) {
  const swing = Math.sin(phase) * 0.7 * Math.min(1, spd / 8);
  _pos.set(x, y, z);
  _quat.setFromAxisAngle(_yAxis, heading);
  _scl.setScalar(scale);
  _mBot.compose(_pos, _quat, _scl);

  const part = (mesh: THREE.InstancedMesh, idx: number, jx: number, jy: number, rot: number, gone: boolean) => {
    if (gone) { mesh.setMatrixAt(idx, ZERO); return; }
    _mLocal.makeRotationX(rot);
    _mLocal.setPosition(jx, jy, 0);
    _mOut.multiplyMatrices(_mBot, _mLocal);
    mesh.setMatrixAt(idx, _mOut);
  };
  part(head, i, 0, JOINTS.neck, 0, (limbMask & 1) !== 0);
  part(torso, i, 0, JOINTS.hips, 0, false);
  part(arms, i * 2, -JOINTS.shoulderX, JOINTS.shoulderY, swing, (limbMask & 2) !== 0);
  part(arms, i * 2 + 1, JOINTS.shoulderX, JOINTS.shoulderY, -swing, (limbMask & 4) !== 0);
  part(legs, i * 2, -JOINTS.hipX, JOINTS.hips, -swing, (limbMask & 8) !== 0);
  part(legs, i * 2 + 1, JOINTS.hipX, JOINTS.hips, swing, (limbMask & 16) !== 0);
  if (proxy) proxy.position.set(x, y + scale, z);
}

function paintBot(
  i: number, colorHex: string,
  head: THREE.InstancedMesh, torso: THREE.InstancedMesh,
  arms: THREE.InstancedMesh, legs: THREE.InstancedMesh,
) {
  _color.set(colorHex);
  head.setColorAt(i, _color);
  torso.setColorAt(i, _color);
  arms.setColorAt(i * 2, _color);
  arms.setColorAt(i * 2 + 1, _color);
  legs.setColorAt(i * 2, _color);
  legs.setColorAt(i * 2 + 1, _color);
}

export const BotHorde = () => {
  const { camera, scene } = useThree();
  const parts = useMemo(() => getDudeParts(), []);
  const headRef = useRef<THREE.InstancedMesh>(null);
  const torsoRef = useRef<THREE.InstancedMesh>(null);
  const armsRef = useRef<THREE.InstancedMesh>(null);
  const legsRef = useRef<THREE.InstancedMesh>(null);
  const proxyRefs = useRef<Array<THREE.Mesh | null>>([]);

  const bots = useRef<Bot[]>([]);              // host truth
  const slotOf = useRef<Map<number, number>>(new Map()); // bot id → instance slot
  const groundY = useRef<Float32Array>(new Float32Array(BOT_CAP).fill(-100));
  const netSmooth = useRef<Map<number, { x: number; y: number; z: number; h: number }>>(new Map());
  const lastPainted = useRef<Map<number, string>>(new Map());
  const rrFrame = useRef(0);
  const lastSync = useRef(0);

  useLayoutEffect(() => {
    for (const m of [headRef.current, torsoRef.current, armsRef.current, legsRef.current]) {
      if (!m) continue;
      m.raycast = NO_RAYCAST;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < m.count; i++) m.setMatrixAt(i, ZERO);
      m.instanceMatrix.needsUpdate = true;
    }
  }, []);

  // spawn hook (host)
  useLayoutEffect(() => {
    _spawn = (count, round) => {
      const withDevourer = round % 3 === 0;
      for (let n = 0; n < count && bots.current.length < BOT_CAP; n++) {
        const mut = withDevourer && n === 0 ? MUT_BY_ID['DEVOURER'] : rollMutation(Math.random);
        const anchor = SPAWN_ANCHORS[Math.floor(Math.random() * SPAWN_ANCHORS.length)];
        const a = Math.random() * Math.PI * 2;
        const r = 8 + Math.random() * 22;
        const bot = makeBot(mut, anchor[0] + Math.cos(a) * r, anchor[1] + 4, anchor[2] + Math.sin(a) * r);
        bots.current.push(bot);
      }
      // reassign slots compactly
      slotOf.current.clear();
      bots.current.forEach((b, i) => slotOf.current.set(b.id, i));
      lastPainted.current.clear(); // repaint everyone
    };
    return () => { _spawn = null; };
  }, []);

  const killBot = (b: Bot, slot: number) => {
    // FULL voxel shatter — the whole dude explodes into bone/blood/organs
    useStore.getState().addDebris(makeGore(b.x, b.y + b.scale, b.z, 28, 9));
    addTrauma(0.15);
    playExplosionSound();
    socket.emit('botdead', { x: b.x, y: b.y + b.scale, z: b.z, big: b.mut === 'DEVOURER' });
    bots.current = bots.current.filter((o) => o.id !== b.id);
    slotOf.current.delete(b.id);
    // clear the slot visuals
    const h = headRef.current, t = torsoRef.current, a = armsRef.current, l = legsRef.current;
    if (h && t && a && l) {
      h.setMatrixAt(slot, ZERO); t.setMatrixAt(slot, ZERO);
      a.setMatrixAt(slot * 2, ZERO); a.setMatrixAt(slot * 2 + 1, ZERO);
      l.setMatrixAt(slot * 2, ZERO); l.setMatrixAt(slot * 2 + 1, ZERO);
    }
    const proxy = proxyRefs.current[slot];
    if (proxy) proxy.position.set(0, -500, 0);
  };

  useFrame((state, dt) => {
    const head = headRef.current, torso = torsoRef.current, arms = armsRef.current, legs = legsRef.current;
    if (!head || !torso || !arms || !legs) return;
    const st = useStore.getState();
    const isHost = st.isHost;

    // death FX from the other side
    while (botFxInbox.length) {
      const e = botFxInbox.pop()!;
      useStore.getState().addDebris(makeGore(e.x, e.y, e.z, e.big ? 30 : 22, 9));
      if (e.big) addTrauma(0.2);
    }

    if (isHost) {
      // drain hits
      while (botHitInbox.length) {
        const hit = botHitInbox.pop()!;
        const b = bots.current.find((o) => o.id === hit.id);
        if (!b) continue;
        b.hp -= hit.damage;
        if (hit.damage >= 35 && b.hp > 0 && b.mut !== 'DEVOURER') {
          const free = [1, 2, 4, 8, 16].filter((bit) => !(b.limbMask & bit));
          if (free.length) {
            b.limbMask |= free[Math.floor(Math.random() * free.length)];
            useStore.getState().addDebris(makeGore(b.x, b.y + b.scale, b.z, 10, 8));
            playImpactSound();
          }
        }
        if (b.hp <= 0) {
          const slot = slotOf.current.get(b.id);
          if (slot !== undefined) killBot(b, slot);
        }
      }

      // sim
      rrFrame.current = (rrFrame.current + 1) % 7;
      const remotes = Object.values(st.remotePlayers);
      _aliveCount = bots.current.length;
      for (let i = 0; i < bots.current.length; i++) {
        const b = bots.current[i];
        const mut = MUT_BY_ID[b.mut];
        const slot = slotOf.current.get(b.id)!;

        // target: nearest player (me = camera) or, for devourer, nearest prey
        let tx = camera.position.x, ty = camera.position.y, tz = camera.position.z;
        let best = (tx - b.x) ** 2 + (tz - b.z) ** 2;
        for (const rp of remotes) {
          const d = (rp.x - b.x) ** 2 + (rp.z - b.z) ** 2;
          if (d < best) { best = d; tx = rp.x; ty = rp.y; tz = rp.z; }
        }
        if (mut.behavior === 'devour') {
          // prey: nearest other bot, else nearest creature
          let pd = Infinity;
          for (const o of bots.current) {
            if (o.id === b.id) continue;
            const d = (o.x - b.x) ** 2 + (o.z - b.z) ** 2;
            if (d < pd) { pd = d; tx = o.x; ty = o.y; tz = o.z; }
          }
          creatureLive.forEach((c, cid) => {
            const d = (c.x - b.x) ** 2 + (c.z - b.z) ** 2;
            if (d < pd) { pd = d; tx = c.x; ty = c.y; tz = c.z; }
          });
          // EAT: close enough → devour, GROW
          if (pd < (2.5 * b.scale) ** 2) {
            const victim = bots.current.find((o) => o.id !== b.id && (o.x - b.x) ** 2 + (o.z - b.z) ** 2 < (2.6 * b.scale) ** 2);
            if (victim) {
              const vSlot = slotOf.current.get(victim.id);
              if (vSlot !== undefined) killBot(victim, vSlot);
              b.scale = Math.min(4.5, b.scale * 1.06);
              b.hp += 40;
            } else {
              creatureLive.forEach((c, cid) => {
                if ((c.x - b.x) ** 2 + (c.z - b.z) ** 2 < (2.6 * b.scale) ** 2) {
                  creatureHitInbox.push({ id: cid, damage: 9999 });
                }
              });
            }
          }
        }

        // steering by behavior
        let dx = tx - b.x, dz = tz - b.z;
        const dist = Math.hypot(dx, dz) || 1;
        dx /= dist; dz /= dist;
        let sx = dx, sz = dz;
        const now = state.clock.elapsedTime;
        if (mut.behavior === 'flee' && dist < 45) { sx = -dx; sz = -dz; }
        if (mut.behavior === 'strafe') {
          sx = dx * 0.6 + -dz * b.strafeDir * 0.8;
          sz = dz * 0.6 + dx * b.strafeDir * 0.8;
          if (Math.sin(now * 0.7 + b.phase) > 0.995) b.strafeDir *= -1;
        }
        if (mut.behavior === 'swarm') {
          const ang = b.phase; // stable per-bot ring slot around the target
          sx = (tx + Math.cos(ang) * 6 - b.x); sz = (tz + Math.sin(ang) * 6 - b.z);
          const l = Math.hypot(sx, sz) || 1; sx /= l; sz /= l;
        }
        const spd = mut.speed;
        b.x += sx * spd * dt;
        b.z += sz * spd * dt;
        b.heading = Math.atan2(sx, sz);
        b.phase += dt * (4 + spd * 0.55);

        // hop behavior
        if (mut.behavior === 'hop' && now > b.nextHopAt && Math.abs(b.y - groundY.current[slot]) < 0.2) {
          b.vy = 9;
          b.nextHopAt = now + 1 + Math.random() * 1.4;
        }

        // gravity + ground (round-robin rays, far-clamped: the raycast law)
        if (slot % 7 === rrFrame.current) {
          _rayOrigin.set(b.x, b.y + 2, b.z);
          _groundRay.set(_rayOrigin, _rayDir);
          _groundRay.near = 0;
          _groundRay.far = 8;
          const hits = _groundRay.intersectObjects(scene.children, true);
          for (const h of hits) {
            const ud = h.object.userData;
            if (ud?.isFloor || ud?.isWall || ud?.isJumpPad) { groundY.current[slot] = h.point.y; break; }
          }
        }
        b.vy -= G * dt;
        b.y += b.vy * dt;
        if (b.y <= groundY.current[slot]) { b.y = groundY.current[slot]; b.vy = 0; }
        if (b.y < -45) { // fell off the world — silent removal
          const s = slotOf.current.get(b.id);
          if (s !== undefined) { bots.current = bots.current.filter((o) => o.id !== b.id); slotOf.current.delete(b.id); }
          continue;
        }

        // paint (mutation color; devourer pulses darkly)
        const painted = lastPainted.current.get(b.id);
        if (painted !== b.mut) {
          paintBot(slot, mut.color, head, torso, arms, legs);
          lastPainted.current.set(b.id, b.mut);
          if (head.instanceColor) head.instanceColor.needsUpdate = true;
          if (torso.instanceColor) torso.instanceColor.needsUpdate = true;
          if (arms.instanceColor) arms.instanceColor.needsUpdate = true;
          if (legs.instanceColor) legs.instanceColor.needsUpdate = true;
        }

        writeBot(slot, b.x, b.y, b.z, b.heading, b.scale, b.limbMask, b.phase, spd,
          head, torso, arms, legs, proxyRefs.current[slot] ?? null);
        // proxy carries the bot id for hit detection
        const proxy = proxyRefs.current[slot];
        if (proxy) proxy.userData.id = String(b.id);
      }
      _aliveCount = bots.current.length;

      // 6Hz snapshot to peers
      const nowMs = performance.now();
      if (nowMs - lastSync.current > 160) {
        lastSync.current = nowMs;
        socket.emit('bots', {
          list: bots.current.map((b) => ({
            id: b.id, mut: b.mut, x: b.x, y: b.y, z: b.z,
            h: b.heading, lm: b.limbMask, hp: b.hp, s: b.scale,
          })),
        });
      }
    } else {
      // ---- non-host mirror: lerp toward the snapshot ----
      const list = netBots.list;
      _aliveCount = list.length;
      const seen = new Set<number>();
      for (let i = 0; i < Math.min(list.length, BOT_CAP); i++) {
        const nb = list[i];
        seen.add(nb.id);
        let sm = netSmooth.current.get(nb.id);
        if (!sm) { sm = { x: nb.x, y: nb.y, z: nb.z, h: nb.h }; netSmooth.current.set(nb.id, sm); }
        const k = Math.min(1, dt * 8);
        sm.x += (nb.x - sm.x) * k;
        sm.y += (nb.y - sm.y) * k;
        sm.z += (nb.z - sm.z) * k;
        sm.h += (nb.h - sm.h) * k;
        const mut = MUT_BY_ID[nb.mut] ?? MUTATIONS[0];
        const painted = lastPainted.current.get(nb.id);
        if (painted !== nb.mut) {
          paintBot(i, mut.color, head, torso, arms, legs);
          lastPainted.current.set(nb.id, nb.mut);
          if (head.instanceColor) head.instanceColor.needsUpdate = true;
          if (torso.instanceColor) torso.instanceColor.needsUpdate = true;
          if (arms.instanceColor) arms.instanceColor.needsUpdate = true;
          if (legs.instanceColor) legs.instanceColor.needsUpdate = true;
        }
        writeBot(i, sm.x, sm.y, sm.z, sm.h, nb.s, nb.lm, state.clock.elapsedTime * 6, 6,
          head, torso, arms, legs, proxyRefs.current[i] ?? null);
        const proxy = proxyRefs.current[i];
        if (proxy) proxy.userData.id = String(nb.id);
      }
      // clear stale slots
      for (let i = list.length; i < BOT_CAP; i++) {
        head.setMatrixAt(i, ZERO); torso.setMatrixAt(i, ZERO);
        arms.setMatrixAt(i * 2, ZERO); arms.setMatrixAt(i * 2 + 1, ZERO);
        legs.setMatrixAt(i * 2, ZERO); legs.setMatrixAt(i * 2 + 1, ZERO);
        const proxy = proxyRefs.current[i];
        if (proxy) proxy.position.set(0, -500, 0);
      }
      netSmooth.current.forEach((_, id) => { if (!seen.has(id)) netSmooth.current.delete(id); });
    }

    head.instanceMatrix.needsUpdate = true;
    torso.instanceMatrix.needsUpdate = true;
    arms.instanceMatrix.needsUpdate = true;
    legs.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      <instancedMesh ref={headRef} args={[parts.head, undefined, BOT_CAP]}>
        <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={0.12} roughness={0.55} metalness={0.05} />
      </instancedMesh>
      <instancedMesh ref={torsoRef} args={[parts.torso, undefined, BOT_CAP]}>
        <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={0.12} roughness={0.55} metalness={0.05} />
      </instancedMesh>
      <instancedMesh ref={armsRef} args={[parts.arm, undefined, BOT_CAP * 2]}>
        <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={0.12} roughness={0.55} metalness={0.05} />
      </instancedMesh>
      <instancedMesh ref={legsRef} args={[parts.leg, undefined, BOT_CAP * 2]}>
        <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={0.12} roughness={0.55} metalness={0.05} />
      </instancedMesh>
      {/* invisible hit proxies — the only raycast targets for the horde */}
      {Array.from({ length: BOT_CAP }, (_, i) => (
        <mesh
          key={i}
          ref={(el) => { proxyRefs.current[i] = el; }}
          visible={false}
          position={[0, -500, 0]}
          userData={tag({ isBot: true, id: '0' })}
        >
          <boxGeometry args={[1.1, 2.1, 0.8]} />
        </mesh>
      ))}
    </group>
  );
};
