'use strict';
const test = require('node:test');
const assert = require('node:assert');
const AD = require('../src/core/adaptive');
const core = require('../src/core/content');
const content = require('../content/content.json');

test('стартовый уровень: как было до адаптивности', () => {
  assert.strictEqual(AD.ensure(null, 'ru').level, 4);
  assert.strictEqual(AD.ensure(undefined, 'en').level, 3);
  assert.strictEqual(AD.ensure({ level: 99 }, 'ru').level, AD.maxLevel('ru'));
});

test('точность выше 85 % — уровень растёт, ниже 75 % — падает, в коридоре — стоит', () => {
  let r = AD.record(null, 'ru', [1, 1, 1, 1, 1, 1], 0);
  assert.strictEqual(r.change, 1);
  assert.strictEqual(r.state.level, 5);
  assert.strictEqual(r.state.since, 0);
  r = AD.record(null, 'ru', [1, 0, 0, 1, 0, 1], 0);
  assert.strictEqual(r.change, -1);
  r = AD.record(null, 'ru', [1, 1, 1, 1, 0, 1, 1, 1, 1, 0], 0); // 80 %
  assert.strictEqual(r.change, 0);
  assert.strictEqual(r.state.level, 4);
});

test('уровень не меняется, пока ответов меньше шести', () => {
  const r = AD.record(null, 'ru', [1, 1, 1], 0);
  assert.strictEqual(r.change, 0);
  assert.strictEqual(r.state.since, 3);
});

test('уровень не выходит за границы', () => {
  assert.strictEqual(AD.record({ level: 1 }, 'ru', [0, 0, 0, 0, 0, 0], 0).state.level, 1);
  assert.strictEqual(AD.record({ level: 5 }, 'en', [1, 1, 1, 1, 1, 1], 0).state.level, 5);
});

test('время шага — скользящее среднее', () => {
  let s = AD.ensure(null, 'ru');
  assert.strictEqual(AD.estTime(s, 'ru:case'), AD.DEFAULT_SEC['ru:case']);
  s = AD.noteTime(s, 'ru:case', 100);
  assert.strictEqual(AD.estTime(s, 'ru:case'), 100);
  s = AD.noteTime(s, 'ru:case', 50);
  assert.strictEqual(AD.estTime(s, 'ru:case'), 80);
});

test('занятие длится от нижней до верхней границы', () => {
  const w = { minSec: 120, maxSec: 180 };
  assert.ok(AD.shouldContinue({ elapsed: 100, est: 200, ...w, tasks: 1 }));
  assert.ok(AD.shouldContinue({ elapsed: 130, est: 40, ...w, tasks: 3 }));
  assert.ok(!AD.shouldContinue({ elapsed: 150, est: 40, ...w, tasks: 3 }));
  assert.ok(!AD.shouldContinue({ elapsed: 50, est: 10, ...w, tasks: AD.TASK_CAP }));
});

test('если записка уровня не влезает, даём короткое дело', () => {
  const s = AD.ensure({ level: 7 }, 'ru');
  assert.strictEqual(AD.nextRuKind(s, { elapsed: 10, minSec: 120, maxSec: 180, tasks: 0 }), 'case+case');
  assert.strictEqual(AD.nextRuKind(s, { elapsed: 125, minSec: 120, maxSec: 180, tasks: 2 }), 'drill');
  assert.strictEqual(AD.nextRuKind(s, { elapsed: 170, minSec: 120, maxSec: 180, tasks: 2 }), null);
});

test('вступление без числа ошибок', () => {
  assert.strictEqual(AD.stripCount('Безграмотный оставил записку. В ней 3 ошибки, по ним мы его вычислим.'), 'Безграмотный оставил записку.');
  assert.strictEqual(AD.stripCount('По этим ошибкам мы его вычислим. Их здесь 3.'), 'Безграмотный снова наследил.');
});

test('записки всех уровней собираются из банка', () => {
  for (let l = 1; l <= AD.maxLevel('ru'); l++) {
    const kind = AD.levelOf('ru', l).parts.join('+');
    const t = core.buildTask(content, { stats: {}, seenCases: [], drillIndex: {} }, kind, () => 0.3);
    const n = core.errorsOf(t.text).length;
    const want = AD.levelOf('ru', l).parts.reduce((a, p) => a + (p === 'drill' ? 2 : 3), 0);
    assert.strictEqual(n, want, `уровень ${l}`);
    assert.strictEqual(t.caseTitles.length + t.drillRules.length, AD.levelOf('ru', l).parts.length);
  }
  const two = core.buildTask(content, { stats: {}, seenCases: [], drillIndex: {} }, 'case+case', Math.random);
  assert.notStrictEqual(two.caseTitles[0], two.caseTitles[1]);
});

// Симуляция: ребёнок, у которого вероятность ответить верно падает с уровнем.
// Уровень должен сам прийти туда, где точность в коридоре 75–85 %.
test('симуляция: точность сходится к коридору 75–85 %', () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  [[0.97, 0.04], [0.99, 0.03], [0.9, 0.05]].forEach(([p0, drop]) => {
    let s = AD.ensure(null, 'ru');
    const tail = [];
    for (let task = 0; task < 300; task++) {
      const p = Math.max(0.05, p0 - drop * s.level);
      const items = [0, 1, 2].map(() => (rnd() < p ? 1 : 0));
      s = AD.record(s, 'ru', items, task).state;
      if (task >= 100) tail.push(...items);
    }
    const acc = tail.reduce((a, b) => a + b, 0) / tail.length;
    assert.ok(acc > 0.7 && acc < 0.9, `p0=${p0}: точность ${Math.round(acc * 100)} %`);
  });
});
