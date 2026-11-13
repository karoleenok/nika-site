// Собирает server/src/leads/quiz-schema.json из js/quiz-data.js (единственный источник вопросов и порогов).
// Зачем файл: в боевой образ попадает только папка server/, а js/quiz-data.js лежит на сайте.
// Запуск: node scripts/build-quiz-schema.js  (из папки server). Тест server/test/quiz-schema.test.js следит, чтобы файл не отстал.
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const SRC = new URL('../../js/quiz-data.js', import.meta.url);
export const OUT = new URL('../src/leads/quiz-schema.json', import.meta.url);

export function buildSchema() {
  const win = {};
  vm.runInNewContext(fs.readFileSync(SRC, 'utf8'), { window: win }, { filename: 'quiz-data.js' });
  const D = win.NikaQuizData;
  if (!D) throw new Error('quiz-data.js не создал window.NikaQuizData');
  const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
  return {
    version: D.VERSION,
    steps: D.STEPS.map((s) => ({
      ...pick(s, ['id', 'type', 'title', 'unit', 'min', 'max', 'step', 'multi', 'other', 'ask']),
      options: s.options?.map((o) => pick(o, ['id', 'label', 'sub', 'only'])),
    })),
    blocks: D.BLOCKS.map((b) => ({
      ...pick(b, ['id', 'short', 'threshold', 'repro', 'sex']),
      items: b.items.map((i) => ({ id: i.id, kind: i.kind, text: i.text, sex: i.sex, count: i.count, num: i.num })),
    })),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(OUT, JSON.stringify(buildSchema(), null, 1) + '\n');
  console.log('quiz-schema.json обновлён');
}
