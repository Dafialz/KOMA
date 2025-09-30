// html/js/support.js — віджет слоганів + відкриття клієнтської підтримки
(() => {
  const PHRASES = [
    'Кома — час набиратися сил',
    'Кома — час для роздумів',
    'Кома — це не кінець, а лише коротка пауза',
    'Кома — життя триває',
    'Кома — не став крапку',
    'Кома — далі буде',
    'Кома — набирайся сил перед наступним кроком',
    'Кома — візьми паузу',
    'Кома — шукай альтернативу',
    'Кома — зміни крапку на кому',
    'Коли треба поставити кому',
    'Кома — це не крапка, рухайся далі',
    'Кома — після зупинки шлях триває',
    'Життя — речення з багатьма комами, але не крапка',
    'Кома — новий шанс',
    'Кома — пауза, як шанс зібрати сили',
    'Кома — зупинись, але не здавайся',
    'Кома — момент, щоб вдихнути глибше перед новим ривком',
    'Кома — твоя історія ще пишеться',
    'Кома — продовжуй',
    'Кома — усе ще попереду',
    'Кома — пауза як частина великого шляху',
    'Кома — тобі є що сказати далі',
    'Кома — не час здаватися'
  ];

  // ✅ ведемо на /support (без /partials/)
  const SUPPORT_URL = '/support';

  // Почекати на елемент (partials можуть вантажитись асинхронно)
  function waitFor(sel, { timeout = 10000 } = {}) {
    const el = document.querySelector(sel);
    if (el) return Promise.resolve(el);
    return new Promise((res, rej) => {
      const mo = new MutationObserver(() => {
        const n = document.querySelector(sel);
        if (n) { mo.disconnect(); res(n); }
      });
      mo.observe(document.documentElement, { childList: true, subtree: true });
      setTimeout(() => { mo.disconnect(); rej(new Error('timeout')); }, timeout);
    });
  }

  async function init() {
    try {
      const phraseEl = await waitFor('#komaPhrase, .koma-phrase');
      const helpBtn  = await waitFor('#komaHelpBtn, #komaHelp, #komaBtn, .koma-help');

      // Ротація фраз кожні 5 секунд
      let i = 0;
      phraseEl.textContent = PHRASES[i];
      setInterval(() => {
        i = (i + 1) % PHRASES.length;
        phraseEl.textContent = PHRASES[i];
      }, 5000);

      const openSupport = () => { window.location.href = SUPPORT_URL; };
      phraseEl.addEventListener('click', openSupport);
      helpBtn.addEventListener('click', openSupport);
    } catch (e) {
      console.warn('[support.js]', e.message);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
