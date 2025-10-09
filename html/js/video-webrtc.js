// js/video-webrtc.js
(function (global) {
  'use strict';
  const app = global.videoApp;
  const { els, room, SIGNAL_URL, FORCE_RELAY, setBadge, logChat } = app;

  const myId = Math.random().toString(36).slice(2);

  // wsReady — гарантовано резолвиться після open()
  let wsReadyResolve;
  function resetWsReady() { app.wsReady = new Promise((r) => (wsReadyResolve = r)); }
  resetWsReady();

  // ---------- ICE ----------
  const FALLBACK_ICE = [
    { urls: ['stun:stun.l.google.com:19302','stun:global.stun.twilio.com:3478'] },
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

  // ---------- PC ----------
  const pc = new RTCPeerConnection({
    iceServers: ICE_SERVERS,
    iceTransportPolicy: ICE_POLICY,
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require',
    iceCandidatePoolSize: 2,
  });

  global.pc = pc; global.app = app;

  let localStream = null, remoteStream = null, dc;
  let makingOffer = false;
  let isSettingRemoteAnswerPending = false;
  let ignoreOffer = false;
  let isUnloading = false;

  const txAudio = pc.addTransceiver('audio', { direction: 'sendrecv' });
  const txVideo = pc.addTransceiver('video', { direction: 'sendrecv' });

  // H264 вище
  try {
    const caps = RTCRtpSender.getCapabilities && RTCRtpSender.getCapabilities('video');
    if (caps && caps.codecs && txVideo.setCodecPreferences) {
      const h264 = caps.codecs.filter(c => /video\/h264/i.test(c.mimeType));
      const rest = caps.codecs.filter(c => !/video\/h264/i.test(c.mimeType));
      if (h264.length) txVideo.setCodecPreferences([...h264, ...rest]);
      if (app.DEBUG_CHAT) logChat(`Codec pref: H264 first (${h264.length})`, 'sys'); else console.log(`Codec pref: H264 first (${h264.length})`);
    }
  } catch {}

  // ---------- Local ----------
  async function startLocal(constraints) {
    if (localStream) return localStream;
    const base = constraints || {
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }
    };
    try {
      localStream = await navigator.mediaDevices.getUserMedia(base);
    } catch (err) {
      if (app.DEBUG_CHAT) logChat('Помилка доступу до камери/мікрофона: ' + (err.message || err.name), 'sys');
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      } catch { localStream = new MediaStream(); }
    }

    const a = localStream.getAudioTracks()[0] || null;
    const v = localStream.getVideoTracks()[0] || null;

    if (a) { await txAudio.sender.replaceTrack(a); try { txAudio.sender.setStreams(localStream); } catch {} }
    if (v) { await txVideo.sender.replaceTrack(v); try { txVideo.sender.setStreams(localStream); } catch {} }

    if (els.local) {
      els.local.srcObject = localStream;
      els.local.muted = true; els.local.playsInline = true; els.local.autoplay = true;
      try { await els.local.play(); } catch {}
    }
    if (els.mic) els.mic.disabled = !a;
    if (els.cam) els.cam.disabled = !v;
    if (els.screen) els.screen.disabled = false;

    return localStream;
  }

  // ---------- Remote ----------
  function ensureRemoteVideoElementSetup() {
    if (!els.remote) return;
    els.remote.playsInline = true;
    els.remote.autoplay = true;
    els.remote.muted = true; // автоплей
  }
  ensureRemoteVideoElementSetup();

  function tryAutoplayRemote() {
    if (!els.remote) return;
    const play = () => { if (els.remote.paused) els.remote.play().catch(()=>{}); };
    play(); setTimeout(play, 300);
    els.remote.addEventListener('loadeddata', play, { once:true });
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

  pc.ontrack = (ev) => {
    const s = (ev.streams && ev.streams[0]) || null;
    if (s) { if (!remoteStream || remoteStream.id !== s.id) remoteStream = s; }
    else {
      if (!remoteStream) remoteStream = new MediaStream();
      if (ev.track && !remoteStream.getTracks().find(t => t.id === ev.track.id)) remoteStream.addTrack(ev.track);
    }

    if (els.remote && els.remote.srcObject !== remoteStream) {
      els.remote.srcObject = remoteStream;
      ensureRemoteVideoElementSetup(); tryAutoplayRemote();
    }
    maybeShowUnmute();
    setBadge('Статус: connected', 'ok');
  };

  // ---------- States ----------
  pc.onicecandidate = ({ candidate }) => { if (candidate) wsSend({ type: 'ice', room, payload: candidate, from: myId }); };
  pc.onicegatheringstatechange = () => { if (app.DEBUG_CHAT) logChat('ICE gathering: ' + pc.iceGatheringState, 'sys'); else console.log('ICE gathering:', pc.iceGatheringState); };
  pc.oniceconnectionstatechange = () => {
    const st = pc.iceConnectionState;
    if (app.DEBUG_CHAT) logChat('ICE: ' + st, 'sys'); else console.log('ICE:', st);
    if (st === 'connected') setBadge('Статус: connected', 'ok');
    if (st === 'failed' || st === 'disconnected') restartIce();
  };
  pc.onsignalingstatechange = () => { if (app.DEBUG_CHAT) logChat('Signaling: ' + pc.signalingState, 'sys'); else console.log('Signaling:', pc.signalingState); };
  pc.onconnectionstatechange = () => {
    const st = pc.connectionState;
    setBadge('Статус: ' + st, st === 'connected' ? 'ok' : (st === 'failed' ? 'danger' : 'muted'));
  };

  // ---------- Perfect negotiation ----------
  pc.onnegotiationneeded = async () => {
    if (app.polite) return;
    if (makingOffer || pc.signalingState !== 'stable') return;
    await createAndSendOffer();
  };

  async function createAndSendOffer() {
    if (app.polite) return;
    if (makingOffer || pc.signalingState !== 'stable') return;
    try {
      makingOffer = true;
      await startLocal();
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      if (app.DEBUG_CHAT) logChat('Відправив offer', 'sys'); else console.log('Відправив offer');
      await wsSend({ type: 'offer', room, payload: pc.localDescription, from: myId });
    } catch (err) {
      if (app.DEBUG_CHAT) logChat('createOffer error: ' + (err.message || err.name), 'sys'); else console.log('createOffer error:', err?.message||err?.name);
    } finally { makingOffer = false; }
  }

  async function acceptOffer(offerDesc) {
    await startLocal();
    const offerCollision = makingOffer || pc.signalingState !== 'stable' || isSettingRemoteAnswerPending;
    ignoreOffer = !app.polite && offerCollision;
    if (ignoreOffer) { if (app.DEBUG_CHAT) logChat('Колізія offer/offer (ігнорую, я — ініціатор)', 'sys'); return; }
    try {
      isSettingRemoteAnswerPending = true;
      await pc.setRemoteDescription(offerDesc);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      if (app.DEBUG_CHAT) logChat('Надіслав answer', 'sys'); else console.log('Надіслав answer');
      await wsSend({ type: 'answer', room, payload: pc.localDescription, from: myId });
      setBadge('Отримали пропозицію — відповідаємо…', 'muted');
    } catch (err) {
      if (app.DEBUG_CHAT) logChat('acceptOffer error: ' + (err.message || err.name), 'sys'); else console.log('acceptOffer error:', err?.message||err?.name);
    } finally { isSettingRemoteAnswerPending = false; }
  }

  async function acceptAnswer(answerDesc) {
    if (pc.signalingState !== 'have-local-offer') return;
    try {
      await pc.setRemoteDescription(answerDesc);
      if (app.DEBUG_CHAT) logChat('Прийняв answer', 'sys'); else console.log('Прийняв answer');
      setBadge('Отримано відповідь — з’єднуємо…', 'muted');
    } catch (err) {
      if (app.DEBUG_CHAT) logChat('setRemoteDescription(answer) error: ' + (err.message || err.name), 'sys'); else console.log('setRemoteDescription(answer) error:', err?.message||err?.name);
    }
  }

  async function restartIce() {
    try {
      const offer = await pc.createOffer({ iceRestart: true });
      await pc.setLocalDescription(offer);
      await wsSend({ type: 'offer', room, payload: pc.localDescription, from: myId });
      if (app.DEBUG_CHAT) logChat('ICE restart: надіслав новий offer', 'sys'); else console.log('ICE restart: offer sent');
    } catch (e) {
      if (app.DEBUG_CHAT) logChat('ICE restart failed: ' + (e.message || e.name), 'sys'); else console.log('ICE restart failed:', e?.message||e?.name);
    }
  }

  // ---------- DataChannel ----------
  try { dc = pc.createDataChannel('chat'); app.dc = dc; bindDataChannel(); } catch {}
  pc.ondatachannel = (e) => { dc = e.channel; app.dc = dc; bindDataChannel(); };

  function bindDataChannel() {
    if (!dc || dc._bound) return;
    dc._bound = true;
    dc.onmessage = (e) => logChat(e.data, 'peer');
    dc.onopen  = () => { if (els.hint) els.hint.textContent = 'Чат підключено';
      if (els.msg)  els.msg.disabled = false; if (els.send) els.send.disabled = false;
      if (app.DEBUG_CHAT) logChat('Чат підключено', 'sys'); else console.log('Чат підключено'); };
    dc.onclose = () => { if (els.msg)  els.msg.disabled = true;  if (els.send) els.send.disabled = true;
      if (app.DEBUG_CHAT) logChat('Чат закрито', 'sys'); else console.log('Чат закрито'); };
  }

  // ---------- WS signaling ----------
  let ws; const outbox = [];
  function wsFlush(){ if(!outbox.length||!ws||ws.readyState!==1) return; while(outbox.length){ const m=outbox.shift(); try{ ws.send(JSON.stringify(m)); }catch{ break; } } }
  async function wsSend(obj){ if(!ws||ws.readyState!==1){ outbox.push(obj); try{ await app.wsReady; }catch{} } if(ws&&ws.readyState===1){ try{ ws.send(JSON.stringify(obj)); }catch{} } }

  let reconnectTimer = null;
  function connectWS(){
    clearTimeout(reconnectTimer);
    ws = new WebSocket(SIGNAL_URL);

    ws.addEventListener('open', () => {
      wsReadyResolve?.();
      wsSend({ type: 'join', room, from: myId });
      wsFlush();
      if (app.DEBUG_CHAT) logChat('Під’єднано до сигналінгу', 'sys'); else console.log('WS connected');
    });

    ws.addEventListener('message', async (e) => {
      let msg; try { msg = JSON.parse(e.data); } catch { return; }
      if (!msg || (msg.room && msg.room !== room)) return;
      if (msg.from && msg.from === myId) return;

      if (msg.type === 'offer') { if (app.DEBUG_CHAT) logChat('Отримав offer', 'sys'); await acceptOffer(new RTCSessionDescription(msg.payload)); return; }
      if (msg.type === 'answer'){ await acceptAnswer(new RTCSessionDescription(msg.payload)); return; }
      if (msg.type === 'ice')   { if (!msg.payload) return; try { await pc.addIceCandidate(msg.payload); } catch {} return; }

      // нове: співрозмовник приєднався/покинув
      if (msg.type === 'peer-join') {
        if (!app.polite) { // ми ініціатор
          if (pc.signalingState === 'stable') {
            if (app.DEBUG_CHAT) logChat('Peer join → надсилаю свіжий offer', 'sys'); else console.log('Peer join → send offer');
            await createAndSendOffer();
          }
        }
        setBadge('Співрозмовник приєднався — з’єднання встановлюється…', 'muted');
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
      if (app.DEBUG_CHAT) logChat('Сигналінг відключено', 'sys'); else console.log('WS closed');
      if (!isUnloading) { resetWsReady(); reconnectTimer = setTimeout(connectWS, 1500); }
    });
    ws.addEventListener('error', () => { try { ws.close(); } catch {} });
  }
  connectWS();

  // ---------- Debug stats (кожні 2с) → лише console ----------
  const statTimer = setInterval(async () => {
    try {
      const stats = await pc.getStats();
      let outV=null, inV=null, pair;
      stats.forEach(r => {
        if (r.type==='outbound-rtp' && r.kind==='video' && !r.isRemote) outV=r;
        if (r.type==='inbound-rtp'  && r.kind==='video' && !r.isRemote) inV=r;
        if (r.type==='candidate-pair' && r.selected) pair=r;
      });
      const rx = inV ? `↓ video: pkts=${inV.packetsReceived}` : '↓ video: n/a';
      const tx = outV ? `↑ video: pkts=${outV.packetsSent}`   : '↑ video: n/a';
      if (pair) {
        const lp = stats.get(pair.localCandidateId), rp = stats.get(pair.remoteCandidateId);
        console.log(`${tx} | ${rx} | ICE=${lp?.candidateType}/${lp?.protocol}⇄${rp?.candidateType}`);
      } else {
        console.log(`${tx} | ${rx}`);
      }
      if (els.remote && els.remote.srcObject && els.remote.readyState < 2) tryAutoplayRemote();
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

  // ---------- unload ----------
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
