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
  // Підтримка налаштування через URL:
  // ?turn=IP_OR_HOST:PORT&tu=user&tp=pass або
  // ?turnHost=...&turnPort=3478&turnUser=...&turnPass=...
  function parseIceFromQS() {
    const short = (qs.get('turn') || '').trim();
    const host = (qs.get('turnHost') || '').trim() || (short.split(':')[0] || '');
    const port = (qs.get('turnPort') || '').trim() || (short.includes(':') ? short.split(':')[1] : '3478');
    const user = (qs.get('turnUser') || qs.get('tu') || '').trim();
    const pass = (qs.get('turnPass') || qs.get('tp') || '').trim();
    if (!host) return null;

    const creds = (user && pass) ? { username: user, credential: pass } : null;
    // ЛИШЕ TURN/UDP (без STUN і без TCP)
    return [
      Object.assign({ urls: `turn:${host}:${port}?transport=udp` }, creds || {}),
    ];
  }

  // ► Твій публічний Coturn (ЛИШЕ UDP)
  const PUB_TURN_HOST = '91.218.235.75';
  const PUB_TURN_PORT = '3478';
  const SELF_ICE = [
    { urls: `turn:${PUB_TURN_HOST}:${PUB_TURN_PORT}?transport=udp`, username: 'test', credential: 'test123' },
  ];

  // ► Безкоштовний публічний TURN (Metered) — тільки для тестів/фолбеку
  // Перевага: працює “просто зараз”.
  // Недолік: обмеження швидкості/стабільності — не для продакшену.
  const METERED_ICE = [
    { urls: 'turn:global.relay.metered.ca:80',  username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:global.relay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:global.relay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
  ];

  // Перемикач джерела ICE через URL:
  // ?use=self     → тільки твій Coturn
  // ?use=public   → тільки Metered
  // (за замовчуванням: спочатку Metered, потім твій Coturn)
  const use = (qs.get('use') || '').toLowerCase();

  let ICE_SERVERS = [];
  if (Array.isArray(global.KOMA_ICE_SERVERS) && global.KOMA_ICE_SERVERS.length) {
    ICE_SERVERS = global.KOMA_ICE_SERVERS.slice();
  } else {
    const fromQS = parseIceFromQS(); // явне вказання через URL має найвищий пріоритет
    if (fromQS && fromQS.length) {
      ICE_SERVERS = fromQS;
    } else if (use === 'self') {
      ICE_SERVERS = SELF_ICE.slice();
    } else if (use === 'public') {
      ICE_SERVERS = METERED_ICE.slice();
    } else {
      // За замовчуванням: метчимо "щоб працювало зараз" → публічний TURN першим, потім свій
      ICE_SERVERS = METERED_ICE.concat(SELF_ICE);
    }
  }

  // ===== Relay policy =====
  // За замовчуванням форсимо relay (TURN). Можна вимкнути через ?relay=0
  const FORCE_RELAY = qs.get('relay') === '0' ? false : true;

  // ===== Perfect Negotiation =====
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

  try {
    const info = `[init] room="${room}", role="${role}", relay=${FORCE_RELAY ? 'on' : 'off'}, signal=${SIGNAL_URL}`;
    console.log(info);
    console.log('window.videoApp = window.videoApp || {};');
    console.log('videoApp.ICE_SERVERS = ', ICE_SERVERS);
    console.log(`ICE policy=${FORCE_RELAY ? 'relay' : 'all'}; servers=${ICE_SERVERS.length}`);
    logChat(info, 'sys');
  } catch {}

  global.videoApp = {
    qs, UA_MOBILE, FORCE_RELAY, room, polite, SIGNAL_URL, role,
    ICE_SERVERS,
    els,
    setBadge, logChat,
    pc: null, txAudio: null, txVideo: null, dc: null,
    startLocal: null, restartIce: null, bindDataChannel: null,
    wsSend: null, wsReady: null
  };
})(window);
