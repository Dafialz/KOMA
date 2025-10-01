// js/video-ui.js
(function (global) {
  'use strict';
  const app = global.videoApp;
  const { els, setBadge, UA_MOBILE } = app;

  // ── Helpers ───────────────────────────────────────────────────────────────
  function safe(el, fn){ if (el) try { fn(); } catch {} }

  // ── Старт з’єднання ───────────────────────────────────────────────────────
  safe(els.start, () => els.start.onclick = async () => {
    try {
      els.start.disabled = true;

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

      els.start.classList.add('active');
    } catch (err) {
      setBadge('Помилка: ' + (err.message || err.name), 'danger');
      els.start.disabled = false;
      els.start.classList.remove('active');
    }
  });

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

  // ── Шерінг екрану ─────────────────────────────────────────────────────────
  safe(els.screen, () => els.screen.onclick = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const screenTrack = stream.getVideoTracks()[0];
      await app.txVideo.sender.replaceTrack(screenTrack);
      els.screen.classList.add('active');

      screenTrack.onended = async () => {
        const cam = els.local && els.local.srcObject && els.local.srcObject.getVideoTracks()[0];
        await app.txVideo.sender.replaceTrack(cam || null);
        els.screen.classList.remove('active');
      };
    } catch {}
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

  // ── Автостарт (?autostart=1) ─────────────────────────────────────────────
  if (app.qs.get('autostart') === '1' && els.start) {
    app.wsReady.then(() => { if (!els.start.disabled) els.start.click(); }).catch(() => {});
  }
})(window);
