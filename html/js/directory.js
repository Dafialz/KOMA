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
    // спочатку прибираємо, щоб перерахувати висоту контенту
    box.style.maxHeight = box.scrollHeight + 'px';
    btn.textContent = 'Приховати ціну';
  } else {
    box.classList.remove('open');
    box.style.maxHeight = '0px';
    btn.textContent = 'Ціна';
  }
};

// ====== Допоміжні функції для модалки
function $(sel, root) { return (root || document).querySelector(sel); }
function getModal() { return document.getElementById('consultModal'); }
function getForm()  { return document.getElementById('consultForm'); }

// мінімальна дата = сьогодні
function setMinToday(input) {
  if (!input) return;
  var d = new Date();
  var yyyy = d.getFullYear();
  var mm = String(d.getMonth() + 1).padStart(2, '0');
  var dd = String(d.getDate()).padStart(2, '0');
  var today = yyyy + '-' + mm + '-' + dd;
  input.min = today;
  if (!input.value) input.value = today;
}

// ===== МОДАЛКА "Консультація"
window.openConsultation = function (el) {
  var modal = getModal();
  if (!modal) { console.warn('Modal not found'); return; }

  var name = (el && el.dataset && el.dataset.name) ? el.dataset.name : '';
  var c_consultant = $('#c_consultant');
  if (c_consultant) c_consultant.value = name;

  // дані з guard, якщо є
  try {
    if (window.guard && window.guard.user) {
      var u = window.guard.user;
      var fn = $('#c_fullName'); if (fn && !fn.value) fn.value = u.fullName || '';
      var em = $('#c_email');    if (em && !em.value) em.value = u.email || '';
    }
  } catch {}

  setMinToday($('#c_date'));

  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
  // фокус
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
};

// ESC для закриття
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') window.closeConsultation();
});

// обчислення timestamp (Київ, +03:00)
function tsKyiv(date, time) {
  return Date.parse(date + 'T' + time + ':00+03:00');
}

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
    alert('Будь ласка, заповніть усі обовʼязкові поля.');
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

  try {
    localStorage.setItem('koma_last_booking', JSON.stringify(booking));
  } catch {}

  // файл відмітимо прапорцем (фактичне завантаження робиться на сторінці запису/сервері)
  var fileInput = $('#c_file');
  if (fileInput && fileInput.files && fileInput.files.length) {
    booking.hasFile = true;
  }

  // редирект на сторінку запису
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

// ===== Вбудовані стилі для модалки (на випадок, якщо в CSS не додано)
(function injectModalStyles() {
  var css = [
    '.modal[aria-hidden="true"]{display:none}',
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
