// js/video-config.js
(function (global) {
  'use strict';

  // ---------- Параметри з URL ----------
  const qs = new URLSearchParams(location.search);

  // Роль: consultant | client
  const role = (qs.get('role') || 'consultant').toLowerCase();

  // Нормалізація рядка під room (лише [a-z0-9:_-], до 64 симв.)
  function slugRoom(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9:_-]+/g, '-')
      .slice(0, 64) || 'room';
  }

  // Витягуємо кімнату:
  // 1) ?room=...       — пріоритет
  // 2) ?consultant=... — зручний синонім (людське ім’я/нік)
  // 3) ?consultantEmail=... або ?c=... — перетворимо в slug
  // Якщо нічого немає — залишимо "KOMA_demo"
  let room =
    qs.get('room')
    || (qs.get('consultant') && `consultant:${qs.get('consultant')}`)
    || (qs.get('consultantEmail') && `consultant:${qs.get('consultantEmail')}`)
    || (qs.get('c') && `consultant:${qs.get('c')}`)
    || 'KOMA_demo';

  room = slugRoom(room);

  // relay: 1 = тільки TURN, 0/false = дозволити host/srflx; за замовчуванням ТІЛЬКИ relay
  const relayParam  = (qs.get('relay') || '').toLowerCase();
  const FORCE_RELAY = (relayParam === '0' || relayParam === 'false') ? false : true;

  // proto: tcp|udp|auto (both/all) — за замовчуванням AUTO (і tcp, і udp)
  const proto     = (qs.get('proto') || 'auto').toLowerCase();
  const WANT_TCP  = ['tcp','both','all','auto'].includes(proto);
  const WANT_UDP  = ['udp','both','all','auto'].includes(proto);

  // Прапорець: показувати системні логи в чаті (за замовчуванням — НІ)
  const DEBUG_CHAT = qs.get('debug') === '1';

  // ---------- Сигналінг ----------
  const scriptTag =
    document.currentScript ||
    Array.from(document.getElementsByTagName('script')).find(s => /video-config\.js/.test(s.src));
  let SIGNAL_URL = (scriptTag && scriptTag.dataset && scriptTag.dataset.signal) || '';
  if (!SIGNAL_URL) {
    SIGNAL_URL = (location.hostname === 'localhost')
      ? 'ws://localhost:3000'
      : 'wss://koma-uaue.onrender.com';
  }

  // ---------- Наш TURN (кастомний + опц. фолбек) ----------
  const TURN_HOST = '37.16.30.199';
  const TURN_PORT = 3478;
  const TURN_USER = 'myuser';
  const TURN_PASS = 'very-strong-pass';

  const ICE_SERVERS_RAW = [];
  if (WANT_TCP) {
    ICE_SERVERS_RAW.push(
      { urls: `turn:${TURN_HOST}:443?transport=tcp`,  username: TURN_USER, credential: TURN_PASS },
      { urls: `turn:${TURN_HOST}:${TURN_PORT}?transport=tcp`, username: TURN_USER, credential: TURN_PASS },
    );
  }
  if (WANT_UDP) {
    ICE_SERVERS_RAW.push(
      { urls: `turn:${TURN_HOST}:${TURN_PORT}?transport=udp`, username: TURN_USER, credential: TURN_PASS },
    );
  }
  if (qs.get('fallback') === '1') {
    ICE_SERVERS_RAW.push(
      { urls: 'turn:global.relay.metered.ca:80',  username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:global.relay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:global.relay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
    );
  }
  if (ICE_SERVERS_RAW.length === 0) {
    ICE_SERVERS_RAW.push({ urls: `turn:${TURN_HOST}:443?transport=tcp`, username: TURN_USER, credential: TURN_PASS });
  }

  // ---------- Елементи інтерфейсу ----------
  const $ = (id) => document.getElementById(id);
  const els = {
    start: $('btnStart'),
    mic: $('btnMic'),
    cam: $('btnCam'),
    screen: $('btnScreen'),
    fullRemote: $('btnFullRemote'),
    fullLocal: $('btnFullLocal'),

    vwrap: $('videoWrap'),
    remote: $('remote'),
    local:  $('local'),
    unmute: $('btnUnmute'),

    status: $('status'),
    roomLabel: $('roomLabel'),
    roleLabel: $('roleLabel'),

    chatlog: $('chatlog'),
    msg: $('msg'),
    send: $('send'),
    hint: $('hint'),
    inviteNote: $('inviteNote'),
  };

  if (els.roomLabel) els.roomLabel.textContent = 'Кімната: ' + room;
  if (els.roleLabel) els.roleLabel.textContent = 'Роль: ' + (role === 'consultant' ? 'консультант' : 'учасник');

  // ---------- Утиліти для UI ----------
  function setBadge(text, type) {
    if (!els.status) return;
    els.status.textContent = text;
    els.status.classList.remove('muted','ok','danger');
    if (type) els.status.classList.add(type);
  }

  function logChat(text, who) {
    // Системні повідомлення — тільки в console, якщо DEBUG_CHAT не увімкнено
    if (who === 'sys' && !DEBUG_CHAT) {
      try { console.log(text); } catch {}
      return;
    }
    if (!els.chatlog) return;
    const wrap = document.createElement('div');
    wrap.className = 'msg ' + (who || 'peer');
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.innerHTML = String(text || '').replace(/[<>&]/g, s => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[s]));
    wrap.appendChild(bubble);
    els.chatlog.appendChild(wrap);
    els.chatlog.scrollTop = els.chatlog.scrollHeight;
  }

  // Зручний генератор інвайт-лінків (використовується у video-ui.js)
  function makeInviteLink(targetRole) {
    const u = new URL(location.href);
    u.searchParams.set('room', room);
    u.searchParams.set('role', String(targetRole || (role === 'consultant' ? 'client' : 'consultant')));
    // Для клієнта корисно автозапуск
    if ((targetRole || '').toLowerCase() === 'client') u.searchParams.set('autostart','1');
    return u.toString();
  }

  // ---------- Експорт ----------
  const app = (global.videoApp = global.videoApp || {});
  app.qs          = qs;
  app.role        = role;
  app.room        = room;
  app.makeInvite  = makeInviteLink;

  app.els         = els;
  app.setBadge    = setBadge;
  app.logChat     = logChat;

  app.SIGNAL_URL  = SIGNAL_URL;
  app.FORCE_RELAY = FORCE_RELAY;
  app.UA_MOBILE   = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  app.PROTO       = proto;
  app.polite      = (role === 'client');      // клієнт — "polite"
  app.DEBUG_CHAT  = DEBUG_CHAT;

  app.ICE_SERVERS = ICE_SERVERS_RAW.slice();

  console.log('[init] room="%s", role="%s", relay=%s, proto=%s, signal=%s',
    room, role, FORCE_RELAY ? 'relay' : 'all', proto, SIGNAL_URL);
  console.log('videoApp.ICE_SERVERS (final) = ', app.ICE_SERVERS);
  console.log('servers=' + app.ICE_SERVERS.length);
})(window);
