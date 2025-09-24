// server.js
// ─────────────────────────────────────────────────────────────────────────────
// 1) WebSocket signaling server (для video.html)
// 2) REST API для бронювань з автозбереженням у bookings.json
//    Маршрути: POST /api/bookings, GET /api/bookings?consultantEmail=...,
//              DELETE /api/bookings/:id
//    Автоочистка: запис видаляється через 60 хв після старту
// ─────────────────────────────────────────────────────────────────────────────

const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

// ── App / HTTP / WS ──────────────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// ── Middlewares ──────────────────────────────────────────────────────────────
app.use(cors()); // за потреби можеш обмежити домени: cors({ origin: ["https://koma-hcmz.netlify.app"] })
app.use(express.json());

// ── СИГНАЛІНГ: кімнати для відеодзвінків ─────────────────────────────────────
const rooms = new Map(); // { roomId: Set<ws> }

wss.on("connection", (ws) => {
  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === "join") {
      ws.room = msg.room;
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
const DATA_DIR = process.env.DATA_DIR || ".";
const BOOK_FILE = path.join(DATA_DIR, "bookings.json");

// завантажити існуючі
let bookings = [];
try {
  if (fs.existsSync(BOOK_FILE)) {
    bookings = JSON.parse(fs.readFileSync(BOOK_FILE, "utf-8"));
  }
} catch {
  bookings = [];
}

function saveBookings() {
  try {
    fs.writeFileSync(BOOK_FILE, JSON.stringify(bookings, null, 2), "utf-8");
  } catch {}
}

// автоочистка: старше за 60 хв від запланованого часу
function cleanup() {
  const now = Date.now();
  const before = bookings.length;
  bookings = bookings.filter((b) => now < b.startTS + 60 * 60 * 1000);
  if (bookings.length !== before) saveBookings();
}
setInterval(cleanup, 60 * 1000);

// ── API ──────────────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  cleanup();
  res.json({
    ok: true,
    wsRooms: rooms.size,
    futureBookings: bookings.length,
  });
});

// створити бронювання
app.post("/api/bookings", (req, res) => {
  const { consultantEmail, consultantName, fullName, email, date, time, note } =
    req.body || {};

  if (!consultantEmail || !consultantName || !fullName || !date || !time) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  // Парсимо локальний час Києва (UTC+3 умовно; достатньо для наших цілей)
  const startTS = Date.parse(`${date}T${time}:00+03:00`);
  if (Number.isNaN(startTS)) {
    return res.status(400).json({ error: "Bad date/time" });
  }

  const id = Math.random().toString(36).slice(2);
  const rec = {
    id,
    consultantEmail: String(consultantEmail).toLowerCase(),
    consultantName,
    fullName,
    email: email || "",
    note: note || "",
    date,
    time,
    startTS,
    createdAt: Date.now(),
  };

  bookings.push(rec);
  saveBookings();

  res.json({ ok: true, id, rec });
});

// отримати список для консультанта
app.get("/api/bookings", (req, res) => {
  cleanup();
  const c = String(req.query.consultantEmail || "").toLowerCase();
  if (!c) return res.status(400).json({ error: "consultantEmail required" });
  const list = bookings
    .filter((b) => b.consultantEmail === c)
    .sort((a, b) => a.startTS - b.startTS);
  res.json({ ok: true, list });
});

// видалити бронювання вручну (після дзвінка)
app.delete("/api/bookings/:id", (req, res) => {
  const id = req.params.id;
  const before = bookings.length;
  bookings = bookings.filter((b) => b.id !== id);
  if (before !== bookings.length) saveBookings();
  res.json({ ok: true });
});

// ── Статика (віддаємо /html як корінь сайту) ─────────────────────────────────
app.use(express.static("html"));

// ── START ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () =>
  console.log(`Server on http://localhost:${PORT}  |  API and WS ready`)
);
