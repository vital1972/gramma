// Английская часть: «Дело Интерпола». Повторение слов по коробкам, выбор предмета, главы и улики.
// Файл работает и в Node (main-процесс, тесты), и в окне занятия (браузер).
(function (root) {
  'use strict';

  const DAY = 24 * 3600 * 1000;
  // Через сколько дней слово возвращается на повторение, по номеру коробки (1–5).
  const BOX_DAYS = [0, 1, 3, 7, 14, 30];
  const MAX_BOX = 5;
  const LEARNED_BOX = 3; // слово «выучено», когда дошло до 3-й коробки
  const BACKLOG_LIMIT = 20; // столько слов ждут повторения — новых не даём

  // Разметка ошибки: {неправильно|правильно:правило:ложный вариант/ещё вариант}
  const ERROR_RE = /\{([^|}]+)\|([^:}]+):(\w+)(?::([^}]+))?\}/g;
  const WORD_RE = /([A-Za-z']+)/;

  function dayKey(d) {
    const z = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
  }

  // ---------- текст ----------

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
      out.push({ t: 'e', text: m[1], right: m[2], rule: m[3], alts: (m[4] || '').split('/').map((x) => x.trim()).filter(Boolean) });
      last = ERROR_RE.lastIndex;
    }
    plain(text.slice(last));
    return out;
  }

  function errorsOf(text) {
    return parse(text).filter((t) => t.t === 'e');
  }

  // Все латинские слова текста, включая варианты в разметке ошибок.
  function wordsOf(text) {
    const all = [];
    parse(text).forEach((t) => {
      const parts = t.t === 'e' ? [t.text, t.right].concat(t.alts) : [t.text];
      parts.forEach((p) => (p.match(/[A-Za-z']+/g) || []).forEach((w) => all.push(w.toLowerCase())));
    });
    return all;
  }

  // Перевод слова для подсказки: словарь, потом карточки слов.
  function glossOf(bank, w) {
    const k = String(w).toLowerCase();
    if (bank.gloss && bank.gloss[k]) return bank.gloss[k];
    if (bank.words && bank.words[k]) return bank.words[k].ru;
    return '';
  }

  // ---------- проверка банка ----------

  function validate(bank) {
    const problems = [];
    if (!bank || typeof bank !== 'object') return ['нет содержимого'];
    const words = bank.words || {};
    const rules = bank.rules || {};
    const chapters = bank.chapters || [];
    const chIds = chapters.map((c) => c.id);
    if (!chapters.length) problems.push('нет ни одной главы');
    chapters.forEach((c) => {
      if (!rules[c.rule]) problems.push(`глава ${c.id}: неизвестный бандит «${c.rule}»`);
      (c.words || []).forEach((w) => { if (!words[w]) problems.push(`глава ${c.id}: нет карточки слова «${w}»`); });
      if (!(c.clues > 0)) problems.push(`глава ${c.id}: не задано, сколько нужно улик`);
    });
    Object.keys(words).forEach((w) => {
      if (!words[w].ru || !words[w].e) problems.push(`слово «${w}»: нет перевода или картинки`);
    });
    const checkText = (where, text, needErr) => {
      const errs = errorsOf(text);
      if (needErr && !errs.length) problems.push(`${where}: в тексте нет ни одной ошибки`);
      errs.forEach((e) => {
        if (!rules[e.rule]) problems.push(`${where}: неизвестное правило «${e.rule}»`);
        if (e.text === e.right) problems.push(`${where}: ошибка совпадает с ответом «${e.text}»`);
        if (e.alts.includes(e.right)) problems.push(`${where}: ложный вариант совпадает с ответом «${e.right}»`);
      });
      wordsOf(text).forEach((w) => { if (!glossOf(bank, w)) problems.push(`${where}: нет перевода для «${w}»`); });
    };
    (bank.intercepts || []).forEach((x) => {
      const where = `перехват ${x.id}`;
      if (!chIds.includes(x.ch)) problems.push(`${where}: неизвестная глава «${x.ch}»`);
      checkText(where, x.text, false);
      if (!(x.qs || []).length) problems.push(`${where}: нет вопросов`);
      (x.qs || []).forEach((q, i) => { if (!Array.isArray(q.opts) || !q.opts[q.a]) problems.push(`${where}: плохой вопрос ${i + 1}`); });
    });
    (bank.notes || []).forEach((x) => {
      if (!chIds.includes(x.ch)) problems.push(`записка ${x.id}: неизвестная глава «${x.ch}»`);
      checkText(`записка ${x.id}`, x.text, true);
    });
    Object.keys(bank.drills || {}).forEach((r) => {
      if (!rules[r]) problems.push(`тренировки: неизвестное правило «${r}»`);
      (bank.drills[r] || []).forEach((t, i) => checkText(`тренировка ${r} №${i + 1}`, t, true));
    });
    Object.keys(rules).forEach((r) => {
      const q = rules[r].quiz;
      if (!q || !Array.isArray(q.opts) || q.a == null || !q.opts[q.a]) problems.push(`бандит ${r}: плохой вопрос`);
    });
    (bank.phonics || []).forEach((p) => {
      if (!Array.isArray(p.opts) || !p.opts[p.a] || !p.word) problems.push(`шифр букв ${p.id}: плохое задание`);
    });
    chIds.forEach((id) => {
      if (!(bank.intercepts || []).some((x) => x.ch === id)) problems.push(`глава ${id}: нет перехватов`);
      if (!(bank.notes || []).some((x) => x.ch === id)) problems.push(`глава ${id}: нет записок`);
    });
    return problems;
  }

  // ---------- прогресс ----------

  const EN_DEFAULTS = {
    words: {}, // { слово: { box, due, ok, miss } }
    chapter: 0, // номер текущей главы
    clues: {}, // { глава: улик собрано }
    arrested: [], // пойманные бандиты (правила)
    interceptsSeen: [],
    notesSeen: [],
    stats: {}, // { правило: { ok, miss } }
    drillIndex: {},
    phonicsIndex: 0,
    sessions: 0,
  };

  // Прогресс с недостающими полями: старый progress.json или пустой.
  function ensure(pen) {
    const out = JSON.parse(JSON.stringify(EN_DEFAULTS));
    return Object.assign(out, pen || {});
  }

  function learnedCount(pen) {
    return Object.values(pen.words || {}).filter((w) => w.box >= LEARNED_BOX).length;
  }

  // Ответ на слово: верно с первой попытки — коробка выше, иначе снова в первую.
  function answerWord(state, ok, now) {
    const s = Object.assign({ box: 0, due: 0, ok: 0, miss: 0 }, state);
    if (ok) {
      s.box = Math.min(MAX_BOX, s.box + 1);
      s.ok++;
      s.due = now + BOX_DAYS[s.box] * DAY;
    } else {
      s.box = 1;
      s.miss++;
      s.due = now; // спросим на следующем занятии
    }
    return s;
  }

  // Звания Интерпола: по числу выученных слов.
  const EN_RANKS = [
    { n: 'Переводчик-стажёр', at: 0 },
    { n: 'Агент', at: 20 },
    { n: 'Спецагент', at: 45 },
    { n: 'Агент 00Л', at: 70 },
  ];
  function rankOf(learned) {
    let r = EN_RANKS[0];
    EN_RANKS.forEach((x) => { if (learned >= x.at) r = x; });
    const next = EN_RANKS.find((x) => x.at > learned) || null;
    return { rank: r, next };
  }

  // Текущая глава. Когда все главы пройдены — «патруль» по всем главам.
  function chapterOf(bank, pen) {
    const n = bank.chapters.length;
    if (pen.chapter < n) return { chapter: bank.chapters[pen.chapter], patrol: false };
    return { chapter: bank.chapters[(pen.sessions || 0) % n], patrol: true };
  }

  function chapterDone(bank, pen, ch) {
    const allIntroduced = ch.words.every((w) => pen.words[w]);
    return allIntroduced && (pen.clues[ch.id] || 0) >= ch.clues;
  }

  // ---------- подбор занятия ----------

  function shuffle(arr, rnd) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Самый давний из показанных или ещё не показанный элемент.
  function pickFresh(list, seen, rnd) {
    if (!list.length) return null;
    const unseen = list.filter((x) => !seen.includes(x.id));
    if (unseen.length) return unseen[Math.floor(rnd() * unseen.length)];
    let best = list[0];
    let bestAt = Infinity;
    list.forEach((x) => {
      const at = seen.lastIndexOf(x.id);
      if (at < bestAt) { bestAt = at; best = x; }
    });
    return best;
  }

  function ruleWeight(stats, rule) {
    const st = (stats && stats[rule]) || { ok: 0, miss: 0 };
    return Math.max(0.3, 1 + st.miss * 2 - st.ok * 0.5);
  }

  // План занятия: какие слова, какое задание на чтение, какой перехват и какая записка.
  // opts: { newWords, maxWords, now, rnd }
  function planSession(bank, penIn, opts) {
    const pen = ensure(penIn);
    const rnd = opts.rnd || Math.random;
    const now = opts.now || Date.now();
    const maxWords = opts.maxWords || 6;
    const { chapter, patrol } = chapterOf(bank, pen);
    const known = Object.keys(pen.words).filter((w) => bank.words[w]);
    const due = known.filter((w) => pen.words[w].due <= now).sort((a, b) => pen.words[a].due - pen.words[b].due);
    let fresh = [];
    if (due.length <= BACKLOG_LIMIT) fresh = chapter.words.filter((w) => !pen.words[w]).slice(0, Math.max(0, opts.newWords == null ? 2 : opts.newWords));
    let review = due.slice(0, Math.max(0, maxWords - fresh.length));
    // Повторять нечего — разминка на словах главы с самой низкой коробкой.
    if (!fresh.length && !review.length) {
      const pool = (patrol ? known : chapter.words.filter((w) => pen.words[w]));
      review = shuffle(pool, rnd).sort((a, b) => pen.words[a].box - pen.words[b].box).slice(0, 3);
    }
    const intercept = pickFresh(bank.intercepts.filter((x) => x.ch === chapter.id), pen.interceptsSeen, rnd);
    // Записка: обычно бандит главы, иногда — слабое правило из прошлых глав.
    const pastRules = bank.chapters.slice(0, Math.min(pen.chapter, bank.chapters.length)).map((c) => c.rule).filter((r) => r !== chapter.rule);
    let noteRule = chapter.rule;
    if (pastRules.length && rnd() < 0.3) {
      const w = pastRules.map((r) => ruleWeight(pen.stats, r));
      let x = rnd() * w.reduce((a, b) => a + b, 0);
      noteRule = pastRules.find((r, i) => (x -= w[i]) < 0) || pastRules[pastRules.length - 1];
    }
    const noteCh = bank.chapters.find((c) => c.rule === noteRule) || chapter;
    const note = pickFresh(bank.notes.filter((x) => x.ch === noteCh.id), pen.notesSeen, rnd);
    const phonics = (bank.phonics || []).length ? bank.phonics[pen.phonicsIndex % bank.phonics.length] : null;
    return {
      chapter, patrol, fresh, review, intercept, note, phonics,
      firstEver: !pen.sessions,
      chapterStart: !patrol && !chapter.words.some((w) => pen.words[w]),
      clues: pen.clues[chapter.id] || 0,
    };
  }

  // Варианты картинок для слова: само слово и три других с другой картинкой.
  // n — сколько всего картинок (по умолчанию 4).
  function wordOptions(bank, target, pen, rnd, n) {
    const r = rnd || Math.random;
    const k = Math.max(2, Math.min(8, n || 4)) - 1;
    const others = Object.keys(bank.words).filter((w) => w !== target && bank.words[w].e !== bank.words[target].e);
    const knownFirst = shuffle(others, r).sort((a, b) => (pen && pen.words[b] ? 1 : 0) - (pen && pen.words[a] ? 1 : 0));
    // Картинки не повторяются: у разных слов бывает одинаковый эмодзи.
    const pics = new Set([bank.words[target].e]);
    const picked = [];
    knownFirst.forEach((w) => { if (picked.length < k && !pics.has(bank.words[w].e)) { pics.add(bank.words[w].e); picked.push(w); } });
    return shuffle([target].concat(picked), r);
  }

  // Слова для дополнительного повторения: уже знакомые, не спрошенные в этом занятии, сначала из низких коробок.
  function extraWords(bank, penIn, exclude, n, rnd) {
    const pen = ensure(penIn);
    const r = rnd || Math.random;
    const pool = Object.keys(pen.words).filter((w) => bank.words[w] && !(exclude || []).includes(w));
    return shuffle(pool, r).sort((a, b) => pen.words[a].box - pen.words[b].box).slice(0, Math.max(0, n));
  }

  function pickDrill(bank, pen, rule) {
    const list = (bank.drills && bank.drills[rule]) || [];
    if (!list.length) return null;
    const used = (pen.drillIndex && pen.drillIndex[rule]) || 0;
    return { rule, text: list[used % list.length] };
  }

  // ---------- запись результатов ----------

  function remember(list, id) {
    return (list || []).filter((x) => x !== id).concat([id]).slice(-200);
  }

  // Применить результат шага занятия к прогрессу. Возвращает новый прогресс и пойманного бандита, если глава закрыта.
  // patch: { words: [{ w, ok }], intercept, note: { id, rule, tokens }, drillRule, phonics: true, sessionEnd: true }
  function applyResult(bank, penIn, patch, now) {
    const pen = ensure(penIn);
    let arrest = null;
    (patch.words || []).forEach(({ w, ok }) => {
      if (!bank.words[w]) return;
      pen.words[w] = answerWord(pen.words[w], ok, now);
    });
    if (patch.phonics) pen.phonicsIndex++;
    if (patch.intercept) {
      const x = bank.intercepts.find((i) => i.id === patch.intercept);
      pen.interceptsSeen = remember(pen.interceptsSeen, patch.intercept);
      const { chapter, patrol } = chapterOf(bank, pen);
      if (x && x.ch === chapter.id && !patrol) {
        pen.clues[chapter.id] = (pen.clues[chapter.id] || 0) + 1;
        if (chapterDone(bank, pen, chapter)) {
          arrest = chapter.rule;
          if (!pen.arrested.includes(chapter.rule)) pen.arrested.push(chapter.rule);
          pen.chapter++;
        }
      }
    }
    if (patch.note) {
      if (patch.note.id) pen.notesSeen = remember(pen.notesSeen, patch.note.id);
      (patch.note.tokens || []).filter((t) => t.t === 'e').forEach((e) => {
        const st = Object.assign({ ok: 0, miss: 0 }, pen.stats[e.rule]);
        if (e.state === 'ok') st.ok++;
        else st.miss++;
        pen.stats[e.rule] = st;
      });
    }
    if (patch.drillRule) pen.drillIndex[patch.drillRule] = (pen.drillIndex[patch.drillRule] || 0) + 1;
    if (patch.sessionEnd) pen.sessions++;
    return { pen, arrest };
  }

  // Итог записки: коины и пропущенные ошибки. Статус ошибки: 'ok', 'half' (нашёл, исправил неверно) или пусто.
  function scoreNote(tokens, falseHits) {
    const errs = tokens.filter((t) => t.t === 'e');
    let coins = 0;
    errs.forEach((e) => { if (e.state === 'ok') coins += 15; else if (e.state === 'half') coins += 10; });
    coins = Math.max(0, coins - 3 * (falseHits || 0));
    const missed = errs.filter((e) => e.state !== 'ok');
    const clean = !missed.length && !falseHits;
    return { coins, clean, found: errs.filter((e) => e.state).length, total: errs.length, missed };
  }

  // ---------- русский или английский ----------

  // Какой предмет следующим. settings: subjectMode ('ru' | 'en' | 'mix'), ratioRu, ratioEn,
  // weekendRatioRu, weekendRatioEn (0 — как в будни), firstSubject ('ru' | 'en' | 'alt').
  // queue: { day, pos } — сколько занятий уже прошло сегодня.
  function nextSubject(settings, queue, date) {
    const s = settings || {};
    if (s.subjectMode === 'ru') return 'ru';
    if (s.subjectMode === 'en') return 'en';
    const weekend = date.getDay() === 0 || date.getDay() === 6;
    let ru = Math.max(0, Math.round(Number(s.ratioRu)));
    let en = Math.max(0, Math.round(Number(s.ratioEn)));
    if (weekend && (Number(s.weekendRatioRu) > 0 || Number(s.weekendRatioEn) > 0)) {
      ru = Math.max(0, Math.round(Number(s.weekendRatioRu) || 0));
      en = Math.max(0, Math.round(Number(s.weekendRatioEn) || 0));
    }
    if (!Number.isFinite(ru)) ru = 2;
    if (!Number.isFinite(en)) en = 1;
    if (!en) return 'ru';
    if (!ru) return 'en';
    const day = dayKey(date);
    const pos = queue && queue.day === day ? queue.pos : 0;
    let first = s.firstSubject === 'en' ? 'en' : 'ru';
    if (s.firstSubject === 'alt') first = Math.floor(date.getTime() / DAY) % 2 ? 'en' : 'ru';
    const p = pos % (ru + en);
    if (first === 'ru') return p < ru ? 'ru' : 'en';
    return p < en ? 'en' : 'ru';
  }

  function advanceQueue(queue, date) {
    const day = dayKey(date);
    const pos = queue && queue.day === day ? queue.pos : 0;
    return { day, pos: pos + 1 };
  }

  const api = {
    parse, errorsOf, wordsOf, glossOf, validate, ensure, learnedCount, answerWord, rankOf, chapterOf, chapterDone,
    planSession, wordOptions, extraWords, pickDrill, applyResult, scoreNote, nextSubject, advanceQueue, ruleWeight,
    EN_RANKS, BOX_DAYS, LEARNED_BOX, EN_DEFAULTS,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OshibkinEnglish = api;
})(typeof self !== 'undefined' ? self : this);
