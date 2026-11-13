/* Запросы к серверу. Кука сессии HttpOnly: скрипты её не видят, браузер прикладывает сам. */
(() => {
  'use strict';
  const call = async (method, url, body) => {
    let res;
    try {
      res = await fetch(url, {
        method, credentials: 'same-origin', cache: 'no-store',
        headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch (_) {
      return { ok: false, status: 0, data: { error: 'Нет связи. Проверь интернет и попробуй ещё раз.' } };
    }
    let data = {};
    try { data = await res.json(); } catch (_) {}
    if (!res.ok && !data.error) data.error = 'Что-то пошло не так. Попробуй ещё раз.';
    return { ok: res.ok, status: res.status, data };
  };
  window.NikaApi = {
    get: url => call('GET', url),
    post: (url, body) => call('POST', url, body || {}),
    put: (url, body) => call('PUT', url, body || {}),
    del: url => call('DELETE', url),
    request: (method, url, body) => call(method, url, body),
    /* Пускает на страницу только с действующей сессией, иначе на экран входа */
    async gate(kind) {
      document.documentElement.style.visibility = 'hidden';
      const r = await call('GET', kind === 'admin' ? '/api/admin/me' : '/api/me');
      if (!r.ok) { location.replace('login.html'); return null; }
      document.documentElement.style.visibility = '';
      return r.data;
    },
    async logout(kind) { await call('POST', '/api/auth/logout', { kind }); location.replace('login.html'); }
  };
})();
