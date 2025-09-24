// server.js
const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// зберігаємо підключення по кімнатах: { roomId: Set<ws> }
const rooms = new Map();

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'join') {
      ws.room = msg.room;
      if (!rooms.has(ws.room)) rooms.set(ws.room, new Set());
      rooms.get(ws.room).add(ws);

      // повідомляємо інших, що з’явився новий учасник
      broadcast(ws.room, { type: 'peer-join' }, ws);
      return;
    }

    // перекидаємо SDP/ICE іншим у кімнаті
    if (ws.room && (msg.type === 'offer' || msg.type === 'answer' || msg.type === 'ice')) {
      broadcast(ws.room, msg, ws);
    }
  });

  ws.on('close', () => {
    if (ws.room && rooms.has(ws.room)) {
      rooms.get(ws.room).delete(ws);
      broadcast(ws.room, { type: 'peer-leave' }, ws);
      if (rooms.get(ws.room).size === 0) rooms.delete(ws.room);
    }
  });
});

function broadcast(room, message, exceptWs) {
  const set = rooms.get(room) || [];
  const data = JSON.stringify(message);
  for (const client of set) {
    if (client !== exceptWs && client.readyState === WebSocket.OPEN) client.send(data);
  }
}

app.use(express.static('html')); // щоб віддавати твої сторінки з папки html
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Signaling server on http://localhost:${PORT}`));
