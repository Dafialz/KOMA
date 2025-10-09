// /html/js/support-chat.js
// Уніфікована логіка WS-чату (служба підтримки)
// Працює і для користувача (role='user'), і для консультанта (role='consultant)
// Кімнати:
//  - "support:all"                 — глобальна для консультантів
//  - "support:consultant:<email>"  — особиста консультанта
//  - "support:thread:<id>"         — конкретний діалог (користувач↔консультант)

export class SupportChat {
  constructor({ role = 'user', wsUrl, consultantEmail = '', onEvent = () => {} } = {}) {
    this.role = role;
    this.consultantEmail = (consultantEmail || '').toLowerCase();
    this.onEvent = onEvent; // (ev, payload)

    // Дин. резолв WS
    this.wsUrl = wsUrl || this._autoWs();
    this.ws = null;
    this.rooms = new Set();

    // локальна історія (за threadId)
    this.LKEY = 'koma_support_history_v1';
    this.history = this._loadHistory();

    // черга на відправку до конекту
    this._outbox = [];

    // з’єднання
    this._connect();
  }

  _autoWs() {
    const explicit = window.CONFIG?.SIGNAL_URL || window.SIGNAL_URL;
    if (explicit) return explicit.replace(/^http/,'ws');
    const isHttps = location.protocol === 'https:';
    const scheme = isHttps ? 'wss' : 'ws';
    const host = location.host; // той самий домен (якщо фронт і бек разом)
    return `${scheme}://${host}`;
  }

  _loadHistory() {
    try { return JSON.parse(localStorage.getItem(this.LKEY) || '{}'); } catch { return {}; }
  }
  _saveHistory() {
    try { localStorage.setItem(this.LKEY, JSON.stringify(this.history)); } catch {}
  }

  _connect() {
    const url = this.wsUrl;
    const qs = '?rooms=' + encodeURIComponent(this._defaultRooms().join(','));
    this.ws = new WebSocket(url + qs);
    this.ws.addEventListener('open', () => {
      this.onEvent('status', { connected: true });
      // доєднатися до дефолтних кімнат явно (на всяк)
      this._defaultRooms().forEach(r => this.join(r));
      // відправити чергу
      this._outbox.splice(0).forEach(m => this._send(m));
    });
    this.ws.addEventListener('close', () => {
      this.onEvent('status', { connected: false });
      setTimeout(() => this._connect(), 1200); // автоперепідключення
    });
    this.ws.addEventListener('message', (e) => {
      let msg; try { msg = JSON.parse(e.data); } catch { return; }
      this._handle(msg);
    });
  }

  _defaultRooms() {
    const rooms = [];
    if (this.role === 'consultant') {
      rooms.push('support:all');
      if (this.consultantEmail) rooms.push(`support:consultant:${this.consultantEmail}`);
    }
    return rooms;
  }

  join(room) {
    if (this.rooms.has(room)) return;
    this.rooms.add(room);
    this._send({ type: 'join', room });
  }

  // Публічна API: приєднатись до thread
  joinThread(threadId) {
    if (!threadId) return;
    const r = `support:thread:${threadId}`;
    this.join(r);
  }

  // Збереження повідомлення в історію
  _keep(threadId, rec) {
    if (!threadId) return;
    if (!this.history[threadId]) this.history[threadId] = [];
    this.history[threadId].push(rec);
    // обрізка до 500 повід.
    if (this.history[threadId].length > 500) this.history[threadId].shift();
    this._saveHistory();
  }

  getThread(threadId) {
    return (this.history[threadId] || []).slice();
  }

  // Генератор id повідомлення
  _mid() {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  sendChat({ room, threadId, text, from, to = '', extras = {} }) {
    if (!text || !text.trim()) return;
    const mid = this._mid();
    const rec = {
      type: 'chat', room, threadId, text: text.trim(),
      from, to, role: this.role, ts: Date.now(), mid, ...extras
    };
    this._keep(threadId, { ...rec, self: true, delivered: false, read: false });
    this._send(rec);
    return mid;
  }

  markDelivered({ threadId, mid, room }) {
    this._send({ type: 'delivered', threadId, mid, room, from: this._senderId() });
  }
  markRead({ threadId, mid, room }) {
    this._send({ type: 'read', threadId, mid, room, from: this._senderId() });
  }

  _senderId() {
    if (this.role === 'consultant') return this.consultantEmail || 'consultant';
    // спроба підхопити гостьовий id
    const g = window.guard?.getGuest?.();
    return g?.id || 'guest';
  }

  _send(obj) {
    const s = JSON.stringify(obj);
    if (!this.ws || this.ws.readyState !== 1) {
      this._outbox.push(obj);
      return;
    }
    try { this.ws.send(s); } catch { this._outbox.push(obj); }
  }

  _handle(msg) {
    // події delivered/read — позначимо в історії
    if (msg.type === 'delivered' || msg.type === 'read') {
      const list = this.history[msg.threadId] || [];
      const it = list.find(x => x.mid === msg.mid);
      if (it) {
        if (msg.type === 'delivered') it.delivered = true;
        if (msg.type === 'read') it.read = true;
        this._saveHistory();
      }
      this.onEvent(msg.type, msg);
      return;
    }

    if (msg.type === 'chat') {
      // зберігаємо
      const self = (msg.role === this.role) && (msg.from === this._senderId());
      this._keep(msg.threadId, { ...msg, self });
      // авто-ACK delivered (якщо це вхідне)
      if (!self) {
        this.markDelivered({ threadId: msg.threadId, mid: msg.mid, room: msg.room });
      }
      this.onEvent('chat', msg);
      return;
    }

    // службові
    if (msg.type === 'join-ack' || msg.type === 'peer-join' || msg.type === 'peer-leave' || msg.type === 'full') {
      this.onEvent(msg.type, msg);
    }
  }
}
