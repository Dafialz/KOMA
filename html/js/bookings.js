// html/js/bookings.js
// Єдиний клієнт для API бронювань.
// !!! Обов'язково заміни API_BASE на свій Render-домен з цим сервером.
const API_BASE = "https://koma-uaue.onrender.com"; // <-- ТУТ

export async function createBooking(payload) {
  let res;
  if (payload.file) {
    // Використовуємо FormData, якщо є файл
    const fd = new FormData();
    for (const [k, v] of Object.entries(payload)) {
      if (v !== undefined && v !== null) {
        fd.append(k, v);
      }
    }
    res = await fetch(`${API_BASE}/api/bookings`, {
      method: "POST",
      body: fd,
    });
  } else {
    // Старий режим — JSON
    res = await fetch(`${API_BASE}/api/bookings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }
  if (!res.ok) throw new Error("Failed to create booking");
  return res.json();
}

export async function fetchBookings(consultantEmail) {
  const url = new URL(`${API_BASE}/api/bookings`);
  url.searchParams.set("consultantEmail", consultantEmail);
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch bookings");
  return res.json();
}

export async function deleteBooking(id) {
  const res = await fetch(`${API_BASE}/api/bookings/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete booking");
  return res.json();
}
