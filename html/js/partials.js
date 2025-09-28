// js/partials.js
// універсальний loader для елементів з data-include="url"
async function includePartials() {
  const nodes = document.querySelectorAll('[data-include]');
  await Promise.all([...nodes].map(async (n) => {
    try {
      const url = n.getAttribute('data-include');
      const res = await fetch(url, { cache: 'no-store' });
      n.innerHTML = await res.text();
    } catch (e) {
      console.warn('Partial load failed:', e);
    }
  }));

  initHeaderFooterLogic();
}

function initHeaderFooterLogic() {
  // мобільне меню
  const hamb = document.getElementById('hamb');
  const mobile = document.getElementById('mobile');
  hamb?.addEventListener('click', () => {
    const open = mobile.classList.toggle('open');
    hamb.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  // рік у футері
  const y = document.getElementById('y');
  if (y) y.textContent = new Date().getFullYear();

  // auth UI (Вхід ↔ Кабінет) — працює на всіх сторінках, бо запускається після підвантаження partials
  try {
    if (window.guard?.applyAuthUI) {
      window.guard.applyAuthUI({ desktop: '#authBtn', mobile: '#authBtnMobile' });
    }
  } catch {}

  // Показ/приховування пункту «Клієнти» тільки для консультанта
  try {
    const showClients = (() => {
      if (!window.guard?.getSession || !window.guard?.hasAccess) return false;
      const s = window.guard.getSession();
      return !!(s && window.guard.hasAccess(s.email));
    })();

    ['#clientsNav', '#clientsNavM'].forEach(sel => {
      const el = document.querySelector(sel);
      if (el) el.style.display = showClients ? '' : 'none';
    });
  } catch {}

  // КНОПКА «ПРИЄДНАТИСЬ» — активна, якщо є майбутній запис у localStorage
  const joinBtn  = document.getElementById('joinBtn');
  const joinBtnM = document.getElementById('joinBtnM');

  const OPEN_AFTER_MIN = 60; // ще 60 хв після початку

  const enable = (url) => {
    [joinBtn, joinBtnM].forEach(b => {
      if (!b) return;
      b.href = url;
      b.removeAttribute('aria-disabled');
    });
  };
  const disable = () => {
    [joinBtn, joinBtnM].forEach(b => {
      if (!b) return;
      b.href = '#';
      b.setAttribute('aria-disabled', 'true');
    });
  };

  function startTSKyiv(d, t) { return Date.parse(`${d}T${t}:00+03:00`); }

  function updateJoin() {
    const raw = localStorage.getItem('koma_last_booking');
    if (!raw) return disable();
    let b;
    try { b = JSON.parse(raw); } catch { return disable(); }
    if (!b || !b.date || !b.time) return disable();
    const start = Number(b.startTS ?? startTSKyiv(b.date, b.time));
    if (Date.now() > start + OPEN_AFTER_MIN * 60 * 1000) return disable();

    const params = new URLSearchParams({
      consultant: b.consultant,
      fullName: b.fullName,
      email: b.email,
      date: b.date,
      time: b.time
    }).toString();

    // без початкового /, бо всі сторінки лежать у /html/
    enable(`zapis.html?${params}`);
  }

  updateJoin();
  window.addEventListener('storage', (e) => {
    if (e.key === 'koma_last_booking') updateJoin();
  });
}

includePartials();
