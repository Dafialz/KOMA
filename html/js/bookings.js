import { API_BASE } from './config.js';

// html/js/bookings.js
// Єдиний клієнт для API бронювань.
// !!! Обов'язково заміни API_BASE на свій Render-домен з цим сервером.

/** Внутрішній запит з охайною обробкою помилок та без кешу */
async function request(input, init = {}) {
  const res = await fetch(input, {
    cache: "no-store",
    headers: { Accept: "application/json", ...(init.headers || {}) },
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

/** Приводимо відповідь сервера до єдиного формату { list: [] } */
function normalizeList(json) {
  if (Array.isArray(json)) return { list: json };
  const list =
    (json && (json.list || json.items || json.bookings || json.data)) || [];
  return { list: Array.isArray(list) ? list : [] };
}

/**
 * Створити бронювання.
 * Якщо payload.file задано (File/Blob) — використовуємо FormData,
 * інакше — JSON. Повертаємо об’єкт створеного запису.
 */
export async function createBooking(payload) {
  if (payload && payload.file) {
    const fd = new FormData();
    Object.entries(payload).forEach(([k, v]) => {
      if (v !== undefined && v !== null) fd.append(k, v);
    });
    return request(`${API_BASE}/api/bookings`, { method: "POST", body: fd });
  }

  return request(`${API_BASE}/api/bookings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {}),
  });
}

/**
 * Отримати список бронювань консультанта.
 * Завжди повертає { list: Booking[] }.
 * Можна передати { date: 'YYYY-MM-DD' } для фільтрації (якщо сервер підтримує).
 */
export async function fetchBookings(consultantEmail, opts = {}) {
  const url = new URL(`${API_BASE}/api/bookings`);
  if (consultantEmail) url.searchParams.set("consultantEmail", consultantEmail);
  if (opts.date) url.searchParams.set("date", opts.date);

  const json = await request(url.toString());
  return normalizeList(json);
}

/** Видалити бронювання за id. Повертає відповідь сервера як є. */
export async function deleteBooking(id) {
  return request(`${API_BASE}/api/bookings/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}
