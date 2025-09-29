// server.js
// Простий API для бронювань з підтримкою завантаження файлів (чеків).

import express from 'express';
import path from 'path';
import fs from 'fs-extra';
import crypto from 'crypto';
import multer from 'multer';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;

// ----- CORS (дозволяємо Netlify / або всіх) -----
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ----- Парсери -----
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ----- ФС -----
const __dirname = path.resolve();
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE  = path.join(DATA_DIR, 'db.json');
const UPLOADS  = path.join(__dirname, 'uploads');

await fs.ensureDir(DATA_DIR);
await fs.ensureDir(UPLOADS);

// Завантаження зберігаємо у /uploads/<uuid>__origName.ext
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOADS),
  filename: (_, file, cb) => {
    const uid = crypto.randomUUID();
    const safe = (file.originalname || 'file').replace(/[^\w.\-]+/g, '_');
    cb(null, `${uid}__${safe}`);
  }
});
const upload = multer({ storage });

// Віддаємо статику з /uploads
app.use('/uploads', express.static(UPLOADS, { fallthrough: true }));

// ----- «БД» у файлі -----
/** @type {Array<any>} */
let bookings = [];
async function loadDB() {
  try {
    const raw = await fs.readFile(DB_FILE, 'utf8');
    bookings = JSON.parse(raw);
    if (!Array.isArray(bookings)) bookings = [];
  } catch {
    bookings = [];
  }
}
async function saveDB() {
  await fs.writeFile(DB_FILE, JSON.stringify(bookings, null, 2), 'utf8');
}
await loadDB();

// ----- Utils -----
const nowISO = () => new Date().toISOString();
const absUrl = (req, rel) => {
  if (!rel) return '';
  if (/^https?:\/\//i.test(rel)) return rel;
  const base = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
  return `${base}${rel.startsWith('/') ? '' : '/'}${rel}`;
};

// ----- API -----

app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: nowISO() });
});

/**
 * GET /api/bookings
 * Параметри:
 *  - consultantEmail (string)
 *  - consultantName (string)
 *  - date=YYYY-MM-DD (optional)
 */
app.get('/api/bookings', (req, res) => {
  const { consultantEmail, consultantName, date } = req.query;

  let list = bookings.slice();

  if (consultantEmail) {
    const key = String(consultantEmail).toLowerCase();
    list = list.filter(b => String(b.consultantEmail || '').toLowerCase() === key);
  }
  if (consultantName) {
    const key = String(consultantName).trim().toLowerCase();
    list = list.filter(b => String(b.consultantName || '').trim().toLowerCase() === key);
  }
  if (date) {
    list = list.filter(b => b.date === String(date));
  }

  res.json({ list });
});

/**
 * POST /api/bookings
 * Приймає:
 *  - consultantName, consultantEmail, fullName, email, date, time, notes, paid
 *  - file (multipart) — необов'язково
 * Повертає: { ok:true, item }
 */
app.post('/api/bookings', upload.single('file'), async (req, res) => {
  try {
    // Якщо прилетів JSON — беремо з body, якщо multipart — теж з body + file
    const {
      consultantName = '',
      consultantEmail = '',
      fullName = '',
      email = '',
      date = '',
      time = '',
      notes = '',
      paid = false,
    } = req.body || {};

    if (!consultantName || !consultantEmail || !fullName || !email || !date || !time) {
      return res.status(400).json({ ok: false, error: 'Missing required fields' });
    }

    let fileUrl = '';
    let fileName = '';
    if (req.file) {
      fileUrl = `/uploads/${req.file.filename}`;
      fileName = req.file.originalname || '';
    }

    const item = {
      id: crypto.randomUUID(),
      createdAt: nowISO(),
      consultantName,
      consultantEmail: String(consultantEmail).toLowerCase(),
      fullName,
      email,
      date,
      time,
      notes,
      paid: !!(paid === true || paid === 'true' || paid === 'on'),
      fileUrl,
      fileName
    };

    bookings.push(item);
    await saveDB();

    // Додаємо абсолютну URL до файлу у відповіді
    const itemOut = { ...item };
    if (itemOut.fileUrl) itemOut.fileUrl = absUrl(req, itemOut.fileUrl);

    res.status(201).json({ ok: true, item: itemOut });
  } catch (e) {
    console.error('POST /api/bookings error:', e);
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

/**
 * DELETE /api/bookings/:id
 */
app.delete('/api/bookings/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const idx = bookings.findIndex(b => b.id === id);
    if (idx === -1) return res.status(404).json({ ok: false, error: 'Not found' });

    const [removed] = bookings.splice(idx, 1);
    await saveDB();

    // Спробувати видалити файл
    if (removed && removed.fileUrl && removed.fileUrl.startsWith('/uploads/')) {
      const p = path.join(__dirname, removed.fileUrl);
      fs.remove(p).catch(() => {});
    }

    res.json({ ok: true });
  } catch (e) {
    console.error('DELETE /api/bookings/:id error:', e);
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// Fallback 404 для API
app.use('/api', (_req, res) => res.status(404).json({ ok: false, error: 'Not found' }));

// ----- Старт -----
app.listen(PORT, () => {
  console.log(`API is up on :${PORT}`);
  console.log(`CORS ALLOW_ORIGIN=${ALLOW_ORIGIN}`);
});
