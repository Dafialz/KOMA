// js/video-webrtc.js
(function (global) {
  'use strict';
  const app = global.videoApp;
  const { els, room, SIGNAL_URL, FORCE_RELAY, setBadge, logChat } = app;

  // ---------- RTCPeerConnection ----------
  const pc = new RTCPeerConnection({
    iceServers: [
      { urls: ['stun:stun.l.google.com:19302', 'stun:global.stun.twilio.com:3478'] },
      { urls: 'turn:global.relay.metered.ca:80',  username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:global.relay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:global.relay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
    ],
    iceTransportPolicy: FORCE_RELAY ? 'relay' : 'all',
  });

  // Фіксуємо порядок m-lines: спочатку audio, потім video
  const txAudio = pc.addTransceiver('audio', { direction: 'sendrecv' });
  const txVideo = pc.addTransceiver('video', { direction: 'sendrecv' });

  let localStream, screenTrack, dc;
  let makingOffer = false;
  let ignoreOffer = false;
  let isUnloading = false;
  let iceProbe = null;

  // ---------- ICE ----------
  pc.onicecandidate = ({ candidate }) => {
    if (candidate) wsSend({ type: 'ice', room, payload: candidate });
  };

  pc.oniceconnectionstatechange = () => {
    logChat('ICE: ' + pc.iceConnectionState, 'sys');

    clearTimeout(iceProbe);
    if (['checking', 'new', 'disconnected'].includes(pc.iceConnectionState)) {
      // якщо зависли — спробуємо перезапустити ICE
      iceProbe = setTimeout(() => {
        if (['checking', 'new', 'disconnected'].includes(pc.iceConnectionState)) {
          logChat('ICE завис — виконуємо iceRestart…', 'sys');
          restartIce();
        }
      }, 8000);
    }
  };

  // ---------- Remote media attach (анти AbortError) ----------
  pc.ontrack = ({ streams }) => {
    const stream = streams && streams[0];
    if (!stream) return;

    // Призначаємо стрім, лише якщо він новий
    if (els.remote.srcObject !== stream) {
      els.remote.srcObject = stream;

      // Дозволяємо автоплей на мобільних: спершу muted → play()
      els.remote.muted = true;

      const tryPlay = () => {
        if (els.remote.paused) {
          els.remote.play().catch(err => {
            // На мобільних autoplay з аудіо часто фейлиться до кліку — це ок
            console.warn('Autoplay failed:', err && err.name);
          });
        }
        els.remote.removeEventListener('loadedmetadata', tryPlay);
      };
      // Чекаємо, поки відео знатиме розміри — тільки тоді play()
      els.remote.addEventListener('loadedmetadata', tryPlay);
    }

    maybeShowUnmute();
    setBadge('З’єднано', 'ok');
  };

  // negotiationneeded (наприклад, після заміни треків)
  pc.onnegotiationneeded = async () => {
    if (makingOffer || pc.signalingState !== 'stable') return;
    logChat('onnegotiationneeded → створюю offer', 'sys');
    await createAndSendOffer();
  };

  // ---------- States ----------
  pc.onsignalingstatechange = () => { logChat('Signaling: ' + pc.signalingState, 'sys'); };

  pc.onconnectionstatechange = () => {
    const st = pc.connectionState;
    setBadge('Статус: ' + st, st === 'connected' ? 'ok' : (st === 'failed' ? 'danger' : 'muted'));
    if (st === 'connected') {
      els.start.textContent = 'З’єднано';
      els.start.disabled = true;
      els.start.classList.add('active');
    }
    if (st === 'failed') {
      logChat('З’єднання втрачено. Пробуємо відновити…', 'sys');
      restartIce();
    }
  };

  // ---------- DataChannel / чат ----------
  pc.ondatachannel = (e) => {
    dc = e.channel;
    app.dc = dc;          // тримаємо посилання актуальним у app
    bindDataChannel();
  };

  function bindDataChannel() {
    if (!dc) return;
    dc.onmessage = (e) => logChat(e.data, 'peer');
    dc.onopen = () => {
      if (els.hint) els.hint.textContent = 'Чат підключено';
      els.msg.disabled = false;
      els.send.disabled = false;
      logChat('Чат підключено', 'sys');
    };
    dc.onclose = () => {
      els.msg.disabled = true;
      els.send.disabled = true;
      logChat('Чат закрито', 'sys');
    };
  }

  // ---------- Local media ----------
  async function startLocal(constraints) {
    if (localStream) return localStream;
    const base = constraints || {
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }
    };
    try {
      localStream = await navigator.mediaDevices.getUserMedia(base);
    } catch (err) {
      if (err && (err.name === 'NotReadableError' || err.name === 'NotAllowedError' || err.name === 'NotFoundError')) {
        logChat('Камера/мікрофон недоступні. Спроба лише з мікрофоном…', 'sys');
        if (els.hint) els.hint.textContent = 'Камера зайнята або заборонена. Використаємо лише мікрофон.';
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      } else {
        logChat('Помилка доступу до пристроїв: ' + (err.message || err.name), 'sys');
        throw err;
      }
    }

    const a = localStream.getAudioTracks()[0] || null;
    const v = localStream.getVideoTracks()[0] || null;
    if (a) await txAudio.sender.replaceTrack(a);
    if (v) await txVideo.sender.replaceTrack(v);

    els.local.srcObject = localStream;
    try { if (els.local.paused) await els.local.play(); } catch {}
    els.mic.disabled = !a;
    els.cam.disabled = !v;
    els.screen.disabled = false;
    return localStream;
  }

  // ---------- Offer / Answer ----------
  async function createAndSendOffer() {
    try {
      makingOffer = true;
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      logChat('Відправив offer', 'sys');
      wsSend({ type: 'offer', room, payload: pc.localDescription });
    } finally {
      makingOffer = false;
    }
  }

  async function restartIce() {
    try {
      const offer = await pc.createOffer({ iceRestart: true });
      await pc.setLocalDescription(offer);
      wsSend({ type: 'offer', room, payload: pc.localDescription });
    } catch (e) {
      console.warn('ICE restart failed', e);
    }
  }

  // ---------- WebSocket (signaling) + reconnection ----------
  let ws, wsReadyResolve;
  const wsReady = new Promise(r => (wsReadyResolve = r));
  let reconnectTimer = null;

  function wsSend(obj) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
  }

  function connectWS() {
    clearTimeout(reconnectTimer);
    ws = new WebSocket(SIGNAL_URL);

    ws.addEventListener('open', () => {
      wsReadyResolve?.();
      wsSend({ type: 'join', room });
      if (els.hint) els.hint.textContent = 'Під’єднуйтесь і чекайте на співрозмовника.';
      logChat('Під’єднано до сигналінгу', 'sys');
    });

    ws.addEventListener('message', async (e) => {
      const msg = JSON.parse(e.data);
      if (!msg || (msg.room && msg.room !== room)) return;

      // ----- OFFER -----
      if (msg.type === 'offer') {
        logChat('Отримав offer', 'sys');
        const offerDesc = new RTCSessionDescription(msg.payload);
        const collision = (makingOffer || pc.signalingState !== 'stable');
        ignoreOffer = !app.polite && collision;

        if (ignoreOffer) {
          logChat('Уникли колізії offer/offer (я — ініціатор)', 'sys');
          return;
        }

        try {
          if (collision) {
            await Promise.all([
              pc.setLocalDescription({ type: 'rollback' }),
              pc.setRemoteDescription(offerDesc),
            ]);
          } else {
            await pc.setRemoteDescription(offerDesc);
          }

          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          logChat('Надіслав answer', 'sys');
          wsSend({ type: 'answer', room, payload: pc.localDescription });
        } catch (err) {
          logChat('Помилка setRemoteDescription(offer): ' + (err.message || err.name), 'sys');
        }
        return;
      }

      // ----- ANSWER -----
      if (msg.type === 'answer') {
        // Приймаємо answer лише коли ми реально в стані очікування відповіді
        if (pc.signalingState !== 'have-local-offer') {
          logChat('Пропущено чужий answer (стан: ' + pc.signalingState + ')', 'sys');
          return;
        }
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(msg.payload));
          logChat('Прийняв answer', 'sys');
        } catch (err) {
          logChat('Помилка setRemoteDescription(answer): ' + (err.message || err.name), 'sys');
        }
        return;
      }

      // ----- ICE -----
      if (msg.type === 'ice') {
        try { await pc.addIceCandidate(msg.payload); } catch {}
        return;
      }

      if (msg.type === 'bye') {
        els.remote.srcObject = null;
        logChat('Співрозмовник покинув кімнату', 'sys');
        return;
      }
    });

    ws.addEventListener('close', () => {
      logChat('Сигналінг відключено', 'sys');
      if (!isUnloading) reconnectTimer = setTimeout(connectWS, 1500);
    });
  }
  connectWS();

  // ---------- Допоміжне ----------
  function maybeShowUnmute() {
    if (!app.UA_MOBILE) return;
    els.vwrap.classList.add('has-unmute');
    if (els.unmute) {
      els.unmute.addEventListener('click', () => {
        els.remote.muted = false;
        els.remote.play().catch(() => {});
        els.vwrap.classList.remove('has-unmute');
      }, { once: true });
    }
  }

  // ---------- Експорт у app ----------
  app.pc = pc;
  app.txAudio = txAudio;
  app.txVideo = txVideo;
  app.dc = dc; // оновлюється при появі каналу
  app.startLocal = startLocal;
  app.restartIce = restartIce;
  app.bindDataChannel = bindDataChannel;
  app.wsSend = wsSend;
  app.wsReady = wsReady;
  app.createAndSendOffer = createAndSendOffer;

  // ---------- При закритті вкладки ----------
  window.addEventListener('beforeunload', () => {
    isUnloading = true;
    try { wsSend({ type: 'bye', room }); } catch {}
    try { app.dc && app.dc.close(); } catch {}
    try { app.pc.getSenders().forEach(s => s.track && s.track.stop()); } catch {}
    try { app.pc.close(); } catch {}
    try { ws && ws.close(); } catch {}
  });

})(window);
