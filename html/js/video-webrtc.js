// js/video-webrtc.js
(function (global) {
  'use strict';
  const app = global.videoApp;
  const { els, room, SIGNAL_URL, FORCE_RELAY, setBadge, logChat } = app;

  // Унікальний ідентифікатор цього табу (щоб не ловити власні WS-повідомлення)
  const myId = Math.random().toString(36).slice(2);

  // ---------- ICE servers / policy (з можливістю підмінити власними) ----------
  const FALLBACK_ICE = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:global.stun.twilio.com:3478'] },
    // ВІДКРИТІ TURN — працюють нестабільно; краще підстав свій список через app.ICE_SERVERS
    { urls: 'turn:global.relay.metered.ca:80',  username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:global.relay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:global.relay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
  ];
  const ICE_SERVERS = Array.isArray(app.ICE_SERVERS) && app.ICE_SERVERS.length ? app.ICE_SERVERS : FALLBACK_ICE;

  // Пріоритет: ?relay= → FORCE_RELAY → 'all'
  const qsRelay = app.qs && app.qs.get('relay');
  const ICE_POLICY = (qsRelay === '1') || (qsRelay === null && FORCE_RELAY) ? 'relay' : 'all';

  // ---------- RTCPeerConnection ----------
  const pc = new RTCPeerConnection({
    iceServers: ICE_SERVERS,
    iceTransportPolicy: ICE_POLICY,
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require',
    // pool трохи прискорює початкову ICE-фазу на деяких браузерах
    iceCandidatePoolSize: 2,
  });

  // Фіксуємо порядок m-lines: спочатку audio, потім video
  const txAudio = pc.addTransceiver('audio', { direction: 'sendrecv' });
  const txVideo = pc.addTransceiver('video', { direction: 'sendrecv' });

  let localStream, dc;
  let makingOffer = false;                   // Perfect Negotiation
  let isSettingRemoteAnswerPending = false;  // Perfect Negotiation
  let ignoreOffer = false;                   // Perfect Negotiation
  let isUnloading = false;
  let iceProbe = null;

  // Анти-зависання: повторні offer/iceRestart
  let answerTimer = null;
  let offerRetries = 0;
  const MAX_RETRIES = 3;
  const ANSWER_TIMEOUT_MS = 6500;

  function scheduleAnswerWaitProbe() {
    clearTimeout(answerTimer);
    answerTimer = setTimeout(async () => {
      if (pc.signalingState === 'have-local-offer') {
        offerRetries++;
        logChat(`Очікую answer… спроба ${offerRetries}/${MAX_RETRIES}`, 'sys');
        if (offerRetries <= MAX_RETRIES) {
          try {
            const offer = await pc.createOffer({ iceRestart: true });
            await pc.setLocalDescription(offer);
            wsSend({ type: 'offer', room, payload: pc.localDescription, from: myId });
            logChat('Надсилаю повторний offer (iceRestart)', 'sys');
            scheduleAnswerWaitProbe();
          } catch (e) {
            logChat('Повторний offer не вдався: ' + (e.message || e.name), 'sys');
          }
        } else {
          logChat('Не отримав answer після кількох спроб. Перевірте посилання другої сторони.', 'sys');
          setBadge('Немає відповіді', 'danger');
        }
      }
    }, ANSWER_TIMEOUT_MS);
  }

  // ---------- ICE ----------
  pc.onicecandidate = ({ candidate }) => {
    if (candidate) wsSend({ type: 'ice', room, payload: candidate, from: myId });
  };

  pc.onicecandidateerror = (e) => {
    logChat(`ICE error: ${e.errorCode || ''} ${e.errorText || ''} @ ${e.url || ''}`, 'sys');
  };

  pc.onicegatheringstatechange = () => {
    logChat('ICE gathering: ' + pc.iceGatheringState, 'sys');
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

  // ---------- Remote media attach ----------
  pc.ontrack = ({ streams }) => {
    const stream = streams && streams[0];
    if (!stream) return;

    if (els.remote && els.remote.srcObject !== stream) {
      els.remote.muted = true;
      els.remote.srcObject = stream;
      const tryPlay = () => {
        if (els.remote.paused) {
          els.remote.play().catch(() => {});
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
    // Важливо: offer робить лише ініціатор (consultant). Polite-сторона чекає.
    if (makingOffer || pc.signalingState !== 'stable') return;
    if (app.polite) {
      logChat('Пропускаю negotiation: я polite (чекаю offer від співрозмовника)', 'sys');
      return;
    }
    await createAndSendOffer();
  };

  // ---------- States ----------
  pc.onsignalingstatechange = () => { logChat('Signaling: ' + pc.signalingState, 'sys'); };

  pc.onconnectionstatechange = async () => {
    const st = pc.connectionState;
    setBadge('Статус: ' + st, st === 'connected' ? 'ok' : (st === 'failed' ? 'danger' : 'muted'));
    if (st === 'connected' && els.start) {
      els.start.textContent = 'З’єднано';
      els.start.disabled = true;
      els.start.classList.add('active');
      offerRetries = 0;
      clearTimeout(answerTimer);

      // Показуємо вибрану пару кандидатів (чи реально пішли через TURN)
      try {
        const stats = await pc.getStats();
        stats.forEach(r => {
          if (r.type === 'candidate-pair' && r.selected) {
            const lp = stats.get(r.localCandidateId);
            const rp = stats.get(r.remoteCandidateId);
            logChat(`Selected pair: ${lp?.candidateType}(${lp?.protocol}) ⇄ ${rp?.candidateType} @ ${rp?.ip || rp?.address || ''}`, 'sys');
          }
        });
      } catch {}
    }
    if (st === 'failed') {
      logChat('З’єднання втрачено. Пробуємо відновити…', 'sys');
      restartIce();
    }
  };

  // ---------- DataChannel / чат ----------
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
    if (!dc || dc._bound) return;
    dc._bound = true;

    dc.onmessage = (e) => logChat(e.data, 'peer');
    dc.onopen = () => {
      if (els.hint) els.hint.textContent = 'Чат підключено';
      if (els.msg)  els.msg.disabled = false;
      if (els.send) els.send.disabled = false;
      logChat('Чат підключено', 'sys');
    };
    dc.onclose = () => {
      if (els.msg)  els.msg.disabled = true;
      if (els.send) els.send.disabled = true;
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

    if (els.local) {
      els.local.srcObject = localStream;
      try { if (els.local.paused) await els.local.play(); } catch {}
    }
    if (els.mic) els.mic.disabled = !a;
    if (els.cam) els.cam.disabled = !v;
    if (els.screen) els.screen.disabled = false;
    return localStream;
  }

  // ---------- Offer / Answer ----------
  async function createAndSendOffer() {
    // Додатковий гард: тільки ініціатор створює перший offer
    if (app.polite) {
      logChat('Не створюю offer: я polite', 'sys');
      return;
    }
    if (pc.signalingState !== 'stable') return;
    try {
      makingOffer = true;
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      logChat('Відправив offer', 'sys');
      wsSend({ type: 'offer', room, payload: pc.localDescription, from: myId });
      offerRetries = 0;
      scheduleAnswerWaitProbe();
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
      wsSend({ type: 'answer', room, payload: pc.localDescription, from: myId });
    } catch (err) {
      logChat('acceptOffer error: ' + (err.message || err.name), 'sys');
    } finally {
      isSettingRemoteAnswerPending = false;
    }
  }

  // М’яка ресинхронізація, якщо answer прийшов не у have-local-offer
  async function acceptAnswer(answerDesc) {
    // Нормальний шлях
    if (pc.signalingState === 'have-local-offer') {
      try {
        await pc.setRemoteDescription(answerDesc);
        clearTimeout(answerTimer);
        logChat('Прийняв answer', 'sys');
      } catch (err) {
        logChat('setRemoteDescription(answer) error: ' + (err.message || err.name), 'sys');
      }
      return;
    }

    // Фолбек: отримали answer у "stable" чи іншому стані → ре-синхронізація
    logChat('Отримав answer у стані ' + pc.signalingState + ' — ігнорую та прошу повторне узгодження', 'sys');
    try {
      if (pc.signalingState !== 'closed') {
        const offer = await pc.createOffer({ iceRestart: false });
        await pc.setLocalDescription(offer);
        wsSend({ type: 'offer', room, payload: pc.localDescription, from: myId });
        logChat('Надіслав повторний offer для ресинхронізації', 'sys');
        scheduleAnswerWaitProbe();
      }
    } catch (e) {
      logChat('Resync offer error: ' + (e?.message || e?.name), 'sys');
    }
  }

  let iceRestartInFlight = false;
  async function restartIce() {
    if (iceRestartInFlight) return;
    iceRestartInFlight = true;
    try {
      if (pc.signalingState === 'closed') return;
      const offer = await pc.createOffer({ iceRestart: true });
      await pc.setLocalDescription(offer);
      wsSend({ type: 'offer', room, payload: pc.localDescription, from: myId });
      scheduleAnswerWaitProbe();
    } catch (e) {
      console.warn('ICE restart failed', e);
    } finally {
      iceRestartInFlight = false;
    }
  }

  // ---------- WebSocket (signaling) + reconnection ----------
  let ws;
  let wsReadyResolve;
  function resetWsReady() {
    app.wsReady = new Promise((r) => (wsReadyResolve = r));
  }
  resetWsReady();

  function wsSend(obj) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
  }

  let reconnectTimer = null;
  function connectWS() {
    clearTimeout(reconnectTimer);
    ws = new WebSocket(SIGNAL_URL);

    ws.addEventListener('open', () => {
      wsReadyResolve?.();
      wsSend({ type: 'join', room, from: myId });
      if (els.hint) els.hint.textContent = 'Під’єднуйтесь і чекайте на співрозмовника.';
      logChat('Під’єднано до сигналінгу', 'sys');
    });

    ws.addEventListener('message', async (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (!msg || (msg.room && msg.room !== room)) return;
      if (msg.from && msg.from === myId) return; // анти-ехо

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
        if (!msg.payload) return;
        try { await pc.addIceCandidate(msg.payload); } catch {}
        return;
      }

      if (msg.type === 'bye') {
        if (els.remote) els.remote.srcObject = null;
        logChat('Співрозмовник покинув кімнату', 'sys');
        return;
      }

      if (msg.type === 'full') {
        logChat('Кімната заповнена (2/2). Закрийте зайві вкладки.', 'sys');
        setBadge('Кімната заповнена', 'danger');
        return;
      }
    });

    ws.addEventListener('close', () => {
      logChat('Сигналінг відключено', 'sys');
      if (!isUnloading) {
        reconnectTimer = setTimeout(() => {
          resetWsReady();
          connectWS();
        }, 1500);
      }
    });

    ws.addEventListener('error', () => {
      try { ws.close(); } catch {}
    });
  }
  connectWS();

  // ---------- Допоміжне ----------
  function maybeShowUnmute() {
    if (!app.UA_MOBILE || !els.vwrap) return;
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
  app.dc = dc;
  app.startLocal = startLocal;
  app.restartIce = restartIce;
  app.bindDataChannel = bindDataChannel;
  app.wsSend = wsSend;
  app.createAndSendOffer = createAndSendOffer;

  // ---------- При закритті вкладки ----------
  window.addEventListener('beforeunload', () => {
    isUnloading = true;
    try { wsSend({ type: 'bye', room, from: myId }); } catch {}
    try { app.dc && app.dc.close(); } catch {}
    try { app.pc.getSenders().forEach(s => s.track && s.track.stop()); } catch {}
    try { app.pc.close(); } catch {}
    try { ws && ws.close(); } catch {}
  });

})(window);
