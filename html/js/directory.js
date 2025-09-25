// ===== РІК У ФУТЕРІ (без optional chaining у лівій частині)
(function setYear() {
  var y = document.getElementById('y');
  if (y) y.textContent = new Date().getFullYear();
})();

// ===== Гармошка "Ціна"
window.togglePrice = function (btn) {
  var body = btn.closest('.p-body');
  if (!body) return;
  var box = body.querySelector('.prices');
  if (!box) return;
  var open = box.classList.toggle('open');
  btn.textContent = open ? 'Приховати ціну' : 'Ціна';
};

// ===== МОДАЛКА "Консультація"
var modal = document.getElementById('consultModal');
var form  = document.getElementById('consultForm');

window.openConsultation = function (el) {
  var name = el.dataset.name || '';
  document.getElementById('c_consultant').value = name;
  // підставимо ім’я, email якщо є guard
  try {
    if (window.guard?.user) {
      var u = window.guard.user;
      document.getElementById('c_fullName').value = u.fullName || '';
      document.getElementById('c_email').value    = u.email || '';
    }
  } catch {}
  modal.setAttribute('aria-hidden','false');
  document.body.style.overflow = 'hidden';
};

window.closeConsultation = function () {
  modal.setAttribute('aria-hidden','true');
  document.body.style.overflow = '';
  form && form.reset();
};

function tsKyiv(date, time) {
  // стабільно збираємо таймстемп (UTC+3)
  return Date.parse(date + 'T' + time + ':00+03:00');
}

window.submitConsultation = function (e) {
  e.preventDefault();
  var consultant = document.getElementById('c_consultant').value.trim();
  var fullName   = document.getElementById('c_fullName').value.trim();
  var email      = document.getElementById('c_email').value.trim();
  var date       = document.getElementById('c_date').value;
  var time       = document.getElementById('c_time').value;
  var notes      = document.getElementById('c_notes').value.trim();

  if (!consultant || !fullName || !email || !date || !time) return false;

  var booking = {
    consultant, fullName, email, date, time, notes,
    startTS: tsKyiv(date, time)
  };

  try {
    localStorage.setItem('koma_last_booking', JSON.stringify(booking));
  } catch {}

  // редирект на сторінку запису — там уже все підхопиться
  var params = new URLSearchParams(booking).toString();
  window.location.href = '/zapis.html?' + params;
  return false;
};

// ===== Дрібні стилі для модалки, якщо їх ще немає в CSS
(function injectModalStyles(){
  var css = `
  .modal[aria-hidden="true"]{display:none}
  .modal{position:fixed;inset:0;z-index:70}
  .modal-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.45)}
  .modal-dialog{position:relative;z-index:1;max-width:720px;margin:6vh auto;background:#fff;
    border:1px solid #e5e7eb;border-radius:16px;box-shadow:0 10px 30px rgba(0,0,0,.15);padding:24px}
  .modal-close{position:absolute;right:10px;top:10px;background:transparent;border:0;
    font-size:24px;line-height:1;cursor:pointer}
  `;
  var s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
})();
