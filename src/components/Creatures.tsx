import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { RigidBody, BallCollider } from '@react-three/rapier';
import { useStore, type Creature } from '../store';
import { socket } from '../socket';
import { creatureLive, creatureHitInbox } from '../game/creatureNet';
import { makeChunks } from '../game/voxel';
import { tag } from '../game/hitTags';

/**
 * Neutral roaming critters (WS-E). Host-authoritative, mirroring the Enemies
 * pattern: the host simulates them as small rapier bodies (wander-hop AI,
 * curious drift toward players, flee when shot) and broadcasts snapshots
 * (~6Hz, 'creatures'); non-hosts render `netCreatures` as plain shootable
 * meshes and relay damage via 'chit'. Aim + T tames one into your minion
 * squad (tryTame, wired in Player.tsx).
 */

const CREATURE_HP = 60;
const CREATURE_CAP = 10;
const CURIOUS_RANGE = 15;
const FLEE_SPEED = 8;
const FLEE_MS = 2500;

type CreatureType = 'blob' | 'wisp' | 'crab';
const TYPE_STYLE: Record<string, { color: string; eye: string }> = {
  blob: { color: '#8df0b8', eye: '#14321f' }, // pastel mint
  wisp: { color: '#a9c9ff', eye: '#16224a' }, // pastel sky
  crab: { color: '#ffb3a1', eye: '#3f1710' }, // pastel coral
};

// --- seeded-ish spawn perches around the temples -----------------------------
const mulberry32 = (a: number) => () => {
  a |= 0; a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// Center temple top ≈ y81; outer temples rise from y20. Critters drop onto them.
const ANCHORS: [number, number, number][] = [
  [0, 90, 0],
  [-200, 48, -200], [200, 48, -200], [-200, 48, 200], [200, 48, 200],
];

const SPAWNS: { pos: [number, number, number]; type: CreatureType }[] = (() => {
  const rand = mulberry32(1337);
  const types: CreatureType[] = ['blob', 'wisp', 'crab'];
  const out: { pos: [number, number, number]; type: CreatureType }[] = [];
  for (let i = 0; i < CREATURE_CAP; i++) {
    const [ax, ay, az] = ANCHORS[i % ANCHORS.length];
    out.push({
      pos: [ax + (rand() - 0.5) * 18, ay + rand() * 4, az + (rand() - 0.5) * 18],
      type: types[Math.floor(rand() * types.length)],
    });
  }
  return out;
})();

let spawnSeq = 0;
const freshCreature = (): Creature => {
  const s = SPAWNS[Math.floor(Math.random() * SPAWNS.length)];
  return {
    id: `crt-${++spawnSeq}-${Math.random().toString(36).slice(2, 7)}`,
    type: s.type,
    x: s.pos[0], y: s.pos[1], z: s.pos[2],
    hp: CREATURE_HP,
  };
};

// --- module-level host state (hp + fear, no store churn) ---------------------
const hpMap = new Map<string, number>();
const hitAt = new Map<string, number>();

const cleanup = (id: string) => {
  hpMap.delete(id);
  hitAt.delete(id);
  creatureLive.delete(id);
};

/** HOST-side damage application: hp, flee-fear, kill → voxel burst + removal. */
function applyCreatureDamage(id: string, damage: number) {
  const st = useStore.getState();
  const c = st.creatures.find((cr) => cr.id === id);
  if (!c) return;
  const live = creatureLive.get(id);
  const pos: [number, number, number] = live ? [live.x, live.y, live.z] : [c.x, c.y, c.z];
  hitAt.set(id, Date.now());
  st.addDamageNumber(pos, damage, '#8df0b8');
  const hp = (hpMap.get(id) ?? CREATURE_HP) - damage;
  if (hp <= 0) {
    st.addDebris(makeChunks({ type: 'icosahedron', position: pos }, pos));
    st.removeCreature(id);
    cleanup(id);
  } else {
    hpMap.set(id, hp);
  }
}

/**
 * Damage entry point for the shooting code (Player hitscan sees userData
 * isCreature → calls this). Host applies directly; non-host relays 'chit'
 * and the host drains it from creatureHitInbox.
 */
export function damageCreature(id: string, damage: number) {
  if (useStore.getState().isHost) applyCreatureDamage(id, damage);
  else socket.emit('chit', { id, damage });
}

// --- taming ------------------------------------------------------------------
const _tameRay = new THREE.Raycaster();
const _screenCenter = new THREE.Vector2(0, 0);

/**
 * Aim + T: raycast from screen center (≤6u); if a creature is under the
 * crosshair, it joins the tamer's minion squad (addMinion caps at 6). Host
 * removes it from the sim directly; non-hosts ask the host via 'tame'.
 * Returns true if consumed (integrator chains T: car first, then tame).
 */
export function tryTame(camera: THREE.Camera, scene: THREE.Scene): boolean {
  _tameRay.setFromCamera(_screenCenter, camera);
  _tameRay.far = 6;
  const hits = _tameRay.intersectObjects(scene.children, true);
  for (const h of hits) {
    let o: THREE.Object3D | null = h.object;
    while (o) {
      const ud = o.userData;
      if (ud?.isCreature && ud.id) {
        const id = ud.id as string;
        const st = useStore.getState();
        if (st.localMinions.length >= 6) return false; // squad full — shot still available
        const live = creatureLive.get(id);
        const net = st.netCreatures.find((c) => c.id === id);
        const pos = live ?? net ?? { x: h.point.x, y: h.point.y, z: h.point.z };
        if (st.isHost) { st.removeCreature(id); cleanup(id); }
        else socket.emit('tame', { id });
        st.addMinion({ x: pos.x, y: pos.y, z: pos.z });
        return true;
      }
      o = o.parent;
    }
    // something solid (wall/floor) between us and any creature blocks the tame
    const sud = h.object.userData;
    if (sud?.isWall || sud?.isFloor || sud?.isJumpPad) return false;
  }
  return false;
}

// --- host sim ----------------------------------------------------------------
const _cPos = new THREE.Vector3();
const _cDir = new THREE.Vector3();

const CreatureMesh = ({ id, type, position }: { id: string; type: string; position: [number, number, number] }) => {
  const rbRef = useRef<any>(null);
  const { camera } = useThree();
  // The 6Hz store refresh rewrites x/y/z; freeze the initial spawn so the
  // reactive RigidBody position prop never teleports a live body.
  const spawn = useRef(position);
  const nextHopAt = useRef(Date.now() + 1500 + Math.random() * 1500);
  const style = TYPE_STYLE[type] ?? TYPE_STYLE.blob;

  useEffect(() => () => { creatureLive.delete(id); }, [id]);

  useFrame((_, delta) => {
    const rb = rbRef.current;
    if (!rb) return;
    const p = rb.translation();
    creatureLive.set(id, { x: p.x, y: p.y, z: p.z });

    // fell into the void → pop back onto its spawn perch
    if (p.y < -70) {
      rb.setTranslation({ x: spawn.current[0], y: spawn.current[1], z: spawn.current[2] }, true);
      rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
      return;
    }

    _cPos.set(p.x, p.y, p.z);

    // nearest player = local camera or any remote player
    let nx = camera.position.x, nz = camera.position.z;
    let best = _cPos.distanceTo(camera.position);
    for (const rp of Object.values(useStore.getState().remotePlayers)) {
      const d = Math.hypot(rp.x - p.x, rp.y - p.y, rp.z - p.z);
      if (d < best) { best = d; nx = rp.x; nz = rp.z; }
    }

    const now = Date.now();

    // recently shot → panic-run away from the nearest player
    if (now - (hitAt.get(id) ?? 0) < FLEE_MS) {
      _cDir.set(p.x - nx, 0, p.z - nz).normalize();
      const vel = rb.linvel();
      rb.setLinvel({ x: _cDir.x * FLEE_SPEED, y: vel.y, z: _cDir.z * FLEE_SPEED }, true);
      return;
    }

    // curious: gentle continuous drift toward a nearby player
    if (best < CURIOUS_RANGE && best > 3) {
      _cDir.set(nx - p.x, 0, nz - p.z).normalize();
      rb.applyImpulse({ x: _cDir.x * 0.9 * delta, y: 0, z: _cDir.z * 0.9 * delta }, true);
    }

    // periodic wander hop (random dir, biased toward a nearby player)
    if (now >= nextHopAt.current) {
      nextHopAt.current = now + 1500 + Math.random() * 1500;
      let hx = (Math.random() - 0.5) * 2, hz = (Math.random() - 0.5) * 2;
      if (best < CURIOUS_RANGE) {
        _cDir.set(nx - p.x, 0, nz - p.z).normalize();
        hx = hx * 0.5 + _cDir.x; hz = hz * 0.5 + _cDir.z;
      }
      const len = Math.hypot(hx, hz) || 1;
      rb.applyImpulse({ x: (hx / len) * 1.1, y: 2.6 + Math.random() * 1.0, z: (hz / len) * 1.1 }, true);
    }
  });

  return (
    <RigidBody
      ref={rbRef}
      position={spawn.current}
      type="dynamic"
      colliders={false}
      mass={0.4}
      lockRotations
      linearDamping={0.6}
    >
      <BallCollider args={[0.5]} />
      <group userData={tag({ isCreature: true, id })}>
        <mesh castShadow>
          <icosahedronGeometry args={[0.5, 0]} />
          <meshStandardMaterial color={style.color} emissive={style.color} emissiveIntensity={0.35} roughness={0.55} />
        </mesh>
        <mesh position={[-0.16, 0.14, 0.42]}>
          <boxGeometry args={[0.1, 0.14, 0.06]} />
          <meshBasicMaterial color={style.eye} />
        </mesh>
        <mesh position={[0.16, 0.14, 0.42]}>
          <boxGeometry args={[0.1, 0.14, 0.06]} />
          <meshBasicMaterial color={style.eye} />
        </mesh>
      </group>
    </RigidBody>
  );
};

// Host: refresh store snapshot from creatureLive + broadcast it (~6Hz), and
// drain the peer-interaction inbox ('chit' damage / 'tame' removals).
const HostCreatureSync = () => {
  useEffect(() => {
    const iv = setInterval(() => {
      const st = useStore.getState();
      const list = st.creatures.map((c) => {
        const live = creatureLive.get(c.id);
        return {
          ...c,
          x: live ? live.x : c.x,
          y: live ? live.y : c.y,
          z: live ? live.z : c.z,
          hp: hpMap.get(c.id) ?? CREATURE_HP,
        };
      });
      st.setCreatures(list);
      socket.emit('creatures', { list });
    }, 160);
    return () => clearInterval(iv);
  }, []);

  useFrame(() => {
    while (creatureHitInbox.length > 0) {
      const h = creatureHitInbox.shift()!;
      if (h.tame) {
        useStore.getState().removeCreature(h.id);
        cleanup(h.id);
      } else {
        applyCreatureDamage(h.id, h.damage);
      }
    }
  });
  return null;
};

const CreatureSim = () => {
  const creatures = useStore((s) => s.creatures);
  const isPlaying = useStore((s) => s.isPlaying);

  useEffect(() => {
    if (!isPlaying) return;
    const st = useStore.getState();
    if (st.creatures.length === 0) {
      st.setCreatures(SPAWNS.map((s) => ({
        id: `crt-${++spawnSeq}-${Math.random().toString(36).slice(2, 7)}`,
        type: s.type,
        x: s.pos[0], y: s.pos[1], z: s.pos[2],
        hp: CREATURE_HP,
      })));
    }
    // slow top-up so the world stays alive after kills/tames
    const iv = setInterval(() => {
      const cur = useStore.getState();
      if (cur.creatures.length >= CREATURE_CAP) return;
      cur.setCreatures([...cur.creatures, freshCreature()]);
    }, 12000);
    return () => clearInterval(iv);
  }, [isPlaying]);

  return (
    <>
      {creatures.map((c) => (
        <CreatureMesh key={c.id} id={c.id} type={c.type} position={[c.x, c.y, c.z]} />
      ))}
      <HostCreatureSync />
    </>
  );
};

// --- non-host mirror ---------------------------------------------------------
const NetCreatures = () => {
  const netCreatures = useStore((s) => s.netCreatures);
  const spawnDeathFx = useStore((s) => s.spawnDeathFx);
  const prev = useRef(new Map<string, { x: number; y: number; z: number }>());

  useEffect(() => {
    const cur = new Map<string, { x: number; y: number; z: number }>();
    for (const c of netCreatures) cur.set(c.id, { x: c.x, y: c.y, z: c.z });
    // Guard against a glitchy empty snapshot shattering the whole flock.
    if (!(netCreatures.length === 0 && prev.current.size > 2)) {
      for (const [id, p] of prev.current) {
        if (!cur.has(id)) spawnDeathFx(p.x, p.y, p.z, false);
      }
      prev.current = cur;
    }
  }, [netCreatures, spawnDeathFx]);

  return (
    <>
      {netCreatures.map((c) => {
        const style = TYPE_STYLE[c.type] ?? TYPE_STYLE.blob;
        return (
          <group key={c.id} position={[c.x, c.y, c.z]} userData={tag({ isCreature: true, id: c.id })}>
            <mesh>
              <icosahedronGeometry args={[0.5, 0]} />
              <meshStandardMaterial color={style.color} emissive={style.color} emissiveIntensity={0.35} roughness={0.55} />
            </mesh>
            <mesh position={[-0.16, 0.14, 0.42]}>
              <boxGeometry args={[0.1, 0.14, 0.06]} />
              <meshBasicMaterial color={style.eye} />
            </mesh>
            <mesh position={[0.16, 0.14, 0.42]}>
              <boxGeometry args={[0.1, 0.14, 0.06]} />
              <meshBasicMaterial color={style.eye} />
            </mesh>
          </group>
        );
      })}
    </>
  );
};

export const Creatures = () => {
  const isHost = useStore((s) => s.isHost);
  return isHost ? <CreatureSim /> : <NetCreatures />;
};
