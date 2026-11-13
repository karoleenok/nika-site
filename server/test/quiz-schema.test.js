import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildSchema, OUT } from '../scripts/build-quiz-schema.js';

// Если правили js/quiz-data.js, нужно перегенерировать: node scripts/build-quiz-schema.js
test('quiz-schema.json совпадает с js/quiz-data.js', { skip: !fs.existsSync(new URL('../../js/quiz-data.js', import.meta.url)) && 'в образе нет папки сайта' }, () => {
  assert.deepEqual(JSON.parse(fs.readFileSync(OUT, 'utf8')), JSON.parse(JSON.stringify(buildSchema())));
});
