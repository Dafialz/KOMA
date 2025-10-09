// /html/js/support-admin.js
import { SupportChat } from './support-chat.js';

// Витягаємо поточного консультанта з guard
const me = (window.guard?.getSession?.() || {});
const myEmail = String(me.email || '').toLowerCase();

// Ініціалізація чату як консультант
const chat = new SupportChat({
  role: 'consultant',
  consultantEmail: myEmail,
  onEvent: handleEvent
});

// UI елементи
const elThreads = document.getElementById('threads');
const elAllCnt  = document.getElementById('allCnt');
const elMyCnt   = document.getElementById('myCnt');
const elTabs    = document.getElementById('tabs');
const elTitle   = document.getElementById('title');
const elWhoTags = document.getElementById('whoTags');
const elMsgs    = document.getElementById('msgs');
const elInput   = document.getElementById('input');
const elSend    = document.getElementById('send');
const elQ       = document.getElementById('q');
const elJoin    = document.getElementById('joinThread');

let currentThread = null; // {id, userName, userEmail, consultantEmail, topic, prio}
let scope = 'all';        // all | mine

// Простенький індекс діалогів (заповнюємо з вхідних повідомлень)
const threads = new Map(); // threadId -> meta { id, userName, userEmail, topic, prio, lastTs, unreadCnt, consultantEmail }

// Відновити зі сховища
restoreThreadsFromHistory();
renderSidebar();

// Події UI
elTabs.addEventListener('click', (e)=>{
  const b = e.target.closest('.pill-tab'); if (!b) return;
  elTabs.querySelectorAll('.pill-tab').forEach(x=>x.classList.remove('active'));
  b.classList.add('active');
  scope = b.dataset.scope;
  renderSidebar();
});

document.getElementById('clear').onclick = ()=>{ elQ.value=''; renderSidebar(); };
elQ.addEventListener('input', ()=>renderSidebar());

elJoin.onclick = ()=>{ if (currentThread) joinSelectedThread(); };

elSend.onclick = sendMessage;
elInput.addEventListener('keydown', (e)=>{
  if (e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); sendMessage(); }
});

function sendMessage(){
  if (!currentThread) return;
  const text = elInput.value.trim();
  if (!text) return;
  const room = `support:thread:${currentThread.id}`;
  chat.sendChat({
    room,
    threadId: currentThread.id,
    text,
    from: myEmail,
    to: currentThread.userEmail || ''
  });
  elInput.value = '';
  scrollToBottom();
}

// ********** Події від SupportChat **********
function handleEvent(ev, payload){
  if (ev === 'chat'){
    // побудова/оновлення треда
    const t = upsertThreadFromMsg(payload);
    // якщо відкрито цей тред — домалюємо в панелі
    if (currentThread && currentThread.id === t.id){
      addMsgEl(payload);
      // якщо це входяще у відкритий — одразу read
      if (payload.role !== 'consultant'){
        chat.markRead({ threadId: t.id, mid: payload.mid, room: `support:thread:${t.id}` });
      }
      scrollToBottom();
    } else {
      // лічильники “нове”
      if (payload.role !== 'consultant') {
        t.unreadCnt = (t.unreadCnt||0) + 1;
        renderSidebar();
      }
    }
    return;
  }

  if (ev === 'delivered' || ev === 'read'){
    // оновити статуси у відкритому чаті (✓ / ✓✓)
    if (currentThread && payload.threadId === currentThread.id){
      const nodes = elMsgs.querySelectorAll(`[data-mid="${payload.mid}"] .meta`);
      nodes.forEach(n=>{
        const txt = n.textContent;
        if (ev==='delivered' && !/✓/.test(txt)) n.textContent = txt + ' · ✓ доставлено';
        if (ev==='read' && !/✓✓/.test(txt)) n.textContent = txt.replace('✓ доставлено','') + ' · ✓✓ прочитано';
      });
    }
    return;
  }
}

// ********** Threads helpers **********
function upsertThreadFromMsg(m){
  const id = m.threadId || deriveThreadId(m);
  const topic = m.topic || 'Звернення';
  const prio  = m.prio  || 'Звичайний';

  const curr = threads.get(id) || {
    id,
    userName: m.userName || m.name || 'Користувач',
    userEmail: (m.userEmail || m.email || '').toLowerCase(),
    consultantEmail: (m.targetConsultant || '').toLowerCase(),
    topic, prio, lastTs: 0, unreadCnt: 0
  };
  curr.lastTs = Math.max(curr.lastTs, m.ts || m.serverTs || Date.now());
  if (m.targetConsultant) curr.consultantEmail = String(m.targetConsultant).toLowerCase();
  threads.set(id, curr);
  renderSidebar();
  return curr;
}

// fallback: якщо немає threadId — формуємо зі зв'язки
function deriveThreadId(m){
  // userEmail + topic + (targetConsultant||'support')
  const u = (m.userEmail || m.email || 'user').toLowerCase();
  const c = (m.targetConsultant || 'support').toLowerCase();
  const t = (m.topic || 'topic').toLowerCase().slice(0,24);
  return `${u}__${c}__${t}`;
}

function restoreThreadsFromHistory(){
  const hist = chat.history;
  Object.keys(hist).forEach(id=>{
    const arr = hist[id];
    const last = arr[arr.length-1];
    if (last) upsertThreadFromMsg(last);
  });
}

// ********** Render sidebar **********
function renderSidebar(){
  const q = (elQ.value || '').toLowerCase().trim();
  const items = Array.from(threads.values())
    .filter(t => {
      if (scope === 'mine' && t.consultantEmail && t.consultantEmail !== myEmail) return false;
      if (!q) return true;
      return [t.userName, t.userEmail, t.topic].join(' ').toLowerCase().includes(q);
    })
    .sort((a,b)=> (b.lastTs||0) - (a.lastTs||0));

  // лічильники
  const allUnread = Array.from(threads.values()).reduce((s,t)=>s+(t.unreadCnt||0),0);
  const myUnread  = Array.from(threads.values()).filter(t=>t.consultantEmail===myEmail).reduce((s,t)=>s+(t.unreadCnt||0),0);
  setBadge(elAllCnt, allUnread);
  setBadge(elMyCnt,  myUnread);

  elThreads.innerHTML='';
  if (!items.length){
    elThreads.innerHTML = `<div class="muted">Немає діалогів</div>`;
    return;
  }
  for (const t of items){
    const div = document.createElement('div');
    div.className='thread';
    div.innerHTML = `
      <div>
        <div><strong>${escapeHtml(t.userName)}</strong> • <span class="meta">${escapeHtml(t.userEmail||'')}</span></div>
        <div class="meta">${escapeHtml(t.topic)} · ${escapeHtml(t.prio)}</div>
      </div>
      <div>${ t.unreadCnt ? `<span class="badge-new">${t.unreadCnt}</span>` : '' }</div>
    `;
    div.onclick = ()=> openThread(t.id);
    elThreads.appendChild(div);
  }
}

function setBadge(el, n){
  if (!el) return;
  if (n>0){ el.textContent = n; el.style.display='inline-flex'; }
  else { el.style.display='none'; }
}

// ********** Open thread **********
function openThread(threadId){
  currentThread = threads.get(threadId);
  if (!currentThread) return;

  elTitle.textContent = currentThread.topic || 'Діалог';
  elWhoTags.innerHTML = `
    <span class="tag">Користувач: ${escapeHtml(currentThread.userEmail||'-')}</span>
    ${ currentThread.consultantEmail ? `<span class="tag">Консультант: ${escapeHtml(currentThread.consultantEmail)}</span>` : '' }
    <span class="tag">${escapeHtml(currentThread.prio||'Звичайний')}</span>
  `;

  // приєднатись у кімнату треда
  joinSelectedThread();

  // відмалювати історію
  const list = chat.getThread(threadId);
  elMsgs.innerHTML='';
  list.forEach(addMsgEl);

  // вхідні — позначити read
  list.filter(m=>m.role!=='consultant').forEach(m=>{
    chat.markRead({ threadId, mid:m.mid, room:`support:thread:${threadId}` });
  });

  currentThread.unreadCnt = 0;
  renderSidebar();

  elInput.disabled=false; elSend.disabled=false;
  scrollToBottom();
}

function joinSelectedThread(){
  if (!currentThread) return;
  chat.joinThread(currentThread.id);
}

function addMsgEl(m){
  const div = document.createElement('div');
  div.className = `msg ${m.role==='consultant' ? 'me' : 'them'}`;
  div.dataset.mid = m.mid;
  const who = m.role==='consultant' ? 'Ви' : (m.userName||'Користувач');
  const ts = new Date(m.ts || m.serverTs || Date.now()).toLocaleString('uk-UA');
  const meta = `${who} · ${ts}`;
  div.innerHTML = `${escapeHtml(m.text)}<div class="meta">${meta}</div>`;
  elMsgs.appendChild(div);
}

function scrollToBottom(){
  requestAnimationFrame(()=>{ elMsgs.scrollTop = elMsgs.scrollHeight + 9999; });
}

function escapeHtml(s){
  return String(s||'').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
