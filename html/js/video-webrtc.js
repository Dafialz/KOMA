// js/video-webrtc.js
(function (global) {
  'use strict';
  const app = global.videoApp;
  const { els, room, SIGNAL_URL, FORCE_RELAY, setBadge, logChat } = app;

  const myId = Math.random().toString(36).slice(2);

  // ---------- wsReady ----------
  let wsReadyResolve;
  function resetWsReady() {
    app.wsReady = new Promise((r) => (wsReadyResolve = r));
  }
  resetWsReady();

  // ---------- ICE ----------
  const FALLBACK_ICE = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:global.stun.twilio.com:3478'] },
    { urls: 'turn:global.relay.metered.ca:80',  username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:global.relay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:global.relay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
  ];
  const ICE_SERVERS = Array.isArray(app.ICE_SERVERS) && app.ICE_SERVERS.length ? app.ICE_SERVERS : FALLBACK_ICE;

  const qsRelay = app.qs && app.qs.get('relay');
  const ICE_POLICY =
    qsRelay === '1' ? 'relay' :
    qsRelay === '0' ? 'all'   :
    (FORCE_RELAY ? 'relay' : 'all');

  logChat(`ICE policy=${ICE_POLICY}; servers=${(ICE_SERVERS||[]).length}`, 'sys');

  // ---------- RTCPeerConnection ----------
  const pc = new RTCPeerConnection({
    iceServers: ICE_SERVERS,
    iceTransportPolicy: ICE_POLICY,
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require',
    iceCandidatePoolSize: 2,
    sdpSemantics: 'unified-plan',
  });

  global.pc = pc;
  global.app = app;

  let localStream = null;
  let remoteStream = null;
  let dc;
  let makingOffer = false;
  let isSettingRemoteAnswerPending = false;
  let ignoreOffer = false;
  let isUnloading = false;

  // ---------- Transceivers (fix m-line order: audio -> video) ----------
  const txAudio = pc.addTransceiver('audio', { direction: 'sendrecv' });
  const txVideo = pc.addTransceiver('video', { direction: 'sendrecv' });
  app.txAudio = txAudio;
  app.txVideo = txVideo;

  // Prefer H264 (Safari/iOS та деякі ПК цього потребують)
  try {
    const caps = RTCRtpSender.getCapabilities && RTCRtpSender.getCapabilities('video');
    if (caps && caps.codecs && txVideo.setCodecPreferences) {
      const h264 = caps.codecs.filter(c => /video\/h264/i.test(c.mimeType));
      const rest = caps.codecs.filter(c => !/video\/h264/i.test(c.mimeType));
      if (h264.length) {
        txVideo.setCodecPreferences([...h264, ...rest]);
        logChat(`Codec pref: H264 first (${h264.length})`, 'sys');
      }
    }
  } catch {}

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
      logChat('Помилка доступу до камери/мікрофона: ' + (err.message || err.name), 'sys');
      try { localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false }); }
      catch { localStream = new MediaStream(); }
    }

    const a = localStream.getAudioTracks()[0] || null;
    const v = localStream.getVideoTracks()[0] || null;

    // ВАЖЛИВО: replaceTrack + setStreams гарантує a=msid: у SDP
    if (a) {
      try { await txAudio.sender.replaceTrack(a); } catch {}
      try { txAudio.sender.setStreams(localStream); } catch {}
    }
    if (v) {
      try { await txVideo.sender.replaceTrack(v); } catch {}
      try { txVideo.sender.setStreams(localStream); } catch {}
    }

    if (els.local) {
      els.local.srcObject = localStream;
      els.local.muted = true;
      els.local.playsInline = true;
      els.local.autoplay = true;
      try { await els.local.play(); } catch {}
    }
    if (els.mic) els.mic.disabled = !a;
    if (els.cam) els.cam.disabled = !v;
    if (els.screen) els.screen.disabled = false;

    return localStream;
  }

  // ---------- Remote media helpers ----------
  function ensureRemoteVideoElementSetup() {
    if (!els.remote) return;
    els.remote.playsInline = true;
    els.remote.autoplay = true;
    els.remote.muted = true; // для автоплею; юзер потім розм’ютить
  }
  ensureRemoteVideoElementSetup();

  function tryAutoplayRemote() {
    if (!els.remote) return;
    const tryPlay = () => {
      if (els.remote.paused) {
        els.remote.play().catch(() => {/* чекаємо на клік Unmute */});
      }
    };
    tryPlay();
    setTimeout(tryPlay, 300);
    els.remote.addEventListener('loadeddata', tryPlay, { once: true });
  }

  function maybeShowUnmute() {
    if (!els.vwrap) return;
    els.vwrap.classList.add('has-unmute');
    if (els.unmute) {
      els.unmute.addEventListener('click', () => {
        try { els.remote.muted = false; els.remote.play().catch(()=>{}); } catch {}
        els.vwrap.classList.remove('has-unmute');
      }, { once: true });
    }
  }

  // ---------- Remote media attach ----------
  pc.ontrack = (ev) => {
    try { ev.track && (ev.track.onunmute = () => { tryAutoplayRemote(); ev.track.onunmute = null; }); } catch {}

    const s = (ev.streams && ev.streams[0]) || null;
    if (s) {
      if (!remoteStream || remoteStream.id !== s.id) remoteStream = s;
    } else {
      if (!remoteStream) remoteStream = new MediaStream();
      if (ev.track && !remoteStream.getTracks().find(t => t.id === ev.track.id)) {
        remoteStream.addTrack(ev.track);
      }
    }

    if (els.remote && els.remote.srcObject !== remoteStream) {
      els.remote.srcObject = remoteStream;
      ensureRemoteVideoElementSetup();
      tryAutoplayRemote();
    }

    maybeShowUnmute();
    setBadge('З’єднано', 'ok');
  };

  // ---------- States / ICE ----------
  pc.onicecandidate = ({ candidate }) => {
    if (candidate) wsSend({ type: 'ice', room, payload: candidate, from: myId });
  };
  pc.onicegatheringstatechange = () => { logChat('ICE gathering: ' + pc.iceGatheringState, 'sys'); };
  pc.oniceconnectionstatechange = () => {
    logChat('ICE: ' + pc.iceConnectionState, 'sys');
    if (pc.iceConnectionState === 'connected') setBadge('З’єднано', 'ok');
  };
  pc.onsignalingstatechange = () => { logChat('Signaling: ' + pc.signalingState, 'sys'); };
  pc.onconnectionstatechange = () => {
    const st = pc.connectionState;
    setBadge('Статус: ' + st, st === 'connected' ? 'ok' : (st === 'failed' ? 'danger' : 'muted'));
  };

  // ---------- Perfect negotiation ----------
  pc.onnegotiationneeded = async () => {
    if (app.polite) return;                         // офер лише від ініціатора
    if (makingOffer || pc.signalingState !== 'stable') return;
    try {
      makingOffer = true;
      await startLocal();                           // треки ДО offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      logChat('Відправив offer', 'sys');
      await wsSend({ type: 'offer', room, payload: pc.localDescription, from: myId });
    } catch (e) {
      logChat('onnegotiationneeded error: ' + (e.message || e.name), 'sys');
    } finally {
      makingOffer = false;
    }
  };

  async function createAndSendOffer() {
    if (app.polite) return;
    if (makingOffer || pc.signalingState !== 'stable') return;
    try {
      makingOffer = true;
      await startLocal();
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      logChat('Відправив offer', 'sys');
      await wsSend({ type: 'offer', room, payload: pc.localDescription, from: myId });
    } catch (err) {
      logChat('createOffer error: ' + (err.message || err.name), 'sys');
    } finally {
      makingOffer = false;
    }
  }

  async function acceptOffer(offerDesc) {
    await startLocal(); // треки ДО answer
    const offerCollision =
      makingOffer || pc.signalingState !== 'stable' || isSettingRemoteAnswerPending;
    ignoreOffer = !app.polite && offerCollision;
    if (ignoreOffer) {
      logChat('Колізія offer/offer (ігнорую, я — ініціатор)', 'sys');
      return;
    }
    try {
      isSettingRemoteAnswerPending = true;
      await pc.setRemoteDescription(offerDesc);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      logChat('Надіслав answer', 'sys');
      await wsSend({ type: 'answer', room, payload: pc.localDescription, from: myId });
    } catch (err) {
      logChat('acceptOffer error: ' + (err.message || err.name), 'sys');
    } finally {
      isSettingRemoteAnswerPending = false;
    }
  }

  async function acceptAnswer(answerDesc) {
    if (pc.signalingState === 'have-local-offer') {
      try {
        await pc.setRemoteDescription(answerDesc);
        logChat('Прийняв answer', 'sys');
        setBadge('Отримано відповідь — з’єднуємо…', 'muted');
      } catch (err) {
        logChat('setRemoteDescription(answer) error: ' + (err.message || err.name), 'sys');
      }
      return;
    }
    // Фолбек: якщо answer прийшов у «нестандартному» стані — робимо ресинхронізацію
    logChat('Answer у стані ' + pc.signalingState + ' — форсую повторний offer', 'sys');
    try {
      if (pc.signalingState !== 'closed') {
        const offer = await pc.createOffer({ iceRestart: false });
        await pc.setLocalDescription(offer);
        await wsSend({ type: 'offer', room, payload: pc.localDescription, from: myId });
      }
    } catch (e) {
      logChat('Resync offer error: ' + (e?.message || e?.name), 'sys');
    }
  }

  async function restartIce() {
    try {
      const offer = await pc.createOffer({ iceRestart: true });
      await pc.setLocalDescription(offer);
      await wsSend({ type: 'offer', room, payload: pc.localDescription, from: myId });
      logChat('ICE restart: надіслав новий offer', 'sys');
    } catch (e) {
      logChat('ICE restart failed: ' + (e.message || e.name), 'sys');
    }
  }

  // ---------- DataChannel ----------
  try {
    dc = pc.createDataChannel('chat');
    app.dc = dc;
    bindDataChannel();
  } catch {}
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

  // ---------- Signaling (WS) ----------
  let ws;
  const outbox = [];
  function wsFlush() {
    if (!outbox.length || !ws || ws.readyState !== 1) return;
    while (outbox.length) {
      const m = outbox.shift();
      try { ws.send(JSON.stringify(m)); } catch { break; }
    }
  }

  async function wsSend(obj) {
    if (!ws || ws.readyState !== 1) {
      outbox.push(obj);
      try { await app.wsReady; } catch {}
    }
    if (ws && ws.readyState === 1) {
      try { ws.send(JSON.stringify(obj)); } catch {}
    }
  }

  let reconnectTimer = null;
  function connectWS() {
    clearTimeout(reconnectTimer);
    ws = new WebSocket(SIGNAL_URL);

    ws.addEventListener('open', () => {
      wsReadyResolve?.();
      wsSend({ type: 'join', room, from: myId });
      wsFlush();
      logChat('Під’єднано до сигналінгу', 'sys');
    });

    ws.addEventListener('message', async (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (!msg || (msg.room && msg.room !== room)) return;
      if (msg.from && msg.from === myId) return;

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
        remoteStream = null;
        logChat('Співрозмовник покинув кімнату', 'sys');
        setBadge('Співрозмовник вийшов. Очікуємо…', 'muted');
        return;
      }
      if (msg.type === 'full') {
        logChat('Кімната заповнена (2/2). Закрийте зайві вкладки.', 'sys');
        setBadge('Кімната заповнена', 'danger');
        return;
      }

      // Пізнє підключення другого — ініціатор шле свіжий offer
      if (msg.type === 'peer-join') {
        if (!app.polite && pc.signalingState === 'stable') {
          logChat('Peer join → надсилаю новий offer', 'sys');
          await createAndSendOffer();
        }
        setBadge('Співрозмовник приєднався — встановлюємо з’єднання…', 'muted');
        return;
      }
      if (msg.type === 'peer-leave') {
        if (els.remote) els.remote.srcObject = null;
        remoteStream = null;
        setBadge('Співрозмовник вийшов. Очікуємо…', 'muted');
        return;
      }
    });

    ws.addEventListener('close', () => {
      logChat('Сигналінг відключено', 'sys');
      if (!isUnloading) {
        resetWsReady();
        reconnectTimer = setTimeout(connectWS, 1500);
      }
    });
    ws.addEventListener('error', () => { try { ws.close(); } catch {} });
  }
  connectWS();

  // ---------- Debug stats ----------
  const statTimer = setInterval(async () => {
    try {
      const stats = await pc.getStats();
      let outV = null, inV = null, pair;
      stats.forEach(r => {
        if (r.type === 'outbound-rtp' && r.kind === 'video' && !r.isRemote) outV = r;
        if (r.type === 'inbound-rtp'  && r.kind === 'video' && !r.isRemote) inV = r;
        if (r.type === 'candidate-pair' && r.selected) pair = r;
      });
      const rx = inV ? `↓ video: pkts=${inV.packetsReceived}` : '↓ video: n/a';
      const tx = outV ? `↑ video: pkts=${outV.packetsSent}`   : '↑ video: n/a';
      const recvStates = pc.getReceivers().map(r=>({kind:r.track?.kind, state:r.track?.readyState, muted:r.track?.muted}));
      if (pair) {
        const lp = stats.get(pair.localCandidateId);
        const rp = stats.get(pair.remoteCandidateId);
        logChat(`${tx} | ${rx} | rxTracks=${JSON.stringify(recvStates)} | ICE=${lp?.candidateType}/${lp?.protocol}⇄${rp?.candidateType}`, 'sys');
      } else {
        logChat(`${tx} | ${rx} | rxTracks=${JSON.stringify(recvStates)}`, 'sys');
      }

      if (els.remote && els.remote.srcObject && els.remote.readyState < 2) {
        tryAutoplayRemote();
      }
    } catch {}
  }, 2000);

  // ---------- Export ----------
  app.pc = pc;
  app.txAudio = txAudio;
  app.txVideo = txVideo;
  app.startLocal = startLocal;
  app.createAndSendOffer = createAndSendOffer;
  app.restartIce = restartIce;
  app.wsSend = wsSend;
  app.ICE_POLICY = ICE_POLICY;
  app.ICE_SERVERS = ICE_SERVERS;
  app.bindDataChannel = bindDataChannel;

  // ---------- При закритті вкладки ----------
  window.addEventListener('beforeunload', () => {
    isUnloading = true;
    clearInterval(statTimer);
    try { wsSend({ type: 'bye', room, from: myId }); } catch {}
    try { app.dc && app.dc.close(); } catch {}
    try { pc.getSenders().forEach(s => s.track && s.track.stop()); } catch {}
    try { pc.close(); } catch {}
    try { ws && ws.close(); } catch {}
  });

})(window);
