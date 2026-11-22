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

  // Первое дело занятия. Дела не повторяются, пока не пройдены все (кроме трёх последних
  // запасных); среди непройденных чаще выпадают дела со «слабыми» правилами.
  function pickCase(content, profile, rnd) {
    const random = rnd || Math.random;
    const cases = content.cases;
    const stats = profile && profile.stats;
    const last = profile && profile.lastCase;
    const seen = (profile && profile.seenCases) || [];
    const keep = Math.min(seen.length, Math.max(0, cases.length - 3));
    const recent = new Set(keep ? seen.slice(-keep) : []);
    if (last && cases.length > 1) recent.add(last);
    let pool = cases.filter((c) => !recent.has(c.title));
    if (!pool.length) pool = cases.filter((c) => c.title !== last);
    if (!pool.length) pool = cases;
    const w = pool.map((c) => errorsOf(c.text).reduce((s, e) => s + ruleWeight(stats, e.rule), 0));
    let r = random() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < pool.length; i++) {
      r -= w[i];
      if (r < 0) return pool[i];
    }
    return pool[pool.length - 1];
  }

  // Учёт пройденных дел: последние не больше 200 названий.
  function rememberCase(seen, title) {
    return (seen || []).filter((t) => t !== title).concat([title]).slice(-200);
  }

  // Короткое дело на одно правило, по кругу.
  function pickDrill(content, profile, rule) {
    const list = (content.drills && content.drills[rule]) || [];
    if (!list.length) return null;
    const used = (profile && profile.drillIndex && profile.drillIndex[rule]) || 0;
    return { rule, text: list[used % list.length], index: used % list.length };
  }

  // Звание по сумме заработанных коинов.
  // Звания: коины за всё время, а для двух высших ещё и уверенно пойманные правила.
  const RANKS = [
    { n: 'Стажёр', at: 0 },
    { n: 'Сыщик', at: 300 },
    { n: 'Инспектор', at: 800 },
    { n: 'Старший детектив', at: 1500 },
    { n: 'Инспектор угрозыска', at: 3000 },
    { n: 'Майор сыска', at: 5000 },
    { n: 'Полковник сыска', at: 8000 },
    { n: 'Комиссар', at: 12000, rules: 7 },
    { n: 'Легенда сыска', at: 18000, rules: 10 },
  ];
  // Правило поймано уверенно: без ошибки не меньше 5 раз и ошибок меньше, чем верных.
  function masteredRules(stats) {
    return Object.keys(stats || {}).filter((r) => stats[r].ok >= 5 && stats[r].miss < stats[r].ok).length;
  }
  function rankOf(total, stats) {
    const m = masteredRules(stats);
    const ok = (x) => total >= x.at && m >= (x.rules || 0);
    let i = 0;
    RANKS.forEach((x, k) => { if (ok(x) && k === i + 1) i = k; });
    const next = RANKS[i + 1] || null;
    const need = next ? { coins: Math.max(0, next.at - total), rules: Math.max(0, (next.rules || 0) - m) } : null;
    return { rank: RANKS[i], next, need, mastered: m };
  }
  // Что осталось до следующего звания, по-человечески.
  function needText(r) {
    if (!r.next) return 'Высшее звание получено';
    const parts = [];
    if (r.need.coins) parts.push(`${r.need.coins} коинов`);
    if (r.need.rules) parts.push(`уверенно поймать ещё ${r.need.rules} ${r.need.rules === 1 ? 'правило' : r.need.rules < 5 ? 'правила' : 'правил'}`);
    return `До звания «${r.next.n}»: ${parts.join(' и ')}`;
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

  const api = { parse, norm, errorsOf, validate, ruleWeight, pickCase, rememberCase, pickDrill, rankOf, needText, masteredRules, scoreTask, applyStats, RANKS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OshibkinCore = api;
})(typeof self !== 'undefined' ? self : this);
