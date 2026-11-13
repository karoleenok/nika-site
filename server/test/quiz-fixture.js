// Полная корректная анкета для тестов: строится по схеме, чтобы не ломаться при правке вопросов.
import fs from 'node:fs';
export const schema = JSON.parse(fs.readFileSync(new URL('../src/leads/quiz-schema.json', import.meta.url), 'utf8'));

export function fullAnswers({ sex = 'f', check = [] } = {}) {
  const a = {};
  for (const s of schema.steps) {
    if (s.type === 'sex') a[s.id] = sex;
    else if (s.type === 'level') a[s.id] = s.options[0].id;
    else if (s.type === 'wheel') a[s.id] = s.min + s.step * 5;
    else if (s.type === 'chips') a[s.id] = { sel: [s.options[0].id], otherOn: false, other: '' };
    else a[s.id] = { yes: false, text: '' };
  }
  const c = {};
  for (const b of schema.blocks) if (!b.sex || b.sex === sex) for (const i of b.items) {
    if (i.sex && i.sex !== sex) continue;
    if (i.kind === 'q') c[i.id] = false;
    if (i.kind === 'n') c[i.id] = i.num.min;
    if (check.includes(i.id)) c[i.id] = true;
  }
  return { a, c };
}
