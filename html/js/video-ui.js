// js/video-ui.js
(function (global) {
  'use strict';
  const app = global.videoApp;
  const { els, setBadge, UA_MOBILE } = app;

  // Кнопка старту
  els.start.onclick = async () => {
    try {
      await app.wsReady;
      await app.startLocal();
      if (!app.dc) { app.dc = app.pc.createDataChannel('chat'); app.bindDataChannel(); }
      await app.createAndSendOffer();
      els.start.disabled = true;
      els.start.classList.add('active');
      setBadge('Очікуємо відповідь…', 'muted');
    } catch (err) {
      setBadge('Помилка: ' + (err.message || err.name), 'danger');
    }
  };

  // Мікрофон
  els.mic.onclick = () => {
    const ls = els.local.srcObject;
    const track = ls && ls.getAudioTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      els.mic.textContent = track.enabled ? '🎙️ Мікрофон' : '🔇 Мікрофон';
      els.mic.classList.toggle('active', !track.enabled);
    }
  };

  // Камера
  els.cam.onclick = () => {
    const ls = els.local.srcObject;
    const track = ls && ls.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    els.cam.textContent = track.enabled ? '📷 Камера' : '🚫 Камера';
    els.cam.classList.toggle('active', !track.enabled);
  };

  // Шерінг екрану
  els.screen.onclick = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const screenTrack = stream.getVideoTracks()[0];
      await app.txVideo.sender.replaceTrack(screenTrack);
      els.screen.classList.add('active');
      screenTrack.onended = async () => {
        const cam = els.local.srcObject && els.local.srcObject.getVideoTracks()[0];
        await app.txVideo.sender.replaceTrack(cam || null);
        els.screen.classList.remove('active');
      };
    } catch { }
  };

  // Повноекранний режим
  function enterFullscreen(el) {
    if (!el) return;
    try {
      if (el.requestFullscreen) return el.requestFullscreen();
      if (el.webkitEnterFullscreen) return el.webkitEnterFullscreen(); // iPhone Safari
      if (el.webkitRequestFullscreen) return el.webkitRequestFullscreen(); // iPad
      if (el.msRequestFullscreen) return el.msRequestFullscreen();
    } catch { }
  }
  function exitFullscreen() {
    try {
      if (document.exitFullscreen) return document.exitFullscreen();
      if (document.webkitExitFullscreen) return document.webkitExitFullscreen();
    } catch { }
  }
  function toggleFS(el) {
    if (!document.fullscreenElement && !(document.webkitFullscreenElement)) enterFullscreen(el);
    else exitFullscreen();
  }
  els.fullRemote.addEventListener('click', () => toggleFS(els.remote));
  els.fullLocal.addEventListener('click', () => toggleFS(els.local));
  [els.remote, els.local].forEach(v => v.addEventListener('dblclick', () => toggleFS(v)));

  // На мобільних — тап по відео також відкриває fullscreen
  if (UA_MOBILE) {
    els.remote.addEventListener('click', () => enterFullscreen(els.remote), { passive: true });
    els.local.addEventListener('click', () => enterFullscreen(els.local), { passive: true });
  }

  // Аудіо-анлок на мобільних
  function maybeShowUnmute() {
    if (!UA_MOBILE) return;
    els.vwrap.classList.add('has-unmute');
  }
  els.unmute.addEventListener('click', () => {
    try { els.remote.muted = false; els.remote.play(); } catch { }
    els.vwrap.classList.remove('has-unmute');
  });

  // Автостарт (?autostart=1)
  if (app.qs.get('autostart') === '1') {
    app.wsReady.then(() => els.start.click()).catch(() => { });
  }

})(window);
