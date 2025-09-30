// html/js/guard.js
(function (global) {
  'use strict';

  const SESSION_KEY = 'koma_session';
  const GUEST_KEY   = 'koma_guest';   // локальна “гість-сесія” для підтримки

  // Дозволені e-mail (синхронно з users.json)
  const allowlist = [
    'oksanakokoten@gmail.com',
    'sergiyoyovych@gmail.com',
    'tetianamakovska@gmail.com',
    'oleksandrtkachuk@gmail.com',
    'anastasiyoyovych@gmail.com',
    'kristinakokoten@gmail.com',
    'dafialz@gmail.com'
  ].map(e => e.toLowerCase());

  // Email → імʼя для відображення
  const names = {
    'oksanakokoten@gmail.com'    : 'Оксана Кокотень',
    'sergiyoyovych@gmail.com'    : 'Сергій Йовович',
    'tetianamakovska@gmail.com'  : 'Тетяна Маковська',
    'oleksandrtkachuk@gmail.com' : 'Олександр Ткачук',
    'anastasiyoyovych@gmail.com' : 'Анастасія Йовович',
    'kristinakokoten@gmail.com'  : 'Крістіна Кокотень',
    'dafialz@gmail.com'          : 'DAFIALZ (Адмін)'
  };

  // ---------- helpers ----------
  function basePath() {
    // /html/page.html -> /html/
    return location.pathname.replace(/[^/]+$/, '');
  }

  // ===== консультантська сесія =====
  function getSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || !s.email || !s.exp) return null;
      if (Date.now() > s.exp) { localStorage.removeItem(SESSION_KEY); return null; }
      return { email: String(s.email), exp: Number(s.exp) };
    } catch {
      return null;
    }
  }

  function isLoggedIn() { return !!getSession(); }

  function hasAccess(email) {
    if (!email) return false;
    return allowlist.includes(String(email).toLowerCase());
  }

  function isAdmin() {
    const s = getSession();
    return !!(s && hasAccess(s.email));
  }

  function protect() {
    const s = getSession();
    if (!s || !hasAccess(s.email)) {
      location.replace(`${basePath()}login.html`);
    }
  }

  function logout() {
    localStorage.removeItem(SESSION_KEY);
    location.replace(`${basePath()}index.html`);
  }

  function emailToName(email) {
    if (!email) return '';
    return names[String(email).toLowerCase()] || '';
  }

  /**
   * Перемикає кнопки авторизації у шапці.
   * options = { desktop: '#authBtn', mobile: '#authBtnMobile' }
   */
  function applyAuthUI(options = {}) {
    const desktopSel = options.desktop || '#authBtn';
    const mobileSel  = options.mobile  || '#authBtnMobile';

    const desk = document.querySelector(desktopSel);
    const mob  = document.querySelector(mobileSel);

    const s = getSession();
    if (s && hasAccess(s.email)) {
      // залогінений консультант → “Кабінет”
      if (desk) { desk.textContent = 'Кабінет'; desk.href = `${basePath()}admin.html`; desk.classList.remove('green'); desk.classList.add('outline'); }
      if (mob)  { mob.textContent  = 'Кабінет'; mob.href  = `${basePath()}admin.html`;  mob.classList.remove('green');  mob.classList.add('outline');  }
    } else {
      // гість → “Вхід”
      if (desk) { desk.textContent = 'Вхід'; desk.href = `${basePath()}login.html`; desk.classList.add('green'); desk.classList.remove('outline'); }
      if (mob)  { mob.textContent  = 'Вхід'; mob.href  = `${basePath()}login.html`;  mob.classList.add('green');  mob.classList.remove('outline');  }
    }
  }

  // ===== гість-сесія для підтримки (видима всім) =====
  function randomId() {
    return Math.random().toString(36).slice(2, 7) + Math.random().toString(36).slice(2, 7);
  }

  function getGuest() {
    try {
      let g = JSON.parse(localStorage.getItem(GUEST_KEY) || 'null');
      if (!g || !g.id) {
        g = { id: 'guest-' + randomId(), name: '', createdAt: Date.now() };
        localStorage.setItem(GUEST_KEY, JSON.stringify(g));
      }
      return g;
    } catch {
      const g = { id: 'guest-' + randomId(), name: '', createdAt: Date.now() };
      try { localStorage.setItem(GUEST_KEY, JSON.stringify(g)); } catch {}
      return g;
    }
  }

  function setGuestName(name) {
    const g = getGuest();
    g.name = String(name || '').trim().slice(0, 60);
    try { localStorage.setItem(GUEST_KEY, JSON.stringify(g)); } catch {}
    return g;
  }

  /** Єдина ідентичність для чату/підтримки */
  function getIdentity() {
    const s = getSession();
    if (s && hasAccess(s.email)) {
      return { type: 'staff', email: s.email, name: emailToName(s.email) || s.email };
    }
    const g = getGuest();
    return { type: 'guest', guestId: g.id, name: g.name || 'Гість' };
  }

  // Експортуємо
  global.guard = {
    protect,
    logout,
    getSession,
    isLoggedIn,
    hasAccess,
    isAdmin,
    emailToName,
    applyAuthUI,
    getGuest,
    setGuestName,
    getIdentity
  };
})(window);
