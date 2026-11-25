// Окно занятия: дело, разбор правил, короткие дела-тренировки, итог.
'use strict';
(async () => {
  const api = window.oshibkin;
  const core = window.OshibkinCore;
  const AD = window.OshibkinAdaptive;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const data = await api.invoke('session:data');
  const RULES = data.content.rules;
  const cfg = data.settings;
  let profile = data.profile;
  const S = { n: 0, coins: 0, found: 0, total: 0, missedRules: [], drilled: [], started: Date.now(), rankAtStart: core.rankOf(data.profile.total, data.profile.stats).rank.n, levelUp: false };
  let adapt = AD.ensure(data.adapt, 'ru');
  const minSec = cfg.sessionMinSec || 120;
  const maxSec = cfg.sessionMaxSec || 180;
  const elapsed = () => (Date.now() - S.started) / 1000;
  // Ответы и время шага уходят в main-процесс: там уровень сохраняется между занятиями.
  async function report(items, key, sec) {
    const r = await api.invoke('adapt:report', { subject: 'ru', items, key, sec });
    adapt = AD.ensure(r.state, 'ru');
    if (r.change > 0) S.levelUp = true;
    return r;
  }

  const ruleOf = (r) => RULES[r] || { name: r, villain: 'Безграмотный', rule: '', ex: '', quiz: null };

  function card(html) {
    $('card').innerHTML = html;
    window.scrollTo(0, 0);
  }
  function toast(msg, cls) {
    const el = $('toast');
    if (!el) return;
    el.className = 'toast ' + (cls || '');
    el.textContent = msg;
  }

  // ---------- вступление ----------
  // task: { title, intro, text, kind, caseTitles, drillRules, remedial }
  function showIntro(task) {
    S.n++;
    const L = AD.levelOf('ru', adapt.level);
    const up = S.levelUp ? '<div class="det"><div class="ava">Д.О.</div><div class="say">Ты щёлкаешь улики как орешки. Начальство даёт дела посложнее!</div></div>' : '';
    S.levelUp = false;
    card(`
      <div class="case-head"><h2>Дело № ${S.n} · ${esc(task.title)}</h2><span class="pill">Дело ${S.n}</span></div>
      ${up}
      <div class="det"><div class="ava">Д.О.</div><div class="say">${esc(task.remedial ? task.intro : AD.stripCount(task.intro))}</div></div>
      <div class="actions"><span></span><button class="btn-main" id="go">Взяться за дело</button></div>`);
    $('go').onclick = () => showTask(task, L);
    $('go').focus();
  }

  // ---------- записка ----------
  function showTask(task, L) {
    const title = task.title;
    const toks = core.parse(task.text).map((t) => (t.t === 'e' ? Object.assign(t, { state: 'none', tries: 0 }) : t));
    const errs = toks.filter((t) => t.t === 'e');
    const T = { toks, errs, falseHits: 0, hint: false, sel: null, task, opened: Date.now() };
    const showCount = task.remedial || L.showCount;
    const ruleNames = [...new Set(errs.map((e) => e.rule))].map((r) => `«${ruleOf(r).name}»`);
    const ask = showCount
      ? `Нажми на слово с ошибкой и исправь его. Ошибок в записке: ${errs.length}.`
      : 'Нажми на слово с ошибкой и исправь его. Сколько ошибок, не скажу: найди все сам и жми «Дело закрыто».';
    const tip = L.showRules && !task.remedial ? ` Ищи почерк: ${ruleNames.join(', ')}.` : '';
    card(`
      <div class="case-head"><h2>Дело № ${S.n} · ${esc(title)}</h2><span class="pill" id="cnt"></span></div>
      <div class="det"><div class="ava">Д.О.</div><div class="say">${esc(ask + tip)}</div></div>
      <div class="paper" id="paper"></div>
      <div class="edit" id="edit" hidden>
        <span class="lbl" id="editLbl"></span>
        <input id="editIn" autocomplete="off" spellcheck="false">
        <button class="btn-main" id="editOk">Исправить</button>
        <button class="btn-ghost" id="editNo">Отмена</button>
      </div>
      <div class="toast" id="toast"></div>
      <div class="actions"><button class="btn-ghost" id="hint">Лупа: подсказка${L.freeHint ? '' : ' (−5)'}</button><button class="btn-main" id="done">Дело закрыто</button></div>`);
    const paper = $('paper');

    const render = (flashFalse) => {
      paper.textContent = '';
      toks.forEach((t, i) => {
        if (t.t === 'p') { paper.append(document.createTextNode(t.text)); return; }
        const sp = document.createElement('span');
        sp.className = 'w';
        sp.dataset.i = i;
        sp.tabIndex = 0;
        sp.setAttribute('role', 'button');
        sp.textContent = t.t === 'e' && t.state === 'ok' ? t.right : t.text;
        if (t.t === 'e' && t.state === 'ok') sp.classList.add('ok');
        if (t.t === 'e' && t.state === 'half') sp.classList.add('half');
        if (t.hint) sp.classList.add('hint');
        if (T.sel === i) sp.classList.add('sel');
        if (flashFalse === i) sp.classList.add('false');
        sp.onclick = () => select(i);
        sp.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(i); } };
        paper.append(sp);
      });
      const f = errs.filter((e) => e.state === 'ok').length;
      $('cnt').textContent = showCount ? `Улик найдено: ${f} из ${errs.length}` : `Улик найдено: ${f}`;
    };

    const close = () => { $('edit').hidden = true; T.sel = null; render(); };
    const select = (i) => {
      const t = toks[i];
      if (t.t === 'e' && t.state === 'ok') return;
      T.sel = i;
      render();
      $('edit').hidden = false;
      $('editIn').value = t.text;
      $('editLbl').textContent = `Исправь слово «${t.text}» или нажми «Отмена», если оно написано верно:`;
      $('editIn').focus();
      $('editIn').select();
    };
    const submit = () => {
      const i = T.sel;
      if (i == null) return;
      const t = toks[i];
      const v = $('editIn').value;
      if (core.norm(v) === core.norm(t.text)) {
        if (t.t === 'e') { toast('Здесь правда ошибка! Какую букву надо поменять?', 'warn'); return; }
        close();
        return;
      }
      if (t.t !== 'e') {
        T.falseHits++;
        $('edit').hidden = true; T.sel = null;
        render(i);
        toast(`«${t.text}» написано верно. Ложное обвинение: −3`, 'bad');
        return;
      }
      if (core.norm(v) === core.norm(t.right)) {
        t.state = 'ok';
        close();
        if (errs.every((e) => e.state === 'ok')) toast(showCount ? 'Все улики найдены! Жми «Дело закрыто».' : 'Улика найдена! Если больше ошибок нет, жми «Дело закрыто».', 'good');
        else toast(`Улика найдена! ${ruleOf(t.rule).villain} оставил след: «${t.text}» → «${t.right}».`, 'good');
        return;
      }
      t.tries++;
      t.state = 'half';
      close();
      toast('Ошибку нашёл, но исправил не так. Попробуй ещё раз: нажми на оранжевое слово.', 'warn');
    };

    $('editOk').onclick = submit;
    $('editNo').onclick = close;
    $('editIn').onkeydown = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
      if (e.key === 'Escape') close();
    };
    $('hint').onclick = () => {
      const e = errs.find((x) => x.state !== 'ok');
      if (!e) return;
      T.hint = true;
      e.hinted = true;
      const i = toks.indexOf(e);
      toks.forEach((t) => { t.hint = false; });
      [i - 2, i, i + 2].forEach((j) => { if (toks[j] && toks[j].t !== 'p') toks[j].hint = true; });
      render();
      toast('Лупа подсветила место, где спряталась ошибка.');
    };
    $('done').onclick = () => finishTask(T, L);
    render();
  }

  // ---------- итог дела ----------
  // Ответы для подсчёта точности: верно с первого раза — 1, с подсказкой, со второй попытки
  // или найдено, но исправлено неверно — 0,5, пропущено — 0, ложное обвинение — 0 (не больше трёх за дело).
  function itemsOf(T) {
    const items = T.errs.map((e) => (e.state === 'ok' ? (e.tries || e.hinted ? 0.5 : 1) : e.state === 'half' ? 0.5 : 0));
    for (let i = 0; i < Math.min(3, T.falseHits); i++) items.push(0);
    return items;
  }

  async function finishTask(T, L) {
    $('done').disabled = true;
    const task = T.task;
    const r = core.scoreTask({ tokens: T.toks, falseHits: T.falseHits, hint: T.hint && !L.freeHint });
    if (T.hint && L.freeHint) r.clean = false;
    const statsAfter = core.applyStats(profile.stats, T.toks);
    profile = await api.invoke('session:task', {
      caseTitles: task.caseTitles || [], drillRules: task.drillRules || [],
      coins: r.coins, found: r.found, total: r.total, falseHits: T.falseHits,
      statsAfter, reviewRules: r.reviewRules, clean: r.clean,
    });
    await report(itemsOf(T), 'ru:' + task.kind, (Date.now() - T.opened) / 1000);
    S.coins += r.coins; S.found += r.found; S.total += r.total;
    r.reviewRules.forEach((x) => { if (!S.missedRules.includes(x)) S.missedRules.push(x); });
    if (!r.reviewRules.length) return nextTask([]);
    showReview(T, r);
  }

  // ---------- разбор ----------
  function showReview(T, r) {
    const missed = r.missed.length;
    const shown = missed ? `<div class="paper">${T.toks.map((t) => {
      if (t.t !== 'e') return esc(t.text);
      return t.state === 'ok' ? `<span class="w ok">${esc(t.right)}</span>` : `<span class="w miss">${esc(t.text)}</span><span class="fix">${esc(t.right)}</span>`;
    }).join('')}</div>` : '';
    const rules = r.reviewRules;
    let k = 0;
    const opened = Date.now();
    const next = async () => {
      if (k < rules.length) return ruleCard(rules[k++], T, next);
      await report([], 'ru:review', (Date.now() - opened) / 1000);
      return nextTask(rules);
    };
    card(`
      <div class="case-head"><h2>Разбор дела</h2><span class="pill">+${r.coins} коинов</span></div>
      <div class="det"><div class="ava">Д.О.</div><div class="say">${missed
        ? `Ты нашёл ${r.found} из ${r.total} улик. Вот что ускользнуло, давай разберём.`
        : 'Все улики найдены, но одну ты исправил не с первого раза. Повторим правило.'}</div></div>
      ${shown}
      <div class="actions"><span></span><button class="btn-main" id="go">Разобрать правило</button></div>`);
    $('go').onclick = next;
    $('go').focus();
  }

  function ruleCard(rule, T, next) {
    const R = ruleOf(rule);
    const fromCase = T.errs.filter((e) => e.rule === rule)
      .map((e) => `${esc(e.text)} → <b>${esc(e.right)}</b>${e.check ? ` (${esc(e.check)})` : ''}`).join('<br>');
    card(`
      <div class="case-head"><h2>Почерк преступника</h2><span class="pill">${esc(R.name)}</span></div>
      <div class="rule">
        <div class="villain">${esc(R.villain)}</div>
        <h3>${esc(R.rule)}</h3>
        <div class="ex">${esc(R.ex)}</div>
        <div>Из этого дела:<br><span class="ex">${fromCase}</span></div>
      </div>
      ${R.quiz ? `<div class="rule"><div class="quiz" id="quiz"><div class="q">${esc(R.quiz.q)}</div></div></div>` : ''}
      <div class="toast" id="toast"></div>
      <div class="actions"><span></span><button class="btn-main" id="go" ${R.quiz ? 'disabled' : ''}>Дальше</button></div>`);
    $('go').onclick = next;
    if (!R.quiz) { $('go').focus(); return; }
    const quiz = $('quiz');
    R.quiz.opts.map((o, i) => ({ o, i })).sort(() => Math.random() - 0.5).forEach(({ o, i }) => {
      const b = document.createElement('button');
      b.textContent = o;
      b.onclick = async () => {
        quiz.querySelectorAll('button').forEach((x) => { x.disabled = true; });
        const ok = i === R.quiz.a;
        b.classList.add(ok ? 'right' : 'wrong');
        toast((ok ? 'Верно! +5. ' : 'Не совсем. ') + R.quiz.why, ok ? 'good' : 'warn');
        if (ok) S.coins += 5;
        profile = await api.invoke('session:quiz', ok);
        $('go').disabled = false;
        $('go').focus();
      };
      quiz.append(b);
    });
  }

  // Следующее дело. После разбора — короткое дело на самое слабое из пропущенных правил,
  // иначе — записка по текущему уровню. Дела идут, пока занятие укладывается в 2–3 минуты.
  function nextTask(missedRules) {
    const t = elapsed();
    if (missedRules.length && AD.shouldContinue({ elapsed: t, est: AD.estTime(adapt, 'ru:drill'), minSec, maxSec, tasks: S.n })) {
      const sorted = missedRules.slice().sort((a, b) => core.ruleWeight(profile.stats, b) - core.ruleWeight(profile.stats, a));
      for (const r of sorted) {
        const d = core.pickDrill(data.content, profile, r);
        if (d) {
          S.drilled.push(r);
          return showIntro({ title: 'Новый след', intro: `Безграмотный снова прокололся на правиле «${ruleOf(r).name}». Это дело короче.`,
            text: d.text, kind: 'drill', caseTitles: [], drillRules: [r], remedial: true });
        }
      }
    }
    const kind = AD.nextRuKind(adapt, { elapsed: t, minSec, maxSec, tasks: S.n });
    if (!kind) return showResult(!S.missedRules.length);
    const task = core.buildTask(data.content, profile, kind, null, S.drilled);
    S.drilled = S.drilled.concat(task.drillRules);
    task.kind = kind;
    return showIntro(task);
  }

  // ---------- итог занятия ----------
  function showResult(solved) {
    const R = core.rankOf(profile.total, profile.stats);
    const { rank, next } = R;
    const rankPct = next ? Math.min(100, Math.round(((profile.total - rank.at) / (next.at - rank.at)) * 100)) : 100;
    const promoted = rank.n !== S.rankAtStart;
    const price = cfg.vacationPrice;
    const vacPct = Math.min(100, Math.round((profile.coins / price) * 100));
    const mins = Math.max(1, Math.round((Date.now() - S.started) / 60000));
    const chips = Object.keys(RULES).map((r) => {
      const st = profile.stats[r];
      if (!st) return `<span class="chip">${esc(RULES[r].villain)}: не встречался</span>`;
      const cls = st.miss > st.ok ? 'weak' : st.ok > 0 ? 'strong' : '';
      return `<span class="chip ${cls}">${esc(RULES[r].villain)}: пойман ${st.ok}, ушёл ${st.miss}</span>`;
    }).join('');
    const canVac = profile.coins >= price && cfg.vacationsLeftToday > 0 && !profile.vacationPending;
    const vacNote = profile.vacationPending ? 'Отпуск уже взят: следующее дело детектив раскроет сам.'
      : profile.coins < price ? `Копилка на «отпуск» (одно занятие пропускается): ${profile.coins} из ${price}`
        : cfg.vacationsLeftToday > 0 ? `Хватает на «отпуск»! В копилке ${profile.coins}, отпуск стоит ${price}.`
          : `В копилке ${profile.coins}. Сегодня отпусков больше нет, приходи завтра.`;
    const say = solved
      ? 'Все улики собраны, ни одного промаха! Возвращайся в игру.'
      : 'Безграмотный пока ушёл, но мы знаем его почерк. Слабые правила я буду давать чаще.';
    card(`
      <div class="case-head"><h2>${solved ? 'Дела раскрыты!' : `На сегодня хватит, ${esc(cfg.childName || 'сыщик')}`}</h2><span class="pill">${esc(rank.n)}</span></div>
      <div class="det"><div class="ava">Д.О.</div><div class="say">${say}</div></div>
      ${promoted ? `<div class="rule" style="text-align:center"><div class="villain">Приказ по управлению сыска</div><h3>Присвоено звание «${esc(rank.n)}»!</h3><div>Поздравляю, ${esc(cfg.childName || 'сыщик')}. Так держать!</div></div>` : ''}
      <div class="stats">
        <div class="stat"><div class="v">${S.found} из ${S.total}</div><div class="k">улик найдено</div></div>
        <div class="stat"><div class="v">+${S.coins}</div><div class="k">коинов за занятие</div></div>
        <div class="stat"><div class="v">${S.n}</div><div class="k">${S.n === 1 ? 'дело' : 'дела'} · около ${mins} мин</div></div>
      </div>
      <div class="stat"><div class="k" id="vacNote">${esc(vacNote)}</div><div class="meter"><i style="width:${vacPct}%"></i></div></div>
      <div class="stat"><div class="k">${esc(core.needText(R))}</div><div class="meter"><i style="width:${rankPct}%"></i></div></div>
      <div><div class="lbl-small">Картотека преступников</div><div class="files">${chips}</div></div>
      <div class="actions">${canVac ? `<button class="btn-ghost" id="vac">Взять отпуск (−${price})</button>` : '<span></span>'}<button class="btn-main" id="back">Вернуться в игру</button></div>`);
    $('back').onclick = async () => { $('back').disabled = true; await api.invoke('session:end', { solved }); };
    $('back').focus();
    const v = $('vac');
    if (v) {
      v.onclick = async () => {
        v.disabled = true;
        const res = await api.invoke('session:vacation');
        profile = res.profile;
        v.textContent = res.ok ? 'Отпуск взят: следующее дело пропускается' : (res.why || 'Не получилось');
        $('vacNote').textContent = res.ok ? `Отпуск взят! В копилке осталось ${profile.coins}.` : $('vacNote').textContent;
      };
    }
  }

  nextTask([]);
})();
