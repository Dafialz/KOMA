// /js/clients.js
import { fetchBookings, deleteBooking } from './bookings.js';

// ── Захист сторінки та шапка ────────────────────────────────────────────────
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

// ── Рендер ──────────────────────────────────────────────────────────────────
function render(items) {
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

  for (const b of safeItems) {
    const hasFile = !!b.fileUrl;
    const fileBlock = hasFile ? `
      <div class="fileline">
        <span class="muted">Прикріплене фото:</span>
        <a class="filebtn" href="${b.fileUrl}" target="_blank" rel="noopener" download>
          📎 Завантажити чек${b.fileName ? ` (${escapeHtml(b.fileName)})` : ''}
        </a>
        <a class="filethumb" href="${b.fileUrl}" target="_blank" rel="noopener" title="Відкрити в новій вкладці">
          <img src="${b.fileUrl}" alt="Прикріплене фото" loading="lazy">
        </a>
      </div>
    ` : '';

    const div = document.createElement('div');
    div.className = 'item';
    div.innerHTML = `
      <div>
        <div class="when">${fmt(b.date, b.time)}</div>
        <div><strong>${escapeHtml(b.fullName||'')}</strong>${b.email ? ` • <a href="mailto:${escapeHtml(b.email)}">${escapeHtml(b.email)}</a>` : ''}</div>
        ${b.note ? `<div class="muted">${escapeHtml(b.note)}</div>` : ''}
        ${fileBlock}
      </div>
      <div class="row">
        <a class="btn ghost" href="video.html?room=${encodeURIComponent(myName)}" target="_blank" rel="noopener">Приєднатися до відеочату</a>
        <button class="btn gray" data-id="${escapeHtml(b.id)}">Завершити</button>
      </div>
    `;

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

    listEl.appendChild(div);
  }
}

// ── Додатковий фетч по імені (варіант B) ────────────────────────────────────
// Якщо бекенд це підтримує: /api/bookings?consultantName=...
async function fetchByName(name){
  try{
    const { API_BASE } = await import('./config.js');
    const url = `${API_BASE}/api/bookings?consultantName=${encodeURIComponent(String(name||''))}`;
    const r = await fetch(url, { headers:{ 'Accept':'application/json' }});
    if (!r.ok) return { list: [] };
    return await r.json();
  }catch(_){ return { list: [] }; }
}

// ── Завантаження ────────────────────────────────────────────────────────────
async function load(showSpinner=true){
  try {
    if (showSpinner && spinEl) spinEl.style.display = 'inline-block';

    // 1) за email консультанта (основний шлях)
    const byEmail = await fetchBookings(myEmail).catch(()=>({ list: [] }));

    // 2) додатково за ІМЕНЕМ консультанта (щоб не залежати від збігу email/ім’я)
    const byName  = await fetchByName(myName).catch(()=>({ list: [] }));

    // змерджимо унікально (за id)
    const merged = uniqById([...(byEmail?.list||[]), ...(byName?.list||[])]);

    render(merged);
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
