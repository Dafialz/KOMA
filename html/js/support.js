// Ротація фраз + модалка підтримки
(function(){
  const phrases = [
    "Кома — час набиратися сил",
    "Кома — час для роздумів",
    "Кома — це не кінець, а лише коротка пауза",
    "Кома — життя триває",
    "Кома — не став крапку",
    "Кома — далі буде",
    "Кома — набирайся сил перед наступним кроком",
    "Кома — візьми паузу",
    "Кома — шукай альтернативу",
    "Кома — зміни крапку на кому",
    "Коли треба поставити кому",
    "Кома — це не крапка, рухайся далі",
    "Кома — після зупинки шлях триває",
    "Життя — це речення з багатьма комами, але не крапка",
    "Кома — новий шанс",
    "Кома — пауза як шанс зібрати сили",
    "Кома — зупинись, але не здавайся",
    "Кома — момент вдихнути глибше перед новим ривком",
    "Кома — твоя історія ще пишеться",
    "Кома — продовжуй",
    "Кома — усе ще попереду",
    "Кома — пауза як частина великого шляху",
    "Кома — тобі є що сказати далі",
    "Кома — не час здаватися"
  ];

  // Ротація
  const phraseEl = document.getElementById('komaPhrase');
  if (phraseEl){
    let i = 0;
    const tick = () => {
      i = (i + 1) % phrases.length;
      phraseEl.textContent = phrases[i];
    };
    setInterval(tick, 5000);
  }

  // Модалка
  const modal   = document.getElementById('komaModal');
  const openBtn = document.getElementById('komaHelpBtn');
  const closeBtn= document.getElementById('komaClose');
  const backdrop= document.getElementById('komaBackdrop');
  const cancel  = document.getElementById('komaCancel');
  const form    = document.getElementById('komaForm');
  const ok      = document.getElementById('komaOk');
  const err     = document.getElementById('komaErr');

  const open = () => modal.setAttribute('aria-hidden','false');
  const close= () => modal.setAttribute('aria-hidden','true');

  if(openBtn){ openBtn.addEventListener('click', open); }
  [closeBtn, backdrop, cancel].forEach(el => el && el.addEventListener('click', close));
  document.addEventListener('keydown', e => { if(e.key === 'Escape') close(); });

  // Імітація надсилання (поки без бекенду)
  if(form){
    form.addEventListener('submit', async (e)=>{
      e.preventDefault();
      ok.style.display='none'; err.style.display='none';
      try{
        // Тут можна підключити fetch(...) на свій бекенд
        await new Promise(r=>setTimeout(r,600));
        ok.style.display='block';
        form.reset();
        setTimeout(close, 900);
      }catch{
        err.style.display='block';
      }
    });
  }
})();
