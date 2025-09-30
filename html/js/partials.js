// html/js/partials.js
(function () {
  'use strict';

  const HEADER_PLACEHOLDER = '[data-include="partials/header.html"]';
  const FOOTER_PLACEHOLDER = '[data-include="partials/footer.html"]';
  const SUPPORT_ANCHOR_ID  = 'komaSupportAnchor'; // внутрішній якір для віджета

  function basePath() {
    // /html/page.html -> /html/
    return location.pathname.replace(/[^/]+$/, '');
  }

  // ---------- guard.js підвантаження один раз ----------
  let guardReady = null;
  function loadGuardOnce() {
    if (window.guard) return Promise.resolve();
    if (guardReady) return guardReady;

    guardReady = new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = `${basePath()}js/guard.js`;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => resolve(); // не блокуємо сторінку
      document.head.appendChild(s);
    });
    return guardReady;
  }

  // ---------- утиліта завантаження скрипта один раз ----------
  const loadedScripts = new Set();
  function loadScriptOnce(src) {
    return new Promise((resolve) => {
      if (loadedScripts.has(src)) return resolve();
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = () => { loadedScripts.add(src); resolve(); };
      s.onerror = () => resolve();
      document.head.appendChild(s);
    });
  }

  // ---------- вставка partial ----------
  async function inject(selector, url) {
    const host = document.querySelector(selector);
    if (!host) return null;
    try {
      const res = await fetch(url, { cache: 'no-store' });
      const html = await res.text();
      host.innerHTML = html;
      return host;
    } catch (e) {
      console.warn('[partials] fail load', url, e);
      return null;
    }
  }

  // ---------- AUTH UI ----------
  function applyAuth() {
    if (window.guard && typeof window.guard.applyAuthUI === 'function') {
      window.guard.applyAuthUI({ desktop: '#authBtn', mobile: '#authBtnMobile' });
      return;
    }
    try {
      const s = window.guard?.getSession?.();
      const loggedIn = !!(s && s.email);
      const btnD = document.querySelector('#authBtn');
      const btnM = document.querySelector('#authBtnMobile');
      const setCab = (a) => { if (!a) return; a.textContent = 'Кабінет'; a.classList.remove('green'); a.href = `${basePath()}admin.html`; };
      const setLog = (a) => { if (!a) return; a.textContent = 'Вхід';    a.classList.add('green');  a.href = `${basePath()}login.html`; };
      if (loggedIn) { setCab(btnD); setCab(btnM); } else { setLog(btnD); setLog(btnM); }
    } catch {}
  }

  // ---------- показ/приховування пункту «Клієнти» ----------
  function applyClientsVisibility() {
    let isConsultant = false;
    try {
      const s = window.guard?.getSession?.();
      isConsultant = !!(s && window.guard?.hasAccess?.(s.email));
    } catch {}

    ['#clientsNav', '#clientsNavM'].forEach(sel => {
      const el = document.querySelector(sel);
      if (el) el.style.display = isConsultant ? '' : 'none';
    });

    const isAdminPage = /(^|\/)admin\.html(\?|#|$)/i.test(location.pathname);
    const footerClientLinks = [
      ...document.querySelectorAll('footer a[href$="clients.html"], .footer a[href$="clients.html"]')
    ];
    footerClientLinks.forEach(a => {
      if (isAdminPage) a.style.display = 'none';
      else a.style.display = isConsultant ? '' : 'none';
    });
  }

  // ---------- JOIN-кнопки у шапці ----------
  function initJoinButtons() {
    const joinBtn  = document.getElementById('joinBtn');
    const joinBtnM = document.getElementById('joinBtnM');
    const OPEN_AFTER_MIN = 60;

    const enable = (url) => {
      [joinBtn, joinBtnM].forEach(b => { if (b) { b.href = url; b.removeAttribute('aria-disabled'); } });
    };
    const disable = () => {
      [joinBtn, joinBtnM].forEach(b => { if (b) { b.href = '#'; b.setAttribute('aria-disabled', 'true'); } });
    };

    function startTSKyiv(d, t) { return Date.parse(`${d}T${t}:00+03:00`); }

    function updateJoin() {
      const raw = localStorage.getItem('koma_last_booking');
      if (!raw) return disable();
      let b;
      try { b = JSON.parse(raw); } catch { return disable(); }
      if (!b || !b.date || !b.time) return disable();

      const start = Number(b.startTS ?? startTSKyiv(b.date, b.time));
      if (!Number.isFinite(start)) return disable();
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

  // ---------- підключення віджета підтримки (сленгові «слогани») ----------
  async function ensureSupportWidget() {
    // вже є — нічого не робимо
    if (document.getElementById('komaWidget')) return;

    // вставляємо як останню ноду у body (якір для простішого пошуку)
    let anchor = document.getElementById(SUPPORT_ANCHOR_ID);
    if (!anchor) {
      anchor = document.createElement('div');
      anchor.id = SUPPORT_ANCHOR_ID;
      document.body.appendChild(anchor);
    }
    try {
      const res = await fetch(`${basePath()}partials/support.html`, { cache: 'no-store' });
      const html = await res.text();
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      // переносимо вміст (widget + modal)
      while (tmp.firstChild) anchor.appendChild(tmp.firstChild);

      // після вставки підвантажуємо скрипт віджета один раз
      await loadScriptOnce(`${basePath()}js/support.js`);
    } catch (e) {
      console.warn('[partials] support widget load fail', e);
    }
  }

  function bindHeaderInteractions(root) {
    if (!root) return;
    const burger = root.querySelector('#hamb');
    const menu   = root.querySelector('#mobile');
    if (burger && menu) {
      burger.addEventListener('click', () => {
        const open = menu.classList.toggle('open');
        burger.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    }

    // Кнопка «Служба підтримки» в кабінеті → на сторінку support.html
    const supportBtn = root.querySelector('#adminSupportBtn, a[href="#support"]');
    if (supportBtn) supportBtn.setAttribute('href', `${basePath()}support.html`);
  }

  async function init() {
    await loadGuardOnce();

    // Вставляємо header/footer
    const header = await inject(HEADER_PLACEHOLDER, `${basePath()}partials/header.html`);
    bindHeaderInteractions(header);
    await inject(FOOTER_PLACEHOLDER, `${basePath()}partials/footer.html`);

    // Після вставки синхронізуємо UI
    applyAuth();
    applyClientsVisibility();
    initJoinButtons();

    // Віджет підтримки з ротацією слоганів
    await ensureSupportWidget();

    // Оновлення при поверненні та зміні storage
    window.addEventListener('pageshow', () => { applyAuth(); applyClientsVisibility(); });
    window.addEventListener('storage', (e) => {
      if (e.key === 'koma_session' || e.key === 'koma_last_booking') {
        applyAuth(); applyClientsVisibility();
      }
    });

    // Дублери на повільних мережах
    setTimeout(() => { applyAuth(); applyClientsVisibility(); }, 100);
    setTimeout(() => { applyAuth(); applyClientsVisibility(); }, 400);
  }

  // Експорт ручного оновлення (про всяк)
  window.refreshAuthUI = () => { applyAuth(); applyClientsVisibility(); };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
