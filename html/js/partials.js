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
  const isAdminPage = /(^|\/)admin\.html(\?|#|$)/i.test(location.pathname);

  // мобільне меню (бургер)
  const hamb = document.getElementById('hamb');
  const mobile = document.getElementById('mobile');
  hamb?.addEventListener('click', () => {
    const open = mobile?.classList.toggle('open');
    if (open != null) hamb.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  // рік у футері
  const y = document.getElementById('y');
  if (y) y.textContent = new Date().getFullYear();

  // ===== AUTH UI: «Вхід» ↔ «Кабінет» (працює на всіх сторінках)
  try {
    if (window.guard?.applyAuthUI) {
      // основне вмикання
      window.guard.applyAuthUI({ desktop: '#authBtn', mobile: '#authBtnMobile' });
    } else {
      // запасний варіант, якщо applyAuthUI відсутній
      const s = window.guard?.getSession?.();
      const loggedIn = !!(s && s.email);
      const btnD = document.querySelector('#authBtn');
      const btnM = document.querySelector('#authBtnMobile');
      const setCabinet = (aEl) => { if (!aEl) return;
        aEl.textContent = 'Кабінет';
        aEl.classList.remove('green');
        aEl.href = 'admin.html';
      };
      const setLogin = (aEl) => { if (!aEl) return;
        aEl.textContent = 'Вхід';
        aEl.classList.add('green');
        aEl.href = 'login.html';
      };
      if (loggedIn) { setCabinet(btnD); setCabinet(btnM); }
      else { setLogin(btnD); setLogin(btnM); }
    }
  } catch (e) { console.warn('Auth UI init failed:', e); }

  // ===== Показ/приховування «Клієнти» для консультанта
  let isConsultant = false;
  try {
    const s = window.guard?.getSession?.();
    isConsultant = !!(s && window.guard?.hasAccess?.(s.email));
  } catch {}

  // (а) Хедер: #clientsNav (desktop) і #clientsNavM (mobile)
  ['#clientsNav', '#clientsNavM'].forEach(sel => {
    const el = document.querySelector(sel);
    if (!el) return;
    el.style.display = isConsultant ? '' : 'none';
  });

  // (б) Футер: знайдемо всі лінки на clients.html і керуватимемо видимістю
  //   — приховати на admin.html завжди,
  //   — на інших сторінках показувати тільки консультанту
  const footerClientLinks = [
    ...document.querySelectorAll('footer a[href$="clients.html"], .footer a[href$="clients.html"]')
  ];
  footerClientLinks.forEach(a => {
    if (isAdminPage) {
      a.style.display = 'none';
    } else {
      a.style.display = isConsultant ? '' : 'none';
    }
  });

  // ===== Кнопка «ПРИЄДНАТИСЬ» — активна, якщо є майбутній запис у localStorage
  const joinBtn  = document.getElementById('joinBtn');
  const joinBtnM = document.getElementById('joinBtnM');

  const OPEN_AFTER_MIN = 60; // активна ще 60 хв після початку

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
    if (Number.isNaN(start)) return disable();
    if (Date.now() > start + OPEN_AFTER_MIN * 60 * 1000) return disable();

    const params = new URLSearchParams({
      consultant: b.consultant || '',
      fullName: b.fullName || '',
      email: b.email || '',
      date: b.date,
      time: b.time
    }).toString();

    enable(`zapis.html?${params}`);
  }

  updateJoin();
  window.addEventListener('storage', (e) => {
    if (e.key === 'koma_last_booking') updateJoin();
  });
}

includePartials();
