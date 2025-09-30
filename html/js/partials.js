// html/js/partials.js
(function () {
  'use strict';

  const HEADER_PLACEHOLDER = '[data-include="partials/header.html"]';
  const FOOTER_PLACEHOLDER = '[data-include="partials/footer.html"]';

  function basePath() { return location.pathname.replace(/[^/]+$/, ''); }

  let guardReady = null;
  function loadGuardOnce() {
    if (window.guard) return Promise.resolve();
    if (guardReady) return guardReady;
    guardReady = new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = `${basePath()}js/guard.js`;
      s.async = true;
      s.onload = resolve;
      s.onerror = resolve;
      document.head.appendChild(s);
    });
    return guardReady;
  }

  async function inject(selector, url) {
    const host = document.querySelector(selector);
    if (!host) return null;
    try {
      const res = await fetch(url, { cache: 'no-store' });
      host.innerHTML = await res.text();
      return host;
    } catch { return null; }
  }

  function applyAuth() {
    if (window.guard?.applyAuthUI) {
      window.guard.applyAuthUI({ desktop: '#authBtn', mobile: '#authBtnMobile' });
      return;
    }
    try {
      const s = window.guard?.getSession?.();
      const loggedIn = !!(s && s.email);
      const btnD = document.querySelector('#authBtn');
      const btnM = document.querySelector('#authBtnMobile');
      const setCabinet = (a) => { if (!a) return; a.textContent = 'Кабінет'; a.classList.remove('green'); a.href = `${basePath()}admin.html`; };
      const setLogin   = (a) => { if (!a) return; a.textContent = 'Вхід'; a.classList.add('green');  a.href = `${basePath()}login.html`; };
      if (loggedIn) { setCabinet(btnD); setCabinet(btnM); } else { setLogin(btnD); setLogin(btnM); }
    } catch {}
  }

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
  }

  async function init() {
    await loadGuardOnce();
    const header = await inject(HEADER_PLACEHOLDER, `${basePath()}partials/header.html`);
    bindHeaderInteractions(header);
    await inject(FOOTER_PLACEHOLDER, `${basePath()}partials/footer.html`);
    applyAuth();
    applyClientsVisibility();

    window.addEventListener('pageshow', () => { applyAuth(); applyClientsVisibility(); });
    window.addEventListener('storage', (e) => {
      if (e.key === 'koma_session') { applyAuth(); applyClientsVisibility(); }
    });

    setTimeout(() => { applyAuth(); applyClientsVisibility(); }, 100);
    setTimeout(() => { applyAuth(); applyClientsVisibility(); }, 400);
  }

  window.refreshAuthUI = () => { applyAuth(); applyClientsVisibility(); };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
