// ===== ШАПКА / мобільне меню / рік
const hamb = document.getElementById('hamb');
const mobile = document.getElementById('mobile');
hamb?.addEventListener('click', () => {
  const open = mobile.classList.toggle('open');
  hamb.setAttribute('aria-expanded', open ? 'true' : 'false');
});
document.getElementById('y')?.textContent = new Date().getFullYear();

// Показ/приховування прайсу
window.togglePrice = (btn) => {
  const box = btn.closest('.p-body').querySelector('.prices');
  box.classList.toggle('open');
  btn.textContent = box.classList.contains('open') ? 'Приховати ціну' : 'Ціна';
};

// ===== КНОПКА «ПРИЄДНАТИСЬ»
const joinBtn  = document.getElementById('joinBtn');
const joinBtnM = document.getElementById('joinBtnM');

// Скільки після старту ще вважаємо запис «активним»
const JOIN_OPEN_AFTER_MIN = 60;

// Груба, але стабільна побудова timestamp для Києва (UTC+3 під ваш кейс)
function startTSFromKyiv(date, time) {
  return Date.parse(`${date}T${time}:00+03:00`);
}

function setJoinLinkFromStorage() {
  const raw = localStorage.getItem('koma_last_booking');
  if (!raw) return disableJoin();

  let b;
  try { b = JSON.parse(raw); } catch { return disableJoin(); }
  if (!b || !b.consultant || !b.fullName || !b.email || !b.date || !b.time) return disableJoin();

  const startTS = Number(b.startTS ?? startTSFromKyiv(b.date, b.time));
  const validTill = startTS + JOIN_OPEN_AFTER_MIN * 60 * 1000;
  if (Date.now() > validTill) return disableJoin();

  const params = new URLSearchParams({
    consultant: b.consultant,
    fullName: b.fullName,
    email: b.email,
    date: b.date,
    time: b.time,
    notes: b.notes || ''
  }).toString();
  const url = `zapis.html?${params}`;
  enableJoin(url);
}

function enableJoin(url) {
  joinBtn.href = url;       joinBtn.removeAttribute('aria-disabled');
  joinBtnM.href = url;      joinBtnM.removeAttribute('aria-disabled');
}
function disableJoin() {
  joinBtn.setAttribute('aria-disabled', 'true'); joinBtn.href = '#';
  joinBtnM.setAttribute('aria-disabled', 'true'); joinBtnM.href = '#';
}

setJoinLinkFromStorage();
