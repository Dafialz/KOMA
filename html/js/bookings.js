// html/js/bookings.js
// Клієнт для API бронювань з безпечним визначенням API_BASE.

// ---- визначаємо API_BASE (config.js -> window.API_BASE -> location.origin)
let API_BASE_DETECTED = '';
try {
  const cfg = await import('./config.js').catch(() => ({}));
  API_BASE_DETECTED =
    (cfg && (cfg.API_BASE || (cfg.default && cfg.default.API_BASE))) || '';
} catch {}
if (!API_BASE_DETECTED && typeof window !== 'undefined' && window.API_BASE) {
  API_BASE_DETECTED = window.API_BASE;
}
if (!API_BASE_DETECTED && typeof location !== 'undefined') {
  API_BASE_DETECTED = location.origin;
}
const API_BASE = String(API_BASE_DETECTED || '').replace(/\/+$/, '');

// Трохи підказок у консоль
try {
  if (!API_BASE || API_BASE === location.origin) {
    console.warn('[bookings] API_BASE не задано у config.js — використовую поточний origin:', API_BASE);
  } else {
    console.info('[bookings] API_BASE =', API_BASE);
  }
} catch {}

/** Внутрішній запит з охайною обробкою помилок та без кешу */
async function request(input, init = {}) {
  const res = await fetch(input, {
    cache: 'no-store',
    headers: { Accept: 'application/json', ...(init.headers || {}) },
    ...init,
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg += `: ${await res.text()}`; } catch {}
    throw new Error(msg);
  }
  if (res.status === 204) return null; // без тіла
  return res.json();
}

/** Приводимо відповідь сервера до формату { list: [] } */
function normalizeList(json) {
  if (Array.isArray(json)) return { list: json };
  const list = (json && (json.list || json.items || json.bookings || json.data)) || [];
  return { list: Array.isArray(list) ? list : [] };
}

/** Створити бронювання (FormData якщо є file, інакше JSON) */
export async function createBooking(payload) {
  if (payload && payload.file) {
    const fd = new FormData();
    Object.entries(payload).forEach(([k, v]) => {
      if (v !== undefined && v !== null) fd.append(k, v);
    });
    return request(`${API_BASE}/api/bookings`, { method: 'POST', body: fd });
  }
  return request(`${API_BASE}/api/bookings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
}

/** Отримати список бронювань по email (опц. date=YYYY-MM-DD) */
export async function fetchBookings(consultantEmail, opts = {}) {
  const url = new URL(`${API_BASE}/api/bookings`);
  if (consultantEmail) url.searchParams.set('consultantEmail', consultantEmail);
  if (opts.date) url.searchParams.set('date', opts.date);
  const json = await request(url.toString());
  return normalizeList(json);
}

/** Видалити бронювання */
export async function deleteBooking(id) {
  return request(`${API_BASE}/api/bookings/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}
