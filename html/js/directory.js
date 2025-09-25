// ===== РІК У ФУТЕРІ
(function setYear() {
  var y = document.getElementById('y');
  if (y) y.textContent = new Date().getFullYear();
})();

// ===== Плавний акордеон "Ціна"
function ensurePricesInit() {
  var all = document.querySelectorAll('.prices');
  for (var i = 0; i < all.length; i++) {
    var p = all[i];
    if (!p.dataset._init) {
      p.style.overflow = 'hidden';
      p.style.maxHeight = '0px';
      p.style.transition = 'max-height .25s ease';
      p.dataset._init = '1';
    }
  }
}
ensurePricesInit();

window.togglePrice = function (btn) {
  var body = btn.closest('.p-body');
  if (!body) return;
  var box = body.querySelector('.prices');
  if (!box) return;

  var open = !box.classList.contains('open');
  if (open) {
    box.classList.add('open');
    box.style.maxHeight = box.scrollHeight + 'px';
    btn.textContent = 'Приховати ціну';
  } else {
    box.classList.remove('open');
    box.style.maxHeight = '0px';
    btn.textContent = 'Ціна';
  }
};

// ===== Допоміжні
function $(sel, root) { return (root || document).querySelector(sel); }
function getModal() { return document.getElementById('consultModal'); }
function getForm()  { return document.getElementById('consultForm'); }
function getSubmit(){ return document.getElementById('submitBtn'); }

// Мінімальна дата = сьогодні
function kyivTodayStr(){
  var d = new Date(new Date().toLocaleString('en-CA', { timeZone: 'Europe/Kyiv' }));
  var yyyy = d.getFullYear();
  var mm = String(d.getMonth() + 1).padStart(2, '0');
  var dd = String(d.getDate()).padStart(2, '0');
  return yyyy + '-' + mm + '-' + dd;
}
function setMinToday(input) {
  if (!input) return;
  var today = kyivTodayStr();
  input.min = today;
  if (!input.value) input.value = today;
}

// TS з урахуванням Києва
function tsKyiv(date, time) { return Date.parse(date + 'T' + time + ':00+03:00'); }

// Мапа імен → email (для підрахунків бронювань)
const NAME_TO_EMAIL = {
  'Оксана Кокотень': 'oksanakokoten@gmail.com',
  'Андрій Савчук':   'andriysavchuk@gmail.com',
  'Ірина Шевченко':  'irynashevchenko@gmail.com',
  'Максим Коваль':   'maksymkoval@gmail.com',
  'Надія Романюк':   'nadiyaromaniyk@gmail.com',
  'Олег Литвин':     'oleglitvin@gmail.com'
};

// 4 фіксованих слоти між 08:00 та 20:00
const SLOTS = ['08:00','12:00','16:00','20:00'];

// Динамічний імпорт API бронювань (працює локально + Netlify)
async function getBookings(email){
  try{
    if (!window.__bk) window.__bk = await import('/js/bookings.js');
    const res = await window.__bk.fetchBookings(email);
    return (res && res.list) ? res.list : [];
  }catch(e){
    console.warn('bookings API недоступний:', e);
    return [];
  }
}

// ===== МОДАЛКА "Записатись"
window.openConsultation = function (el) {
  var modal = getModal();
  if (!modal) { console.warn('Modal not found'); return; }

  var name = (el && el.dataset && el.dataset.name) ? el.dataset.name : '';
  var c_consultant = $('#c_consultant');
  if (c_consultant) c_consultant.value = name;

  // автозаповнення з guard
  try {
    if (window.guard && window.guard.user) {
      var u = window.guard.user;
      var fn = $('#c_fullName'); if (fn && !fn.value) fn.value = u.fullName || '';
      var em = $('#c_email');    if (em && !em.value) em.value = u.email || '';
    }
  } catch {}

  // дата й слоти
  var dateInput = $('#c_date');
  setMinToday(dateInput);
  renderSlots(); // первинний рендер

  // під час зміни дати — оновити слоти
  if (dateInput && !dateInput._bound){
    dateInput.addEventListener('change', renderSlots);
    dateInput._bound = true;
  }

  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');

  var focusEl = $('#c_fullName');
  if (focusEl) setTimeout(function(){ focusEl.focus(); }, 0);
};

window.closeConsultation = function () {
  var modal = getModal();
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');

  var form = getForm();
  if (form) form.reset();
  var grid = $('#slotGrid');
  if (grid) grid.innerHTML = '';
};

// Побудова слотів з урахуванням зайнятості
async function renderSlots(){
  var grid = $('#slotGrid');
  var date = ($('#c_date') || {}).value;
  var consultant = ($('#c_consultant') || {}).value;
  var timeHidden = $('#c_time');
  var submitBtn = getSubmit();
  if (!grid || !date || !consultant) return;

  grid.innerHTML = '';
  timeHidden.value = '';

  // взяти бронювання для цього консультанта на обрану дату
  const email = NAME_TO_EMAIL[consultant] || '';
  let takenSet = new Set();
  if (email){
    const list = await getBookings(email);
    for (const b of list){
      if (b.date === date && b.time) takenSet.add(b.time);
    }
  }

  let freeCount = 0;
  SLOTS.forEach(t => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = t;
    btn.className = 'slot' + (takenSet.has(t) ? ' taken' : '');
    btn.disabled = takenSet.has(t);
    if (!btn.disabled) freeCount++;

    btn.onclick = () => {
      // зняти попередню позначку
      grid.querySelectorAll('.slot.selected').forEach(x => x.classList.remove('selected'));
      btn.classList.add('selected');
      timeHidden.value = t;
      if (submitBtn) submitBtn.disabled = false;
    };
    grid.appendChild(btn);
  });

  // якщо всі 4 зайняті — блокуємо сабміт
  if (submitBtn) submitBtn.disabled = (freeCount === 0);
}

// ESC закриття
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') window.closeConsultation();
});

// Сабміт форми
window.submitConsultation = function (e) {
  if (e && e.preventDefault) e.preventDefault();

  var consultant = ($('#c_consultant') || {}).value || '';
  var fullName   = ($('#c_fullName')   || {}).value || '';
  var email      = ($('#c_email')      || {}).value || '';
  var date       = ($('#c_date')       || {}).value || '';
  var time       = ($('#c_time')       || {}).value || '';
  var notes      = ($('#c_notes')      || {}).value || '';

  consultant = consultant.trim();
  fullName   = fullName.trim();
  email      = email.trim();
  notes      = notes.trim();

  if (!consultant || !fullName || !email || !date || !time) {
    alert('Будь ласка, оберіть дату і час та заповніть обовʼязкові поля.');
    return false;
  }

  var booking = {
    consultant: consultant,
    fullName:   fullName,
    email:      email,
    date:       date,
    time:       time,
    notes:      notes,
    startTS:    tsKyiv(date, time)
  };

  try { localStorage.setItem('koma_last_booking', JSON.stringify(booking)); } catch {}

  var fileInput = $('#c_file');
  if (fileInput && fileInput.files && fileInput.files.length) booking.hasFile = true;

  var params = new URLSearchParams({
    consultant: booking.consultant,
    fullName:   booking.fullName,
    email:      booking.email,
    date:       booking.date,
    time:       booking.time,
    notes:      booking.notes
  }).toString();

  window.closeConsultation();
  window.location.href = '/zapis.html?' + params;
  return false;
};

// ===== Вбудовані стилі для модалки (fallback)
(function injectModalStyles() {
  var css = [
    '.modal[aria-hidden=\"true\"]{display:none}',
    '.modal{position:fixed;inset:0;z-index:70}',
    '.modal-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.45)}',
    '.modal-dialog{position:relative;z-index:1;max-width:720px;margin:6vh auto;background:#fff;',
    ' border:1px solid #e5e7eb;border-radius:16px;box-shadow:0 10px 30px rgba(0,0,0,.15);padding:24px}',
    '.modal-close{position:absolute;right:10px;top:10px;background:transparent;border:0;',
    ' font-size:24px;line-height:1;cursor:pointer}'
  ].join('');
  var s = document.createElement('style');
  s.textContent = css;
  document.head.appendChild(s);
})();

// ===== Автоблокування картки, якщо на СЬОГОДНІ вже 4 записи
(async function autoDisableIfFullToday(){
  const today = kyivTodayStr();
  const cards = document.querySelectorAll('.card.person');
  for (const card of cards){
    const nameEl = card.querySelector('.p-name');
    const btn = card.querySelector('.p-actions .btn');
    if (!nameEl || !btn) continue;
    const name = nameEl.textContent.trim();
    const email = NAME_TO_EMAIL[name] || '';
    if (!email) continue;

    const list = await getBookings(email);
    const countToday = list.filter(b => b.date === today).length;
    if (countToday >= 4){
      btn.setAttribute('aria-disabled','true');
      btn.textContent = 'Немає місць';
      btn.onclick = null;
    }
  }
})();
