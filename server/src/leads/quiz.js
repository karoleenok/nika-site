// Анкета теста на главной (оверлей js/quiz-overlay.js). Вопросы, пороги и тексты живут в js/quiz-data.js;
// сервер читает их из quiz-schema.json, который собирает server/scripts/build-quiz-schema.js.
// При любой правке вопросов: поднять VERSION в quiz-data.js, запустить скрипт, закоммитить оба файла.
import fs from 'node:fs';

const schema = JSON.parse(fs.readFileSync(new URL('./quiz-schema.json', import.meta.url), 'utf8'));
const STEPS = schema.steps;
const BLOCKS = schema.blocks;

export const VERSION = schema.version;
export const CONSENT_VERSION = '2026-11-13';         // согласие на обработку ПД (legal/consent.html)
export const HEALTH_CONSENT_VERSION = '2026-11-13';  // согласие на данные о здоровье (legal/consent-health.html)

// Названия блоков для экрана Ники (в базе у анкеты лежат id блоков, которые выделил тест)
export const ANALYSES = Object.fromEntries(BLOCKS.map((b) => [b.id, b.short]));

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const text = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
const round1 = (v) => Math.round(v * 10) / 10;

// Род в формулировках, как на странице (gx в js/quiz-data.js): «сдавал(а)» → «сдавала» / «сдавал»
const gx = (t, sex) => (sex !== 'f' && sex !== 'm' ? t : String(t)
  .replace(/прошёл\(ла\)/g, sex === 'f' ? 'прошла' : 'прошёл')
  .replace(/(\p{L})\((а|ла)\)/gu, (_, c, e) => c + (sex === 'f' ? e : '')));

const visibleBlocks = (sex) => BLOCKS.filter((b) => !b.sex || b.sex === sex);
const visibleItems = (b, sex) => b.items.filter((i) => !i.sex || i.sex === sex);

// Проверка ответов. Принимает { a: ответы части 1, c: чек-лист части 2 }.
// Возвращает очищенную копию или null. Лишние поля, чужие варианты и пункты другого пола не пропускаем.
export function cleanAnswers(raw) {
  if (!isObj(raw) || !isObj(raw.a) || !isObj(raw.c)) return null;
  const A = raw.a, a = {};
  if (Object.keys(A).some((k) => !STEPS.some((s) => s.id === k))) return null;

  for (const s of STEPS) {
    const v = A[s.id];
    if (s.type === 'sex' || s.type === 'level') {
      if (typeof v !== 'string' || !s.options.some((o) => o.id === v)) return null;
      a[s.id] = v;
    } else if (s.type === 'wheel') {
      if (!isNum(v) || v < s.min || v > s.max) return null;
      a[s.id] = round1(Math.round(v / s.step) * s.step);
    } else if (s.type === 'chips') {
      if (!isObj(v) || !Array.isArray(v.sel)) return null;
      const ids = [...new Set(v.sel)];
      if (ids.some((x) => typeof x !== 'string' || !s.options.some((o) => o.id === x))) return null;
      if (!s.multi && ids.length > 1) return null;
      const only = s.options.filter((o) => o.only).map((o) => o.id);
      if (ids.length > 1 && ids.some((x) => only.includes(x))) return null;      // «нет» вместе с заболеваниями
      const other = v.otherOn === true && s.other ? text(v.other, 200) : '';
      if (v.otherOn === true && !s.other) return null;
      if (v.otherOn === true && !other) return null;
      if (!ids.length && !other) return null;
      a[s.id] = other ? { sel: ids, other } : { sel: ids };
    } else if (s.type === 'yn') {
      if (!isObj(v) || typeof v.yes !== 'boolean') return null;
      a[s.id] = v.yes ? { yes: true, text: text(v.text, 300) } : { yes: false };
    } else return null;
  }

  const C = raw.c, c = {};
  const items = visibleBlocks(a.sex).flatMap((b) => visibleItems(b, a.sex));
  const ids = new Set(items.map((i) => i.id));
  if (Object.keys(C).some((k) => !ids.has(k))) return null;
  for (const i of items) {
    const v = C[i.id];
    if (i.kind === 's') { if (v === true) c[i.id] = true; else if (v !== undefined && v !== false) return null; }
    else if (i.kind === 'q') { if (typeof v !== 'boolean') return null; c[i.id] = v; }
    else if (i.kind === 'n') {
      if (!isNum(v) || !i.num || v < i.num.min || v > i.num.max) return null;
      c[i.id] = Math.round(v);
    }
  }
  return { a, c };
}

// Сколько пунктов блока отмечено: считаются симптомы и «да», числа и информационные пункты нет
const countOf = (b, ans) => visibleItems(b, ans.a.sex).filter((i) => i.count && i.kind !== 'n' && ans.c[i.id] === true).length;

// Блоки, где набрался порог. Те же правила, что на странице (js/quiz-overlay.js, flagged).
export function flaggedBlocks(ans) {
  return visibleBlocks(ans.a.sex).filter((b) => countOf(b, ans) >= b.threshold).map((b) => b.id);
}

// Ответы человеческими словами — для экрана Ники
export function readable(ans) {
  const out = [], sx = ans.a?.sex, g = (t) => gx(t, sx);
  for (const s of STEPS) {
    const v = ans.a?.[s.id];
    if (v == null) continue;
    const label = (id) => { const o = s.options?.find((x) => x.id === id); return g(o ? (o.sub ? `${o.label} (${o.sub})` : o.label) : id); };
    let a;
    if (s.type === 'sex' || s.type === 'level') a = [label(v)];
    else if (s.type === 'wheel') a = [`${String(v).replace('.', ',')} ${s.unit}`];
    else if (s.type === 'chips') a = [...v.sel.map(label), ...(v.other ? [`другое: ${v.other}`] : [])];
    else a = [v.yes ? (v.text ? `да: ${v.text}` : 'да') : 'нет'];
    out.push({ q: g(s.title), a });
  }
  for (const b of visibleBlocks(ans.a?.sex)) {
    const items = visibleItems(b, ans.a.sex), n = countOf(b, ans);
    const a = [];
    for (const i of items) {
      const v = ans.c?.[i.id];
      if (i.kind === 's') { if (v === true) a.push(g(i.text)); }
      else if (i.kind === 'q') a.push(`${g(i.text)} ${v ? 'да' : 'нет'}`);
      else if (i.kind === 'n' && v != null) a.push(`${i.text} ${v} ${i.num?.unit ?? ''}`.trim());
    }
    out.push({ q: `${b.short}: отмечено ${n}, порог ${b.threshold}${n >= b.threshold ? ' (выделен)' : ''}`, a });
  }
  return out;
}
