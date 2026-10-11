const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  transports: ["websocket", "polling"]
});

const PORT = process.env.PORT || 3000;
const players = new Map();
const MAX_PLAYERS = 16;

app.get("/", (_req, res) => res.sendFile(require("path").join(__dirname, "index.html")));
app.get("/health", (_req, res) => res.json({ ok: true, players: players.size }));

io.on("connection", socket => {
  socket.data.lastShot = 0;
  socket.on("joinGame", data => {
    if (players.size >= MAX_PLAYERS) {
      socket.emit("notice", "اتاق پر است؛ بعداً دوباره تلاش کن.");
      socket.disconnect(true);
      return;
    }
    const name = String(data && data.name || "Player").replace(/[<>]/g, "").slice(0, 16);
    const spawn = (players.size % 2 === 0) ? { x: -2, z: 8 } : { x: 2, z: -8 };
    players.set(socket.id, {
      id: socket.id, name, x: spawn.x, z: spawn.z, yaw: 0,
      color: Math.random() > .5 ? 0x2387c9 : 0xb84a36, hp: 100
    });
    socket.emit("notice", "وارد بازی شدی. بازیکنان دیگر می‌توانند متصل شوند.");
    broadcastState();
  });

  socket.on("move", data => {
    const p = players.get(socket.id);
    if (!p || !data) return;
    const x = Number(data.x), z = Number(data.z), yaw = Number(data.yaw);
    if (![x,z,yaw].every(Number.isFinite)) return;
    // Basic bounds; a production game must validate speed and collision server-side.
    p.x = Math.max(-20, Math.min(20, x));
    p.z = Math.max(-20, Math.min(20, z));
    p.yaw = yaw;
    broadcastState();
  });

  socket.on("shoot", data => {
    const shooter = players.get(socket.id);
    const now = Date.now();
    if (!shooter || !data || now - socket.data.lastShot < 150) return;
    socket.data.lastShot = now;
    const x = Number(data.x), z = Number(data.z), yaw = Number(data.yaw), pitch = Number(data.pitch);
    if (![x,z,yaw,pitch].every(Number.isFinite)) return;
    // Simple server-side cone/range hit check. This is a prototype, not cheat-proof.
    let target = null, best = 18;
    for (const [id, p] of players) {
      if (id === socket.id) continue;
      const dx = p.x - x, dz = p.z - z;
      const distance = Math.hypot(dx, dz);
      if (distance > 18 || distance < 0.1) continue;
      const targetYaw = Math.atan2(dx, -dz);
      const angle = Math.atan2(Math.sin(targetYaw-yaw), Math.cos(targetYaw-yaw));
      if (Math.abs(angle) < 0.16 && distance < best) { target = p; best = distance; }
    }
    if (target) {
      target.hp -= 25;
      io.emit("hit", { target: target.id, damage: 25, hp: target.hp });
      if (target.hp <= 0) {
        io.emit("kill", { killer: socket.id, target: target.id });
        target.hp = 100;
        target.x = Math.random() * 12 - 6;
        target.z = Math.random() * 12 - 6;
      }
      broadcastState();
    }
  });

  socket.on("disconnect", () => {
    players.delete(socket.id);
    broadcastState();
  });
});

function broadcastState() {
  const state = {};
  for (const [id, p] of players) state[id] = p;
  io.emit("state", state);
}

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Strike Mobile server listening on port ${PORT}`);
});
