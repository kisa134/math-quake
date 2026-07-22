import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { createServer } from "http";
import { Server } from "socket.io";

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? Number(process.env.PORT) : 3000; // Render/hosts inject PORT
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  // --- Authoritative world (increment 05: net-world-backbone) ---
  // Server owns HIGH-LEVEL truth only (root transforms + state), ticks at 20Hz,
  // broadcasts world_snapshot; clients interpolate. This runs on a NEW world_*
  // channel and does NOT touch the existing per-player relay below.
  type CreatureState = 'idle' | 'walk' | 'chase' | 'attack' | 'dead';
  const STATE_I: Record<CreatureState, number> = { idle: 0, walk: 1, chase: 2, attack: 3, dead: 4 };

  interface Creature {
    id: string;
    x: number; y: number; z: number; yaw: number;
    vx: number; vy: number; vz: number;
    state: CreatureState; hp: number; gaitId: number;
  }
  interface World {
    seq: number;
    train: { t: number; speed: number; pilotId: string | null; derailed: boolean };
    creatures: Creature[];
  }

  const makeWorld = (): World => ({
    seq: 0,
    train: { t: 0, speed: 0.03, pilotId: null, derailed: false },
    // MVP: one dummy entity the server flies in a circle — proof of authority.
    creatures: [{ id: 'dummy', x: 0, y: 2, z: 0, yaw: 0, vx: 0, vy: 0, vz: 0, state: 'walk', hp: 100, gaitId: 0 }],
  });

  const q = (v: number) => Math.round(v * 100);
  const qa = (v: number) => Math.round(v * 1000);
  const buildSnapshot = (w: World, serverTime: number) => ({
    seq: w.seq,
    t: serverTime,
    train: [Math.round(w.train.t * 1e4), Math.round(w.train.speed * 1e3), w.train.pilotId ?? '', w.train.derailed ? 1 : 0],
    cr: w.creatures.map(c => [
      c.id, q(c.x), q(c.y), q(c.z), qa(c.yaw),
      STATE_I[c.state], c.hp | 0, c.gaitId | 0,
      c.state === 'idle' ? 0 : Math.round(c.vx * 10),
      c.state === 'idle' ? 0 : Math.round(c.vz * 10),
    ]),
  });

  const stepWorld = (w: World, dt: number) => {
    // MVP dummy: circle orbit, authoritative on the server (clients don't compute it).
    const a = Date.now() / 1000;
    const c = w.creatures[0];
    if (c) {
      const nx = Math.cos(a) * 8, nz = Math.sin(a) * 8;
      c.vx = (nx - c.x) / Math.max(dt, 1e-3);
      c.vz = (nz - c.z) / Math.max(dt, 1e-3);
      c.x = nx; c.z = nz; c.yaw = a + Math.PI / 2;
    }
  };

  // Basic room and player state
  const rooms: Record<string, {
    players: Record<string, { x: number, y: number, z: number, rotation: number, health: number, score: number, isShooting: boolean }>;
    enemies: Record<string, any>;
    world: World;
    lastTick: number;
  }> = {};

  const TICK_MS = 1000 / 20;
  setInterval(() => {
    const now = Date.now();
    for (const roomId in rooms) {
      const room = rooms[roomId];
      const dt = Math.min(0.1, (now - room.lastTick) / 1000);
      room.lastTick = now;
      stepWorld(room.world, dt);
      room.world.seq++;
      io.to(roomId).emit('world_snapshot', buildSnapshot(room.world, now));
    }
  }, TICK_MS);

  io.on("connection", (socket) => {
    let currentRoom = "";

    socket.on("join", (roomId) => {
      socket.join(roomId);
      currentRoom = roomId;
      
      if (!rooms[roomId]) {
        rooms[roomId] = { players: {}, enemies: {}, world: makeWorld(), lastTick: Date.now() };
      }

      rooms[roomId].players[socket.id] = {
        x: 0, y: 10, z: 0, rotation: 0, health: 100, score: 0, isShooting: false
      };

      socket.emit("init", {
        id: socket.id,
        players: rooms[roomId].players,
      });

      // Full world state for late-joiners (increment 05).
      socket.emit("world_init", {
        world: rooms[roomId].world,
        serverTime: Date.now(),
        seq: rooms[roomId].world.seq,
      });

      socket.to(roomId).emit("player_joined", {
        id: socket.id,
        player: rooms[roomId].players[socket.id]
      });
    });

    socket.on("update", (data) => {
      if (!currentRoom || !rooms[currentRoom] || !rooms[currentRoom].players[socket.id]) return;
      
      // Update local state
      Object.assign(rooms[currentRoom].players[socket.id], data);

      // Broadcast to others
      socket.to(currentRoom).emit("player_updated", {
        id: socket.id,
        data
      });
    });
    
    socket.on("shoot", (data) => {
      if (!currentRoom) return;
      socket.to(currentRoom).emit("player_shot", {
        id: socket.id,
        ...data
      });
    });
    
    socket.on("hit", (data) => {
        if (!currentRoom) return;
        if (rooms[currentRoom] && rooms[currentRoom].players[data.targetId]) {
            rooms[currentRoom].players[data.targetId].health -= data.damage;
            io.to(currentRoom).emit("player_hit", {
                id: data.targetId,
                damage: data.damage,
                health: rooms[currentRoom].players[data.targetId].health,
                shooterId: socket.id
            });
            
            if (rooms[currentRoom].players[data.targetId].health <= 0) {
               // Handle death
               rooms[currentRoom].players[data.targetId].health = 100;
               io.to(currentRoom).emit("player_died", {
                   id: data.targetId,
                   shooterId: socket.id
               });
               if (rooms[currentRoom].players[socket.id]) {
                  rooms[currentRoom].players[socket.id].score += 10;
                  io.to(currentRoom).emit("score_updated", {
                      id: socket.id,
                      score: rooms[currentRoom].players[socket.id].score
                  });
               }
            }
        }
    });

    socket.on("disconnect", () => {
      if (currentRoom && rooms[currentRoom]) {
        delete rooms[currentRoom].players[socket.id];
        socket.to(currentRoom).emit("player_left", socket.id);
        
        if (Object.keys(rooms[currentRoom].players).length === 0) {
            delete rooms[currentRoom];
        }
      }
    });
  });

  // API routes FIRST
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
