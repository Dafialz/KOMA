// js/video-webrtc.js
(function (global) {
  'use strict';
  const app = global.videoApp;
  const { els, room, SIGNAL_URL, FORCE_RELAY, setBadge, logChat } = app;

  const myId = Math.random().toString(36).slice(2);

  // ---------- ICE servers ----------
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

  let localStream = null;
  let dc;
  let makingOffer = false;
  let isSettingRemoteAnswerPending = false;
  let ignoreOffer = false;
  let isUnloading = false;
  let iceProbe = null;

  const txAudio = pc.addTransceiver('audio', { direction: 'sendrecv' });
  const txVideo = pc.addTransceiver('video', { direction: 'sendrecv' });

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
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      } catch {
        localStream = new MediaStream(); // створюємо пустий потік щоб SDP був валідним
      }
    }

    const a = localStream.getAudioTracks()[0] || null;
    const v = localStream.getVideoTracks()[0] || null;
    if (a) await txAudio.sender.replaceTrack(a);
    if (v) await txVideo.sender.replaceTrack(v);

    if (els.local) {
      els.local.srcObject = localStream;
      els.local.muted = true;
      els.local.playsInline = true;
      try { await els.local.play(); } catch {}
    }
    if (els.mic) els.mic.disabled = !a;
    if (els.cam) els.cam.disabled = !v;
    return localStream;
  }

  // ---------- Remote media ----------
  pc.ontrack = ({ streams }) => {
    const stream = streams && streams[0];
    if (!stream) return;
    if (els.remote && els.remote.srcObject !== stream) {
      els.remote.srcObject = stream;
      els.remote.playsInline = true;
      els.remote.muted = false;
      els.remote.addEventListener('loadedmetadata', () => {
        els.remote.play().catch(()=>{});
      });
    }
    maybeShowUnmute();
    setBadge('З’єднано', 'ok');
  };

  // ---------- ICE ----------
  pc.onicecandidate = ({ candidate }) => {
    if (candidate) wsSend({ type: 'ice', room, payload: candidate, from: myId });
  };
  pc.oniceconnectionstatechange = () => {
    logChat('ICE: ' + pc.iceConnectionState, 'sys');
    if (['failed', 'disconnected'].includes(pc.iceConnectionState)) restartIce();
  };

  // ---------- DataChannel ----------
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
    dc.onopen = () => logChat('Чат підключено', 'sys');
    dc.onclose = () => logChat('Чат закрито', 'sys');
  }

  // ---------- Offer / Answer ----------
  async function createAndSendOffer() {
    if (app.polite) return;
    await startLocal(); // 🔸 тепер завжди беремо локальний потік ДО offer
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
    await startLocal(); // 🔸 також беремо локальний потік перед відповіддю
    const offerCollision =
      makingOffer || pc.signalingState !== 'stable' || isSettingRemoteAnswerPending;
    ignoreOffer = !app.polite && offerCollision;
    if (ignoreOffer) {
      logChat('Колізія offer/offer (ігнорую)', 'sys');
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
    }
  }

  async function restartIce() {
    try {
      const offer = await pc.createOffer({ iceRestart: true });
      await pc.setLocalDescription(offer);
      await wsSend({ type: 'offer', room, payload: pc.localDescription, from: myId });
    } catch (e) {
      logChat('ICE restart failed', 'sys');
    }
  }

  // ---------- Signaling ----------
  let ws;
  function connectWS() {
    ws = new WebSocket(SIGNAL_URL);
    ws.addEventListener('open', () => {
      wsSend({ type: 'join', room, from: myId });
      logChat('Під’єднано до сигналінгу', 'sys');
    });
    ws.addEventListener('message', async (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.from === myId) return;

      if (msg.type === 'offer') {
        logChat('Отримав offer', 'sys');
        await acceptOffer(new RTCSessionDescription(msg.payload));
      } else if (msg.type === 'answer') {
        await acceptAnswer(new RTCSessionDescription(msg.payload));
      } else if (msg.type === 'ice') {
        try { await pc.addIceCandidate(msg.payload); } catch {}
      }
    });
  }
  connectWS();

  async function wsSend(obj) {
    try {
      if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
    } catch {}
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

  // ---------- Export ----------
  app.pc = pc;
  app.startLocal = startLocal;
  app.createAndSendOffer = createAndSendOffer;
  app.restartIce = restartIce;
  app.wsSend = wsSend;
  app.bindDataChannel = bindDataChannel;

  window.addEventListener('beforeunload', () => {
    try { wsSend({ type: 'bye', room, from: myId }); } catch {}
    try { app.dc && app.dc.close(); } catch {}
    try { app.pc.close(); } catch {}
    try { ws && ws.close(); } catch {}
  });

})(window);
