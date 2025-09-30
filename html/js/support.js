// support.js — віджет «Кома»: ротація слоганів + перехід на сторінку підтримки
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

  // частини підвантажуються через partials → чекаємо появи елементів
  function waitFor(sel, t = 10000) {
    return new Promise((res, rej) => {
      const ready = () => {
        const el = document.querySelector(sel);
        if (el) return res(el);
      };
      ready();
      const mo = new MutationObserver(ready);
      mo.observe(document.documentElement, { childList: true, subtree: true });
      setTimeout(() => { mo.disconnect(); rej(new Error('timeout ' + sel)); }, t);
    });
  }

  async function init() {
    try {
      const phraseEl = await waitFor('#komaPhrase');
      const btn      = await waitFor('#komaBtn');

      // ротація кожні 5 сек
      let i = 0;
      phraseEl.textContent = PHRASES[i];
      setInterval(() => {
        i = (i + 1) % PHRASES.length;
        phraseEl.textContent = PHRASES[i];
      }, 5000);

      // перехід на сторінку підтримки (видима всім)
      const go = (newTab = false) => {
        const href = (location.pathname.replace(/[^/]+$/, '')) + 'support.html';
        if (newTab) window.open(href, '_blank');
        else location.href = href;
      };
      btn.addEventListener('click', e => {
        if (e.ctrlKey || e.metaKey) go(true); else go(false);
      });
    } catch (e) {
      // тихо, щоб не ламати сторінку
      console.warn('[support.js]', e.message);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
