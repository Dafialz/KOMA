// js/zapis.js
// ===== Helpers
const $ = (s)=>document.querySelector(s);

// Київський час — сервісні форматери
const KYIV_TZ = 'Europe/Kyiv';
const dtFmtKyiv = new Intl.DateTimeFormat('uk-UA', {
  timeZone: KYIV_TZ, weekday:'long', year:'numeric', month:'long', day:'numeric'
});
const tmFmtKyiv = new Intl.DateTimeFormat('uk-UA', {
  timeZone: KYIV_TZ, hour:'2-digit', minute:'2-digit'
});

// Отримати часовий зсув з UTC для конкретного моменту (ms)
function getZoneOffsetMs(zone, utcDate){
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hour12:false, year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', second:'2-digit'
  }).formatToParts(utcDate).reduce((a,p)=>{a[p.type]=p.value; return a;}, {});
  const zonedAsUTCms = Date.UTC(parts.year, parts.month-1, parts.day, parts.hour, parts.minute, parts.second);
  return zonedAsUTCms - utcDate.getTime();
}
// Побудувати UTC-дату з полів Київського часу
function makeUtcFromKyiv(y,m,d,H,M){
  const guessUTC = new Date(Date.UTC(y, m-1, d, H, M, 0, 0));
  const offset = getZoneOffsetMs(KYIV_TZ, guessUTC);
  return new Date(guessUTC.getTime() - offset);
}

// ----- Read URL params
const q = new URLSearchParams(location.search);
const params = {
  consultant: q.get('consultant') || 'Консультант',
  fullName: q.get('fullName') || 'Клієнт',
  email:    q.get('email') || '',
  date:     q.get('date'),
  time:     q.get('time'),
  notes:    q.get('notes') || '',
  role:     q.get('role') || 'client'    // client | consultant
};

// Мапа ім'я → email (для бекенда)
const nameToEmail = {
  'Оксана Кокотень': 'oksanakokoten@gmail.com',
  'Андрій Савчук': 'andriysavchuk@gmail.com',
  'Ірина Шевченко': 'irynashevchenko@gmail.com',
  'Максим Коваль': 'maksymkoval@gmail.com',
  'Надія Романюк': 'nadiyaromaniyk@gmail.com',
  'Олег Литвин':   'oleglitvin@gmail.com'
};
const consultantEmail = nameToEmail[params.consultant] || '';

// ----- Render basic info
$('#consultant').textContent = params.consultant;
$('#client').textContent = params.fullName + (params.email ? ` • ${params.email}` : '');
$('#notes').textContent = params.notes || '—';
$('#title').textContent = `Запис до: ${params.consultant}`;
$('#whoAmI').textContent = params.role;

// ----- Compose UTC moment from Kyiv local date/time
const [yy,mm,dd] = params.date ? params.date.split('-').map(n=>+n) : [NaN,NaN,NaN];
const [HH,MM]    = params.time ? params.time.split(':').map(n=>+n) : [NaN,NaN];
const startUTC   = makeUtcFromKyiv(yy, mm, dd, HH, MM);

// ----- Show datetime (Kyiv)
$('#dtText').textContent = `${dtFmtKyiv.format(startUTC)}, ${tmFmtKyiv.format(startUTC)}`;
$('#tzText').textContent = `Часовий пояс: ${KYIV_TZ}`;

// ===== ВАЖЛИВО: однакова кімната — ІМ'Я КОНСУЛЬТАНТА
const roomId = encodeURIComponent(params.consultant);
const meetingUrl = `/video.html?room=${roomId}`;
const videoBtn = $('#videoBtn');
videoBtn.href = meetingUrl;
videoBtn.setAttribute('aria-disabled','true');
$('#roomBadge').textContent = `Кімната: ${params.consultant}`;

// ----- Google Calendar link (UTC інтервал)
const pad = (n)=>String(n).padStart(2,'0');
const toUTC = (d)=>`${d.getUTCFullYear()}${pad(d.getUTCMonth()+1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
const endUTC = new Date(startUTC.getTime() + 60*60*1000); // 1h duration
const text = encodeURIComponent(`Сесія з консультантом: ${params.consultant}`);
const meetAbs = `${location.origin}/video.html?room=${roomId}`;
const details = encodeURIComponent(`Клієнт: ${params.fullName}${params.email? ' ('+params.email+')':''}\nПосилання на відеочат: ${meetAbs}`);
const locationStr = encodeURIComponent('Онлайн (КОМА відеочат)');
$('#gcalBtn').href = `https://calendar.google.com/calendar/u/0/r/eventedit?text=${text}&dates=${toUTC(startUTC)}/${toUTC(endUTC)}&details=${details}&location=${locationStr}`;

// ----- Schedule logic. Кнопка активна: -10 хв .. +1 год від старту
const statusTag = $('#statusTag');
const countdown = $('#countdown');
const OPEN_BEFORE_MIN = 10;
const OPEN_AFTER_MIN  = 60;
const openFromUTC = new Date(startUTC.getTime() - OPEN_BEFORE_MIN*60*1000);
const openTillUTC = new Date(startUTC.getTime() + OPEN_AFTER_MIN*60*1000);

function tick(){
  const nowUTC = new Date();
  if(nowUTC < openFromUTC){
    const ms = openFromUTC - nowUTC;
    countdown.textContent = fmtDuration(ms);
    setStatus('Очікування','tag');
    setVideoDisabled(true);
  }else if(nowUTC <= openTillUTC){
    countdown.textContent = 'Доступно зараз';
    setStatus('Онлайн','tag ok');
    setVideoDisabled(false);
  }else{
    countdown.textContent = 'Час зустрічі минув';
    setStatus('Завершено','tag danger');
    setVideoDisabled(true);
  }
}
function setStatus(text, cls){ statusTag.textContent=text; statusTag.className=cls; }
function setVideoDisabled(disabled){
  if(disabled){ videoBtn.setAttribute('aria-disabled','true'); }
  else { videoBtn.removeAttribute('aria-disabled'); }
}
function fmtDuration(ms){
  const s = Math.max(0, Math.floor(ms/1000));
  const h = Math.floor(s/3600);
  const m = Math.floor((s%3600)/60);
  const sec = s%60;
  const p = (n)=>String(n).padStart(2,'0');
  return `${p(h)}:${p(m)}:${p(sec)}`;
}
tick(); setInterval(tick, 1000);

// ====== АВТО-СТВОРЕННЯ БРОНЮВАННЯ на бекенді + збереження для хедера «Приєднатись»
const API_BASE = location.hostname.endsWith('netlify.app')
  ? 'https://koma-uaue.onrender.com'
  : location.origin;

(async function postBooking(){
  if(!params.date || !params.time || !consultantEmail) return;
  const key = `koma_posted_${consultantEmail}_${params.date}_${params.time}_${params.email||''}`;
  if(localStorage.getItem(key)) return;

  try{
    const body = {
      consultantEmail,
      consultantName: params.consultant,
      fullName: params.fullName,
      email: params.email || '',
      date: params.date,
      time: params.time,
      note: params.notes || ''
    };
    const r = await fetch(`${API_BASE}/api/bookings`, {
      method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)
    });
    const data = await r.json();
    if(data && data.ok){
      localStorage.setItem(key, data.id || '1');
      $('#subtitle').textContent = 'Ваш запис збережено. Очікуємо на зустріч у призначений час.';
      setStatus('Підтверджено','tag ok');
    }
  }catch{}
})();

// ЗБЕРЕЖЕМО «останній бронь» для кнопки Приєднатись у хедері
(function saveLastBooking(){
  if(!params.date || !params.time) return;
  const rec = {
    consultant: params.consultant,
    fullName: params.fullName,
    email: params.email || '',
    date: params.date,
    time: params.time,
    startTS: Date.parse(`${params.date}T${params.time}:00+03:00`)
  };
  localStorage.setItem('koma_last_booking', JSON.stringify(rec));
  // тригер для інших вкладок (щоб header оновився)
  window.dispatchEvent(new StorageEvent('storage', { key: 'koma_last_booking' }));
})();

// ===== CHAT (localStorage sync per room)
const CHAT_KEY = `koma_chat_${params.consultant}`;
const msgsEl   = $('#msgs');
const inputEl  = $('#msgInput');
const sendBtn  = $('#sendBtn');
const newBar   = $('#newBar');
const unreadEl = $('#unread');
const unreadCountEl = $('#unreadCount');

let messages = loadChat();
render(true);

function send(){
  const text = inputEl.value.trim();
  if(!text) return;
  const msg = {
    id: crypto.randomUUID ? crypto.randomUUID() : (Date.now()+"-"+Math.random()),
    role: params.role,
    name: params.role === 'consultant' ? params.consultant : (params.fullName || 'Клієнт'),
    text,
    ts: Date.now()
  };
  messages.push(msg);
  saveChat(messages);
  inputEl.value = '';
  autoGrow();
  render(true);
}

sendBtn.addEventListener('click', send);
inputEl.addEventListener('keydown', (e)=>{
  if(e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); send(); }
});

// autosize textarea
function autoGrow(){
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 140) + 'px';
}
inputEl.addEventListener('input', autoGrow); autoGrow();

// storage sync
window.addEventListener('storage', (ev)=>{
  if(ev.key === CHAT_KEY){
    messages = loadChat();
    const atBottom = isAtBottom();
    render(atBottom ? false : null);
  }
});

// scroll helpers
function isAtBottom(){
  return Math.abs(msgsEl.scrollHeight - msgsEl.scrollTop - msgsEl.clientHeight) < 60;
}
function scrollToBottom(){
  msgsEl.scrollTop = msgsEl.scrollHeight;
  newBar.style.display = 'none';
  unreadEl.style.display = 'none';
  unreadCountEl.textContent = '0';
}
msgsEl.addEventListener('scroll', ()=>{
  if(isAtBottom()){
    newBar.style.display = 'none';
    unreadEl.style.display = 'none';
    unreadCountEl.textContent = '0';
  }
});
newBar.addEventListener('click', scrollToBottom);

// render chat
function render(forceScroll){
  msgsEl.innerHTML = '';
  let lastDate = '';
  messages.forEach(m=>{
    const d = new Date(m.ts);
    const day = d.toLocaleDateString('uk-UA');
    if(day !== lastDate){
      const sep = document.createElement('div');
      sep.className = 'muted';
      sep.style.textAlign = 'center';
      sep.style.margin = '6px 0';
      sep.textContent = day;
      msgsEl.appendChild(sep);
      lastDate = day;
    }
    const wrap = document.createElement('div');
    wrap.style.display = 'flex';
    wrap.style.flexDirection = 'column';
    wrap.style.alignItems = m.role === params.role ? 'flex-end' : 'flex-start';

    const bubble = document.createElement('div');
    bubble.className = `msg ${m.role === params.role ? 'me' : 'them'}`;
    bubble.innerText = m.text;

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.style.textAlign = m.role === params.role ? 'right' : 'left';
    meta.textContent = `${m.name || m.role} • ${d.toLocaleTimeString('uk-UA', {hour:'2-digit', minute:'2-digit'})}`;

    wrap.appendChild(bubble);
    wrap.appendChild(meta);
    msgsEl.appendChild(wrap);
  });

  if(forceScroll === true){
    scrollToBottom();
  } else if(forceScroll === null){
    newBar.style.display = 'inline-flex';
    unreadEl.style.display = 'inline-flex';
    unreadCountEl.textContent = String(+unreadCountEl.textContent + 1);
  }
}
function loadChat(){
  try { return JSON.parse(localStorage.getItem(CHAT_KEY)) || []; }
  catch{ return []; }
}
function saveChat(data){
  localStorage.setItem(CHAT_KEY, JSON.stringify(data));
  window.dispatchEvent(new StorageEvent('storage', {key: CHAT_KEY}));
}
// clear chat (локально)
document.getElementById('clearChat').addEventListener('click', ()=>{
  if(confirm('Очистити історію чату лише на цьому пристрої?')){
    localStorage.removeItem(CHAT_KEY);
    messages = [];
    render(true);
  }
});
