// /js/clients.js
import { fetchBookings, deleteBooking } from './bookings.js';

// ── Захист сторінки ─────────────────────────────────────────────────────────
guard.protect();
const me = guard.getSession();
const myName  = (guard.emailToName && guard.emailToName(me.email)) || 'Консультант';
const myEmail = String(me.email || '').toLowerCase();

const meLine    = document.getElementById('meLine');
const logoutBtn = document.getElementById('logout');
if (meLine)    meLine.textContent = `Користувач: ${myEmail} (${myName})`;
if (logoutBtn) logoutBtn.onclick = () => guard.logout();

const listEl     = document.getElementById('list');
const emptyEl    = document.getElementById('empty');
const errEl      = document.getElementById('error');
const spinEl     = document.getElementById('spin');
const refreshBtn = document.getElementById('refresh');

// ── Утиліти ─────────────────────────────────────────────────────────────────
function fmt(date, time) {
  // YYYY-MM-DD -> DD.MM.YYYY HH:MM
  const p = (String(date||'').split('-'));
  if (p.length !== 3) return `${date} ${time||''}`;
  return `${p[2]}.${p[1]}.${p[0]} ${time||''}`;
}
function escapeHtml(s){
  return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
const uniqById = (arr)=> {
  const seen = new Set();
  return (arr||[]).filter(x => {
    const id = x && x.id;
    if (!id || seen.has(id)) return false;
    seen.add(id); return true;
  });
};

// Підтягнемо API_BASE аби будувати абсолютні посилання на файли
let API_BASE_CACHE = null;
async function getApiBase(){
  if (API_BASE_CACHE) return API_BASE_CACHE;
  let mod = {};
  try { mod = await import('./config.js'); } catch {}
  API_BASE_CACHE =
    (mod && (mod.API_BASE || (mod.default && mod.default.API_BASE))) ||
    (typeof window !== 'undefined' && window.API_BASE) ||
    (typeof location !== 'undefined' && location.origin) ||
    '';
  API_BASE_CACHE = String(API_BASE_CACHE).replace(/\/+$/,'');
  return API_BASE_CACHE;
}
function joinUrl(base, rel){
  if (!rel) return '';
  if (/^https?:\/\//i.test(rel)) return rel;
  if (rel.startsWith('/')) return `${base}${rel}`;
  return `${base}/${rel}`;
}

// ── Рендер ──────────────────────────────────────────────────────────────────
async function render(items) {
  if (!listEl) return;
  listEl.innerHTML = '';

  const safeItems = Array.isArray(items) ? items : [];
  if (!safeItems.length) {
    if (emptyEl) emptyEl.style.display='block';
    if (errEl)   errEl.style.display='none';
    return;
  }
  if (emptyEl) emptyEl.style.display='none';
  if (errEl)   errEl.style.display='none';

  // Сортуємо за датою/часом (найближчі вгорі)
  safeItems.sort((a,b) => (String(a.date)+String(a.time)).localeCompare(String(b.date)+String(b.time)));

  const API_BASE = await getApiBase();

  for (const b of safeItems) {
    const fileUrlAbs = b.fileUrl ? joinUrl(API_BASE, b.fileUrl) : '';
    const hasFile = !!fileUrlAbs;

    const fileBlock = hasFile ? `
      <div class="fileline" style="display:flex;align-items:center;gap:10px;margin-top:8px">
        <span class="muted">Прикріплене фото:</span>
        <a class="filebtn btn light" href="${fileUrlAbs}" target="_blank" rel="noopener" download>
          📎 Завантажити чек${b.fileName ? ` (${escapeHtml(b.fileName)})` : ''}
        </a>
        <a class="filethumb" href="${fileUrlAbs}" target="_blank" rel="noopener" title="Відкрити в новій вкладці" style="line-height:0">
          <img src="${fileUrlAbs}" alt="Прикріплене фото" loading="lazy"
               style="height:56px;width:56px;object-fit:cover;border-radius:10px;border:1px solid var(--border)">
        </a>
      </div>
    ` : '';

    const div = document.createElement('div');
    div.className = 'item';
    div.innerHTML = `
      <div>
        <div class="when">${fmt(b.date, b.time)}</div>
        <div><strong>${escapeHtml(b.fullName||'')}</strong>${b.email ? ` • <a href="mailto:${escapeHtml(b.email)}">${escapeHtml(b.email)}</a>` : ''}</div>
        ${b.notes ? `<div class="muted">${escapeHtml(b.notes)}</div>` : ''} 
        ${fileBlock}
      </div>
      <div class="row" style="gap:10px;align-items:center">
        <a class="btn ghost" href="video.html?room=${encodeURIComponent(myName)}" target="_blank" rel="noopener">Приєднатися до відеочату</a>
        <button class="btn gray" data-id="${escapeHtml(b.id)}">Завершити</button>
      </div>
    `;

    // кнопка "Завершити"
    const delBtn = div.querySelector('button[data-id]');
    if (delBtn) {
      delBtn.onclick = async (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        try {
          e.currentTarget.disabled = true;
          await deleteBooking(id);
          await load(false);
        } catch {
          e.currentTarget.disabled = false;
          alert('Не вдалося видалити запис. Спробуйте ще раз.');
        }
      };
    }

    // якщо користувач клацне саме по <img>, все одно відкриємо в новій вкладці
    const img = div.querySelector('.filethumb img');
    if (img && fileUrlAbs){
      img.style.cursor = 'zoom-in';
      img.addEventListener('click', (ev)=>{
        ev.preventDefault();
        window.open(fileUrlAbs, '_blank', 'noopener');
      });
    }

    listEl.appendChild(div);
  }
}

// ── Додатковий фетч по імені (варіант B) ────────────────────────────────────
async function fetchByName(name){
  try{
    let mod = {};
    try { mod = await import('./config.js'); } catch {}
    const API_BASE =
      (mod && (mod.API_BASE || (mod.default && mod.default.API_BASE))) ||
      (typeof window !== 'undefined' && window.API_BASE) ||
      (typeof location !== 'undefined' && location.origin) || '';
    const url = `${String(API_BASE).replace(/\/+$/,'')}/api/bookings?consultantName=${encodeURIComponent(String(name||''))}`;
    const r = await fetch(url, { headers:{ 'Accept':'application/json' }});
    if (!r.ok) return { list: [] };
    const j = await r.json().catch(()=> ({}));
    return j && (j.list ? j : { list: Array.isArray(j) ? j : [] });
  }catch(_){ return { list: [] }; }
}

// ── Завантаження ────────────────────────────────────────────────────────────
async function load(showSpinner=true){
  try {
    if (showSpinner && spinEl) spinEl.style.display = 'inline-block';

    // 1) за email консультанта (основний шлях)
    const byEmail = await fetchBookings(myEmail).catch(()=>({ list: [] }));

    // 2) додатково за іменем консультанта (щоб не залежати від збігу email/ім’я)
    const byName  = await fetchByName(myName).catch(()=>({ list: [] }));

    // змерджимо унікально (за id)
    const merged = uniqById([...(byEmail?.list||[]), ...(byName?.list||[])]);

    await render(merged);
  } catch {
    if (listEl) listEl.innerHTML = '';
    if (emptyEl) emptyEl.style.display='none';
    if (errEl)   errEl.style.display='block';
  } finally {
    if (spinEl) spinEl.style.display = 'none';
  }
}

if (refreshBtn) refreshBtn.onclick = () => load();

// первинне завантаження + м’яке автооновлення
await load(false);
setInterval(load, 60*1000);
