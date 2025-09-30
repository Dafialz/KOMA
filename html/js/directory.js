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
const KYIV_TZ = 'Europe/Kyiv';

// Мінімальна дата = сьогодні (Europe/Kyiv)
function kyivTodayStr(){
  var d = new Date(new Date().toLocaleString('en-CA', { timeZone: KYIV_TZ }));
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
function kyivOffsetISO() {
  try {
    var fmt = new Intl.DateTimeFormat('en-GB', { timeZone: KYIV_TZ, timeZoneName: 'shortOffset' });
    var parts = fmt.formatToParts(new Date());
    var off = (parts.find(p => p.type === 'timeZoneName') || {}).value || 'GMT+03';
    var m = off.match(/GMT?([+-]\d{1,2})/i);
    var h = m ? parseInt(m[1],10) : 3;
    var sign = h >= 0 ? '+' : '-';
    var abs = Math.abs(h);
    return sign + String(abs).padStart(2,'0') + ':00';
  } catch { return '+03:00'; }
}
function tsKyiv(date, time) { return Date.parse(date + 'T' + time + ':00' + kyivOffsetISO()); }

// Мапа імен → email (фолбек) — ОНОВЛЕНО під фактичних консультантів
const NAME_TO_EMAIL = {
  'Оксана Кокотень':       'oksanakokoten@gmail.com',
  'Cергій Ойович':         'sergiyoyovych@gmail.com',      // уважно: літера "C" може бути латинська у верстці
  'Сергій Ойович':         'sergiyoyovych@gmail.com',      // дубль на випадок кириличної "С"
  'Анастасія Ойович':      'anastasiyoyovych@gmail.com',
  'Олександр Ткачук':      'oleksandrtkachuk@gmail.com',
  'Тетяна Маковська':      'tetianamakovska@gmail.com',
  'Христина Кокотень':     'kristinakokoten@gmail.com'
};

function hourSlots() {
  var arr = [];
  for (var h = 8; h <= 19; h++) arr.push(String(h).padStart(2,'0') + ':00');
  return arr;
}

// Динамічний імпорт API бронювань
async function getBookings(email){
  try{
    if (!window.__bk) window.__bk = await import('./bookings.js');
    const res = await window.__bk.fetchBookings(email);
    return (res && res.list) ? res.list : [];
  }catch(e){
    console.warn('bookings API недоступний:', e);
    return [];
  }
}
function findEmailByName(name){
  var card = $all('.card.person').find(c => (c.dataset.name || '').trim() === String(name||'').trim());
  return (card && card.dataset.email) || NAME_TO_EMAIL[name] || '';
}

/* ===== JOIN кнопка на сторінці ===== */
function updateDirJoin() {
  const btn = document.getElementById('dirJoinLink');
  if (!btn) return;
  const raw = localStorage.getItem('koma_last_booking');
  if (!raw) { btn.setAttribute('aria-disabled','true'); btn.href = '#'; return; }
  let b; try { b = JSON.parse(raw); } catch { b = null; }
  if (!b || !b.date || !b.time) { btn.setAttribute('aria-disabled','true'); btn.href = '#'; return; }
  const qs = new URLSearchParams({
    consultant: b.consultant || '',
    fullName: b.fullName || '',
    email: b.email || '',
    date: b.date,
    time: b.time
  }).toString();
  btn.href = `zapis.html?${qs}`;
  btn.removeAttribute('aria-disabled');
}
window.addEventListener('storage', (e) => { if (e.key === 'koma_last_booking') updateDirJoin(); });
document.addEventListener('DOMContentLoaded', updateDirJoin);

/* ===== ОНОВЛЕННЯ ЛІЧИЛЬНИКІВ 0/4 ===== */
async function updateQuotaBadges(dateStr){
  const cards = $all('.card.person');
  for (const card of cards){
    const email = (card.dataset && card.dataset.email) || '';
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
        btn.onclick = function(){ openConsultation(btn); };
      }
    }catch(e){
      console.warn('quota update fail for', email, e);
    }
  }
}

/* ===== Копіювання тексту (банк) ===== */
function copyText(txt){
  if (!txt) return;
  if (navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(txt).catch(()=>{});
  } else {
    const ta = document.createElement('textarea');
    ta.value = txt; document.body.appendChild(ta); ta.select();
    try{ document.execCommand('copy'); }catch(e){}
    document.body.removeChild(ta);
  }
}

/* ===== Блок оплати та чекбокс ===== */
function ensurePaymentBlock(){
  const form = getForm(); if (!form) return;
  if ($('#pb_block', form)) return;

  const grid = form.querySelector('.grid.grid-2') || form;
  const wrap = document.createElement('div');
  wrap.id = 'pb_block';
  wrap.className = 'paycard';
  wrap.innerHTML = [
    '<div class="paycard__logo"><img src="icon/privat.png" alt="ПриватБанк"></div>',
    '<div class="paycard__info">',
      '<div class="paycard__title">ПриватБанк</div>',
      '<div class="paycard__row">',
        '<code id="pb_num" class="paycard__num" title="Натисніть, щоб скопіювати">1234 1234 1234 1234</code>',
        '<button type="button" id="pb_copy" class="btn outline small paycard__btn">Копіювати</button>',
      '</div>',
      '<div class="muted" style="font-size:.9rem">Оплатіть та поставте галочку «Я оплатив(ла)».</div>',
    '</div>'
  ].join('');

  const commentBlock = grid.children[4] || null;
  if (commentBlock) commentBlock.after(wrap); else grid.appendChild(wrap);

  const pbNum  = wrap.querySelector('#pb_num');
  const pbCopy = wrap.querySelector('#pb_copy');
  function doCopy(){ copyText('1234123412341234'); }
  pbNum.addEventListener('click', doCopy);
  pbCopy.addEventListener('click', doCopy);
}
function ensurePaidCheckbox(){
  var form = getForm(); if (!form) return;
  if (!$('#c_paid', form)) {
    var grid = form.querySelector('.grid.grid-2') || form;
    var wrap = document.createElement('div');
    wrap.className = 'col-span-2 paid-wrap';
    wrap.innerHTML = '<label style="display:inline-flex;align-items:center;gap:8px"><input id="c_paid" type="checkbox" required/><span>Я оплатив(ла)</span></label>';
    grid.appendChild(wrap);
  }
}

/* ===== МОДАЛКА "Записатись" ===== */
window.openConsultation = function (el) {
  var modal = getModal();
  if (!modal) { console.warn('Modal not found'); return; }

  var name  = (el && el.dataset && el.dataset.name)  || '';
  var email = (el && el.dataset && el.dataset.email) || '';

  var c_consultant = $('#c_consultant');
  if (c_consultant) c_consultant.value = name;
  if (email) modal.dataset.email = email;

  try {
    if (window.guard && window.guard.user) {
      var u = window.guard.user;
      var fn = $('#c_fullName'); if (fn && !fn.value) fn.value = u.fullName || '';
      var em = $('#c_email');    if (em && !em.value) em.value = u.email || '';
    }
  } catch {}

  var dateInput = $('#c_date');
  setMinToday(dateInput);
  renderSlots();

  if (dateInput && !dateInput._bound){
    dateInput.addEventListener('change', function(){
      renderSlots();
      updateQuotaBadges(dateInput.value);
    });
    dateInput._bound = true;
  }

  ensurePaymentBlock();
  ensurePaidCheckbox();
  bindFilePreview();

  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');

  var focusEl = $('#c_fullName');
  if (focusEl) setTimeout(function(){ focusEl.focus(); }, 0);
};
window.closeConsultation = function (){
  var modal = getModal();
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden','true');
  document.body.classList.remove('modal-open');
};

// Позначити зайняті слоти у гріді
function markBusy(grid, busyList){
  if (!grid || !busyList || !busyList.length) return;
  Array.prototype.forEach.call(grid.children, function(btn){
    var t = btn.getAttribute('data-time');
    if (busyList.indexOf(t) >= 0){
      btn.classList.add('taken');
      btn.setAttribute('aria-disabled','true');
    }
  });
}
// Рендер слотів
function renderSlots(){
  var grid = document.getElementById('slotGrid');
  var dateInput = document.getElementById('c_date');
  var timeInput = document.getElementById('c_time');
  if (!grid || !dateInput || !timeInput) return;

  var slots = hourSlots();
  grid.innerHTML = '';

  var modal = getModal();
  var email = (modal && modal.dataset && modal.dataset.email) || '';
  if (!email) {
    var name = (document.getElementById('c_consultant') || {}).value || '';
    email = findEmailByName(name);
  }

  slots.forEach(function(t){
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'slot';
    b.textContent = t;
    b.setAttribute('data-time', t);
    b.addEventListener('click', function(){
      if (b.classList.contains('taken')) return;
      Array.prototype.forEach.call(grid.children, function(x){ x.classList.remove('selected'); });
      b.classList.add('selected');
      timeInput.value = t;
    });
    grid.appendChild(b);
  });

  (async function(){
    try{
      var list = await getBookings(email);
      var busy = list.filter(function(b){ return b.date === dateInput.value; }).map(function(b){ return b.time; });
      markBusy(grid, busy);
    }catch(e){/* ignore */}
  })();

  timeInput.value = '';
}

// Прев'ю завантаженого зображення
function bindFilePreview(){
  var input = document.getElementById('c_file');
  var box = document.getElementById('filePreview');
  if (!input || !box || input._bound) return;
  input._bound = true;

  input.addEventListener('change', function(){
    box.innerHTML = '';
    var f = input.files && input.files[0];
    if (!f) return;
    var img = document.createElement('img');
    img.alt = 'Попередній перегляд';
    box.appendChild(img);
    var reader = new FileReader();
    reader.onload = function(e){ img.src = e.target.result; };
    reader.readAsDataURL(f);
  });
}

/* ===== Збереження «останнього запису» для join-кнопок ===== */
function saveLastBookingLocally(data){
  if(!data || !data.date || !data.time) return;
  const rec = {
    consultant: data.consultantName || data.consultant || '',
    fullName:   data.fullName || '',
    email:      data.email || '',
    date:       data.date,
    time:       data.time,
    startTS:    tsKyiv(data.date, data.time)
  };
  try {
    localStorage.setItem('koma_last_booking', JSON.stringify(rec));
    window.dispatchEvent(new StorageEvent('storage', { key: 'koma_last_booking' }));
  } catch {}
  updateDirJoin();
}

/* ===== Success-модалка ===== */
function openSuccess(url){
  const m = document.getElementById('successModal');
  const a = document.getElementById('successJoin');
  if (!m || !a) return;
  a.href = url || '#';
  m.classList.add('open'); m.setAttribute('aria-hidden','false');
  document.body.classList.add('modal-open');
}
window.closeSuccess = function(){
  const m = document.getElementById('successModal');
  if (!m) return;
  m.classList.remove('open'); m.setAttribute('aria-hidden','true');
  document.body.classList.remove('modal-open');
};

/* ===== Сабміт форми ===== */
async function submitConsultation(e){
  if (e && e.preventDefault) e.preventDefault();
  var form = getForm();
  var btn = getSubmit();
  if (!form || !btn) return false;

  var consultantName = (document.getElementById('c_consultant')||{}).value || '';
  var modal = getModal();
  var consultantEmail = (modal && modal.dataset && modal.dataset.email) || findEmailByName(consultantName);

  var fileInput = document.getElementById('c_file');
  var file = (fileInput && fileInput.files && fileInput.files[0]) ? fileInput.files[0] : null;

  var data = {
    consultant: consultantName,
    consultantName: consultantName,
    consultantEmail: consultantEmail,
    fullName:   (document.getElementById('c_fullName')||{}).value || '',
    email:      (document.getElementById('c_email')||{}).value || '',
    date:       (document.getElementById('c_date')||{}).value || '',
    time:       (document.getElementById('c_time')||{}).value || '',
    note:       (document.getElementById('c_notes')||{}).value || '',
    paid:       !!((document.getElementById('c_paid')||{}).checked),
    file
  };

  if (!data.consultantName || !data.consultantEmail || !data.fullName || !data.email || !data.date || !data.time){
    alert('Заповніть усі поля, оберіть час і переконайтесь, що email консультанта відомий.');
    return false;
  }
  if (!data.paid){ alert('Підтвердіть оплату (галочка «Я оплатив(ла)»).'); return false; }

  btn.setAttribute('aria-disabled','true'); btn.textContent='Надсилаю…';

  try{
    if (!window.__bk) window.__bk = await import('./bookings.js');
    let ok = false;
    if (window.__bk && window.__bk.createBooking){
      const res = await window.__bk.createBooking(data);
      ok = !!(res && res.ok);
    }

    // Збираємо лінк на «Приєднатись»
    const qs = new URLSearchParams({
      consultant: data.consultantName,
      fullName: data.fullName,
      email: data.email,
      date: data.date,
      time: data.time
    }).toString();
    const joinUrl = `zapis.html?${qs}`;

    // Зберігаємо «останній запис», оновлюємо лічильники
    saveLastBookingLocally(data);
    try{ updateQuotaBadges(data.date); }catch(_){}

    // Показуємо гарний попап
    openSuccess(joinUrl);
    closeConsultation();
    return false;
  }catch(e){
    console.warn('submitConsultation error', e);
    // фолбек — все одно збережемо локально і дамо перейти
    saveLastBookingLocally(data);
    const qs = new URLSearchParams({
      consultant: data.consultantName,
      fullName: data.fullName,
      email: data.email,
      date: data.date,
      time: data.time
    }).toString();
    location.href = 'zapis.html?' + qs;
    return false;
  }finally{
    btn.removeAttribute('aria-disabled'); btn.textContent='Записатися';
  }
}
window.submitConsultation = submitConsultation;

// Початкове оновлення
updateQuotaBadges(kyivTodayStr());
updateDirJoin();
