// Анкета по витаминам и анализам. Один источник для страницы теста и для сервера:
// страница берёт вопросы через GET /api/quiz, сервер по ним же проверяет ответы и считает список анализов.
//
// ЧЕРНОВИК. Вопросы и связи «симптом → анализ» составлены по общим рекомендациям,
// а не по опросу Ники (опрос.docx). Заменить на её вопросы и согласовать список с ней.
// При любой правке вопросов поднять VERSION: у каждой анкеты в базе видно, какой набор она видела.

export const VERSION = 'draft-2026-11-13';
export const CONSENT_VERSION = '2026-11-13';         // согласие на обработку ПД (legal/consent.html)
export const HEALTH_CONSENT_VERSION = '2026-11-13';  // согласие на данные о здоровье (legal/consent-health.html)

export const ANALYSES = {
  cbc: 'общий анализ крови',
  ferritin: 'ферритин',
  iron: 'сывороточное железо',
  vitd: 'витамин D (25-OH)',
  b12: 'витамин B12',
  folate: 'фолиевая кислота',
  tsh: 'ТТГ',
  ft4: 'Т4 свободный',
  mg: 'магний',
  ca: 'кальций',
  zinc: 'цинк',
  glucose: 'глюкоза',
  hba1c: 'гликированный гемоглобин',
};
const BASE = ['cbc', 'vitd'];   // этот минимум попадает в список всегда

export const QUESTIONS = [
  { id: 'symptoms', type: 'multi', required: true, title: 'Что из этого бывает у тебя часто?', hint: 'Отметь всё, что подходит.',
    options: [
      { id: 'tired', label: 'усталость и слабость, даже после сна', a: ['ferritin', 'b12', 'tsh'] },
      { id: 'sleepy', label: 'сонливость днём', a: ['ferritin', 'tsh', 'b12'] },
      { id: 'hair', label: 'выпадают волосы, ломкие ногти', a: ['ferritin', 'zinc', 'tsh'] },
      { id: 'pale', label: 'бледность, одышка на лестнице', a: ['ferritin', 'iron'] },
      { id: 'cramps', label: 'судороги и подёргивания мышц', a: ['mg', 'ca'] },
      { id: 'tingle', label: 'онемение или покалывание в руках и ногах', a: ['b12', 'folate'] },
      { id: 'cold', label: 'мёрзну, когда другим нормально', a: ['tsh', 'ft4', 'ferritin'] },
      { id: 'colds', label: 'часто простываю', a: ['zinc'] },
      { id: 'mood', label: 'плохое настроение, раздражительность', a: ['b12', 'tsh'] },
      { id: 'sweet', label: 'тянет на сладкое, сильная жажда', a: ['glucose', 'hba1c'] },
      { id: 'none', label: 'ничего из этого', a: [], only: true },
    ] },
  { id: 'food', type: 'one', required: true, title: 'Как ты питаешься?',
    options: [
      { id: 'all', label: 'ем всё, включая мясо и рыбу', a: [] },
      { id: 'little_meat', label: 'мясо и рыбу ем редко', a: ['ferritin', 'b12'] },
      { id: 'veg', label: 'вегетарианство или веганство', a: ['ferritin', 'b12', 'zinc'] },
      { id: 'diet', label: 'сижу на строгой диете', a: ['ferritin', 'b12', 'mg'] },
    ] },
  { id: 'sun', type: 'one', required: true, title: 'Сколько ты бываешь на солнце?',
    options: [
      { id: 'often', label: 'часто, гуляю днём', a: [] },
      { id: 'rare', label: 'редко, в основном в помещении', a: ['vitd'] },
    ] },
  { id: 'last', type: 'one', required: true, title: 'Когда ты в последний раз сдавал(а) анализы?',
    options: [
      { id: 'half', label: 'меньше полугода назад', a: [] },
      { id: 'year', label: 'полгода — год назад', a: [] },
      { id: 'long', label: 'больше года назад или не помню', a: [] },
    ] },
  { id: 'note', type: 'text', required: false, title: 'Что ещё хочешь рассказать Нике?', hint: 'Необязательно. До 500 символов.', max: 500 },
];

const byId = new Map(QUESTIONS.map((q) => [q.id, q]));

// Публичная форма вопросов: без связей с анализами, чтобы ответы не подгоняли под список
export const publicQuestions = () => ({
  version: VERSION,
  healthConsentVersion: HEALTH_CONSENT_VERSION,
  questions: QUESTIONS.map(({ id, type, required, title, hint, max, options }) => ({
    id, type, required, title, hint, max, options: options?.map(({ id: oid, label, only }) => ({ id: oid, label, only: !!only })),
  })),
});

// Проверка ответов. Возвращает очищенные ответы или null. Лишние поля и чужие варианты не пропускаем.
export function cleanAnswers(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (Object.keys(raw).some((k) => !byId.has(k))) return null;
  const out = {};
  for (const q of QUESTIONS) {
    const v = raw[q.id];
    if (q.type === 'text') {
      if (v == null || v === '') { if (q.required) return null; continue; }
      if (typeof v !== 'string') return null;
      const s = v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, q.max);
      if (s) out[q.id] = s;
      continue;
    }
    const ids = new Set(q.options.map((o) => o.id));
    if (q.type === 'one') {
      if (v == null) { if (q.required) return null; continue; }
      if (typeof v !== 'string' || !ids.has(v)) return null;
      out[q.id] = v;
    } else {
      if (!Array.isArray(v) || v.length > q.options.length) return null;
      const pick = [...new Set(v)];
      if (pick.some((x) => typeof x !== 'string' || !ids.has(x))) return null;
      if (q.required && !pick.length) return null;
      const only = q.options.filter((o) => o.only).map((o) => o.id);
      if (pick.length > 1 && pick.some((x) => only.includes(x))) return null;   // «ничего из этого» вместе с симптомами
      out[q.id] = pick;
    }
  }
  return out;
}

// Предварительный список анализов. Порядок — как в словаре ANALYSES.
export function analysesFor(answers) {
  const set = new Set(BASE);
  for (const q of QUESTIONS) {
    if (!q.options) continue;
    const v = answers[q.id];
    for (const o of q.options) if (v === o.id || (Array.isArray(v) && v.includes(o.id))) o.a.forEach((x) => set.add(x));
  }
  return Object.keys(ANALYSES).filter((k) => set.has(k));
}

// Ответы человеческими словами — для экрана Ники
export function readable(answers) {
  return QUESTIONS.filter((q) => answers[q.id] != null).map((q) => {
    const v = answers[q.id];
    if (q.type === 'text') return { q: q.title, a: [v] };
    const label = (id) => q.options.find((o) => o.id === id)?.label ?? id;
    return { q: q.title, a: Array.isArray(v) ? v.map(label) : [label(v)] };
  });
}
