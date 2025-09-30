// js/video-config.js
(function (global) {
  'use strict';

  const qs = new URLSearchParams(location.search);
  const UA_MOBILE = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  // Форсимо TURN на мобільних (якщо явно не relay=0) або коли relay=1
  const FORCE_RELAY = qs.get('relay') === '1' || (UA_MOBILE && qs.get('relay') !== '0');

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
  const polite = true;

  // SIGNAL URL
  const RENDER_WSS = 'wss://koma-uaue.onrender.com';
  const SIGNAL_URL = (location.hostname === 'localhost') ? 'ws://localhost:3000' : RENDER_WSS;

  // Елементи
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
  };

  // Підписи кімнати і ролі
  if (els.roomLabel) els.roomLabel.textContent = `Кімната: ${room}`;
  if (els.roleLabel) els.roleLabel.textContent = 'Роль: учасник';

  function setBadge(text, cls) {
    if (!els.status) return;
    els.status.textContent = text;
    els.status.className = 'badge ' + (cls || '');
  }

  // Акуратний рендер повідомлень у чаті
  function logChat(text, who = 'sys') {
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

  // Експорт у глобал
  global.videoApp = {
    // конфіг
    qs, UA_MOBILE, FORCE_RELAY, room, polite, SIGNAL_URL,
    // DOM
    els,
    // утиліти
    setBadge, logChat,
    // місця під об’єкти/функції з інших модулів:
    pc: null, txAudio: null, txVideo: null, dc: null,
    startLocal: null, restartIce: null, bindDataChannel: null,
    wsSend: null, wsReady: null
  };
})(window);
