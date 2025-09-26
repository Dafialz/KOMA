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
  for (var h = 8; h <= 19; h++) {
    arr.push(String(h).padStart(2,'0') + ':00');
  }
  return arr;
}

// Динамічний імпорт API бронювань (відносний шлях від js/)
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
  var card = $all('.card.person').find(function(c){
    return (c.dataset.name || '').trim() === String(name||'').trim();
  });
  return (card && card.dataset.email) || NAME_TO_EMAIL[name] || '';
}

// ===== ОНОВЛЕННЯ ЛІЧИЛЬНИКІв 0/4 ТА КНОПОК
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

/* ===== Копіювання тексту (для картки банку) ===== */
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

/* ===== БЛОК ОПЛАТИ «ПРИВАТБАНК» ===== */
function ensurePaymentBlock(){
  const form = getForm();
  if (!form) return;
  if ($('#pb_block', form)) return;

  const grid = form.querySelector('.grid.grid-2') || form;

  const wrap = document.createElement('div');
  wrap.id = 'pb_block';
  wrap.className = 'paycard';

  wrap.innerHTML = [
    '<div class="paycard__logo"><img src="../icon/privat.png" alt="ПриватБанк"></div>',
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
  if (commentBlock) {
    commentBlock.after(wrap);
  } else {
    grid.appendChild(wrap);
  }

  const pbNum  = wrap.querySelector('#pb_num');
  const pbCopy = wrap.querySelector('#pb_copy');
  function doCopy(){ copyText('1234123412341234'); }
  pbNum.addEventListener('click', doCopy);
  pbCopy.addEventListener('click', doCopy);
}

/* ===== Обовʼязковий чекбокс "Я оплатив(ла)" ===== */
function ensurePaidCheckbox(){
  var form = getForm();
  if (!form) return;

  if (!$('#c_paid', form)) {
    var grid = form.querySelector('.grid.grid-2') || form;
    var wrap = document.createElement('div');
    wrap.className = 'col-span-2 paid-wrap';

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

window.close
