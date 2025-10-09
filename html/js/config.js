// js/config.js
(function (w) {
  // HTTP база бекенду (Render)
  // !!! якщо домен інший — заміни обидва значення нижче
  const PROD_HTTP = 'https://koma-uaue.onrender.com';
  const PROD_WS   = 'wss://koma-uaue.onrender.com';

  // Використовуємо прод
  w.API_BASE   = PROD_HTTP;
  w.SIGNAL_URL = PROD_WS;

  // Опційно: таймаут для фетчів
  w.API_TIMEOUT = 15000;
})(window);
