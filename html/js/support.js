// support.js — віджет «Кома» + модалка підтримки
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

  // Дочікуємося появи елементів (partials можуть підвантажуватись асинхронно)
  function waitFor(selector, {timeout = 10000} = {}) {
    return new Promise((resolve, reject) => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);

      const obs = new MutationObserver(() => {
        const found = document.querySelector(selector);
        if (found) {
          obs.disconnect();
          resolve(found);
        }
      });
      obs.observe(document.documentElement, {childList: true, subtree: true});

      setTimeout(() => {
        obs.disconnect();
        reject(new Error(`Timeout waiting for ${selector}`));
      }, timeout);
    });
  }

  async function init() {
    try {
      const phraseEl = await waitFor('#komaPhrase');
      const btn      = await waitFor('#komaBtn');
      const modal    = await waitFor('#komaModal');
      const closeBtn = await waitFor('#komaClose');
      const cancel   = await waitFor('#komaCancel');
      const form     = await waitFor('#komaForm');

      // Ротація фраз
      let idx = 0;
      phraseEl.textContent = PHRASES[idx];
      setInterval(() => {
        idx = (idx + 1) % PHRASES.length;
        phraseEl.textContent = PHRASES[idx];
      }, 5000);

      // Відкриття / закриття модалки
      const open = () => {
        modal.setAttribute('aria-hidden', 'false');
        btn.setAttribute('aria-expanded', 'true');
        // фокус у форму
        const first = form.querySelector('input, textarea');
        first && first.focus();
      };
      const close = () => {
        modal.setAttribute('aria-hidden', 'true');
        btn.setAttribute('aria-expanded', 'false');
      };

      btn.addEventListener('click', open);
      closeBtn.addEventListener('click', close);
      cancel.addEventListener('click', close);
      modal.querySelector('.koma-modal__backdrop').addEventListener('click', close);
      document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

      // Імітація відправки форми
      form.addEventListener('submit', e => {
        e.preventDefault();
        form.querySelector('#komaOk').style.display = 'block';
        setTimeout(() => {
          form.reset();
          form.querySelector('#komaOk').style.display = 'none';
          close();
        }, 1200);
      });
    } catch (e) {
      // тихо фейлитися, щоб не ламати сторінку
      console.warn('[support.js]', e.message);
    }
  }

  // Старт після DOM готовий
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
