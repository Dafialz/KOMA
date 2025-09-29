// html/js/guard.js
(function (global) {
  const SESSION_KEY = 'koma_session';

  // Дозволені користувачі (email у нижньому регістрі) — синхронізовано з users.json
  const allowlist = [
    'oksanakokoten@gmail.com',
    'andriyoyovych@gmail.com',
    'anastasiyaoyovych@gmail.com',
    'oleksandrtkachuk@gmail.com',
    'tetianamakovska@gmail.com',
    'kristinakokoten@gmail.com'
  ].map(e => e.toLowerCase());

  // Email → ім'я для зручного відображення/генерації лінків
  const names = {
    'oksanakokoten@gmail.com'     : 'Оксана Кокотень',
    'andriyoyovych@gmail.com'     : 'Андрій Йовович',
    'anastasiyaoyovych@gmail.com' : 'Анастасія Йовович',
    'oleksandrtkachuk@gmail.com'  : 'Олександр Ткачук',
    'tetianamakovska@gmail.com'   : 'Тетяна Маковська',
    'kristinakokoten@gmail.com'   : 'Крістіна Кокотень'
  };

  // -------- helpers --------
  function basePath() {
    // /html/page.html -> /html/
    return location.pathname.replace(/[^/]+$/, '');
  }

  function getSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s?.email || !s?.exp) return null;
      if (Date.now() > s.exp) { localStorage.removeItem(SESSION_KEY); return null; }
      return { email: String(s.email), exp: Number(s.exp) };
    } catch { return null; }
  }

  function isLoggedIn() {
    return !!getSession();
  }

  function hasAccess(email) {
    if (!email) return false;
    return allowlist.includes(String(email).toLowerCase());
  }

  function protect() {
    const s = getSession();
    if (!s || !hasAccess(s.email)) {
      location.replace(`${basePath()}login.html`);
    }
  }

  function logout() {
    localStorage.removeItem(SESSION_KEY);
    // Переходимо на головну, щоб одразу оновилась шапка
    location.replace(`${basePath()}index.html`);
  }

  function emailToName(email) {
    if (!email) return '';
    return names[String(email).toLowerCase()] || '';
  }

  /**
   * Автоматично перемикає кнопки авторизації у шапці.
   * Викликається на будь-якій публічній сторінці.
   * options = { desktop: '#authBtn', mobile: '#authBtnMobile' }
   */
  function applyAuthUI(options = {}) {
    const desktopSel = options.desktop || '#authBtn';
    const mobileSel = options.mobile || '#authBtnMobile';

    const desk = document.querySelector(desktopSel);
    const mob  = document.querySelector(mobileSel);

    const s = getSession();
    if (s && hasAccess(s.email)) {
      // Залогінений консультант → показуємо «Кабінет»
      if (desk) { desk.textContent = 'Кабінет'; desk.setAttribute('href', `${basePath()}admin.html`); desk.classList.remove('green'); desk.classList.add('outline'); }
      if (mob)  { mob.textContent  = 'Кабінет'; mob.setAttribute('href',  `${basePath()}admin.html`);  mob.classList.remove('green');  mob.classList.add('outline');  }
    } else {
      // Гість → показуємо «Вхід»
      if (desk) { desk.textContent = 'Вхід'; desk.setAttribute('href', `${basePath()}login.html`); desk.classList.add('green'); desk.classList.remove('outline'); }
      if (mob)  { mob.textContent  = 'Вхід'; mob.setAttribute('href',  `${basePath()}login.html`);  mob.classList.add('green');  mob.classList.remove('outline');  }
    }
  }

  // Експорт у глобал
  global.guard = {
    protect,
    logout,
    getSession,
    isLoggedIn,
    hasAccess,
    emailToName,
    applyAuthUI
  };
})(window);
