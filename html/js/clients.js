import { fetchBookings, deleteBooking } from './bookings.js';

// Захист сторінки та шапка
guard.protect();
const me = guard.getSession();
const myName  = guard.emailToName(me.email) || 'Консультант';
const myEmail = String(me.email || '').toLowerCase();
document.getElementById('meLine').textContent = `Користувач: ${myEmail} (${myName})`;
document.getElementById('y').textContent = new Date().getFullYear();
document.getElementById('logout').onclick = () => guard.logout();

const listEl  = document.getElementById('list');
const emptyEl = document.getElementById('empty');
const errEl   = document.getElementById('error');
const spinEl  = document.getElementById('spin');
const refreshBtn = document.getElementById('refresh');

function fmt(date, time) {
  // YYYY-MM-DD -> DD.MM.YYYY HH:MM
  const p = date.split('-');
  return `${p[2]}.${p[1]}.${p[0]} ${time}`;
}

// простий ескейп для імен файлів
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function render(items) {
  listEl.innerHTML = '';
  if (!items.length) { emptyEl.style.display='block'; errEl.style.display='none'; return; }
  emptyEl.style.display='none'; errEl.style.display='none';

  // Сортуємо за датою/часом (найближчі вгорі)
  items.sort((a,b) => (a.date+a.time).localeCompare(b.date+b.time));

  for (const b of items) {
    const div = document.createElement('div');
    div.className = 'item';
    div.innerHTML = `
      <div>
        <div class="when">${fmt(b.date, b.time)}</div>
        <div><strong>${b.fullName}</strong> ${b.email ? `• <a href="mailto:${b.email}">${b.email}</a>` : ''}</div>
        ${b.note ? `<div class="muted">${b.note}</div>` : ''}

        ${b.fileUrl ? `
          <div class="fileline">
            <span class="muted">Прикріплений файл:</span>
            <a class="filebtn" href="${b.fileUrl}" target="_blank" rel="noopener" download>
              📎 Завантажити чек${b.fileName ? ` (${escapeHtml(b.fileName)})` : ''}
            </a>
          </div>
        ` : ''}
      </div>
      <div class="row">
        <a class="btn ghost" href="video.html?room=${encodeURIComponent(myName)}" target="_blank" rel="noopener">Приєднатися до відеочату</a>
        <button class="btn gray" data-id="${b.id}">Завершити</button>
      </div>
    `;

    div.querySelector('button[data-id]').onclick = async (e) => {
      const id = e.currentTarget.getAttribute('data-id');
      try {
        e.currentTarget.disabled = true;
        await deleteBooking(id);
        await load();
      } catch {
        e.currentTarget.disabled = false;
        alert('Не вдалося видалити запис. Спробуйте ще раз.');
      }
    };

    listEl.appendChild(div);
  }
}

async function load(showSpinner=true){
  try {
    if(showSpinner) spinEl.style.display = 'inline-block';
    const { list } = await fetchBookings(myEmail);
    render(Array.isArray(list) ? list : []);
  } catch {
    listEl.innerHTML = '';
    emptyEl.style.display='none';
    errEl.style.display='block';
  } finally {
    spinEl.style.display = 'none';
  }
}

refreshBtn.onclick = () => load();

// первинне завантаження + м’яке автооновлення
await load(false);
setInterval(load, 60*1000);
