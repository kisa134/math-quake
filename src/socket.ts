import { createClient, type RealtimeChannel } from '@supabase/supabase-js';
import { useStore } from './store';
import { SUPABASE_URL, SUPABASE_ANON } from './net/supabaseConfig';
import { creatureHitInbox } from './game/creatureNet';
import { voxInbox } from './game/voxCandles';
import { roundWinReward } from './config/economy';
import { goreInbox } from './game/voxHumanoid';
import { placePortal } from './game/portals';
import { botHitInbox, botFxInbox, netBots } from './game/botHorde';
import { applyDragonHit, dragonState, dragonFxInbox, DRAGONS } from './game/voxDragon';

/**
 * Multiplayer transport — Supabase Realtime broadcast, peer-to-peer style (no
 * game server). Each room is a channel `mq-<room>`; players broadcast their own
 * transform/shots/hits and everyone else applies them. This keeps a socket.io-
 * compatible `socket.emit/on/id` + `initMultiplayer` surface so the components
 * (Player/UI/RemotePlayers) didn't have to change.
 *
 * Authority note: this is client-trust / casual (HP + score are applied on the
 * receiving client). Good enough for friends' deathmatch. A server-authoritative
 * host (increment 05) can layer back on top later for anti-cheat.
 */
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
  realtime: { params: { eventsPerSecond: 40 } },
});

const myId = Math.random().toString(36).slice(2, 10);

type Handler = (payload: any) => void;
const handlers: Record<string, Handler[]> = {};
let channel: RealtimeChannel | null = null;

export const socket = {
  get id() { return myId; },
  get connected() { return channel !== null; },
  connect() { /* no-op: connection happens in initMultiplayer */ },
  emit(event: string, data: Record<string, any> = {}) {
    if (!channel) return;
    channel.send({ type: 'broadcast', event, payload: { from: myId, ...data } });
  },
  on(event: string, cb: Handler) {
    (handlers[event] ||= []).push(cb);
  },
};

export const initMultiplayer = (roomId: string) => {
  const store = useStore.getState();
  store.setPlayerId(myId);
  store.setRemotePlayers({});

  channel = supabase.channel(`mq-${roomId}`, {
    config: { broadcast: { self: false }, presence: { key: myId } },
  });

  // --- presence: room membership + host election (lowest id owns enemies) ---
  channel.on('presence', { event: 'sync' }, () => {
    if (!channel) return;
    const ids = Object.keys(channel.presenceState());
    if (!ids.includes(myId)) ids.push(myId);
    const hostId = ids.slice().sort()[0];
    useStore.getState().setIsHost(hostId === myId);

    const present = new Set(ids);
    const remotes = useStore.getState().remotePlayers;
    for (const id of Object.keys(remotes)) {
      if (!present.has(id)) useStore.getState().removeRemotePlayer(id);
    }
  });

  // --- peer broadcasts ---
  channel.on('broadcast', { event: 'update' }, ({ payload }) => {
    if (!payload || payload.from === myId) return;
    useStore.getState().updateRemotePlayer(payload.from, payload); // creates if new
  });

  channel.on('broadcast', { event: 'shoot' }, ({ payload }) => {
    if (!payload || payload.from === myId) return;
    useStore.getState().addProjectile({
      position: payload.position,
      velocity: payload.velocity,
      fromPlayer: false,
    });
  });

  channel.on('broadcast', { event: 'hit' }, ({ payload }) => {
    if (!payload) return;
    // The shooter broadcasts a hit on targetId; the target applies its own damage.
    if (payload.targetId === myId) {
      useStore.getState().takeDamage(payload.damage, payload.limb);
    }
    // Everyone sees the GORE on the victim's voxel dude (V3.2) — и ИМЕННО ту
    // конечность, в которую попали (V9 К).
    goreInbox.push({ targetId: payload.targetId, damage: payload.damage, limb: payload.limb });
  });

  // --- shared enemies (host-authoritative) ---
  channel.on('broadcast', { event: 'enemies' }, ({ payload }) => {
    if (!payload || payload.from === myId) return;
    useStore.getState().setNetEnemies(payload.list || []);
  });
  channel.on('broadcast', { event: 'ehit' }, ({ payload }) => {
    if (!payload) return;
    // Only the host applies damage to the shared enemies.
    if (useStore.getState().isHost) {
      useStore.getState().damageEnemy(payload.id, payload.damage, payload.point);
    }
  });

  // --- V6 Ш4: portals — both players see and use both ---
  channel.on('broadcast', { event: 'portal' }, ({ payload }) => {
    if (!payload || payload.from === myId) return;
    placePortal(payload.slot, payload.x, payload.y, payload.z, payload.nx, payload.ny, payload.nz);
  });

  // --- V4.1 dragons: event-sourced HP + mount state (wild flight is analytic) ---
  channel.on('broadcast', { event: 'dhit' }, ({ payload }) => {
    if (!payload || payload.from === myId) return;
    if (applyDragonHit(payload.id, payload.damage)) {
      const d = DRAGONS[payload.id];
      if (d && payload.x !== undefined) dragonFxInbox.push({ x: payload.x, y: payload.y, z: payload.z, scale: d.scale });
      // if I was riding it — I fall
      if (useStore.getState().ridingDragon === payload.id) useStore.getState().setRidingDragon(null);
    }
  });
  channel.on('broadcast', { event: 'dmount' }, ({ payload }) => {
    if (!payload || payload.from === myId) return;
    if (dragonState[payload.id]) dragonState[payload.id].riddenBy = payload.from;
  });
  channel.on('broadcast', { event: 'ddismount' }, ({ payload }) => {
    if (!payload || payload.from === myId) return;
    if (dragonState[payload.id]) dragonState[payload.id].riddenBy = null;
  });

  // --- V4 bot horde: host-authoritative, peers mirror + relay hits ---
  channel.on('broadcast', { event: 'bots' }, ({ payload }) => {
    if (!payload || payload.from === myId) return;
    if (!useStore.getState().isHost) netBots.list = payload.list || [];
  });
  channel.on('broadcast', { event: 'bhit' }, ({ payload }) => {
    if (!payload) return;
    if (useStore.getState().isHost) botHitInbox.push({ id: payload.id, damage: payload.damage });
  });
  channel.on('broadcast', { event: 'botdead' }, ({ payload }) => {
    if (!payload || payload.from === myId) return;
    botFxInbox.push({ x: payload.x, y: payload.y, z: payload.z, big: !!payload.big });
  });

  // --- CS match rounds (V2.2): host drives, peers mirror + self-pay bonuses ---
  channel.on('broadcast', { event: 'round' }, ({ payload }) => {
    if (!payload || payload.from === myId) return;
    if (!useStore.getState().isHost) {
      useStore.getState().setRound({ num: payload.num, phase: payload.phase, until: payload.until });
    }
  });
  channel.on('broadcast', { event: 'roundwin' }, ({ payload }) => {
    if (!payload || payload.from === myId) return;
    if (!useStore.getState().isHost) {
      useStore.getState().addMoney(roundWinReward(payload.num));
    }
  });

  // --- Teardown voxel candles: replicate carves (V2.1) ---
  channel.on('broadcast', { event: 'vox' }, ({ payload }) => {
    if (!payload || payload.from === myId) return;
    voxInbox.push({ id: payload.id, x: payload.x, y: payload.y, z: payload.z, r: payload.r });
  });

  // --- neutral creatures (host-authoritative, WS-E) ---
  channel.on('broadcast', { event: 'creatures' }, ({ payload }) => {
    if (!payload || payload.from === myId) return;
    if (!useStore.getState().isHost) useStore.getState().setNetCreatures(payload.list || []);
  });
  channel.on('broadcast', { event: 'chit' }, ({ payload }) => {
    if (!payload) return;
    if (useStore.getState().isHost) creatureHitInbox.push({ id: payload.id, damage: payload.damage });
  });
  channel.on('broadcast', { event: 'tame' }, ({ payload }) => {
    if (!payload) return;
    if (useStore.getState().isHost) creatureHitInbox.push({ id: payload.id, damage: 0, tame: true });
  });

  // --- editor: shared prop placement/removal ---
  channel.on('broadcast', { event: 'place' }, ({ payload }) => {
    if (!payload || payload.from === myId) return;
    useStore.getState().addProp(payload.prop);
  });
  channel.on('broadcast', { event: 'remove' }, ({ payload }) => {
    if (!payload || payload.from === myId) return;
    useStore.getState().removeProp(payload.id);
  });

  // --- late-join build snapshot: a fresh peer asks, the host replies with the
  // full placedProps so they see everything already built (fixes broadcast-only
  // props not replaying to late joiners). ---
  channel.on('broadcast', { event: 'props-req' }, ({ payload }) => {
    if (!payload || payload.from === myId) return;
    if (useStore.getState().isHost) {
      socket.emit('props-sync', { to: payload.from, props: useStore.getState().placedProps });
    }
  });
  channel.on('broadcast', { event: 'props-sync' }, ({ payload }) => {
    if (!payload || payload.to !== myId) return;
    useStore.getState().setPlacedProps(payload.props || []);
  });

  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      channel!.track({ id: myId });
      socket.emit('props-req'); // pull existing builds from the host
    }
  });
};
