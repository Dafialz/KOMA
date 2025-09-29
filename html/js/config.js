// js/config.js
(function (w) {
  // Вкажи тут точний домен свого бекенду на Render
  // приклад: https://koma-uuae.onrender.com
  const PROD = 'https://koma-uuae.onrender.com';

  // Якщо тимчасово хочеш вимкнути бекенд — постав '', і фронт піде на поточний origin
  w.API_BASE = PROD;

  // На майбутнє: спільний таймаут для фетчів (якщо знадобиться)
  w.API_TIMEOUT = 15000;
})(window);
