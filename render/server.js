import http from 'http';
import { WebSocketServer } from 'ws';

// Для Render порт приходить з process.env.PORT
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type':'text/plain' });
  res.end('KOMA signaling server is running\n');
});

const wss = new WebSocketServer({ server });

/**
 * Проста модель “кімнат”:
 * roomId -> Set<WebSocket>
 */
const rooms = new Map();

function joinRoom(ws, room) {
  if (!rooms.has(room)) rooms.set(room, new Set());
  rooms.get(room).add(ws);
  ws.room = room;
}

function leaveRoom(ws) {
  const { room } = ws;
  if (!room) return;
  const set = rooms.get(room);
  if (set) {
    set.delete(ws);
    if (set.size === 0) rooms.delete(room);
  }
  ws.room = null;
}

function broadcastToRoom(room, data, except) {
  const set = rooms.get(room);
  if (!set) return;
  for (const client of set) {
    if (client.readyState === 1 && client !== except) {
      client.send(data);
    }
  }
}

// keepalive (Render іноді засинає; пінгуємо клієнтів)
function heartbeat() { this.isAlive = true; }

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', heartbeat);

  ws.on('message', (buf) => {
    let msg = {};
    try { msg = JSON.parse(buf.toString()); } catch { return; }

    // очікуємо формат: { type, room, payload }
    switch (msg.type) {
      case 'join': {
        leaveRoom(ws);
        joinRoom(ws, msg.room);
        ws.send(JSON.stringify({ type:'joined', room: msg.room }));
        break;
      }
      case 'leave': {
        leaveRoom(ws);
        break;
      }
      // прокидаємо сигнальні повідомлення усім іншим у кімнаті
      case 'offer':
      case 'answer':
      case 'ice':
      case 'bye': {
        if (!ws.room) return;
        broadcastToRoom(ws.room, JSON.stringify({
          type: msg.type,
          from: msg.from || null,
          payload: msg.payload
        }), ws);
        break;
      }
      default:
        // no-op
        break;
    }
  });

  ws.on('close', () => leaveRoom(ws));
});

// перевірка коннектів
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => clearInterval(interval));

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log('Signaling server on :' + PORT);
});
