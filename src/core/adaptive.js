// Адаптивная нагрузка: уровень сложности держит точность ребёнка в коридоре 75–85 %,
// а объём занятия подбирается так, чтобы оно длилось 2–3 минуты.
// Файл работает и в Node (main-процесс, тесты), и в окне занятия (браузер).
(function (root) {
  'use strict';

  const TARGET_LO = 0.75; // ниже — упрощаем
  const TARGET_HI = 0.85; // выше — усложняем
  const MIN_ITEMS = 6; // столько ответов нужно на текущем уровне, прежде чем его менять
  const WINDOW = 20; // точность считается по последним ответам
  const KEEP_ITEMS = 40;
  const TASK_CAP = 12; // страховка: больше дел за занятие не даём

  // Уровни русского. parts — из чего собрана записка: короткое дело (drill, 2 ошибки на одно правило)
  // или обычное дело (case, 3 ошибки на разные правила). showCount — говорить, сколько ошибок.
  // showRules — подсказывать, на какие правила ошибки. freeHint — лупа без штрафа.
  const RU_LEVELS = [
    null,
    { parts: ['drill'], showCount: true, showRules: true, freeHint: true, label: 'короткая записка, правило подсказано' },
    { parts: ['drill'], showCount: true, showRules: false, freeHint: false, label: 'короткая записка' },
    { parts: ['case'], showCount: true, showRules: true, freeHint: false, label: 'записка, правила подсказаны' },
    { parts: ['case'], showCount: true, showRules: false, freeHint: false, label: 'записка на 3 ошибки' },
    { parts: ['case', 'drill'], showCount: true, showRules: false, freeHint: false, label: 'длинная записка на 5 ошибок' },
    { parts: ['case', 'drill'], showCount: false, showRules: false, freeHint: false, label: 'длинная записка, число ошибок не сказано' },
    { parts: ['case', 'case'], showCount: false, showRules: false, freeHint: false, label: 'две записки, 6 ошибок, число не сказано' },
  ];

  // Уровни английского. pics — картинок на выбор в радиоперехвате; alts — сколько ложных вариантов
  // показывать в записке (Infinity — все); readBox — с какой коробки слово только читается глазами;
  // review — сколько слов повторять; showCount — говорить, сколько ошибок в записке.
  const EN_LEVELS = [
    null,
    { pics: 3, alts: 0, readBox: 3, review: 3, showCount: true, label: '3 картинки, 2 варианта в записке' },
    { pics: 4, alts: 1, readBox: 2, review: 4, showCount: true, label: '4 картинки, 3 варианта в записке' },
    { pics: 4, alts: Infinity, readBox: 2, review: 5, showCount: true, label: '4 картинки, все варианты' },
    { pics: 4, alts: Infinity, readBox: 1, review: 6, showCount: false, label: 'больше чтения, число ошибок не сказано' },
    { pics: 6, alts: Infinity, readBox: 1, review: 8, showCount: false, label: '6 картинок, больше слов' },
  ];

  const START = { ru: 4, en: 3 }; // стартовые уровни = как было до адаптивности
  const LEVELS = { ru: RU_LEVELS, en: EN_LEVELS };
  const maxLevel = (subject) => LEVELS[subject].length - 1;

  // Сколько секунд в среднем занимает шаг, пока своих замеров нет.
  const DEFAULT_SEC = {
    'ru:drill': 40, 'ru:case': 70, 'ru:case+drill': 100, 'ru:case+case': 130, 'ru:review': 35,
    'en:word': 9, 'en:phonics': 20, 'en:intercept': 60, 'en:note': 45, 'en:drill': 40, 'en:review': 30,
  };

  function ensure(state, subject) {
    const s = Object.assign({ level: START[subject] || 3, items: [], since: 0, sec: {}, changes: [] }, state || {});
    s.level = Math.min(maxLevel(subject), Math.max(1, Math.round(Number(s.level) || START[subject] || 3)));
    if (!Array.isArray(s.items)) s.items = [];
    if (!s.sec || typeof s.sec !== 'object') s.sec = {};
    if (!Array.isArray(s.changes)) s.changes = [];
    s.since = Math.max(0, Number(s.since) || 0);
    return s;
  }

  function levelOf(subject, level) {
    return LEVELS[subject][Math.min(maxLevel(subject), Math.max(1, level))];
  }

  function mean(arr) {
    return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
  }

  // Точность по последним ответам (0–1) или null, если ответов нет.
  function accuracy(state, n) {
    return mean(state.items.slice(-(n || WINDOW)));
  }

  // Записать ответы (1 — верно, 0 — ошибка, 0.5 — наполовину) и, если набралось достаточно
  // ответов на текущем уровне, сдвинуть уровень. Возвращает { state, change: -1 | 0 | 1 }.
  function record(stateIn, subject, items, now) {
    const s = ensure(JSON.parse(JSON.stringify(stateIn || {})), subject);
    const clean = (items || []).map(Number).filter((x) => Number.isFinite(x)).map((x) => Math.min(1, Math.max(0, x)));
    s.items = s.items.concat(clean).slice(-KEEP_ITEMS);
    s.since += clean.length;
    let change = 0;
    if (s.since >= MIN_ITEMS) {
      const acc = mean(s.items.slice(-Math.min(s.since, WINDOW)));
      if (acc > TARGET_HI && s.level < maxLevel(subject)) change = 1;
      else if (acc < TARGET_LO && s.level > 1) change = -1;
      if (change) {
        s.level += change;
        s.since = 0;
        s.changes = s.changes.concat([{ at: now || Date.now(), level: s.level, acc: Math.round(acc * 100) }]).slice(-30);
      }
    }
    return { state: s, change };
  }

  // Время шага: скользящее среднее, чтобы прогноз подстраивался под ребёнка.
  function noteTime(stateIn, key, sec) {
    const s = Object.assign({}, stateIn, { sec: Object.assign({}, (stateIn && stateIn.sec) || {}) });
    const v = Math.min(600, Math.max(3, Number(sec) || 0));
    const old = s.sec[key];
    s.sec[key] = old ? Math.round((old * 0.6 + v * 0.4) * 10) / 10 : v;
    return s;
  }

  function estTime(state, key) {
    return (state && state.sec && state.sec[key]) || DEFAULT_SEC[key] || 60;
  }

  // Давать ли ещё одно задание. elapsed и est — в секундах.
  // До нижней границы продолжаем всегда; дальше — только если задание успеет закончиться до верхней.
  function shouldContinue({ elapsed, est, minSec, maxSec, tasks }) {
    if ((tasks || 0) >= TASK_CAP) return false;
    if (elapsed >= maxSec) return false;
    if (elapsed < minSec) return true;
    return elapsed + est <= maxSec;
  }

  // Какое русское задание дать следующим. Если по уровню задание не успеет уложиться в верхнюю
  // границу, а короткое успеет, даём короткое. null — занятие пора заканчивать.
  function nextRuKind(state, { elapsed, minSec, maxSec, tasks }) {
    const kind = levelOf('ru', state.level).parts.join('+');
    // После дела с промахами идёт разбор правила: закладываем его с вероятностью промаха.
    const acc = accuracy(state);
    const pad = (1 - (acc == null ? 0.8 : acc)) * estTime(state, 'ru:review') * 2;
    const est = estTime(state, 'ru:' + kind) + pad;
    if (shouldContinue({ elapsed, est, minSec, maxSec, tasks })) {
      // До нижней границы далеко, но длинное задание сильно перевалит за верхнюю: берём короткое.
      if (elapsed + est > maxSec + 20 && kind !== 'drill') return 'drill';
      return kind;
    }
    if (kind !== 'drill' && shouldContinue({ elapsed, est: estTime(state, 'ru:drill'), minSec, maxSec, tasks })) return 'drill';
    return null;
  }

  // Вступление к делу без фраз про число ошибок: их число меняется вместе с уровнем.
  function stripCount(intro) {
    const parts = String(intro || '').split(/(?<=[.!?])\s+/).filter((x) => x && !/\d|ошиб/i.test(x));
    return parts.join(' ') || 'Безграмотный снова наследил.';
  }

  const api = {
    RU_LEVELS, EN_LEVELS, START, TARGET_LO, TARGET_HI, MIN_ITEMS, WINDOW, TASK_CAP, DEFAULT_SEC,
    ensure, levelOf, maxLevel, accuracy, record, noteTime, estTime, shouldContinue, nextRuKind, stripCount,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OshibkinAdaptive = api;
})(typeof self !== 'undefined' ? self : this);
