// html/js/guard.js
(function(global){
  const SESSION_KEY = 'koma_session';

  // Дозволені користувачі
  const allowlist = [
    'oksanakokoten@gmail.com',
    'andriysavchuk@gmail.com',
    'irynashevchenko@gmail.com',
    'maksymkoval@gmail.com',
    'nadiyaromaniyk@gmail.com',
    'oleglitvin@gmail.com'
  ];

  // Відображення email -> ім'я для генерації кімнати
  const names = {
    'oksanakokoten@gmail.com': 'Оксана Кокотень',
    'andriysavchuk@gmail.com': 'Андрій Савчук',
    'irynashevchenko@gmail.com': 'Ірина Шевченко',
    'maksymkoval@gmail.com': 'Максим Коваль',
    'nadiyaromaniyk@gmail.com': 'Надія Романюк',
    'oleglitvin@gmail.com': 'Олег Литвин'
  };

  function getSession(){
    try{
      const raw = localStorage.getItem(SESSION_KEY);
      if(!raw) return null;
      const s = JSON.parse(raw);
      if(!s.email || !s.exp) return null;
      if(Date.now() > s.exp) { localStorage.removeItem(SESSION_KEY); return null; }
      return s;
    }catch{ return null; }
  }

  function protect(){
    const s = getSession();
    if(!s || !allowlist.includes(s.email.toLowerCase())){
      // якщо нема доступу — на логін
      const base = location.pathname.replace(/[^/]+$/,'');
      location.replace(`${base}login.html`);
    }
  }

  function logout(){
    localStorage.removeItem(SESSION_KEY);
    const base = location.pathname.replace(/[^/]+$/,'');
    location.replace(`${base}login.html`);
  }

  function emailToName(email){
    return names[email.toLowerCase()];
  }

  global.guard = { protect, logout, getSession, emailToName };
})(window);
