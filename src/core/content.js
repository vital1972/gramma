// Разбор текста записки и адаптивный подбор дел.
// Файл работает и в Node (main-процесс, тесты), и в окне занятия (браузер).
(function (root) {
  'use strict';

  // Разметка ошибки: {неправильно|правильно:правило:проверка}
  const ERROR_RE = /\{([^|}]+)\|([^:}]+):(\w+)(?::([^}]+))?\}/g;
  const WORD_RE = /([А-Яа-яЁё-]+)/;

  function parse(text) {
    const out = [];
    const plain = (s) => {
      s.split(WORD_RE).forEach((p, i) => {
        if (!p) return;
        out.push(i % 2 ? { t: 'w', text: p } : { t: 'p', text: p });
      });
    };
    let last = 0;
    let m;
    ERROR_RE.lastIndex = 0;
    while ((m = ERROR_RE.exec(text))) {
      plain(text.slice(last, m.index));
      out.push({ t: 'e', text: m[1], right: m[2], rule: m[3], check: m[4] || '' });
      last = ERROR_RE.lastIndex;
    }
    plain(text.slice(last));
    return out;
  }

  // Сравнение ответа: пробелы схлопываются, ё = е, регистр важен (правило о большой букве).
  function norm(s) {
    return String(s).trim().replace(/\s+/g, ' ').replace(/ё/g, 'е').replace(/Ё/g, 'Е');
  }

  function errorsOf(text) {
    return parse(text).filter((t) => t.t === 'e');
  }

  // Проверка банка заданий: каждое правило в разметке должно существовать.
  function validate(content) {
    const problems = [];
    if (!content || typeof content !== 'object') return ['нет содержимого'];
    const rules = content.rules || {};
    const check = (where, text) => {
      const errs = errorsOf(text);
      if (!errs.length) problems.push(`${where}: в тексте нет ни одной ошибки`);
      errs.forEach((e) => {
        if (!rules[e.rule]) problems.push(`${where}: неизвестное правило «${e.rule}»`);
        if (norm(e.text) === norm(e.right)) problems.push(`${where}: ошибка совпадает с ответом «${e.text}»`);
      });
    };
    (content.cases || []).forEach((c, i) => check(`дело ${i + 1} «${c.title}»`, c.text));
    Object.keys(content.drills || {}).forEach((r) => {
      if (!rules[r]) problems.push(`тренировки: неизвестное правило «${r}»`);
      (content.drills[r] || []).forEach((t, i) => check(`тренировка ${r} №${i + 1}`, t));
    });
    Object.keys(rules).forEach((r) => {
      const q = rules[r].quiz;
      if (!q || !Array.isArray(q.opts) || q.a == null || !q.opts[q.a]) problems.push(`правило ${r}: плохой вопрос`);
    });
    if (!(content.cases || []).length) problems.push('нет ни одного дела');
    return problems;
  }

  // Вес правила: чем чаще ошибается, тем чаще правило попадается.
  function ruleWeight(stats, rule) {
    const st = (stats && stats[rule]) || { ok: 0, miss: 0 };
    const w = 1 + st.miss * 2 - st.ok * 0.5;
    return Math.max(0.3, w);
  }

  // Первое дело занятия: смешанное, с самыми «слабыми» правилами, не повторяя последнее.
  function pickCase(content, profile, rnd) {
    const random = rnd || Math.random;
    const cases = content.cases;
    const last = profile && profile.lastCase;
    const scored = cases.map((c, i) => {
      const w = errorsOf(c.text).reduce((s, e) => s + ruleWeight(profile && profile.stats, e.rule), 0);
      return { i, w: c.title === last && cases.length > 1 ? 0 : w + random() * 0.5 };
    });
    scored.sort((a, b) => b.w - a.w);
    return cases[scored[0].i];
  }

  // Короткое дело на одно правило, по кругу.
  function pickDrill(content, profile, rule) {
    const list = (content.drills && content.drills[rule]) || [];
    if (!list.length) return null;
    const used = (profile && profile.drillIndex && profile.drillIndex[rule]) || 0;
    return { rule, text: list[used % list.length], index: used % list.length };
  }

  // Звание по сумме заработанных коинов.
  const RANKS = [
    { n: 'Стажёр', at: 0 },
    { n: 'Сыщик', at: 300 },
    { n: 'Инспектор', at: 800 },
    { n: 'Старший детектив', at: 1500 },
  ];
  function rankOf(total) {
    let r = RANKS[0];
    RANKS.forEach((x) => { if (total >= x.at) r = x; });
    const next = RANKS.find((x) => x.at > total) || null;
    return { rank: r, next };
  }

  // Подсчёт итогов одного дела. tokens — результат parse() со статусами ошибок.
  // Статус ошибки: 'ok' — найдена и исправлена, 'half' — найдена, исправлена неверно, иначе — пропущена.
  function scoreTask(task) {
    const errs = task.tokens.filter((t) => t.t === 'e');
    const missed = errs.filter((e) => e.state !== 'ok');
    const clean = !missed.length && !task.falseHits && !task.hint && errs.every((e) => !e.tries);
    let coins = 0;
    errs.forEach((e) => {
      if (e.state === 'ok') coins += 15; // найдена (+10) и исправлена (+5)
      else if (e.state === 'half') coins += 10;
    });
    coins -= 3 * (task.falseHits || 0);
    if (task.hint) coins -= 5;
    coins = Math.max(0, coins);
    if (clean) coins += 20;
    const reviewRules = [];
    errs.forEach((e) => {
      if ((e.state !== 'ok' || e.tries) && !reviewRules.includes(e.rule)) reviewRules.push(e.rule);
    });
    return { coins, clean, found: errs.length - missed.length, total: errs.length, missed, reviewRules };
  }

  // Обновление статистики правил после дела.
  function applyStats(stats, tokens) {
    const s = Object.assign({}, stats);
    tokens.filter((t) => t.t === 'e').forEach((e) => {
      const st = Object.assign({ ok: 0, miss: 0 }, s[e.rule]);
      if (e.state === 'ok' && !e.tries) st.ok++;
      else st.miss++;
      s[e.rule] = st;
    });
    return s;
  }

  const api = { parse, norm, errorsOf, validate, ruleWeight, pickCase, pickDrill, rankOf, scoreTask, applyStats, RANKS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OshibkinCore = api;
})(typeof self !== 'undefined' ? self : this);
