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
  // на випадок, якщо currentScript недоступний
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
  // Параметри: ?turn=host[:port]&tu=user&tp=pass&proto=udp|tcp
  // Якщо proto=udp -> додаються STUN і TURN/UDP; інакше лише TURN/TCP:443
  const TURN_HOST = '66.241.124.113';
  const TURN_PORT = '3478';
  // дефолтні креденшли (можна перевизначити через query або global.KOMA_ICE_SERVERS)
  const TURN_USER = 'myuser';
  const TURN_PASS = 'very-strong-pass';

  function sanitizeIce(list) {
    // видаляємо TURN без username/credential, щоб не ловити InvalidAccessError
    return (list || []).filter(s => {
      try {
        const u = (s && s.urls) || '';
        const isTurn = /^turns?:/i.test(u);
        if (!isTurn) return true;
        return !!(s.username && s.credential);
      } catch { return false; }
    });
  }

  function parseIceFromQS() {
    const short = (qs.get('turn') || '').trim();               // host[:port]
    const host = (qs.get('turnHost') || '').trim() || (short.split(':')[0] || '');
    const port = (qs.get('turnPort') || '').trim() || (short.includes(':') ? short.split(':')[1] : '');
    const user = (qs.get('turnUser') || qs.get('tu') || '').trim();
    const pass = (qs.get('turnPass') || qs.get('tp') || '').trim();
    const wantUDP = (qs.get('proto') || '').toLowerCase() === 'udp';

    if (!host) return null;

    const thePort = port || (wantUDP ? TURN_PORT : '443');
    const creds = (user && pass) ? { username: user, credential: pass } : null;

    const arr = [];
    if (wantUDP) {
      arr.push({ urls: `stun:${host}:${thePort}` });
      arr.push(Object.assign({ urls: `turn:${host}:${thePort}?transport=udp` }, creds || {}));
      // дублюємо TCP 443 як fall-back
      arr.push(Object.assign({ urls: `turn:${host}:443?transport=tcp` }, creds || {}));
    } else {
      arr.push(Object.assign({ urls: `turn:${host}:443?transport=tcp` }, creds || {}));
    }
    return sanitizeIce(arr);
  }

  function defaultIce() {
    const wantUDP = (qs.get('proto') || '').toLowerCase() === 'udp';
    if (wantUDP) {
      return sanitizeIce([
        { urls: `stun:${TURN_HOST}:${TURN_PORT}` },
        { urls: `turn:${TURN_HOST}:${TURN_PORT}?transport=udp`, username: TURN_USER, credential: TURN_PASS },
        { urls: `turn:${TURN_HOST}:443?transport=tcp`, username: TURN_USER, credential: TURN_PASS },
      ]);
    }
    return sanitizeIce([
      { urls: `turn:${TURN_HOST}:443?transport=tcp`, username: TURN_USER, credential: TURN_PASS },
    ]);
  }

  // Побудова ICE
  let ICE_SERVERS = [];
  const QS_ICE = parseIceFromQS();
  if (QS_ICE && QS_ICE.length) {
    ICE_SERVERS = QS_ICE;
  } else {
    ICE_SERVERS = defaultIce();
  }

  // Перевизначення через глобальну змінну (якщо задано вручну)
  if (Array.isArray(global.KOMA_ICE_SERVERS) && global.KOMA_ICE_SERVERS.length) {
    ICE_SERVERS = sanitizeIce(global.KOMA_ICE_SERVERS.slice());
  }

  // ===== Політика relay =====
  // true/1/'' -> relay; false/0/false -> all
  const relayParam = (qs.get('relay') || '').toLowerCase();
  const FORCE_RELAY = relayParam === '' ? true : !(relayParam === '0' || relayParam === 'false');
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
    const info = `[init] room="${room}", role="${role}", relay=${FORCE_RELAY ? 'on' : 'off'}, signal=${SIGNAL_URL}`;
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
