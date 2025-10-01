// server.js
// ─────────────────────────────────────────────────────────────────────────────
// 1) WebSocket-сигналінг (join / offer / answer / ice / bye)
// 2) REST API бронювань з файлами (multer) і збереженням у bookings.json:
//    POST   /api/bookings
//    GET    /api/bookings?consultantEmail=...      -> { ok, list: [...] }
//    DELETE /api/bookings/:id
// 3) Статика сайту з директорії /html
// + Keepalive для WS (ping/pong), щоб Render/проксі не рвали з’єднання
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
const DATA_DIR   = process.env.DATA_DIR || ".";           // на Render можна "/data"
const BOOK_FILE  = path.join(DATA_DIR, "bookings.json");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");

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

// Тюн для проксі: довший keep-alive HTTP (деякі платформи обривають за замовчуванням)
server.keepAliveTimeout = 65_000;  // > 60s
server.headersTimeout   = 70_000;

// ── CORS + префлайт ──────────────────────────────────────────────────────────
const corsOptions = (ALLOWED_ORIGIN === "*")
  ? {} : { origin: ALLOWED_ORIGIN, credentials: false };

app.use(cors(corsOptions));
app.options("*", cors(corsOptions)); // відповіді на preflight для всіх маршрутів

// Дублюємо заголовок (деякі платформи кешують відповіді CORS)
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN === "*" ? "*" : ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
  next();
});

app.use(express.json());
app.use("/uploads", express.static(UPLOAD_DIR)); // віддаємо завантажені файли

// ── Сигналінг (кімнати) ──────────────────────────────────────────────────────
const rooms = new Map(); // Map<roomId, Set<ws>>

function broadcast(room, message, exceptWs) {
  const set = rooms.get(room) || new Set();
  const data = JSON.stringify(message);
  for (const client of set) {
    if (client !== exceptWs && client.readyState === WebSocket.OPEN) {
      try { client.send(data); } catch {}
    }
  }
}

// WS keepalive (ping/pong), щоб виявляти "мертві" клієнти за проксі
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

wss.on("connection", (ws) => {
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === "join") {
      ws.room = String(msg.room || "").trim();
      if (!ws.room) return;
      if (!rooms.has(ws.room)) rooms.set(ws.room, new Set());
      rooms.get(ws.room).add(ws);
      return;
    }

    if (
      ws.room &&
      (msg.type === "offer" || msg.type === "answer" || msg.type === "ice" || msg.type === "bye")
    ) {
      broadcast(ws.room, msg, ws);
    }
  });

  ws.on("close", () => {
    if (ws.room && rooms.has(ws.room)) {
      rooms.get(ws.room).delete(ws);
      if (rooms.get(ws.room).size === 0) rooms.delete(ws.room);
    }
  });

  ws.on("error", () => {
    // тихо закриваємо; reconnection зробить клієнт
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

// Healthcheck (зручно для Render)
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    rooms: rooms.size,
    bookings: bookings.length,
    uptime: process.uptime(),
  });
});

// Список кімнат (діагностика)
app.get("/api/rooms", (_req, res) => {
  const summary = [];
  for (const [roomId, set] of rooms.entries()) {
    summary.push({ roomId, peers: Array.from(set).length });
  }
  res.json({ ok: true, rooms: summary });
});

// Створити бронювання (JSON або multipart з полем "file")
app.post("/api/bookings", upload.single("file"), (req, res) => {
  let {
    consultantEmail,
    consultantName,
    fullName,
    email,
    date,
    time,
    notes, // із фронта може приходити як notes
    note,  // або як note
  } = req.body || {};

  // нормалізуємо поля
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

  // Простий таймштамп початку (Київ). За потреби передавайте готовий startTS із клієнта.
  const startTS = Date.parse(`${date}T${time}:00+03:00`);
  if (Number.isNaN(startTS)) {
    if (req.file) { try { fs.unlinkSync(req.file.path); } catch {} }
    return res.status(400).json({ error: "Bad date/time" });
  }

  // Інформація про файл
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

  // видаляємо файл, якщо був
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

// Коректне завершення (прибираємо інтервал ping)
process.on('SIGTERM', () => {
  clearInterval(wsPingInterval);
  server.close(() => process.exit(0));
});
process.on('SIGINT', () => {
  clearInterval(wsPingInterval);
  server.close(() => process.exit(0));
});
