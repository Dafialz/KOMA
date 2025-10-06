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
  function makeRoomIdFromQS(q) {
    const r = q.get('room');
    if (r) return decodeURIComponent(r);
    const consultant = (q.get('consultant') || '').trim();
    const date = (q.get('date') || '').trim();
    const time = (q.get('time') || '').trim();
    const raw = `${consultant}__${date}__${time}`.replace(/\s+/g, '');
    return raw || 'KOMA_room';
  }
  const room = makeRoomIdFromQS(qs);

  // ===== SIGNAL URL =====
  const scriptTag =
    document.currentScript ||
    Array.from(document.getElementsByTagName('script')).find(s =>
      (s.src || '').includes('video-config.js')
    );

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
  // Налаштовано під твій coturn на Fly.io:
  //  - відкрито 3478/udp і 3478/tcp
  //  - НЕ використовуємо 443/tcp, бо він не проброшений у fly.toml
  const TURN_HOST = '66.241.124.113';
  const TURN_PORT = '3478';
  const TURN_USER = 'myuser';
  const TURN_PASS = 'very-strong-pass';

  function firstUrl(u) {
    return Array.isArray(u) ? u[0] : u;
  }
  function sanitizeIce(list) {
    return (list || []).filter(s => {
      try {
        const u = firstUrl((s && s.urls) || '');
        const isTurn = /^turns?:/i.test(u);
        if (!isTurn) return true; // STUN без логіна — ок
        return !!(s.username && s.credential);
      } catch { return false; }
    });
  }

  const ICE_SERVERS = sanitizeIce([
    // STUN можна лишити — та з FORCE_RELAY нижче браузер все одно піде через TURN
    { urls: `stun:${TURN_HOST}:${TURN_PORT}` },
    { urls: `turn:${TURN_HOST}:${TURN_PORT}?transport=udp`, username: TURN_USER, credential: TURN_PASS },
    { urls: `turn:${TURN_HOST}:${TURN_PORT}?transport=tcp`, username: TURN_USER, credential: TURN_PASS },
    // ⚠️ Не вмикаємо 443/tcp — порт не відкритий у fly.toml
    // { urls: `turn:${TURN_HOST}:443?transport=tcp`, username: TURN_USER, credential: TURN_PASS },
  ]);

  // ===== Політика relay =====
  // За замовчуванням форсуємо relay; можна вимкнути query-параметром ?relay=0
  const FORCE_RELAY = (qs.get('relay') ?? '1') !== '0';
  const ICE_POLICY = FORCE_RELAY ? 'relay' : 'all';

  // Perfect Negotiation: консультант — impolite, клієнт — polite
  const polite = (role !== 'consultant');

  // ===== Елементи UI
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
    const info = `[init] room="${room}", role="${role}", relay=${ICE_POLICY}, signal=${SIGNAL_URL}`;
    console.log(info);
    console.log('window.videoApp = window.videoApp || {};');
    console.log('videoApp.ICE_SERVERS = ', ICE_SERVERS);
    console.log(`ICE policy=${ICE_POLICY}; servers=${ICE_SERVERS.length}`);
    if (!ICE_SERVERS.length) {
      console.warn('WARNING: ICE_SERVERS is empty — перевірте налаштування TURN/STUN.');
    }
    logChat(info, 'sys');
  } catch {}

  global.videoApp = {
    qs, UA_MOBILE, FORCE_RELAY, ICE_POLICY, room, polite, SIGNAL_URL, role,
    ICE_SERVERS,
    els,
    setBadge, logChat,
    pc: null, txAudio: null, txVideo: null, dc: null,
    startLocal: null, restartIce: null, bindDataChannel: null,
    wsSend: null, wsReady: null
  };
})(window);
