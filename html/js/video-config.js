// js/video-config.js
(function (global) {
  'use strict';

  const qs = new URLSearchParams(location.search);
  const UA_MOBILE = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  // ===== РОЛЬ (consultant | client) =====
  function detectRole() {
    const fromQS = (qs.get('role') || '').toLowerCase();
    if (fromQS === 'consultant' || fromQS === 'client') return fromQS;
    try {
      const raw = localStorage.getItem('koma_session');
      if (raw) {
        const s = JSON.parse(raw);
        if (s && s.email) return 'consultant';
      }
    } catch {}
    return 'client';
  }
  const role = detectRole();

  // ===== КІМНАТА =====
  function makeRoomIdFromQS(qs) {
    const r = qs.get('room');
    if (r) return decodeURIComponent(r);
    const consultant = (qs.get('consultant') || '').trim();
    const date = (qs.get('date') || '').trim();
    const time = (qs.get('time') || '').trim();
    const raw = `${consultant}__${date}__${time}`.replace(/\s+/g, '');
    return raw || 'KOMA_room';
  }
  const room = makeRoomIdFromQS(qs);

  // ===== SIGNAL URL =====
  const scriptTag = document.currentScript;
  const DATA_SIGNAL = scriptTag && scriptTag.dataset ? scriptTag.dataset.signal : '';
  const RENDER_WSS = 'wss://koma-uaue.onrender.com';

  let SIGNAL_URL = '';
  if (typeof window.KOMA_SIGNAL_URL === 'string' && window.KOMA_SIGNAL_URL.trim()) {
    SIGNAL_URL = window.KOMA_SIGNAL_URL.trim();
  } else if (DATA_SIGNAL) {
    SIGNAL_URL = DATA_SIGNAL.trim();
  } else if (location.hostname === 'localhost') {
    SIGNAL_URL = 'ws://localhost:3000';
  } else {
    SIGNAL_URL = RENDER_WSS;
  }

  // ===== TURN / ICE servers =====
  // Пріоритет джерел:
  // 1) window.KOMA_ICE_SERVERS  (масив як у RTCPeerConnection)
  // 2) Параметри URL:
  //    ?turnHost=IP_OR_HOST&turnPort=3478&turnUser=test&turnPass=test123
  //    або компактно: ?turn=IP_OR_HOST:3478&tu=test&tp=test123
  // 3) Дефолт: твій публічний TURN (udp/tcp) + резервний openrelay
  function parseIceFromQS() {
    const short = (qs.get('turn') || '').trim();       // напр. "91.218.235.75:3478"
    const host = (qs.get('turnHost') || '').trim() || (short.split(':')[0] || '');
    const port = (qs.get('turnPort') || '').trim() || (short.includes(':') ? short.split(':')[1] : '3478');
    const user = (qs.get('turnUser') || qs.get('tu') || '').trim();
    const pass = (qs.get('turnPass') || qs.get('tp') || '').trim();
    if (!host) return null;

    const creds = (user && pass) ? { username: user, credential: pass } : null;
    const arr = [];
    // UDP
    arr.push(Object.assign({ urls: `turn:${host}:${port}?transport=udp` }, creds || {}));
    // TCP
    arr.push(Object.assign({ urls: `turn:${host}:${port}?transport=tcp` }, creds || {}));
    return arr;
  }

  // ► ДЕФОЛТНИЙ ПУБЛІЧНИЙ TURN (твій Coturn на білому IP)
  const PUB_TURN_HOST = '91.218.235.75';
  const PUB_TURN_PORT = '3478';
  const DEFAULT_PUBLIC_SELF = [
    { urls: `turn:${PUB_TURN_HOST}:${PUB_TURN_PORT}?transport=udp`, username: 'test', credential: 'test123' },
    { urls: `turn:${PUB_TURN_HOST}:${PUB_TURN_PORT}?transport=tcp`, username: 'test', credential: 'test123' },
  ];

  // Резервний публічний (може бути нестабільним; використовується лише як фолбек)
  const DEFAULT_OPEN_RELAY = [
    { urls: 'turn:global.relay.metered.ca:80',                username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:global.relay.metered.ca:443',               username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:global.relay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
  ];

  let ICE_SERVERS = [];
  if (Array.isArray(global.KOMA_ICE_SERVERS) && global.KOMA_ICE_SERVERS.length) {
    ICE_SERVERS = global.KOMA_ICE_SERVERS.slice();
  } else {
    const fromQS = parseIceFromQS();
    if (fromQS && fromQS.length) {
      ICE_SERVERS = fromQS;
    } else {
      ICE_SERVERS = [...DEFAULT_PUBLIC_SELF, ...DEFAULT_OPEN_RELAY];
    }
  }

  // ===== Relay policy =====
  // За замовчуванням ВМИКАЄМО relay (TURN) — для мобільних/CGNAT. Можна вимкнути через ?relay=0
  const FORCE_RELAY = qs.get('relay') === '0' ? false : true;

  // ===== Perfect Negotiation =====
  // Ініціатором робимо консультанта: polite = false (ініціатор), client = true (слухає).
  const polite = (role !== 'consultant');

  // ===== Елементи
  const els = {
    local: document.getElementById('local'),
    remote: document.getElementById('remote'),
    start: document.getElementById('btnStart'),
    mic: document.getElementById('btnMic'),
    cam: document.getElementById('btnCam'),
    screen: document.getElementById('btnScreen'),
    fullRemote: document.getElementById('btnFullRemote'),
    fullLocal: document.getElementById('btnFullLocal'),
    status: document.getElementById('status'),
    chatlog: document.getElementById('chatlog'),
    msg: document.getElementById('msg'),
    send: document.getElementById('send'),
    hint: document.getElementById('hint'),
    unmute: document.getElementById('btnUnmute'),
    vwrap: document.getElementById('videoWrap'),
    roomLabel: document.getElementById('roomLabel'),
    roleLabel: document.getElementById('roleLabel'),
    inviteNote: document.getElementById('inviteNote'),
  };

  // Підписи кімнати і ролі
  if (els.roomLabel) els.roomLabel.textContent = `Кімната: ${room}`;
  if (els.roleLabel) els.roleLabel.textContent = `Роль: ${role === 'consultant' ? 'консультант' : 'учасник'}`;

  function setBadge(text, cls) {
    if (!els.status) return;
    els.status.textContent = text;
    els.status.className = 'badge ' + (cls || '');
  }

  function logChat(text, who = 'sys') {
    if (!els.chatlog) return;
    const item = document.createElement('div');
    if (who === 'me') item.className = 'msg me';
    else if (who === 'peer') item.className = 'msg peer';
    else item.className = 'msg sys';

    if (who === 'sys') {
      item.textContent = text;
    } else {
      const bubble = document.createElement('div');
      bubble.className = 'bubble';
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = who === 'me' ? 'Я' : 'Співрозмовник';
      const span = document.createElement('span');
      span.textContent = text;
      bubble.appendChild(name);
      bubble.appendChild(span);
      item.appendChild(bubble);
    }
    els.chatlog.appendChild(item);
    els.chatlog.scrollTop = els.chatlog.scrollHeight;
  }

  // ── Діагностика в консоль / чат
  try {
    const info = `[init] room="${room}", role="${role}", relay=${FORCE_RELAY ? 'on' : 'off'}, signal=${SIGNAL_URL}`;
    console.log(info);
    console.log('window.videoApp = window.videoApp || {};');
    console.log('videoApp.ICE_SERVERS = ', ICE_SERVERS);
    logChat(info, 'sys');
  } catch {}

  // Експорт у глобал (використовує video-webrtc.js)
  global.videoApp = {
    // конфіг
    qs, UA_MOBILE, FORCE_RELAY, room, polite, SIGNAL_URL, role,
    ICE_SERVERS,
    // DOM
    els,
    // утиліти
    setBadge, logChat,
    // “місця” для інш. модулів
    pc: null, txAudio: null, txVideo: null, dc: null,
    startLocal: null, restartIce: null, bindDataChannel: null,
    wsSend: null, wsReady: null
  };
})(window);
