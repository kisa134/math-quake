import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { createServer } from "http";
import { Server } from "socket.io";

async function startServer() {
  const app = express();
  const PORT = 3000;
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  // Basic room and player state
  const rooms: Record<string, {
    players: Record<string, { x: number, y: number, z: number, rotation: number, health: number, score: number, isShooting: boolean }>;
    enemies: Record<string, any>;
  }> = {};

  io.on("connection", (socket) => {
    let currentRoom = "";

    socket.on("join", (roomId) => {
      socket.join(roomId);
      currentRoom = roomId;
      
      if (!rooms[roomId]) {
        rooms[roomId] = { players: {}, enemies: {} };
      }
      
      rooms[roomId].players[socket.id] = {
        x: 0, y: 10, z: 0, rotation: 0, health: 100, score: 0, isShooting: false
      };

      socket.emit("init", {
        id: socket.id,
        players: rooms[roomId].players,
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
