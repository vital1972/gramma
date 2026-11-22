'use strict';
const test = require('node:test');
const assert = require('node:assert');
const en = require('../src/core/english');
const bank = require('../content/english.json');

const DAY = 24 * 3600 * 1000;
const seq = (...xs) => { let i = 0; return () => xs[i++ % xs.length]; };

test('английский банк без ошибок разметки, у каждого слова в текстах есть перевод', () => {
  assert.deepStrictEqual(en.validate(bank), []);
});

test('в каждой главе есть слова, перехваты, записки и тренировки на её бандита', () => {
  bank.chapters.forEach((c) => {
    assert.ok(c.words.length >= 10, c.id);
    assert.ok(bank.intercepts.filter((x) => x.ch === c.id).length >= c.clues, `${c.id}: перехватов меньше, чем улик`);
    assert.ok(bank.notes.filter((x) => x.ch === c.id).length >= 2, c.id);
    assert.ok((bank.drills[c.rule] || []).length >= 3, c.rule);
  });
});

test('у слов в банке разные картинки', () => {
  const pics = Object.values(bank.words).map((w) => w.e);
  assert.strictEqual(new Set(pics).size, pics.length);
});

test('validate находит слово без перевода и ложный вариант, равный ответу', () => {
  const bad = JSON.parse(JSON.stringify(bank));
  bad.intercepts[0].text = 'Meet me at the spaceship.';
  bad.notes[0].text = 'He {like|likes:ps3:likes} cheese.';
  const p = en.validate(bad).join('\n');
  assert.match(p, /spaceship/);
  assert.match(p, /ложный вариант/);
});

test('parse: латинские слова, ошибка с ложными вариантами', () => {
  const t = en.parse('The baker {like|likes:ps3:liking/liked} cheese.');
  assert.deepStrictEqual(t.map((x) => x.t), ['w', 'p', 'w', 'p', 'e', 'p', 'w', 'p']);
  const e = t[4];
  assert.strictEqual(e.right, 'likes');
  assert.deepStrictEqual(e.alts, ['liking', 'liked']);
});

test('коробки: верно — дальше и реже, ошибка — снова в первую', () => {
  const now = 1e12;
  let s = en.answerWord(undefined, true, now);
  assert.strictEqual(s.box, 1);
  assert.strictEqual(s.due, now + DAY);
  s = en.answerWord(s, true, now);
  assert.strictEqual(s.box, 2);
  assert.strictEqual(s.due, now + 3 * DAY);
  s = en.answerWord(s, false, now);
  assert.strictEqual(s.box, 1);
  assert.strictEqual(s.due, now);
  for (let i = 0; i < 10; i++) s = en.answerWord(s, true, now);
  assert.strictEqual(s.box, 5);
});

test('план первого занятия: два новых слова первой главы, перехват и записка этой главы', () => {
  const p = en.planSession(bank, null, { now: 1e12, rnd: seq(0.1) });
  assert.strictEqual(p.chapter.id, 'london');
  assert.ok(p.firstEver && p.chapterStart);
  assert.deepStrictEqual(p.fresh, bank.chapters[0].words.slice(0, 2));
  assert.deepStrictEqual(p.review, []);
  assert.strictEqual(p.intercept.ch, 'london');
  assert.strictEqual(p.note.ch, 'london');
});

test('слова, которым пора, идут на повторение; при большом хвосте новых нет', () => {
  const now = 1e12;
  const pen = en.ensure({ sessions: 3 });
  bank.chapters[0].words.slice(0, 2).forEach((w) => { pen.words[w] = { box: 1, due: now - 1, ok: 1, miss: 0 }; });
  let p = en.planSession(bank, pen, { now, newWords: 2 });
  assert.deepStrictEqual(p.review.sort(), bank.chapters[0].words.slice(0, 2).sort());
  assert.strictEqual(p.fresh.length, 2);
  Object.keys(bank.words).slice(0, 25).forEach((w) => { pen.words[w] = { box: 1, due: now - 1, ok: 0, miss: 1 }; });
  p = en.planSession(bank, pen, { now, newWords: 2 });
  assert.strictEqual(p.fresh.length, 0);
  assert.strictEqual(p.review.length, 6);
});

test('улики: глава закрывается, когда собраны улики и показаны все слова', () => {
  const now = 1e12;
  const ch = bank.chapters[0];
  let pen = en.ensure({});
  ch.words.slice(0, 3).forEach((w) => { pen.words[w] = { box: 1, due: now + DAY }; });
  const ids = bank.intercepts.filter((x) => x.ch === ch.id).map((x) => x.id);
  for (let i = 0; i < ch.clues; i++) {
    const r = en.applyResult(bank, pen, { intercept: ids[i % ids.length] }, now);
    pen = r.pen;
    assert.strictEqual(r.arrest, null, 'слова ещё не все показаны');
  }
  ch.words.forEach((w) => { pen.words[w] = pen.words[w] || { box: 1, due: now + DAY }; });
  const r = en.applyResult(bank, pen, { intercept: ids[0] }, now);
  assert.strictEqual(r.arrest, ch.rule);
  assert.strictEqual(r.pen.chapter, 1);
  assert.deepStrictEqual(r.pen.arrested, [ch.rule]);
});

test('после всех глав — патруль, улики больше не копятся', () => {
  const pen = en.ensure({ chapter: bank.chapters.length, sessions: 7 });
  const { patrol, chapter } = en.chapterOf(bank, pen);
  assert.ok(patrol);
  const r = en.applyResult(bank, pen, { intercept: bank.intercepts.find((x) => x.ch === chapter.id).id }, 1e12);
  assert.strictEqual(r.arrest, null);
  assert.ok(en.planSession(bank, pen, { now: 1e12 }).intercept);
});

test('статистика записки и тренировки', () => {
  const tokens = en.parse('He {like|likes:ps3:liking} it. She {go|goes:ps3:gos} home.');
  tokens[2].state = 'ok';
  const errs = tokens.filter((t) => t.t === 'e');
  errs[0].state = 'ok';
  const r = en.applyResult(bank, en.ensure({}), { note: { id: 'Lz1', tokens }, drillRule: 'ps3' }, 1e12);
  assert.deepStrictEqual(r.pen.stats.ps3, { ok: 1, miss: 1 });
  assert.deepStrictEqual(r.pen.notesSeen, ['Lz1']);
  assert.strictEqual(r.pen.drillIndex.ps3, 1);
  const sc = en.scoreNote(tokens, 1);
  assert.strictEqual(sc.coins, 12);
  assert.strictEqual(sc.missed.length, 1);
});

test('чередование 2 : 1, русский первым', () => {
  const s = { subjectMode: 'mix', ratioRu: 2, ratioEn: 1, firstSubject: 'ru' };
  const d = new Date(2026, 10, 23, 15); // понедельник
  let q = { day: '', pos: 0 };
  const got = [];
  for (let i = 0; i < 6; i++) {
    got.push(en.nextSubject(s, q, d));
    q = en.advanceQueue(q, d);
  }
  assert.deepStrictEqual(got, ['ru', 'ru', 'en', 'ru', 'ru', 'en']);
  // Новый день — очередь сначала.
  assert.strictEqual(en.nextSubject(s, q, new Date(2026, 10, 24, 9)), 'ru');
});

test('режимы: только русский, только английский, английский первым, выходные', () => {
  const d = new Date(2026, 10, 23, 15);
  const q = { day: '', pos: 0 };
  assert.strictEqual(en.nextSubject({ subjectMode: 'ru' }, q, d), 'ru');
  assert.strictEqual(en.nextSubject({ subjectMode: 'en' }, q, d), 'en');
  assert.strictEqual(en.nextSubject({ subjectMode: 'mix', ratioRu: 2, ratioEn: 1, firstSubject: 'en' }, q, d), 'en');
  assert.strictEqual(en.nextSubject({ subjectMode: 'mix', ratioRu: 2, ratioEn: 0 }, q, d), 'ru');
  const sat = new Date(2026, 10, 28, 12);
  const s = { subjectMode: 'mix', ratioRu: 2, ratioEn: 1, weekendRatioRu: 1, weekendRatioEn: 1, firstSubject: 'ru' };
  const q1 = en.advanceQueue({ day: '', pos: 0 }, sat);
  assert.strictEqual(en.nextSubject(s, q1, sat), 'en');
  assert.strictEqual(en.nextSubject(s, q1, d), 'ru', 'в будни пропорция обычная, а очередь другого дня не считается');
});

test('звания Интерпола по выученным словам', () => {
  assert.strictEqual(en.rankOf(0).rank.n, 'Переводчик-стажёр');
  assert.strictEqual(en.rankOf(20).rank.n, 'Агент');
  assert.strictEqual(en.rankOf(70).next, null);
});

test('варианты картинок: четыре разных, среди них верная', () => {
  const o = en.wordOptions(bank, 'cake', en.ensure({}), seq(0.3, 0.7, 0.1));
  assert.strictEqual(o.length, 4);
  assert.ok(o.includes('cake'));
  assert.strictEqual(new Set(o).size, 4);
});
