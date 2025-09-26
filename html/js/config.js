// html/js/config.js
// Базовий URL API (залежно від середовища)
export const API_BASE = (location.hostname === 'localhost')
  ? 'http://localhost:3000'
  : 'https://koma-uaue.onrender.com';
