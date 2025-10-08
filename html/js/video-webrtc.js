// js/video-webrtc.js
(function (global) {
  'use strict';
  const app = global.videoApp;
  const { els, room, SIGNAL_URL, FORCE_RELAY, setBadge, logChat } = app;

  // Унікальний id цього табу (щоб не ловити власні WS-повідомлення)
  const myId = Math.random().toString(36).slice(2);

  // ---------- wsReady: ГАРАНТОВАНИЙ Promise для video-ui ----------
  let wsReadyResolve;
  function resetWsReady() {
    app.wsReady = new Promise((r) => (wsReadyResolve = r));
  }
  resetWsReady();

  // ---------- ICE servers / policy ----------
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
  });

  // Експортуємо для консолі
  global.pc = pc;
  global.app = app;

  let localStream = null;
  let remoteStream = null;
  let dc;
  let makingOffer = false;
  let isSettingRemoteAnswerPending = false;
  let ignoreOffer = false;
  let isUnloading = false;

  // Трансивери: фіксуємо порядок m-lines (audio -> video)
  const txAudio = pc.addTransceiver('audio', { direction: 'sendrecv' });
  const txVideo = pc.addTransceiver('video', { direction: 'sendrecv' });

  // Спроба пріоритезувати H264 (краще для iOS/Safari/деяких ПК)
  try {
    const caps = RTCRtpSender.getCapabilities && RTCRtpSender.getCapabilities('video');
    if (caps && caps.codecs && txVideo.setCodecPreferences) {
      const h264 = caps.codecs.filter(c => /video\/h264/i.test(c.mimeType));
      const rest = caps.codecs.filter(c => !/video\/h264/i.test(c.mimeType));
      if (h264.length) txVideo.setCodecPreferences([...h264, ...rest]);
      logChat(`Codec pref: H264 first (${h264.length})`, 'sys');
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
      try {
        // fallback: хоч би мікрофон
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      } catch {
        // крайній варіант: порожній потік, щоб SDP був валідний
        localStream = new MediaStream();
      }
    }

    const a = localStream.getAudioTracks()[0] || null;
    const v = localStream.getVideoTracks()[0] || null;

    if (a) {
      await txAudio.sender.replaceTrack(a);
      try { txAudio.sender.setStreams(localStream); } catch {}
    }
    if (v) {
      await txVideo.sender.replaceTrack(v);
      try { txVideo.sender.setStreams(localStream); } catch {}
    }

    if (els.local) {
      els.local.srcObject = localStream;
      els.local.muted = true;       // щоб автоплей не блокувався
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
    // muted=true дозволяє автоплей, потім юзер тицяє Unmute
    els.remote.muted = true;
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

  // ---------- ICE / states ----------
  pc.onicecandidate = ({ candidate }) => {
    if (candidate) wsSend({ type: 'ice', room, payload: candidate, from: myId });
  };
  pc.oniceconnectionstatechange = () => {
    logChat('ICE: ' + pc.iceConnectionState, 'sys');
    if (['failed', 'disconnected'].includes(pc.iceConnectionState)) restartIce();
  };
  pc.onicegatheringstatechange = () => {
    logChat('ICE gathering: ' + pc.iceGatheringState, 'sys');
  };
  pc.onsignalingstatechange = () => {
    logChat('Signaling: ' + pc.signalingState, 'sys');
  };
  pc.onconnectionstatechange = () => {
    const st = pc.connectionState;
    setBadge('Статус: ' + st, st === 'connected' ? 'ok' : (st === 'failed' ? 'danger' : 'muted'));
  };

  // negotiationneeded — лише для ініціатора і без дублювань
  pc.onnegotiationneeded = async () => {
    if (app.polite) return;
    if (makingOffer) return;
    if (pc.signalingState !== 'stable') return;
    await createAndSendOffer();
  };

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

  // ---------- Offer / Answer ----------
  async function createAndSendOffer() {
    if (app.polite) return;               // ініціатор — тільки non-polite
    await startLocal();                   // мати треки ДО offer
    if (pc.signalingState !== 'stable') return;
    try {
      makingOffer = true;
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
    await startLocal(); // у відповідача теж треки ДО answer
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
      } catch (err) {
        logChat('setRemoteDescription(answer) error: ' + (err.message || err.name), 'sys');
      }
      return;
    }
    // Якщо answer прийшов у «нестандартному» стані — робимо ресинхронізацію
    logChat('Отримав answer у стані ' + pc.signalingState + ' — форсую повторну синхронізацію', 'sys');
    try {
      if (pc.signalingState !== 'closed') {
        const offer = await pc.createOffer({ iceRestart: false });
        await pc.setLocalDescription(offer);
        await wsSend({ type: 'offer', room, payload: pc.localDescription, from: myId });
        logChat('Надіслав повторний offer для ресинхронізації', 'sys');
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
    } catch (e) {
      logChat('ICE restart failed: ' + (e.message || e.name), 'sys');
    }
  }

  // ---------- Signaling (WS) з reconnection та outbox ----------
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
      wsReadyResolve?.();                // <-- РОЗРІШУЄМО app.wsReady
      wsSend({ type: 'join', room, from: myId });
      wsFlush();
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
        resetWsReady();
        reconnectTimer = setTimeout(connectWS, 1500);
      }
    });

    ws.addEventListener('error', () => {
      try { ws.close(); } catch {}
    });
  }
  connectWS();

  // ---------- Debug stats (кожні 2с) ----------
  let statTimer = setInterval(async () => {
    try {
      if (!pc) return;
      const stats = await pc.getStats();
      let outV = null, inV = null;
      stats.forEach(r => {
        if (r.type === 'outbound-rtp' && r.kind === 'video' && !r.isRemote) outV = r;
        if (r.type === 'inbound-rtp'  && r.kind === 'video' && !r.isRemote) inV = r;
      });
      const rx = inV ? `↓ video: pkts=${inV.packetsReceived} kbps=${Math.round(((inV.bytesReceived||0)*8/1000)/2)}` : '↓ video: n/a';
      const tx = outV ? `↑ video: pkts=${outV.packetsSent} kbps=${Math.round(((outV.bytesSent||0)*8/1000)/2)}` : '↑ video: n/a';

      const recvStates = pc.getReceivers().map(r=>({
        kind: r.track?.kind, muted: r.track?.muted, enabled: r.track?.enabled,
        state: r.track?.readyState
      }));
      logChat(`${tx} | ${rx} | rxTracks=${JSON.stringify(recvStates)}`, 'sys');

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
  app.bindDataChannel = bindDataChannel;
  app.ICE_POLICY = ICE_POLICY;
  app.ICE_SERVERS = ICE_SERVERS;

  // ---------- При закритті вкладки ----------
  window.addEventListener('beforeunload', () => {
    isUnloading = true;
    clearInterval(statTimer);
    try { wsSend({ type: 'bye', room, from: myId }); } catch {}
    try { app.dc && app.dc.close(); } catch {}
    try { app.pc.getSenders().forEach(s => s.track && s.track.stop()); } catch {}
    try { app.pc.close(); } catch {}
    try { ws && ws.close(); } catch {}
  });

})(window);
