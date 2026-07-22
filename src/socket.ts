import { io } from "socket.io-client";
import { useStore } from "./store";

export const socket = io("/", {
  autoConnect: false,
});

export const initMultiplayer = (roomId: string) => {
  socket.connect();
  
  socket.on("connect", () => {
    socket.emit("join", roomId);
  });

  socket.on("init", (data) => {
    useStore.getState().setPlayerId(data.id);
    
    // Remove self from remote players
    const remotes = { ...data.players };
    delete remotes[data.id];
    useStore.getState().setRemotePlayers(remotes);
  });

  socket.on("player_joined", (data) => {
    useStore.getState().updateRemotePlayer(data.id, data.player);
  });

  socket.on("player_updated", (data) => {
    useStore.getState().updateRemotePlayer(data.id, data.data);
  });

  socket.on("player_shot", (data) => {
    useStore.getState().addProjectile({
      position: data.position,
      velocity: data.velocity,
      fromPlayer: false
    });
  });

  socket.on("player_hit", (data) => {
    if (data.id === useStore.getState().playerId) {
      useStore.getState().takeDamage(data.damage);
    } else {
      useStore.getState().updateRemotePlayer(data.id, { health: data.health });
    }
  });

  socket.on("player_died", (data) => {
    if (data.id === useStore.getState().playerId) {
      useStore.getState().takeDamage(100); // Trigger local death
    } else {
      useStore.getState().updateRemotePlayer(data.id, { health: 100 });
    }
  });

  socket.on("score_updated", (data) => {
    if (data.id === useStore.getState().playerId) {
      useStore.getState().score = data.score;
    } else {
      useStore.getState().updateRemotePlayer(data.id, { score: data.score });
    }
  });

  socket.on("player_left", (id) => {
    useStore.getState().removeRemotePlayer(id);
  });
};
