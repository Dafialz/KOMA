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
  let makingOffer = false;                   // Perfect Negotiation
  let isSettingRemoteAnswerPending = false;  // Perfect Negotiation
  let ignoreOffer = false;                   // Perfect Negotiation
  let isUnloading = false;
  let iceProbe = null;
  let lastRemoteStream = null;

  // ---------- ICE ----------
  pc.onicecandidate = ({ candidate }) => {
    if (candidate) wsSend({ type: 'ice', room, payload: candidate });
  };

  pc.oniceconnectionstatechange = () => {
    logChat('ICE: ' + pc.iceConnectionState, 'sys');
    clearTimeout(iceProbe);
    if (['checking', 'new', 'disconnected'].includes(pc.iceConnectionState)) {
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

    if (lastRemoteStream !== stream) {
      lastRemoteStream = stream;

      if (els.remote.srcObject !== stream) {
        // для автоплею на мобільних спочатку глушимо
        els.remote.muted = true;
        els.remote.srcObject = stream;
      }

      const tryPlay = () => {
        if (els.remote.paused) {
          els.remote.play().catch(() => { /* мобільні можуть блокувати – це ок */ });
        }
        els.remote.removeEventListener('loadedmetadata', tryPlay);
      };
      els.remote.addEventListener('loadedmetadata', tryPlay);
    }

    maybeShowUnmute();
    setBadge('З’єднано', 'ok');
  };

  // ---------- negotiationneeded ----------
  pc.onnegotiationneeded = async () => {
    // ВАЖЛИВО: не створюємо offer, поки стан не stable
    if (makingOffer || pc.signalingState !== 'stable') return;
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
  // Створюємо локально, щоб зменшити glare і швидше активувати чат
  try {
    dc = pc.createDataChannel('chat');
    app.dc = dc;
    bindDataChannel();
  } catch (_) {}
  pc.ondatachannel = (e) => {
    dc = e.channel;
    app.dc = dc;
    bindDataChannel();
  };

  function bindDataChannel() {
    if (!dc) return;
    if (dc._bound) return;
    dc._bound = true;

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

  // ---------- Offer / Answer (Perfect Negotiation) ----------
  async function createAndSendOffer() {
    // дубль-ґард: offer тільки у stable
    if (pc.signalingState !== 'stable') return;
    try {
      makingOffer = true;
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      logChat('Відправив offer', 'sys');
      wsSend({ type: 'offer', room, payload: pc.localDescription });
    } catch (err) {
      logChat('Помилка createOffer/setLocalDescription: ' + (err.message || err.name), 'sys');
    } finally {
      makingOffer = false;
    }
  }

  async function acceptOffer(offerDesc) {
    const offerCollision =
      makingOffer || pc.signalingState !== 'stable' || isSettingRemoteAnswerPending;

    ignoreOffer = !app.polite && offerCollision;
    if (ignoreOffer) {
      logChat('Уникли колізії offer/offer (я — ініціатор)', 'sys');
      return;
    }

    try {
      isSettingRemoteAnswerPending = (pc.signalingState !== 'stable');
      await pc.setRemoteDescription(offerDesc);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      logChat('Надіслав answer', 'sys');
      wsSend({ type: 'answer', room, payload: pc.localDescription });
    } catch (err) {
      logChat('acceptOffer error: ' + (err.message || err.name), 'sys');
    } finally {
      isSettingRemoteAnswerPending = false;
    }
  }

  async function acceptAnswer(answerDesc) {
    // Критично: приймати answer тільки коли ми у стані have-local-offer
    if (pc.signalingState !== 'have-local-offer') {
      logChat('Отримав answer у стані ' + pc.signalingState + ' — ігнорую', 'sys');
      return;
    }
    try {
      await pc.setRemoteDescription(answerDesc);
      logChat('Прийняв answer', 'sys');
    } catch (err) {
      logChat('setRemoteDescription(answer) error: ' + (err.message || err.name), 'sys');
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
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (!msg || (msg.room && msg.room !== room)) return;

      if (msg.type === 'offer') {
        logChat('Отримав offer', 'sys');
        await acceptOffer(new RTCSessionDescription(msg.payload));
        return;
      }

      if (msg.type === 'answer') {
        await acceptAnswer(new RTCSessionDescription(msg.payload));
        return;
      }

      if (msg.type === 'ice') {
        try { await pc.addIceCandidate(msg.payload); } catch {}
        return;
      }

      if (msg.type === 'bye') {
        els.remote.srcObject = null;
        lastRemoteStream = null;
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
