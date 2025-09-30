// js/video-webrtc.js
(function (global) {
  'use strict';
  const app = global.videoApp;
  const { els, room, SIGNAL_URL, FORCE_RELAY, setBadge, logChat } = app;

  // RTCPeerConnection
  const pc = new RTCPeerConnection({
    iceServers: [
      { urls: ['stun:stun.l.google.com:19302', 'stun:global.stun.twilio.com:3478'] },
      { urls: 'turn:global.relay.metered.ca:80',  username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:global.relay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:global.relay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
    ],
    iceTransportPolicy: FORCE_RELAY ? 'relay' : 'all',
  });

  const txAudio = pc.addTransceiver('audio', { direction: 'sendrecv' });
  const txVideo = pc.addTransceiver('video', { direction: 'sendrecv' });

  let localStream, screenTrack, dc;
  let makingOffer = false;
  let ignoreOffer = false;
  let isUnloading = false;
  let iceProbe = null;

  pc.onicecandidate = ({ candidate }) => {
    if (candidate) wsSend({ type: 'ice', room, payload: candidate });
  };

  // ✅ Обережно підключаємо remote-stream, щоб не ловити AbortError
  pc.ontrack = ({ streams }) => {
    const stream = streams && streams[0];
    if (!stream) return;

    // Не пере-присвоюємо той самий stream
    const needAttach = els.remote.srcObject !== stream;
    if (needAttach) {
      els.remote.srcObject = stream;

      const tryPlay = () => {
        // На мобільних звук все одно буде заблоковано до кліку — ок
        els.remote.play().catch(() => {});
        els.remote.removeEventListener('loadedmetadata', tryPlay);
      };
      // Чекаємо, поки відео знатиме розміри — тільки тоді play()
      els.remote.addEventListener('loadedmetadata', tryPlay);
    }

    maybeShowUnmute();
    setBadge('З’єднано', 'ok');
  };

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

  pc.onsignalingstatechange = () => { logChat('Signaling: ' + pc.signalingState, 'sys'); };

  pc.ondatachannel = (e) => {
    dc = e.channel;
    app.dc = dc;          // 🔄 тримаємо посилання актуальним у app
    bindDataChannel();
  };

  async function restartIce() {
    try {
      const offer = await pc.createOffer({ iceRestart: true });
      await pc.setLocalDescription(offer);
      wsSend({ type: 'offer', room, payload: pc.localDescription });
    } catch (e) {
      console.warn('ICE restart failed', e);
    }
  }

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
    try { els.local.play(); } catch {}
    els.mic.disabled = !a;
    els.cam.disabled = !v;
    els.screen.disabled = false;
    return localStream;
  }

  async function createAndSendOffer() {
    try {
      makingOffer = true;
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      wsSend({ type: 'offer', room, payload: pc.localDescription });
    } finally {
      makingOffer = false;
    }
  }

  // WebSocket (signaling) + reconnection
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

      if (msg.type === 'offer') {
        const offerDesc = new RTCSessionDescription(msg.payload);
        const collision = (makingOffer || pc.signalingState !== 'stable');
        ignoreOffer = !app.polite && collision;
        if (ignoreOffer) { logChat('Уникли колізії offer/offer (я — ініціатор)', 'sys'); return; }

        if (collision) {
          await Promise.all([
            pc.setLocalDescription({ type: 'rollback' }),
            pc.setRemoteDescription(offerDesc)
          ]);
        } else {
          await pc.setRemoteDescription(offerDesc);
        }

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        wsSend({ type: 'answer', room, payload: pc.localDescription });
        return;
      }

      if (msg.type === 'answer') {
        if (!ignoreOffer) await pc.setRemoteDescription(new RTCSessionDescription(msg.payload));
        return;
      }

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

  // DataChannel / чат
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

  // Допоміжне
  function maybeShowUnmute() {
    if (!app.UA_MOBILE) return;
    els.vwrap.classList.add('has-unmute');
  }

  // Експорт у app
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

  // При закритті вкладки
  window.addEventListener('beforeunload', () => {
    isUnloading = true;
    try { wsSend({ type: 'bye', room }); } catch {}
    try { app.dc && app.dc.close(); } catch {}
    try { app.pc.getSenders().forEach(s => s.track && s.track.stop()); } catch {}
    try { app.pc.close(); } catch {}
    try { ws && ws.close(); } catch {}
  });

})(window);
