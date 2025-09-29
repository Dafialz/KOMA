// js/config.js
(function (w) {
  // TODO: постав тут СВОЮ адресу бекенду Render.
  // За твоїми логами це виглядає як koma-uuae.onrender.com — перевір точний URL.
  const PROD = 'https://koma-uuae.onrender.com';

  // Якщо бекенд тимчасово відсутній — постав порожній рядок '', тоді увімкнеться локальний фолбек.
  w.API_BASE = PROD;

  // Таймаут для мережевих запитів
  w.API_TIMEOUT = 15000;
})(window);
