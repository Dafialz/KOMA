// js/video-webrtc.js
(function (global) {
  'use strict';
  const app = global.videoApp;
  const { els, room, SIGNAL_URL, FORCE_RELAY, setBadge, logChat } = app;

  // Унікальний id цього табу (щоб не ловити власні WS-повідомлення)
  const myId = Math.random().toString(36).slice(2);

  // ---------- wsReady: гарантований Promise для video-ui ----------
  let wsReadyResolve;
  function resetWsReady() { app.wsReady = new Promise((r) => (wsReadyResolve = r)); }
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

  // ---------- RTCPeerConnection ----------
  const pc = new RTCPeerConnection({
    iceServers: ICE_SERVERS,
    iceTransportPolicy: ICE_POLICY,
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require',
    iceCandidatePoolSize: 2,
    sdpSemantics: 'unified-plan',
  });

  // Доступно з консолі
  global.pc = pc;
  global.app = app;

  let localStream = null;
  let remoteStream = null;
  let dc;
  let makingOffer = false;
  let isSettingRemoteAnswerPending = false;
  let ignoreOffer = false;
  let isUnloading = false;

  // Сендери для подальшого replaceTrack (шерінг)
  let audioSender = null;
  let videoSender = null;
  app.txAudio = { sender: null };
  app.txVideo = { sender: null };

  // ---------- Local media (addTrack => гарантія a=msid) ----------
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

    try {
      if (a && !audioSender) {
        audioSender = pc.addTrack(a, localStream);
        app.txAudio.sender = audioSender;
      }
      if (v && !videoSender) {
        videoSender = pc.addTrack(v, localStream);
        app.txVideo.sender = videoSender;
      }
    } catch (e) {
      logChat('addTrack error: ' + (e.message || e.name), 'sys');
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
    els.remote.muted = true; // для автоплею; розм’ютити кнопкою
  }
  ensureRemoteVideoElementSetup();

  function tryAutoplayRemote(retries = 6) {
    if (!els.remote) return;
    const attempt = () => {
      if (!els.remote || !els.remote.srcObject) return;
      if (els.remote.readyState >= 2 && els.remote.videoWidth > 0) return; // уже грає
      els.remote.play().catch(()=>{});
    };
    attempt();
    for (let i = 1; i <= retries; i++) setTimeout(attempt, 150 * i);
    els.remote.addEventListener('loadedmetadata', attempt, { once: true });
    els.remote.addEventListener('loadeddata', attempt, { once: true });
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
  pc.onicegatheringstatechange = () => { /* тихо */ };
  pc.oniceconnectionstatechange = () => {
    if (pc.iceConnectionState === 'connected') {
      setBadge('З’єднано', 'ok');
      tryAutoplayRemote(); // ще раз після встановлення ICE
    }
  };
  pc.onsignalingstatechange = () => { /* тихо */ };
  pc.onconnectionstatechange = () => {
    const st = pc.connectionState;
    setBadge(st === 'connected' ? 'З’єднано' : ('Статус: ' + st), st === 'connected' ? 'ok' : (st === 'failed' ? 'danger' : 'muted'));
    if (st === 'connected') tryAutoplayRemote();
  };

  // ---------- Perfect negotiation ----------
  pc.onnegotiationneeded = async () => {
    if (app.polite) return;                         // офер лише від ініціатора
    if (makingOffer || pc.signalingState !== 'stable') return;
    try {
      makingOffer = true;
      await startLocal();                           // треки ДО offer (=> a=msid в офері)
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
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
      await startLocal();                           // ГАРАНТУЄМО треки ДО offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
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
      await wsSend({ type: 'answer', room, payload: pc.localDescription, from: myId });
      setBadge('Отримано пропозицію — відповідаю…', 'muted');
    } catch (err) {
      logChat('acceptOffer error: ' + (err.message || err.name), 'sys');
    } finally {
      isSettingRemoteAnswerPending = false;
    }
  }

  async function acceptAnswer(answerDesc) {
    if (pc.signalingState !== 'have-local-offer') return;
    try {
      await pc.setRemoteDescription(answerDesc);
      setBadge('Відповідь прийнята — встановлюємо медіа…', 'muted');
      tryAutoplayRemote();
    } catch (err) {
      logChat('setRemoteDescription(answer) error: ' + (err.message || err.name), 'sys');
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
    dc.onmessage = (e) => {/* не спамимо чат логами */};
    dc.onopen = () => {
      if (els.hint) els.hint.textContent = 'Чат підключено';
      if (els.msg)  els.msg.disabled = false;
      if (els.send) els.send.disabled = false;
    };
    dc.onclose = () => {
      if (els.msg)  els.msg.disabled = true;
      if (els.send) els.send.disabled = true;
    };
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
      wsReadyResolve?.();
      wsSend({ type: 'join', room, from: myId });
      wsFlush();
      setBadge('Під’єднано до сигналінгу', 'muted');
    });

    ws.addEventListener('message', async (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (!msg || (msg.room && msg.room !== room)) return;
      if (msg.from && msg.from === myId) return;

      if (msg.type === 'join-ack') {
        const count = typeof msg.count === 'number' ? msg.count : undefined;
        if (count === 1) setBadge('Очікуємо співрозмовника…', 'muted');
        if (count === 2) setBadge('Співрозмовник у кімнаті — встановлюємо з’єднання…', 'muted');
        return;
      }

      if (msg.type === 'offer') { await acceptOffer(new RTCSessionDescription(msg.payload)); return; }
      if (msg.type === 'answer') { await acceptAnswer(new RTCSessionDescription(msg.payload)); return; }
      if (msg.type === 'ice') { if (!msg.payload) return; try { await pc.addIceCandidate(msg.payload); } catch {} return; }

      if (msg.type === 'bye') {
        if (els.remote) els.remote.srcObject = null;
        remoteStream = null;
        setBadge('Співрозмовник вийшов. Очікуємо…', 'muted');
        return;
      }
      if (msg.type === 'full') {
        setBadge('Кімната заповнена', 'danger');
        return;
      }
      if (msg.type === 'peer-join') {
        if (!app.polite && pc.signalingState === 'stable') await createAndSendOffer();
        setBadge('Співрозмовник приєднався — з’єдную…', 'muted');
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
      if (!isUnloading) {
        resetWsReady();
        reconnectTimer = setTimeout(connectWS, 1500);
      }
      setBadge('Сигналінг відключено', 'muted');
    });
    ws.addEventListener('error', () => { try { ws.close(); } catch {} });
  }
  connectWS();

  // ---------- Debug stats (кожні 2с, коротко) ----------
  const statTimer = setInterval(async () => {
    try {
      const stats = await pc.getStats();
      let inV = null;
      stats.forEach(r => { if (r.type === 'inbound-rtp' && r.kind === 'video' && !r.isRemote) inV = r; });
      if (inV && inV.packetsReceived > 0) tryAutoplayRemote();
    } catch {}
  }, 2000);

  // ---------- Export ----------
  app.pc = pc;
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
