// server.js
// ─────────────────────────────────────────────────────────────────────────────
// 1) WebSocket signaling server (для video.html)
// 2) REST API для бронювань з автозбереженням у bookings.json
//    POST /api/bookings, GET /api/bookings?consultantEmail=..., DELETE /api/bookings/:id
//    Підтримка файлів (multipart/form-data, поле "file"), збереження у /uploads
//    Автоочистка: запис видаляється через 60 хв після старту
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
const DATA_DIR = process.env.DATA_DIR || ".";             // напр.: "/data" на Render
const BOOK_FILE = path.join(DATA_DIR, "bookings.json");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");

// гарантовано створюємо директорії
try { fs.mkdirSync(DATA_DIR,  { recursive: true }); } catch {}
try { fs.mkdirSync(UPLOAD_DIR,{ recursive: true }); } catch {}

// ── Multer (завантаження файлів) ─────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const safe = (file.originalname || "file")
      .replace(/[^a-zA-Z0-9.\-_]+/g, "_")
      .slice(0, 80);
    const stamp = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
    cb(null, `${stamp}-${safe}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

// ── App / HTTP / WS ──────────────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// ── Middlewares ──────────────────────────────────────────────────────────────
app.use(
  cors(
    ALLOWED_ORIGIN === "*"
      ? {}
      : { origin: ALLOWED_ORIGIN }
  )
);
app.use(express.json());

// віддавати завантажені файли
app.use("/uploads", express.static(UPLOAD_DIR));

// ── СИГНАЛІНГ: кімнати для відеодзвінків ─────────────────────────────────────
const rooms = new Map(); // { roomId: Set<ws> }

wss.on("connection", (ws) => {
  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === "join") {
      ws.room = String(msg.room || "").trim();
      if (!ws.room) return;

      if (!rooms.has(ws.room)) rooms.set(ws.room, new Set());
      rooms.get(ws.room).add(ws);
      broadcast(ws.room, { type: "peer-join" }, ws);
      return;
    }

    if (
      ws.room &&
      (msg.type === "offer" || msg.type === "answer" || msg.type === "ice")
    ) {
      broadcast(ws.room, msg, ws);
    }
  });

  ws.on("close", () => {
    if (ws.room && rooms.has(ws.room)) {
      rooms.get(ws.room).delete(ws);
      broadcast(ws.room, { type: "peer-leave" }, ws);
      if (rooms.get(ws.room).size === 0) rooms.delete(ws.room);
    }
  });
});

function broadcast(room, message, exceptWs) {
  const set = rooms.get(room) || [];
  const data = JSON.stringify(message);
  for (const client of set) {
    if (client !== exceptWs && client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

// ── БРОНЮВАННЯ: збереження у файлі ───────────────────────────────────────────
let bookings = [];
try {
  if (fs.existsSync(BOOK_FILE)) {
    bookings = JSON.parse(fs.readFileSync(BOOK_FILE, "utf-8"));
    if (!Array.isArray(bookings)) bookings = [];
  }
} catch { bookings = []; }

function saveBookings() {
  try {
    fs.writeFileSync(BOOK_FILE, JSON.stringify(bookings, null, 2), "utf-8");
  } catch {}
}

// автоочистка: старше за 60 хв від запланованого часу
function cleanup() {
  const now = Date.now();
  const before = bookings.length;
  bookings = bookings.filter((b) => now < Number(b.startTS) + 60 * 60 * 1000);
  if (bookings.length !== before) saveBookings();
}
setInterval(cleanup, 60 * 1000);

// ── API ──────────────────────────────────────────────────────────────────────
app.get("/api/health", (req, res) => {
  cleanup();
  res.json({ ok: true, rooms: rooms.size, bookings: bookings.length });
});

// створити бронювання (підтримка JSON та multipart/form-data з полем "file")
app.post("/api/bookings", upload.single("file"), (req, res) => {
  // якщо multipart — поля у req.body приходять як строки; якщо JSON — express.json() вже їх розпарсив
  let {
    consultantEmail,
    consultantName,
    fullName,
    email,
    date,
    time,
    note
  } = req.body || {};

  consultantEmail = String(consultantEmail || "").trim().toLowerCase();
  consultantName  = String(consultantName  || "").trim();
  fullName        = String(fullName        || "").trim();
  email           = String(email           || "").trim();
  date            = String(date            || "").trim();
  time            = String(time            || "").trim();
  note            = String(note            || "").trim();

  if (!consultantEmail || !consultantName || !fullName || !date || !time) {
    // при помилці видалимо тимчасово збережений файл (якщо був)
    if (req.file) { try { fs.unlinkSync(req.file.path); } catch {} }
    return res.status(400).json({ error: "Missing required fields" });
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    if (req.file) { try { fs.unlinkSync(req.file.path); } catch {} }
    return res.status(400).json({ error: "Bad email" });
  }

  // Київський локальний час
  const startTS = Date.parse(`${date}T${time}:00+03:00`);
  if (Number.isNaN(startTS)) {
    if (req.file) { try { fs.unlinkSync(req.file.path); } catch {} }
    return res.status(400).json({ error: "Bad date/time" });
  }

  // інформація про файл (якщо був)
  let fileName = "";
  let fileUrl  = "";
  if (req.file) {
    fileName = req.file.originalname || req.file.filename;
    // віддаємо як шлях відносно цього сервера
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
    fileUrl, // напр.: /uploads/abc123-file.pdf
  };

  bookings.push(rec);
  saveBookings();

  return res.status(201).json({ ok: true, id, rec });
});

// отримати список для консультанта
app.get("/api/bookings", (req, res) => {
  cleanup();
  const c = String(req.query.consultantEmail || "").toLowerCase().trim();
  if (!c) return res.status(400).json({ error: "consultantEmail required" });

  const list = bookings
    .filter((b) => b.consultantEmail === c)
    .sort((a, b) => a.startTS - b.startTS);

  res.json({ ok: true, list });
});

// видалити бронювання вручну (після дзвінка)
app.delete("/api/bookings/:id", (req, res) => {
  const id = String(req.params.id || "");
  // якщо у записі був файл — видалимо і його
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

// ── Статика (віддаємо /html як корінь сайту) ─────────────────────────────────
app.use(express.static("html"));

// ── START ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () =>
  console.log(`Server on http://localhost:${PORT}  |  API and WS ready`)
);
