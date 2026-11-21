'use strict';
const test = require('node:test');
const assert = require('node:assert');
const core = require('../src/core/content');
const content = require('../content/content.json');

test('банк заданий без ошибок разметки', () => {
  assert.deepStrictEqual(core.validate(content), []);
});

test('в каждом деле и тренировке есть ошибка, правило известно', () => {
  content.cases.forEach((c) => assert.ok(core.errorsOf(c.text).length >= 2, c.title));
  Object.keys(content.rules).forEach((r) => assert.ok((content.drills[r] || []).length >= 1, `нет тренировок для ${r}`));
});

test('parse делит текст на слова, знаки и ошибки', () => {
  const t = core.parse('Принеси {лошку|ложку:parn:ложечка}, фонарик.');
  assert.deepStrictEqual(t.map((x) => x.t), ['w', 'p', 'e', 'p', 'w', 'p']);
  const e = t[2];
  assert.strictEqual(e.text, 'лошку');
  assert.strictEqual(e.right, 'ложку');
  assert.strictEqual(e.rule, 'parn');
  assert.strictEqual(e.check, 'ложечка');
});

test('ошибка из двух слов остаётся одной уликой', () => {
  const t = core.parse('Он {под бежал|подбежал:prist} к реке.');
  const errs = t.filter((x) => x.t === 'e');
  assert.strictEqual(errs.length, 1);
  assert.strictEqual(errs[0].text, 'под бежал');
});

test('norm: ё = е, лишние пробелы не важны, регистр важен', () => {
  assert.strictEqual(core.norm(' звёздное '), core.norm('звездное'));
  assert.strictEqual(core.norm('в  магазин'), 'в магазин');
  assert.notStrictEqual(core.norm('москвы'), core.norm('Москвы'));
});

test('validate находит неизвестное правило и пустой текст', () => {
  const bad = { rules: { a: { quiz: { opts: ['x'], a: 0 } } }, cases: [{ title: 'т', text: '{x|y:zzz}' }, { title: 'пусто', text: 'нет ошибок' }], drills: {} };
  const p = core.validate(bad);
  assert.ok(p.some((s) => s.includes('zzz')));
  assert.ok(p.some((s) => s.includes('нет ни одной ошибки')));
});

test('pickCase предпочитает слабые правила и не повторяет последнее дело', () => {
  const profile = { stats: { capital: { ok: 0, miss: 5 } }, lastCase: null };
  const c = core.pickCase(content, profile, () => 0);
  assert.ok(core.errorsOf(c.text).some((e) => e.rule === 'capital'));
  const again = core.pickCase(content, Object.assign({}, profile, { lastCase: c.title }), () => 0);
  assert.notStrictEqual(again.title, c.title);
});

test('pickDrill идёт по кругу', () => {
  const a = core.pickDrill(content, { drillIndex: { parn: 0 } }, 'parn');
  const b = core.pickDrill(content, { drillIndex: { parn: 1 } }, 'parn');
  const c = core.pickDrill(content, { drillIndex: { parn: content.drills.parn.length } }, 'parn');
  assert.notStrictEqual(a.text, b.text);
  assert.strictEqual(a.text, c.text);
  assert.strictEqual(core.pickDrill(content, {}, 'nope'), null);
});

test('scoreTask: чистое дело даёт бонус', () => {
  const tokens = core.parse(content.cases[0].text).map((t) => (t.t === 'e' ? Object.assign(t, { state: 'ok', tries: 0 }) : t));
  const r = core.scoreTask({ tokens, falseHits: 0, hint: false });
  assert.strictEqual(r.clean, true);
  assert.strictEqual(r.coins, 3 * 15 + 20);
  assert.deepStrictEqual(r.reviewRules, []);
});

test('scoreTask: пропуск и ложное обвинение', () => {
  const tokens = core.parse(content.cases[0].text);
  const errs = tokens.filter((t) => t.t === 'e');
  errs[0].state = 'ok'; errs[0].tries = 0;
  errs[1].state = 'half'; errs[1].tries = 1;
  const r = core.scoreTask({ tokens, falseHits: 2, hint: true });
  assert.strictEqual(r.clean, false);
  assert.strictEqual(r.found, 1);
  assert.strictEqual(r.coins, 15 + 10 - 6 - 5);
  assert.deepStrictEqual(r.reviewRules, [errs[1].rule, errs[2].rule]);
});

test('очки не уходят в минус', () => {
  const tokens = core.parse(content.cases[0].text);
  const r = core.scoreTask({ tokens, falseHits: 10, hint: true });
  assert.strictEqual(r.coins, 0);
});

test('applyStats считает пойманные и ушедшие', () => {
  const tokens = core.parse('{a|b:x} {c|d:x} {e|f:y}');
  const errs = tokens.filter((t) => t.t === 'e');
  errs[0].state = 'ok'; errs[0].tries = 0;
  errs[1].state = 'ok'; errs[1].tries = 1;
  const s = core.applyStats({ x: { ok: 1, miss: 0 } }, tokens);
  assert.deepStrictEqual(s, { x: { ok: 2, miss: 1 }, y: { ok: 0, miss: 1 } });
});

test('rankOf', () => {
  assert.strictEqual(core.rankOf(0).rank.n, 'Стажёр');
  assert.strictEqual(core.rankOf(299).next.n, 'Сыщик');
  assert.strictEqual(core.rankOf(1500).rank.n, 'Старший детектив');
  assert.strictEqual(core.rankOf(1500).next, null);
});

test('банк: нет повторов, в деле 2–4 ошибки, на каждое правило хватает коротких дел', () => {
  const texts = content.cases.map((c) => c.text).concat(...Object.values(content.drills));
  assert.strictEqual(new Set(texts).size, texts.length, 'тексты повторяются');
  content.cases.forEach((c) => {
    const n = core.errorsOf(c.text).length;
    assert.ok(n >= 2 && n <= 4, `«${c.title}»: ошибок ${n}`);
    assert.ok(c.title && c.intro, 'нужны название и вступление');
  });
  Object.keys(content.rules).forEach((r) => {
    assert.ok((content.drills[r] || []).length >= 5, `мало коротких дел на «${r}»`);
    (content.drills[r] || []).forEach((t) => core.errorsOf(t).forEach((e) => assert.strictEqual(e.rule, r, t)));
  });
  texts.forEach((t) => core.parse(t).filter((x) => x.t !== 'e').forEach((x) => assert.ok(!/[{}|]/.test(x.text), `сломанная разметка: ${t}`)));
});
