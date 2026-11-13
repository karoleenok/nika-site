import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanAnswers, flaggedBlocks, readable, ANALYSES } from '../src/leads/quiz.js';
import { fullAnswers, schema } from './quiz-fixture.js';

const liv = (n) => schema.blocks.find((b) => b.id === 'liv').items.filter((i) => i.kind === 's').slice(0, n).map((i) => i.id);

test('корректная анкета проходит, лишнее вычищается', () => {
  const raw = fullAnswers();
  raw.a.diseases = { sel: ['none'], otherOn: false, other: 'не должно попасть' };
  const ok = cleanAnswers(raw);
  assert.ok(ok);
  assert.deepEqual(ok.a.diseases, { sel: ['none'] });
  assert.equal(ok.a.sex, 'f');
});

test('чужие поля, варианты и пункты другого пола отклоняются', () => {
  assert.equal(cleanAnswers(null), null);
  assert.equal(cleanAnswers({ a: {}, c: {} }), null);
  const r1 = fullAnswers(); r1.a.hack = 1; assert.equal(cleanAnswers(r1), null);
  const r2 = fullAnswers(); r2.a.diet = { sel: ['нет-такого'] }; assert.equal(cleanAnswers(r2), null);
  const r3 = fullAnswers(); r3.c.male_01 = true; assert.equal(cleanAnswers(r3), null);    // мужской пункт у женщины
  const r4 = fullAnswers(); r4.a.height = 5; assert.equal(cleanAnswers(r4), null);
  const r5 = fullAnswers(); delete r5.c[schema.blocks[0].items.find((i) => i.kind === 'q').id]; assert.equal(cleanAnswers(r5), null); // не все да/нет
  const r6 = fullAnswers(); r6.a.diseases = { sel: ['none', 'gi'] }; assert.equal(cleanAnswers(r6), null);
  const r7 = fullAnswers(); r7.a.request = { sel: [], otherOn: true, other: '   ' }; assert.equal(cleanAnswers(r7), null);
});

test('пол определяет блок: мужчине женский блок не нужен, женщине мужской', () => {
  assert.ok(cleanAnswers(fullAnswers({ sex: 'm' })));
  const m = fullAnswers({ sex: 'm' }); m.c.fem_02 = true; assert.equal(cleanAnswers(m), null);
});

test('порог блока: 3 пункта не выделяют, 4 выделяют; числа и неучитываемые пункты не считаются', () => {
  assert.deepEqual(flaggedBlocks(cleanAnswers(fullAnswers({ check: liv(3) }))), []);
  assert.deepEqual(flaggedBlocks(cleanAnswers(fullAnswers({ check: liv(4) }))), ['liv']);
  const fe = schema.blocks.find((b) => b.id === 'fe').items.find((i) => i.count === false);
  assert.ok(fe);
  assert.deepEqual(flaggedBlocks(cleanAnswers(fullAnswers({ check: [...liv(3), fe.id] }))), []);
});

test('для Ники ответы читаются словами', () => {
  const ans = cleanAnswers(fullAnswers({ check: liv(4) }));
  const r = readable(ans);
  assert.equal(r[0].a[0], 'женский');
  const block = r.find((x) => x.q.startsWith('печень'));
  assert.ok(block.q.includes('выделен'));
  assert.equal(ANALYSES.liv, 'печень и желчный пузырь');
  assert.ok(block.a.length >= 4);
});
