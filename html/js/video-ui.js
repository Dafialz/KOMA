// js/video-ui.js
(function (global) {
  'use strict';
  const app = global.videoApp;
  const { els, setBadge, UA_MOBILE } = app;
  const role = app.role;           // 'consultant' | 'client'
  const room = app.room;

  // ── Helpers ───────────────────────────────────────────────────────────────
  function safe(el, fn){ if (el) try { fn(); } catch {} }
  function oppositeRole(r){ return r === 'consultant' ? 'client' : 'consultant'; }
  function makeLink(r){
    const u = new URL(location.href);
    u.searchParams.set('room', room);
    u.searchParams.set('role', r);
    u.searchParams.set('autostart','1');
    return u.toString();
  }
  function toast(msg, cls='muted'){ app.logChat(msg, 'sys'); setBadge(msg, cls); }

  // ── Старт з’єднання (рефактор у функцію) ─────────────────────────────────
  let starting = false;
  let waitTipTimer = null;

  async function startOnce(){
    if (starting) return;
    starting = true;
    safe(els.start, () => { els.start.disabled = true; els.start.classList.add('active'); });

    try {
      // чекаємо сигналінг і локальні пристрої
      await app.wsReady;
      await app.startLocal();

      // якщо DC ще нема — створимо і прив’яжемо
      if (!app.dc || app.dc.readyState === 'closed') {
        app.dc = app.pc.createDataChannel('chat');
        app.bindDataChannel();
      }

      // ініціатор (не polite) шле перший offer
      if (!app.polite) {
        await app.createAndSendOffer();
        setBadge('Очікуємо відповідь…', 'muted');
      } else {
        setBadge('Очікуємо пропозицію від співрозмовника…', 'muted');
      }

      // «вартовий очікування»: якщо друга сторона не приєдналась
      clearTimeout(waitTipTimer);
      waitTipTimer = setTimeout(()=>{
        if (!els || !els.hint) return;
        if (app.pc && app.pc.connectionState !== 'connected') {
          const otherURL = makeLink(oppositeRole(role));
          els.hint.innerHTML =
            `Немає другої сторони. Відкрийте це посилання для ${
              oppositeRole(role)==='consultant'?'консультанта':'клієнта'
            }: <a href="${otherURL}" target="_blank" rel="noopener">${otherURL}</a>`;
        }
      }, 9000);

    } catch (err) {
      setBadge('Помилка: ' + (err.message || err.name), 'danger');
      starting = false;
      safe(els.start, () => { els.start.disabled = false; els.start.classList.remove('active'); });
    }
  }

  // Кнопка «Під’єднатися»
  safe(els.start, () => els.start.onclick = startOnce);

  // ── Мікрофон ──────────────────────────────────────────────────────────────
  safe(els.mic, () => els.mic.onclick = () => {
    const ls = els.local && els.local.srcObject;
    const track = ls && ls.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    els.mic.textContent = track.enabled ? '🎙️ Мікрофон' : '🔇 Мікрофон';
    els.mic.classList.toggle('active', !track.enabled);
  });

  // ── Камера ────────────────────────────────────────────────────────────────
  safe(els.cam, () => els.cam.onclick = () => {
    const ls = els.local && els.local.srcObject;
    const track = ls && ls.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    els.cam.textContent = track.enabled ? '📷 Камера' : '🚫 Камера';
    els.cam.classList.toggle('active', !track.enabled);
  });

  // ── Шерінг екрану (з розгорнутим хендлінгом) ──────────────────────────────
  safe(els.screen, () => els.screen.onclick = async () => {
    // перевірка підтримки
    const gdm = navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia;
    if (!gdm) {
      toast('Ваш браузер не підтримує захоплення екрана. На Android використайте Chrome; на iPhone — Safari iOS 16.4+.', 'danger');
      return;
    }

    try {
      toast('Запит на захоплення екрана…');
      const stream = await gdm.call(navigator.mediaDevices, { video: true });
      const screenTrack = stream && stream.getVideoTracks && stream.getVideoTracks()[0];
      if (!screenTrack) { toast('Не вдалося отримати трек екрана.', 'danger'); return; }

      // якщо ще не стартували локальні, підстрахуємось
      if (!app.txVideo || !app.txVideo.sender) {
        await app.startLocal().catch(()=>{});
      }
      if (!app.txVideo || !app.txVideo.sender) {
        toast('Відеосендер недоступний (txVideo.sender). Спробуйте натиснути «Під’єднатися» ще раз.', 'danger');
        try { screenTrack.stop(); } catch {}
        return;
      }

      await app.txVideo.sender.replaceTrack(screenTrack);
      els.screen.classList.add('active');
      toast('Екран транслюється. Щоб зупинити — завершіть трансляцію у вікні браузера.', 'ok');

      screenTrack.onended = async () => {
        const cam = els.local && els.local.srcObject && els.local.srcObject.getVideoTracks()[0];
        try { await app.txVideo.sender.replaceTrack(cam || null); } catch {}
        els.screen.classList.remove('active');
        toast('Трансляцію екрана завершено.');
      };
    } catch (err) {
      const msg = (err && (err.message || err.name)) || 'Unknown';
      if (/NotAllowedError|SecurityError/i.test(msg)) {
        toast('Доступ заблоковано (скасовано користувачем або блокувальником). На Android — спробуйте Chrome / вимкніть Shields.', 'danger');
      } else if (/AbortError/i.test(msg)) {
        toast('Трансляцію перервано (AbortError). Спробуйте ще раз.', 'danger');
      } else {
        toast('Помилка захоплення екрана: ' + msg, 'danger');
      }
    }
  });

  // ── Повноекранний режим ───────────────────────────────────────────────────
  function enterFS(el){
    if (!el) return;
    try {
      if (el.requestFullscreen) return el.requestFullscreen();
      if (el.webkitEnterFullscreen) return el.webkitEnterFullscreen(); // iPhone video
      if (el.webkitRequestFullscreen) return el.webkitRequestFullscreen();
      if (el.msRequestFullscreen) return el.msRequestFullscreen();
    } catch {}
  }
  function exitFS(){
    try {
      if (document.exitFullscreen) return document.exitFullscreen();
      if (document.webkitExitFullscreen) return document.webkitExitFullscreen();
    } catch {}
  }
  function toggleFS(el){
    if (!document.fullscreenElement && !document.webkitFullscreenElement) enterFS(el);
    else exitFS();
  }
  safe(els.fullRemote, () => els.fullRemote.addEventListener('click', () => toggleFS(els.remote)));
  safe(els.fullLocal,  () => els.fullLocal .addEventListener('click', () => toggleFS(els.local)));
  [els.remote, els.local].forEach(v => v && v.addEventListener('dblclick', () => toggleFS(v)));

  // На мобільних — тап по відео також відкриває fullscreen
  if (UA_MOBILE) {
    safe(els.remote, () => els.remote.addEventListener('click', () => enterFS(els.remote), { passive:true }));
    safe(els.local,  () => els.local .addEventListener('click', () => enterFS(els.local ), { passive:true }));
  }

  // ── Аудіо-анлок на мобільних ──────────────────────────────────────────────
  safe(els.unmute, () => els.unmute.addEventListener('click', () => {
    try { if (els.remote) { els.remote.muted = false; els.remote.play(); } } catch {}
    if (els.vwrap) els.vwrap.classList.remove('has-unmute');
  }));

  // ── Чат: надсилання повідомлення ─────────────────────────────────────────
  safe(els.send, () => els.send.onclick = () => {
    const txt = (els.msg && els.msg.value || '').trim();
    if (!txt) return;
    try {
      if (app.dc && app.dc.readyState === 'open') {
        app.dc.send(txt);
        app.logChat(txt, 'me');
        els.msg.value = '';
      }
    } catch {}
  });
  safe(els.msg, () => els.msg.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      els.send && els.send.click();
    }
  }));

  // ── Автостарт ─────────────────────────────────────────────────────────────
  // 1) Якщо ?autostart=1 — як і було.
  // 2) Додатково: для ролі client автозапуск завжди (щоб клієнт не забув натиснути).
  if (els.start) {
    const mustAuto = app.qs.get('autostart') === '1' || role === 'client';
    app.wsReady.then(() => {
      if (mustAuto && !els.start.disabled) startOnce();
    }).catch(()=>{});
  }

  // Підказка у статусі, куди кликнути другій стороні (видно одразу)
  if (els.hint) {
    const otherURL = makeLink(oppositeRole(role));
    els.hint.innerHTML =
      `Якщо друга сторона ще не в мережі — відкрийте для неї посилання: `
      + `<a href="${otherURL}" target="_blank" rel="noopener">${otherURL}</a>`;
  }
})(window);
