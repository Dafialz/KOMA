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
function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
function getModal() { return document.getElementById('consultModal'); }
function getForm()  { return document.getElementById('consultForm'); }
function getSubmit(){ return document.getElementById('submitBtn'); }

const MAX_PER_DAY = 4;

// Мінімальна дата = сьогодні (Europe/Kyiv)
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

// Поточний офсет Києва у форматі +02:00 / +03:00 (спрощено)
function kyivOffsetISO() {
  try {
    var fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Kyiv', timeZoneName: 'shortOffset' });
    var parts = fmt.formatToParts(new Date());
    var off = (parts.find(p => p.type === 'timeZoneName') || {}).value || 'GMT+03';
    var m = off.match(/GMT?([+-]\d{1,2})/i);
    var h = m ? parseInt(m[1],10) : 3;
    var sign = h >= 0 ? '+' : '-';
    var abs = Math.abs(h);
    return sign + String(abs).padStart(2,'0') + ':00';
  } catch { return '+03:00'; }
}

// TS з урахуванням Києва (приблизно, з поточним офсетом)
function tsKyiv(date, time) { return Date.parse(date + 'T' + time + ':00' + kyivOffsetISO()); }

// Мапа імен → email (фолбек; основне джерело — data-атрибути у картках)
const NAME_TO_EMAIL = {
  'Оксана Кокотень': 'oksanakokoten@gmail.com',
  'Андрій Савчук':   'andriysavchuk@gmail.com',
  'Ірина Шевченко':  'irynashevchenko@gmail.com',
  'Максим Коваль':   'maksymkoval@gmail.com',
  'Надія Романюк':   'nadiyaromaniyk@gmail.com',
  'Олег Литвин':     'oleglitvin@gmail.com'
};

// Слоти щогодини 08:00–19:00
function hourSlots() {
  var arr = [];
  for (var h = 8; h <= 19; h++) {        // до 19:00 включно
    arr.push(String(h).padStart(2,'0') + ':00');
  }
  return arr;
}

// Динамічний імпорт API бронювань
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

function findEmailByName(name){
  // шукаємо по data-name у картці; якщо немає — фолбек з мапи
  var card = $all('.card.person').find(function(c){
    return (c.dataset.name || '').trim() === String(name||'').trim();
  });
  return (card && card.dataset.email) || NAME_TO_EMAIL[name] || '';
}

// ===== ОНОВЛЕННЯ ЛІЧИЛЬНИКІВ 0/4 ТА БЛОКУВАННЯ КНОПОК
async function updateQuotaBadges(dateStr){
  const cards = $all('.card.person');
  for (const card of cards){
    const email = (card.dataset && card.dataset.email) || '';
    const name  = (card.dataset && card.dataset.name)  || (card.querySelector('.p-name') || {}).textContent || '';
    const btn   = card.querySelector('.p-actions .btn');
    const badge = card.querySelector('.quota-badge');
    if (!email || !btn || !badge) continue;

    try{
      const list = await getBookings(email);
      const count = list.filter(b => b.date === dateStr).length;
      badge.textContent = count + '/' + MAX_PER_DAY;
      badge.classList.toggle('full', count >= MAX_PER_DAY);

      if (count >= MAX_PER_DAY){
        btn.setAttribute('aria-disabled','true');
        btn.textContent = 'Немає місць';
        btn.onclick = null;
      } else {
        btn.removeAttribute('aria-disabled');
        btn.textContent = 'Записатись';
        if (!btn.onclick) btn.onclick = function(){ openConsultation(btn); };
      }
    }catch(e){
      console.warn('quota update fail for', name, e);
    }
  }
}

/* ===== Інʼєкція обовʼязкового чекбоксу "Я оплатив(ла)" ===== */
function ensurePaidCheckbox(){
  var form = getForm();
  if (!form) return;

  if (!$('#c_paid', form)) {
    var grid = form.querySelector('.grid.grid-2') || form;
    var wrap = document.createElement('div');
    wrap.className = 'col-span-2 paid-wrap';
    // сам чекбокс
    var label = document.createElement('label');
    label.style.display = 'inline-flex';
    label.style.alignItems = 'center';
    label.style.gap = '8px';

    var input = document.createElement('input');
    input.type = 'checkbox';
    input.id = 'c_paid';
    input.required = true;

    var span = document.createElement('span');
    span.textContent = 'Я оплатив(ла)';

    label.appendChild(input);
    label.appendChild(span);
    wrap.appendChild(label);

    // додати в кінець сітки форми (перед кнопками)
    grid.appendChild(wrap);
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

  // під час зміни дати — оновити слоти + лічильники в картках
  if (dateInput && !dateInput._bound){
    dateInput.addEventListener('change', function(){
      renderSlots();
      updateQuotaBadges(dateInput.value);
    });
    dateInput._bound = true;
  }

  // інʼєкція чекбоксу "Я оплатив(ла)"
  ensurePaidCheckbox();

  // прев’ю файлу
  bindFilePreview();

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
  var prev = $('#filePreview');
  if (prev) prev.innerHTML = '';
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
  if (submitBtn) submitBtn.disabled = true;

  // взяти бронювання для цього консультанта на обрану дату
  const email = findEmailByName(consultant);
  let takenSet = new Set();
  let countForDay = 0;

  if (email){
    const list = await getBookings(email);
    for (const b of list){
      if (b.date === date && b.time){
        takenSet.add(b.time);
        countForDay++;
      }
    }
  }

  const slots = hourSlots();

  // якщо ліміт 4/4 — блокуємо всі слоти
  if (countForDay >= MAX_PER_DAY){
    slots.forEach(function(t){
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = t;
      btn.className = 'slot taken';
      btn.disabled = true;
      grid.appendChild(btn);
    });
    if (submitBtn) submitBtn.disabled = true;
    return;
  }

  let anyFree = false;
  slots.forEach(function(t){
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = t;
    const isTaken = takenSet.has(t);
    btn.className = 'slot' + (isTaken ? ' taken' : '');
    btn.disabled = isTaken;

    if (!isTaken) anyFree = true;

    btn.onclick = function () {
      grid.querySelectorAll('.slot.selected').forEach(function(x){ x.classList.remove('selected'); });
      btn.classList.add('selected');
      timeHidden.value = t;
      if (submitBtn) submitBtn.disabled = false;
    };
    grid.appendChild(btn);
  });

  if (submitBtn) submitBtn.disabled = !anyFree;
}

// Прев’ю прикріпленого фото
function bindFilePreview(){
  var inp = $('#c_file');
  var box = $('#filePreview');
  if (!inp || !box) return;

  if (inp._bound) return; // вже підключено
  inp._bound = true;

  inp.addEventListener('change', function(){
    box.innerHTML = '';
    var f = inp.files && inp.files[0];
    if (!f) return;
    if (!/^image\//i.test(f.type)){
      box.textContent = 'Невідомий файл';
      return;
    }
    var r = new FileReader();
    r.onload = function(){
      var img = document.createElement('img');
      img.alt = 'Прев’ю';
      img.src = r.result;
      box.innerHTML = '';
      box.appendChild(img);
    };
    r.readAsDataURL(f);
  });
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
  var paidEl     = ($('#c_paid')       || null);

  consultant = consultant.trim();
  fullName   = fullName.trim();
  email      = email.trim();
  notes      = notes.trim();

  if (!consultant || !fullName || !email || !date || !time) {
    alert('Будь ласка, оберіть дату і час та заповніть обовʼязкові поля.');
    return false;
  }
  if (!paidEl || !paidEl.checked) {
    alert('Підтвердіть оплату: поставте галочку «Я оплатив(ла)».');
    return false;
  }

  var booking = {
    consultant: consultant,
    fullName:   fullName,
    email:      email,
    date:       date,
    time:       time,
    notes:      notes,
    paid:       true,
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
    notes:      booking.notes,
    paid:       '1'
  }).toString();

  window.closeConsultation();
  window.location.href = '/zapis.html?' + params;
  return false;
};

// ===== Вбудовані стилі для модалки (scrollable fallback)
(function injectModalStyles() {
  var css = [
    '.modal[aria-hidden="true"]{display:none}',
    'body.modal-open{overflow:hidden}',                               /* блокуємо скрол фону */
    '.modal{position:fixed;inset:0;z-index:70;overscroll-behavior:contain}',
    '.modal-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.45)}',
    '.modal-dialog{position:relative;z-index:1;max-width:720px;width:calc(100% - 24px);margin:6vh auto;background:#fff;',
    ' border:1px solid #e5e7eb;border-radius:16px;box-shadow:0 10px 30px rgba(0,0,0,.15);padding:24px;',
    ' max-height:88vh;overflow:auto;-webkit-overflow-scrolling:touch}',
    '.modal-close{position:absolute;right:10px;top:10px;background:transparent;border:0;',
    ' font-size:24px;line-height:1;cursor:pointer}'
  ].join('');
  var s = document.createElement('style');
  s.textContent = css;
  document.head.appendChild(s);
})();

// ===== Ініціалізація лічильників 0/4 на сьогодні
(async function initQuotas(){
  const today = kyivTodayStr();
  await updateQuotaBadges(today);
})();
