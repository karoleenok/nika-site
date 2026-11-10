/* Срок сессии на стороне браузера (ДЕМО). В боевой версии сессия живёт в HttpOnly-куке от сервера,
   срок и продление задаёт сервер; этот файл удаляется. В хранилище лежит время окончания, а не флаг:
   просроченная сессия не пускает в кабинет, даже если запись осталась. */
(() => {
  'use strict';
  const read = k => { try { return localStorage.getItem(k) || sessionStorage.getItem(k); } catch (_) { return null; } };
  window.NikaSession = {
    active(key) { return Number(read(key)) > Date.now(); },
    /* persist = «запомнить меня»: хранится days дней в localStorage; без галочки живёт до закрытия вкладки */
    start(key, days, persist) {
      const exp = String(Date.now() + (persist ? days : 1) * 864e5);
      try { (persist ? localStorage : sessionStorage).setItem(key, exp); (persist ? sessionStorage : localStorage).removeItem(key); } catch (_) {}
    },
    end(key) { try { localStorage.removeItem(key); sessionStorage.removeItem(key); } catch (_) {} }
  };
})();
