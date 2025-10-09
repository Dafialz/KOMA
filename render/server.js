// server.js
// ─────────────────────────────────────────────────────────────────────────────
// 1) WebSocket-сигналінг (join / offer / answer / ice / bye) для багатьох кімнат
//    з подіями peer-join / peer-leave і лімітом 2 peer/room для відео
// 2) Служба підтримки (чат):
//    - кімнати: support:all, support:consultant:<email>, support:thread:<id>
//    - типи: chat / delivered / read
//    - багатокімнатні підписки на одному з’єднанні
// 3) REST API бронювань із файлами (multer) → bookings.json
// 4) Статика з /html
// + Keepalive для WS (ping/pong)
// ─────────────────────────────────────────────────────────────────────────────

const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const multer = require("multer");

// ── Конфіг ───────────────────────────────────────────────────────────────────
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*"; // напр.: "https://koma-hcmz.netlify.app"
const DATA_DIR   = process.env.DATA_DIR || ".";
const BOOK_FILE  = path.join(DATA_DIR, "bookings.json");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const MAX_ROOM_PEERS = 2; // важливо: не більше 2-х у відеокімнаті

// Гарантуємо наявність директорій
try { fs.mkdirSync(DATA_DIR,   { recursive: true }); } catch {}
try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch {}

// ── Multer (файли) ───────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const safe = String(file.originalname || "file")
      .replace(/[^a-zA-Z0-9.\-_]+/g, "_")
      .slice(0, 80);
    const stamp = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
    cb(null, `${stamp}-${safe}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } }); // 10 МБ

// ── App / HTTP / WS ──────────────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Тюн для проксі: довший keep-alive HTTP
server.keepAliveTimeout = 65_000;
server.headersTimeout   = 70_000;

// ── CORS + префлайт ──────────────────────────────────────────────────────────
const corsOptions = (ALLOWED_ORIGIN === "*")
  ? {}
  : { origin: ALLOWED_ORIGIN.split(",").map(s => s.trim()), credentials: false };

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN === "*" ? "*" : ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
  next();
});

app.use(express.json());
app.use("/uploads", express.static(UPLOAD_DIR));

// ── Сигналінг + Підтримка: кімнати ───────────────────────────────────────────
/**
 * rooms: Map<roomId, Set<ws>>
 * для ws: ws.rooms = Set<roomId>  (підтримка множинних кімнат)
 * зворотна сумісність: ws.room (перший join для відео)
 */
const rooms = new Map(); // Map<roomId, Set<ws>>

function wsId() { return Math.random().toString(36).slice(2); }
function now() { return Date.now(); }

function isSupportRoom(roomId = "") {
  return String(roomId).startsWith("support:");
}

function roomSet(roomId) {
  if (!rooms.has(roomId)) rooms.set(roomId, new Set());
  return rooms.get(roomId);
}

function countInRoom(roomId) {
  const set = rooms.get(roomId);
  return set ? set.size : 0;
}

// універсальна розсилка в межах кімнати
function broadcast(roomId, message, exceptWs = null) {
  const set = rooms.get(roomId);
  if (!set) return;
  const data = JSON.stringify({ ...message, room: roomId });
  for (const client of set) {
    if (client.readyState !== WebSocket.OPEN) continue;
    if (exceptWs && client === exceptWs) continue;
    try { client.send(data); } catch {}
  }
}

// приєднання до кімнати (для support:* — без ліміту)
function joinRoom(ws, roomId) {
  const set = roomSet(roomId);

  // ліміт лише для НЕ support кімнат (тобто для відео)
  if (!isSupportRoom(roomId) && set.size >= MAX_ROOM_PEERS) {
    try { ws.send(JSON.stringify({ type: "full", room: roomId })); } catch {}
    return false;
  }

  set.add(ws);
  if (!ws.rooms) ws.rooms = new Set();
  ws.rooms.add(roomId);

  // для зворотної сумісності із відеочатом (одна активна)
  if (!isSupportRoom(roomId) && !ws.room) ws.room = roomId;

  return true;
}

function leaveAllRooms(ws) {
  if (!ws.rooms) return;
  for (const r of ws.rooms) {
    const set = rooms.get(r);
    if (set) {
      set.delete(ws);
      if (set.size === 0) rooms.delete(r);
    }
  }
  ws.rooms.clear();
  ws.room = null;
}

// WS keepalive (ping/pong)
const PING_INTERVAL_MS = 30_000;
const wsPingInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      try { ws.terminate(); } catch {}
      return;
    }
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  });
}, PING_INTERVAL_MS);

wss.on("connection", (ws, req) => {
  ws.isAlive = true;
  ws.id = wsId();
  ws.rooms = new Set();
  ws.on("pong", () => { ws.isAlive = true; });

  // автоджойн через ?rooms=a,b,c
  try {
    const u = new URL(req.url, "http://localhost");
    const qsRooms = u.searchParams.get("rooms");
    if (qsRooms) {
      qsRooms.split(",").map(s => s.trim()).filter(Boolean).forEach(r => joinRoom(ws, r));
    }
  } catch {}

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const type = msg?.type;

    // JOIN ───────────────────────────────────────────────────────────────────
    if (type === "join") {
      const roomId = String(msg.room || "").trim();
      if (!roomId) return;
      if (!joinRoom(ws, roomId)) return;

      const count = countInRoom(roomId);

      // Підтвердження для новачка
      try {
        ws.send(JSON.stringify({ type: "join-ack", room: roomId, count }));
      } catch {}

      // Сповістити інших у кімнаті
      // peer-join має сенс лише для відео-кімнат, але не зашкодить і підтримці
      broadcast(roomId, { type: "peer-join", count }, ws);
      return;
    }

    // Сигналінг (відео) ──────────────────────────────────────────────────────
    if ((type === "offer" || type === "answer" || type === "ice")) {
      // гарантуємо членство для сумісності
      const r = String(msg.room || ws.room || "").trim();
      if (!r) return;
      if (!ws.rooms?.has(r)) joinRoom(ws, r);
      broadcast(r, { ...msg, room: r }, ws);
      return;
    }

    if (type === "bye") {
      // явний вихід користувача
      if (ws.room) broadcast(ws.room, { type: "peer-leave" }, ws);
      return;
    }

    // Служба підтримки (чат) ────────────────────────────────────────────────
    // Очікуємо:
    //   { type:'chat', room, threadId, from, to, role, text, ts, mid }
    //   { type:'delivered'|'read', room, threadId, mid, from }
    if (type === "chat") {
      const room = String(msg.room || "").trim();
      if (room) {
        if (!ws.rooms?.has(room)) joinRoom(ws, room);
      }

      const payload = {
        ...msg,
        serverTs: now(),
      };
      const data = JSON.stringify(payload);

      // 1) основна кімната
      if (room) broadcast(room, payload);

      // 2) глобальна кімната консультантів
      broadcast("support:all", payload);

      // 3) кімната конкретного треда (якщо є)
      if (msg.threadId) broadcast(`support:thread:${msg.threadId}`, payload);

      // миттєва квитанція "delivered" назад від сервера відправнику
      try {
        const ack = {
          type: "delivered",
          room,
          threadId: msg.threadId || null,
          mid: msg.mid,
          to: msg.from,
          serverTs: now(),
        };
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(ack));
      } catch {}

      return;
    }

    if (type === "delivered" || type === "read") {
      const room = String(msg.room || "").trim();
      if (room && !ws.rooms?.has(room)) joinRoom(ws, room);

      const payload = { ...msg, serverTs: now() };

      if (room) broadcast(room, payload, ws);
      if (msg.threadId) broadcast(`support:thread:${msg.threadId}`, payload, ws);
      return;
    }

    // інші службові події — за потреби
  });

  ws.on("close", () => {
    // для кожної кімнати, де доречно, повідомляємо peer-leave
    if (ws.rooms && ws.rooms.size) {
      for (const r of ws.rooms) {
        // повідомлення корисне для відеокімнат
        if (!isSupportRoom(r)) broadcast(r, { type: "peer-leave" }, ws);
      }
    }
    leaveAllRooms(ws);
  });

  ws.on("error", () => {
    try { ws.close(); } catch {}
  });
});

// ── Збереження бронювань ─────────────────────────────────────────────────────
let bookings = [];
try {
  if (fs.existsSync(BOOK_FILE)) {
    const raw = fs.readFileSync(BOOK_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) bookings = parsed;
  }
} catch { bookings = []; }

function saveBookings() {
  try {
    fs.writeFileSync(BOOK_FILE, JSON.stringify(bookings, null, 2), "utf-8");
  } catch (e) {
    console.error("saveBookings error:", e.message);
  }
}

// Healthcheck
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    rooms: Array.from(rooms).map(([roomId, set]) => ({ roomId, peers: set.size })),
    bookings: bookings.length,
    uptime: process.uptime(),
  });
});

// Список кімнат (діагностика)
app.get("/api/rooms", (_req, res) => {
  const summary = [];
  for (const [roomId, set] of rooms.entries()) {
    summary.push({ roomId, peers: set.size });
  }
  res.json({ ok: true, rooms: summary });
});

// Створити бронювання (JSON або multipart із полем "file")
app.post("/api/bookings", upload.single("file"), (req, res) => {
  let {
    consultantEmail,
    consultantName,
    fullName,
    email,
    date,
    time,
    notes,
    note,
  } = req.body || {};

  consultantEmail = String(consultantEmail || "").trim().toLowerCase();
  consultantName  = String(consultantName  || "").trim();
  fullName        = String(fullName        || "").trim();
  email           = String(email           || "").trim();
  date            = String(date            || "").trim();
  time            = String(time            || "").trim();
  note            = String(note || notes || "").trim();

  if (!consultantEmail || !consultantName || !fullName || !date || !time) {
    if (req.file) { try { fs.unlinkSync(req.file.path); } catch {} }
    return res.status(400).json({ error: "Missing required fields" });
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    if (req.file) { try { fs.unlinkSync(req.file.path); } catch {} }
    return res.status(400).json({ error: "Bad email" });
  }

  const startTS = Date.parse(`${date}T${time}:00+03:00`);
  if (Number.isNaN(startTS)) {
    if (req.file) { try { fs.unlinkSync(req.file.path); } catch {} }
    return res.status(400).json({ error: "Bad date/time" });
  }

  let fileName = "";
  let fileUrl  = "";
  if (req.file) {
    fileName = req.file.originalname || req.file.filename;
    fileUrl  = `/uploads/${req.file.filename}`;
  }

  const id = Math.random().toString(36).slice(2);
  const rec = {
    id,
    consultantEmail,
    consultantName,
    fullName,
    email,
    note,
    date,
    time,
    startTS,
    createdAt: Date.now(),
    fileName,
    fileUrl,
  };

  bookings.push(rec);
  saveBookings();
  return res.status(201).json({ ok: true, id, rec });
});

// Список бронювань для консультанта
app.get("/api/bookings", (req, res) => {
  const c = String(req.query.consultantEmail || "").trim().toLowerCase();
  if (!c) return res.status(400).json({ error: "consultantEmail required" });

  const list = bookings
    .filter((b) => b.consultantEmail === c)
    .sort((a, b) => a.startTS - b.startTS);

  res.json({ ok: true, list });
});

// Видалити бронювання
app.delete("/api/bookings/:id", (req, res) => {
  const id = String(req.params.id || "");
  const found = bookings.find((b) => b.id === id);

  if (found && found.fileUrl) {
    const p = path.join(UPLOAD_DIR, path.basename(found.fileUrl));
    try { fs.unlinkSync(p); } catch {}
  }

  const before = bookings.length;
  bookings = bookings.filter((b) => b.id !== id);
  if (before !== bookings.length) saveBookings();

  res.json({ ok: true, removed: before - bookings.length });
});

// ── Статика сайту ────────────────────────────────────────────────────────────
app.use(express.static("html"));

// ── START ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`CORS ALLOWED_ORIGIN = ${ALLOWED_ORIGIN}`);
});

// Коректне завершення
function shutdown() {
  clearInterval(wsPingInterval);
  server.close(() => process.exit(0));
}
process.on("SIGTERM", shutdown);
process.on("SIGINT",  shutdown);
