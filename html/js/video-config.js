// js/video-config.js
(function (global) {
  'use strict';

  // ---------- Параметри з URL ----------
  const qs   = new URLSearchParams(location.search);
  const role = (qs.get('role') || 'consultant').toLowerCase();           // consultant | client
  const room = (qs.get('room') || 'KOMA_demo').trim() || 'KOMA_demo';

  // relay: 1 = тільки TURN, 0 = дозволити host/srflx; за замовчуванням ТІЛЬКИ relay
  const relayParam  = (qs.get('relay') || '').toLowerCase();
  const FORCE_RELAY = (relayParam === '0' || relayParam === 'false') ? false : true;

  // proto: tcp|udp|auto (або both/all) — за замовчуванням TCP (краще проходить фаєрволи)
  const proto     = (qs.get('proto') || 'tcp').toLowerCase();
  const WANT_TCP  = ['tcp','both','all','auto'].includes(proto);
  const WANT_UDP  = ['udp','both','all','auto'].includes(proto);

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

  // ---------- Наш TURN на Fly.io ----------
  // Публічний IPv4 твого інстанса на Fly
  const TURN_HOST = '37.16.30.199';
  const TURN_PORT = 3478;
  const TURN_USER = 'myuser';
  const TURN_PASS = 'very-strong-pass';

  const ICE_SERVERS_RAW = [];

  // ТІЛЬКИ 3478 (без 443). Порядок: tcp -> udp
  if (WANT_TCP) {
    ICE_SERVERS_RAW.push(
      { urls: `turn:${TURN_HOST}:${TURN_PORT}?transport=tcp`, username: TURN_USER, credential: TURN_PASS },
    );
  }
  if (WANT_UDP) {
    ICE_SERVERS_RAW.push(
      { urls: `turn:${TURN_HOST}:${TURN_PORT}?transport=udp`, username: TURN_USER, credential: TURN_PASS },
    );
  }

  // Додатковий публічний fallback (увімкнути параметром ?fallback=1) — тільки для дебага
  if (qs.get('fallback') === '1') {
    ICE_SERVERS_RAW.push(
      { urls: 'turn:global.relay.metered.ca:80',  username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:global.relay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:global.relay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
    );
  }

  // Якщо все відфільтрували і масив пустий — підстрахуємось tcp:3478
  if (ICE_SERVERS_RAW.length === 0) {
    ICE_SERVERS_RAW.push({ urls: `turn:${TURN_HOST}:${TURN_PORT}?transport=tcp`, username: TURN_USER, credential: TURN_PASS });
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
    if (!els.chatlog) return;
    const wrap = document.createElement('div');
    wrap.className = 'msg ' + (who || 'sys');
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.innerHTML = String(text || '').replace(/[<>&]/g, s => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[s]));
    wrap.appendChild(bubble);
    els.chatlog.appendChild(wrap);
    els.chatlog.scrollTop = els.chatlog.scrollHeight;
  }

  // ---------- Експорт у глобальний app ----------
  const app = (global.videoApp = global.videoApp || {});
  app.qs          = qs;
  app.role        = role;
  app.room        = room;
  app.els         = els;
  app.setBadge    = setBadge;
  app.logChat     = logChat;
  app.SIGNAL_URL  = SIGNAL_URL;
  app.FORCE_RELAY = FORCE_RELAY;             // true => iceTransportPolicy:'relay'
  app.UA_MOBILE   = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  app.PROTO       = proto;                   // зручно бачити у логах/в UI
  app.polite      = (role === 'client');     // клієнт приймає чужий offer; консультант ініціює

  // Фінальний список ICE-серверів
  app.ICE_SERVERS = ICE_SERVERS_RAW.slice();

  // Дебаг у консоль
  console.log('[init] room="%s", role="%s", relay=%s, proto=%s, signal=%s',
    room, role, FORCE_RELAY ? 'relay' : 'all', proto, SIGNAL_URL);
  console.log('videoApp.ICE_SERVERS (final) = ', app.ICE_SERVERS);
  console.log('servers=' + app.ICE_SERVERS.length);

})(window);
