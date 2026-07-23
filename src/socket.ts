import { createClient, type RealtimeChannel } from '@supabase/supabase-js';
import { useStore } from './store';
import { SUPABASE_URL, SUPABASE_ANON } from './net/supabaseConfig';

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

  // --- presence: authoritative room membership; prune anyone who left ---
  channel.on('presence', { event: 'sync' }, () => {
    if (!channel) return;
    const present = new Set(Object.keys(channel.presenceState()));
    present.delete(myId);
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
      useStore.getState().takeDamage(payload.damage);
    }
  });

  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') channel!.track({ id: myId });
  });
};
