/* Загрузка видео частями прямо в хранилище (S3), минуя наш сервер.
   Части по 10 МБ, 3 параллельно на телефоне и 4 на компьютере, до 5 попыток на часть с нарастающей паузой.
   Пропала связь: ждём её молча («продолжим сами»), попытки не тратим.
   Обновили страницу: сервер помнит загрузку, Ника выбирает тот же файл, докачиваются только недостающие части.
   Одновременно идёт одна загрузка. Состояние слушают экраны админки через NikaUpload.subscribe. */
(() => {
  'use strict';
  const api = window.NikaApi;
  const MAX_TRY = 5;
  const URL_FRESH_MS = 12 * 60 * 1000;   // подпись живёт 15 минут, обновляем заранее
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const backoff = n => Math.min(16000, 1000 * 2 ** (n - 1)) + Math.random() * 400;   // 1, 2, 4, 8, 16 с
  const parallel = () => (window.matchMedia && matchMedia('(pointer: coarse)').matches ? 3 : 4);
  const fingerprint = f => [f.name, f.size, f.lastModified].join('|');
  const online = () => navigator.onLine !== false;
  const waitOnline = () => new Promise(res => {
    if (online()) { setTimeout(res, 1500); return; }
    const t = setInterval(() => { if (online()) done(); }, 5000);   // на случай, если событие не придёт
    const done = () => { clearInterval(t); window.removeEventListener('online', done); setTimeout(res, 800); };
    window.addEventListener('online', done);
  });

  /* Проверка до загрузки: у MP4 на 5–8 байте стоит метка ftyp. MOV с айфона сюда не пройдёт. */
  const checkFile = async file => {
    if (!file) return 'Выбери файл.';
    if (file.size > 2 * 1024 ** 3) return 'Файл больше 2 ГБ. Сожми его или раздели на части.';
    if (!file.size) return 'Файл пустой.';
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    let sig = '';
    try { sig = String.fromCharCode.apply(null, new Uint8Array(await file.slice(4, 8).arrayBuffer())); } catch (_) {}
    if (ext === 'mov' || file.type === 'video/quicktime') return 'Это MOV (формат айфона). Нужен MP4: сохрани или экспортируй видео в MP4.';
    if (sig !== 'ftyp' || (ext !== 'mp4' && ext !== 'm4v')) return 'Нужен файл в формате MP4.';
    return '';
  };

  const listeners = new Set();
  let cur = null;   // { videoId, state, cancel, retry }
  const publish = () => listeners.forEach(fn => { try { fn(cur); } catch (_) {} });

  /* Экран не гаснет, пока идёт загрузка (если браузер умеет) */
  let wake = null;
  const holdScreen = async () => { try { if ('wakeLock' in navigator && !wake && document.visibilityState === 'visible') { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch (_) { wake = null; } };
  const freeScreen = () => { try { if (wake) wake.release(); } catch (_) {} wake = null; };
  const busy = () => !!cur && ['prepare', 'uploading', 'offline', 'finishing'].includes(cur.state.phase);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && busy()) holdScreen(); });
  window.addEventListener('beforeunload', e => { if (busy()) { e.preventDefault(); e.returnValue = ''; } });

  function start(videoId, file) {
    if (busy()) return null;
    const total = file.size;
    const doneBytes = new Map(), live = new Map(), urls = new Map(), xhrs = new Set();
    let uploadId = null, partSize = 0, partCount = 0, stopped = false, run = 0;
    const state = { phase: 'prepare', loaded: 0, total, pct: 0, error: '', fileName: file.name };
    const ctl = { videoId: String(videoId), state, cancel, retry };
    cur = ctl;

    const sum = m => { let s = 0; m.forEach(v => { s += v; }); return s; };
    const emit = (patch) => {
      Object.assign(state, patch || {});
      state.loaded = Math.min(total, sum(doneBytes) + sum(live));
      state.pct = total ? Math.min(100, Math.floor(state.loaded / total * 100)) : 0;
      publish();
    };
    const fail = (msg) => { if (stopped) return; stopped = true; xhrs.forEach(x => x.abort()); freeScreen(); emit({ phase: 'error', error: msg }); };

    /* Запрос к нашему серверу. Нет связи — ждём её и повторяем, не тратя попытки. */
    const call = async (fn) => {
      for (let i = 1; ; i++) {
        const r = await fn();
        if (r.ok || (r.status && r.status < 500 && r.status !== 429)) return r;
        if (r.status === 0) { if (stopped) return r; emit({ phase: 'offline' }); await waitOnline(); if (!stopped) emit({ phase: 'uploading' }); i--; continue; }
        if (i >= MAX_TRY) return r;
        await sleep(backoff(i));
      }
    };

    const sign = async (need) => {
      const r = await call(() => api.post('/api/admin/uploads/' + uploadId + '/sign', { parts: need }));
      if (!r.ok) throw new Error(r.data.error || 'Не получилось подготовить загрузку.');
      const at = Date.now();
      Object.keys(r.data.urls).forEach(n => urls.set(Number(n), { url: r.data.urls[n], at }));
    };
    let queue = [];
    const urlFor = async (n) => {
      const c = urls.get(n);
      if (c && Date.now() - c.at < URL_FRESH_MS) return c.url;
      const batch = [n].concat(queue.filter(x => { const u = urls.get(x); return !u || Date.now() - u.at >= URL_FRESH_MS; }).slice(0, 19));
      await sign(batch);
      return urls.get(n).url;
    };

    const put = (url, blob, n) => new Promise(res => {
      const x = new XMLHttpRequest(); xhrs.add(x);
      x.open('PUT', url);
      x.upload.onprogress = e => { live.set(n, e.loaded); emit(); };
      x.onload = () => { xhrs.delete(x); res(x.status); };
      x.onerror = x.ontimeout = () => { xhrs.delete(x); res(0); };
      x.onabort = () => { xhrs.delete(x); res(-1); };
      x.timeout = 5 * 60 * 1000;
      x.send(blob);
    });

    const sendPart = async (n) => {
      const blob = file.slice((n - 1) * partSize, Math.min(n * partSize, total));
      for (let i = 1; i <= MAX_TRY; i++) {
        if (stopped) return;
        let url;
        try { url = await urlFor(n); } catch (e) { fail(e.message); return; }
        const st = await put(url, blob, n);
        live.delete(n);
        if (st === -1 || stopped) return;
        if (st >= 200 && st < 300) { doneBytes.set(n, blob.size); emit(); return; }
        if (st === 0 && !online()) { emit({ phase: 'offline' }); await waitOnline(); if (stopped) return; emit({ phase: 'uploading' }); i--; continue; }
        if (st === 403) urls.delete(n);   // подпись устарела — возьмём новую
        emit();
        if (i < MAX_TRY) await sleep(backoff(i));
      }
      fail('Не получилось загрузить часть файла. Проверь интернет и нажми «повторить».');
    };

    async function go() {
      const my = ++run; stopped = false; urls.clear(); live.clear();
      emit({ phase: 'prepare', error: '' });
      holdScreen();
      const init = await call(() => api.post('/api/admin/videos/' + videoId + '/upload', { size: total, type: 'video/mp4', fingerprint: fingerprint(file) }));
      if (my !== run || stopped) return;
      if (!init.ok) { fail(init.data.error); return; }
      ({ uploadId, partSize, partCount } = init.data);
      ctl.uploadId = uploadId;
      doneBytes.clear();
      init.data.done.forEach(n => doneBytes.set(n, Math.min(partSize, total - (n - 1) * partSize)));
      for (;;) {
        queue = [];
        for (let n = 1; n <= partCount; n++) if (!doneBytes.has(n)) queue.push(n);
        emit({ phase: 'uploading' });
        const worker = async () => { while (queue.length && !stopped) await sendPart(queue.shift()); };
        await Promise.all(Array.from({ length: Math.min(parallel(), queue.length || 1) }, worker));
        if (stopped || my !== run) return;
        emit({ phase: 'finishing' });
        const fin = await call(() => api.post('/api/admin/uploads/' + uploadId + '/complete'));
        if (my !== run || stopped) return;
        if (fin.ok) { freeScreen(); emit({ phase: 'done' }); return; }
        if (fin.status === 409) {   // хранилище недосчиталось частей: узнаём каких и докачиваем
          const p = await call(() => api.get('/api/admin/uploads/' + uploadId + '/parts'));
          if (!p.ok) { fail(p.data.error); return; }
          doneBytes.clear(); p.data.done.forEach(n => doneBytes.set(n, Math.min(partSize, total - (n - 1) * partSize)));
          if (p.data.done.length >= partCount) { fail('Не получилось собрать файл. Нажми «повторить».'); return; }
          continue;
        }
        fail(fin.data.error); return;
      }
    }
    function retry() { if (state.phase === 'error') go(); }
    async function cancel() {
      stopped = true; run++; xhrs.forEach(x => x.abort()); freeScreen();
      if (uploadId) await api.del('/api/admin/uploads/' + uploadId);
      emit({ phase: 'canceled' });
      if (cur === ctl) cur = null;
      publish();
    }
    go();
    return ctl;
  }

  window.NikaUpload = {
    checkFile, start,
    current: () => cur,
    clear: () => { if (cur && !busy()) { cur = null; publish(); } },
    subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); }
  };
})();
