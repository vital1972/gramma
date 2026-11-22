// Окно английского занятия «Дело Интерпола»: новые слова, радиоперехват, шифр букв, перехват, записка бандита, итог.
'use strict';
(async () => {
  const api = window.oshibkin;
  const EN = window.OshibkinEnglish;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  const data = await api.invoke('en:data');
  const bank = data.bank;
  const cfg = data.settings;
  let pen = data.pen;
  let profile = data.profile;
  const plan = EN.planSession(bank, pen, { now: data.now, newWords: cfg.newWords });
  const ch = plan.chapter;
  const S = { coins: 0, clean: true, notes: 0, found: 0, total: 0, arrest: null, started: Date.now(), words: 0, wordsOk: 0 };
  const W = (w) => bank.words[w];

  // ---------- голос ----------
  const synth = 'speechSynthesis' in window ? window.speechSynthesis : null;
  let voice = null;
  function pickVoice() {
    if (!synth) return;
    const vs = synth.getVoices().filter((v) => /^en[-_]/i.test(v.lang));
    const pref = ['Microsoft Libby', 'Microsoft Sonia', 'Microsoft Hazel', 'Microsoft Aria', 'Microsoft Zira', 'Microsoft Jenny', 'Microsoft David', 'Microsoft Mark', 'Microsoft George'];
    voice = null;
    for (const p of pref) { voice = vs.find((v) => v.name.indexOf(p) === 0); if (voice) break; }
    if (!voice) voice = vs.find((v) => /en-GB/i.test(v.lang)) || vs[0] || null;
  }
  await new Promise((resolve) => {
    if (!synth || !cfg.voiceOn) return resolve();
    pickVoice();
    if (voice) return resolve();
    synth.onvoiceschanged = () => { pickVoice(); if (voice) resolve(); };
    setTimeout(resolve, 1500);
  });
  const hasVoice = !!(synth && voice && cfg.voiceOn);
  function say(text, slower) {
    if (!hasVoice) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.voice = voice;
    u.lang = voice.lang;
    u.rate = Math.max(0.5, (cfg.speechRate || 0.85) * (slower ? 0.9 : 1));
    synth.speak(u);
  }

  // ---------- шаги ----------
  const reviewMode = (w) => (!hasVoice || (pen.words[w] && pen.words[w].box >= 2) ? 'read' : 'hear');
  const wordItems = plan.fresh.map((w) => ({ w, mode: hasVoice ? 'hear' : 'read' })).concat(plan.review.map((w) => ({ w, mode: reviewMode(w) })));
  const phon = plan.phonics && (plan.phonics.mode === 'see' || hasVoice) ? plan.phonics : null;
  const STEPS = [];
  if (wordItems.length) STEPS.push('words');
  if (phon) STEPS.push('phonics');
  if (plan.intercept) STEPS.push('intercept');
  if (plan.note) STEPS.push('note');
  let stepIdx = 0;

  function card(title, html) {
    const bars = STEPS.map((_, i) => `<i class="${i < stepIdx ? 'done' : i === stepIdx ? 'on' : ''}"></i>`).join('');
    $('card').innerHTML = `
      <div class="head"><div class="t"><span class="eyebrow">Интерпол · ${esc(ch.city)} ${esc(ch.mark || '')}</span><h2>${esc(title)}</h2></div>
        <div class="pills"><span class="pill ip">${Math.min(stepIdx + 1, STEPS.length)} из ${STEPS.length}</span><span class="pill" id="coins">${S.coins} коинов</span></div></div>
      <div class="steps">${bars}</div>${html}`;
    window.scrollTo(0, 0);
  }
  const det = (html, ava, ip) => `<div class="det"><div class="ava ${ip ? 'ip' : ''}">${ava || '🕵️'}</div><div class="say">${html}</div></div>`;
  function coinsShown() { const c = $('coins'); if (c) c.textContent = `${S.coins} коинов`; }
  function toast(msg, cls) { const el = $('toast'); if (!el) return; el.className = 'toast ' + (cls || ''); el.textContent = msg; }
  async function save(patch) {
    const r = await api.invoke('en:save', patch);
    pen = r.pen;
    profile = r.profile;
    if (r.arrest) S.arrest = r.arrest;
    return r;
  }
  function next() {
    stepIdx++;
    const s = STEPS[stepIdx];
    if (s === 'phonics') return phonics();
    if (s === 'intercept') return intercept();
    if (s === 'note') return note(plan.note.text, plan.note.id, null);
    return result();
  }
  function start() {
    stepIdx = 0;
    const s = STEPS[0];
    if (s === 'words') return newWords(0);
    stepIdx = -1;
    return next();
  }

  // ---------- брифинг ----------
  function briefing() {
    const villain = (bank.rules[ch.rule] || {}).villain || '';
    let text;
    if (plan.firstEver) {
      text = `${esc(cfg.childName || 'Агент')}, беда. Интерпол прислал перехваченные сообщения банды <b>Мистера Микса</b>. Они пишут по-английски, а я английского <b>не знаю</b>. Ты мой переводчик. Без тебя я их не поймаю.`;
    } else if (plan.patrol) {
      text = 'Мистер Микс за решёткой, но его сообщники всё ещё переписываются. Патрулируем город и не даём им забыть, кто здесь лучший переводчик.';
    } else if (plan.chapterStart) {
      text = `Банда перебралась в <b>${esc(ch.city)}</b>. Здесь орудует <b>${esc(villain)}</b>. Тема главы: ${esc(ch.topic)}.`;
    } else {
      text = `${esc(ch.city)}. Новый перехват. Ищем: <b>${esc(villain)}</b>. Улик собрано: ${plan.clues} из ${ch.clues}.`;
    }
    const noVoice = cfg.voiceOn && !hasVoice ? '<div class="warnline">Английского голоса на компьютере нет, поэтому сегодня только чтение. Родителю: Параметры Windows → Время и язык → Речь → Добавить голоса → English.</div>' : '';
    card(plan.firstEver ? 'Срочно: нужен переводчик' : 'Сообщение от Интерпола', `
      ${det(text, '🌐', true)}
      ${plan.firstEver ? det(`Сегодня ищем <b>${esc(villain)}</b>. ${esc((bank.rules[ch.rule] || {}).name ? 'Он путает правило «' + bank.rules[ch.rule].name + '»' : '')}, по этой ошибке мы его и вычислим.`) : ''}
      ${noVoice}
      <div class="actions"><span></span><button class="btn-ip" id="go">Приступить, агент!</button></div>`);
    $('go').onclick = () => { say("Let's go, agent!"); start(); };
    $('go').focus();
  }

  // ---------- новые слова ----------
  function newWords(i) {
    if (i >= plan.fresh.length) return listen(0, []);
    const w = plan.fresh[i];
    card('Новое слово в картотеке', `
      ${det('Это слово встретится в деле. Послушай и запомни.', '🗂️')}
      <div class="word-card"><span class="e">${W(w).e}</span><div><div class="w">${esc(w)}</div><div class="r">${esc(W(w).ru)}</div></div>
        ${hasVoice ? '<button class="btn-ghost" id="play">🔊 Ещё раз</button>' : ''}</div>
      <div class="actions"><span></span><button class="btn-ip" id="go">Запомнил</button></div>`);
    setTimeout(() => say(w, true), 200);
    if ($('play')) $('play').onclick = () => say(w, true);
    $('go').onclick = () => newWords(i + 1);
    $('go').focus();
  }

  // ---------- радиоперехват: слово → картинка ----------
  function listen(i, results) {
    if (i >= wordItems.length) {
      const coins = results.filter((r) => r.ok).length * 5;
      S.coins += coins;
      S.words += results.length;
      S.wordsOk += results.filter((r) => r.ok).length;
      if (results.some((r) => !r.ok)) S.clean = false;
      return save({ coins, words: results }).then(next);
    }
    const { w, mode } = wordItems[i];
    const opts = EN.wordOptions(bank, w, pen);
    const ask = mode === 'hear' ? 'Бандиты говорят по рации. Что они назвали?' : 'На записке бандита слово. Что оно значит?';
    card(mode === 'hear' ? 'Радиоперехват' : 'Слово из записки', `
      ${det(`${ask} <span style="color:var(--ink-dim)">(${i + 1} из ${wordItems.length})</span>`, mode === 'hear' ? '📻' : '📝')}
      ${mode === 'hear'
        ? '<button class="btn-ip big-play" id="play">🔊 Слушать</button>'
        : `<div class="read-word">${esc(w)}${hasVoice ? ' <button class="btn-ghost" id="play">🔊</button>' : ''}</div>`}
      <div class="grid4">${opts.map((k) => `<button class="pic" data-k="${esc(k)}">${W(k).e}<small></small></button>`).join('')}</div>
      <div class="toast" id="toast"></div>`);
    const play = () => say(w);
    if (mode === 'hear') setTimeout(play, 250);
    if ($('play')) $('play').onclick = play;
    let first = true;
    document.querySelectorAll('.pic').forEach((b) => {
      b.onclick = () => {
        const k = b.dataset.k;
        b.querySelector('small').textContent = mode === 'hear' ? k : W(k).ru;
        if (k === w) {
          b.classList.add('right');
          document.querySelectorAll('.pic').forEach((x) => { x.disabled = true; });
          if (first) { S.coins += 5; coinsShown(); }
          toast(`Верно: ${w} — ${W(w).ru}.${first ? ' +5' : ''}`, 'good');
          say(w);
          results.push({ w, ok: first });
          setTimeout(() => listen(i + 1, results), 1300);
        } else {
          first = false;
          b.classList.add('wrong');
          b.disabled = true;
          toast(mode === 'hear' ? `Это ${k} — ${W(k).ru}. Послушай ещё раз.` : `Это ${W(k).ru}. Попробуй ещё.`, 'bad');
          if (mode === 'hear') setTimeout(play, 600);
        }
      };
    });
  }

  // ---------- шифр букв: правила чтения ----------
  function phonics() {
    const c = phon;
    const ask = c.mode === 'hear' ? 'Агент назвал пароль. Как он <b>пишется</b>?' : 'Пароль написан на записке. Как он <b>звучит</b>?';
    card('Шифр букв', `
      ${det(ask, '🔐')}
      ${c.mode === 'hear' ? '<button class="btn-ip big-play" id="play">🔊 Слушать пароль</button>' : `<div class="tape center">${esc(c.word)}</div>`}
      <div class="opts">${c.opts.map((o, k) => `<button class="opt" data-k="${k}">${esc(o)}</button>`).join('')}</div>
      <div id="after"></div>`);
    if (c.mode === 'hear') { const p = () => say(c.word, true); setTimeout(p, 250); $('play').onclick = p; }
    let first = true;
    document.querySelectorAll('.opt').forEach((b) => {
      b.onclick = () => {
        if (+b.dataset.k !== c.a) { first = false; S.clean = false; b.classList.add('wrong'); b.disabled = true; return; }
        b.classList.add('right');
        document.querySelectorAll('.opt').forEach((x) => { x.disabled = true; });
        const coins = first ? 5 : 0;
        S.coins += coins;
        coinsShown();
        say(c.word, true);
        $('after').innerHTML = `<div class="rule"><div>${esc(c.rule)}</div></div><div class="actions" style="margin-top:12px"><span></span><button class="btn-ip" id="go">Дальше</button></div>`;
        $('go').onclick = async () => { $('go').disabled = true; await save({ coins, phonics: true }); next(); };
        $('go').focus();
      };
    });
  }

  // ---------- перехват ----------
  function wordsHtml(text) {
    return text.split(/([A-Za-z']+)/).map((p, i) => (i % 2 ? `<button class="wd" data-w="${esc(p)}">${esc(p)}</button>` : esc(p))).join('');
  }
  function bindGloss(root) {
    root.querySelectorAll('.wd[data-w]').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.e != null) return;
      const w = b.dataset.w;
      say(w);
      const g = EN.glossOf(bank, w);
      $('gloss').innerHTML = `<b>${esc(w)}</b>${g ? ' — ' + esc(g) : ''}`;
    }));
  }
  function intercept() {
    const x = plan.intercept;
    card('Перехват', `
      ${det(hasVoice ? 'Банда отправила сообщение. Сначала послушай, потом прочитай. Непонятное слово можно нажать.' : 'Банда отправила сообщение. Прочитай его. Непонятное слово можно нажать.', '📠')}
      ${hasVoice ? '<button class="btn-ip big-play" id="play">🔊 Слушать сообщение</button>' : ''}
      <div class="tape"><span class="stamp">INTERCEPTED</span>${wordsHtml(x.text)}</div>
      <div class="gloss" id="gloss">Нажми на слово, чтобы ${hasVoice ? 'услышать его и ' : ''}увидеть перевод.</div>
      ${x.qs.map((q, qi) => `<div class="q" data-q="${qi}"><div class="qt">${qi + 1}. ${esc(q.q)}</div>
        <div class="opts">${q.opts.map((o, k) => `<button class="opt" data-k="${k}">${esc(o)}</button>`).join('')}</div></div>`).join('')}
      <div class="toast" id="toast"></div>
      <div class="actions"><span></span><button class="btn-ip" id="go" disabled>Передать Ошибкину</button></div>`);
    if (hasVoice) { const p = () => say(x.text); setTimeout(p, 300); $('play').onclick = p; }
    bindGloss($('card'));
    let done = 0;
    let coins = 0;
    document.querySelectorAll('.q').forEach((qb) => {
      const q = x.qs[+qb.dataset.q];
      let first = true;
      qb.querySelectorAll('.opt').forEach((b) => {
        b.onclick = () => {
          if (+b.dataset.k !== q.a) { first = false; S.clean = false; b.classList.add('wrong'); b.disabled = true; return; }
          b.classList.add('right');
          qb.querySelectorAll('.opt').forEach((o) => { o.disabled = true; });
          if (first) { coins += 10; S.coins += 10; coinsShown(); }
          if (++done === x.qs.length) {
            $('go').disabled = false;
            $('go').focus();
            toast('Всё расшифровано! Передаём улику детективу.', 'good');
          }
        };
      });
    });
    $('go').onclick = async () => { $('go').disabled = true; await save({ coins, intercept: x.id }); next(); };
  }

  // ---------- записка бандита ----------
  function note(text, id, drillRule) {
    const toks = EN.parse(text);
    const errs = toks.filter((t) => t.t === 'e');
    let falseHits = 0;
    const accused = new Set();
    const villain = (bank.rules[drillRule || errs[0].rule] || {}).villain || 'бандит';
    card(drillRule ? `Ещё одна записка: ${villain}` : 'Записка бандита', `
      ${det(drillRule
        ? `${esc(villain)} снова прокололся. Найди ошибку и выбери, как правильно.`
        : `Нашли записку. Её написал <b>${esc(villain)}</b>, он путает правило. Найди ${errs.length === 1 ? 'ошибку' : `все ошибки (${errs.length})`}: нажми на неправильное слово.`, '🔎')}
      <div class="tape" id="paper"><span class="stamp">EVIDENCE</span></div>
      <div class="gloss" id="gloss"></div>
      <div id="fix"></div>
      <div class="toast" id="toast"></div>
      <div class="actions"><span></span><button class="btn-ghost" id="done">Больше ошибок нет</button></div>`);
    const paper = $('paper');
    toks.forEach((t, i) => {
      if (t.t === 'p') { paper.append(document.createTextNode(t.text)); return; }
      const b = document.createElement('button');
      b.className = 'wd';
      b.textContent = t.text;
      b.dataset.w = t.text;
      if (t.t === 'e') b.dataset.e = String(i);
      t.el = b;
      paper.append(b);
    });
    let finished = false;
    const finish = async () => {
      if (finished) return;
      finished = true;
      $('done').disabled = true;
      $('fix').innerHTML = '';
      errs.forEach((e) => {
        if (e.state === 'ok') return;
        e.el.classList.add('miss');
        e.el.textContent = e.text;
        const r = document.createElement('span');
        r.className = 'fixr';
        r.textContent = e.right;
        e.el.after(r);
      });
      const sc = EN.scoreNote(toks, falseHits);
      S.coins += sc.coins; S.found += sc.found; S.total += sc.total; S.notes++;
      if (!sc.clean) S.clean = false;
      coinsShown();
      const slim = toks.filter((t) => t.t === 'e').map((t) => ({ t: 'e', rule: t.rule, state: t.state || '' }));
      await save({ coins: sc.coins, note: { id: drillRule ? null : id, tokens: slim, found: sc.found, total: sc.total, falseHits, clean: sc.clean }, drillRule });
      const rules = [...new Set(sc.missed.map((e) => e.rule))];
      const go = document.createElement('button');
      go.className = 'btn-ip';
      if (rules.length && S.notes < cfg.maxTasks) {
        toast(sc.found ? `Найдено ${sc.found} из ${sc.total}. Остальное подсвечено красным.` : 'Бандит ускользнул. Ошибки подсвечены красным.', 'bad');
        go.textContent = 'Разобрать правило';
        go.onclick = () => ruleCard(rules[0]);
      } else {
        toast(sc.missed.length ? 'Ошибки подсвечены красным. На сегодня хватит.' : 'Попался! Все ошибки найдены.', sc.missed.length ? 'bad' : 'good');
        go.textContent = 'Итог';
        go.onclick = result;
      }
      $('done').replaceWith(go);
      go.focus();
    };
    paper.querySelectorAll('.wd').forEach((b) => b.addEventListener('click', () => {
      if (finished) return;
      if (b.dataset.e == null) {
        const w = b.dataset.w;
        say(w);
        const g = EN.glossOf(bank, w);
        $('gloss').innerHTML = `<b>${esc(w)}</b>${g ? ' — ' + esc(g) : ''}`;
        if (!accused.has(w)) { accused.add(w); falseHits++; }
        b.classList.remove('false'); void b.offsetWidth; b.classList.add('false');
        toast(`«${w}» написано верно. Ложное обвинение: −3`, 'bad');
        return;
      }
      const e = toks[+b.dataset.e];
      if (e.state) return;
      paper.querySelectorAll('.wd').forEach((x) => x.classList.remove('sel'));
      b.classList.add('sel');
      const opts = shuffle([e.text, e.right].concat(e.alts));
      $('fix').innerHTML = `<div class="fixbox"><div>Как правильно вместо «<b>${esc(e.text)}</b>»?</div><div class="opts">${opts.map((o) => `<button class="opt" data-o="${esc(o)}">${esc(o)}</button>`).join('')}</div></div>`;
      $('fix').querySelectorAll('.opt').forEach((ob) => {
        ob.onclick = () => {
          const v = ob.dataset.o;
          if (v === e.text) { $('fix').innerHTML = ''; b.classList.remove('sel'); toast('Так и было написано. Здесь точно ошибка, выбери другой вариант.', 'warn'); return; }
          const ok = v === e.right;
          e.state = ok ? 'ok' : 'half';
          b.classList.remove('sel');
          b.classList.add(ok ? 'fixed' : 'half');
          b.textContent = e.right;
          say(e.right);
          $('fix').innerHTML = '';
          toast(ok ? `Улика! ${e.text} → ${e.right}` : `Ошибку нашёл, но правильно «${e.right}».`, ok ? 'good' : 'warn');
          if (errs.every((x) => x.state)) setTimeout(finish, 700);
        };
      });
    }));
    $('done').onclick = finish;
  }

  function ruleCard(rule) {
    const R = bank.rules[rule];
    card(`Почерк преступника: ${R.name}`, `
      ${det('Бандит ускользнул, но мы знаем его слабость. Запомни правило.', '📒')}
      <div class="rule"><div class="villain">${esc(R.villain)}</div><h3>${esc(R.rule)}</h3><div class="ex">${esc(R.ex)}</div></div>
      <div class="q"><div class="qt">Проверка: ${esc(R.quiz.q)}</div><div class="opts" id="quiz"></div></div>
      <div class="toast" id="toast"></div>
      <div class="actions"><span></span><button class="btn-ip" id="go" disabled>Дальше</button></div>`);
    say(R.ex.split('·')[0]);
    shuffle(R.quiz.opts.map((o, i) => ({ o, i }))).forEach(({ o, i }) => {
      const b = document.createElement('button');
      b.className = 'opt';
      b.textContent = o;
      b.onclick = async () => {
        $('quiz').querySelectorAll('button').forEach((x) => { x.disabled = true; });
        const ok = i === R.quiz.a;
        b.classList.add(ok ? 'right' : 'wrong');
        toast((ok ? 'Верно! +5. ' : 'Не совсем. ') + (R.quiz.why || ''), ok ? 'good' : 'warn');
        if (ok) { S.coins += 5; coinsShown(); }
        profile = await api.invoke('session:quiz', ok);
        $('go').disabled = false;
        $('go').focus();
      };
      $('quiz').append(b);
    });
    $('go').onclick = () => {
      const d = EN.pickDrill(bank, pen, rule);
      if (d) note(d.text, null, rule);
      else result();
    };
  }

  // ---------- итог ----------
  async function result() {
    stepIdx = STEPS.length;
    if (S.clean && S.notes) {
      S.coins += 20;
      await save({ coins: 20 });
    }
    const learned = EN.learnedCount(pen);
    const { rank, next: nextRank } = EN.rankOf(learned);
    const rankPct = nextRank ? Math.round(((learned - rank.at) / (nextRank.at - rank.at)) * 100) : 100;
    const cur = EN.chapterOf(bank, pen);
    const clues = Math.min(ch.clues, pen.clues[ch.id] || 0);
    const allDone = pen.chapter >= bank.chapters.length;
    const price = cfg.vacationPrice;
    const vacPct = Math.min(100, Math.round((profile.coins / price) * 100));
    const mins = Math.max(1, Math.round((Date.now() - S.started) / 60000));
    let say1;
    if (S.arrest) {
      const v = (bank.rules[S.arrest] || {}).villain || S.arrest;
      say1 = allDone
        ? `<b>${esc(v)} арестован, и вместе с ним сам Мистер Микс!</b> Банда разгромлена. Интерпол объявляет тебе благодарность, агент.`
        : `<b>${esc(v)} арестован!</b> Банда бежит в ${esc(cur.chapter.city)}. Интерпол уже готовит билеты.`;
    } else if (plan.patrol) {
      say1 = 'Патруль окончен. Сообщники Мистера Микса не прошли незамеченными.';
    } else {
      say1 = `${S.clean ? 'Блестящая работа, ни одного промаха!' : 'Отличная работа, агент!'} Улика у нас. ${esc(ch.city)}: улик ${clues} из ${ch.clues}.`;
    }
    const canVac = profile.coins >= price && cfg.vacationsLeftToday > 0 && !profile.vacationPending;
    const vacNote = profile.vacationPending ? 'Отпуск уже взят: следующее занятие пропускается.'
      : profile.coins < price ? `Копилка на «отпуск»: ${profile.coins} из ${price}`
        : cfg.vacationsLeftToday > 0 ? `Хватает на «отпуск»! В копилке ${profile.coins}, отпуск стоит ${price}.`
          : `В копилке ${profile.coins}. Сегодня отпусков больше нет.`;
    const cities = bank.chapters.map((c, i) => {
      const cls = i < pen.chapter ? 'done' : (c.id === cur.chapter.id && !cur.patrol ? 'on' : '');
      return `<div class="city ${cls}"><span class="m">${esc(c.mark || '')}</span>${esc(c.city)}</div>`;
    }).join('');
    card(S.arrest ? 'Арест!' : 'Улика добыта', `
      ${det(say1, '🕵️')}
      ${S.arrest ? `<div class="arrest">${allDone ? 'Все бандиты пойманы. Дальше — патрулирование и повторение слов.' : `Следующая глава: ${esc(cur.chapter.city)}, ${esc(cur.chapter.topic)}.`}</div>` : ''}
      <div class="stats">
        <div class="stat"><div class="v">${S.wordsOk} из ${S.words}</div><div class="k">слов с первого раза</div></div>
        <div class="stat"><div class="v">+${S.coins}</div><div class="k">коинов · около ${mins} мин</div></div>
        <div class="stat"><div class="v">${learned}</div><div class="k">слов выучено из ${Object.keys(bank.words).length}</div></div>
      </div>
      ${!S.arrest && !plan.patrol ? `<div class="stat"><div class="k">Улики против бандита в главе «${esc(ch.city)}»</div><div class="meter"><i style="width:${Math.round((clues / ch.clues) * 100)}%"></i></div></div>` : ''}
      <div class="stat"><div class="k">Звание Интерпола: <b>${esc(rank.n)}</b>${nextRank ? ` · до «${esc(nextRank.n)}» ещё ${nextRank.at - learned} слов` : ''}</div><div class="meter"><i style="width:${rankPct}%"></i></div></div>
      <div class="stat"><div class="k" id="vacNote">${esc(vacNote)}</div><div class="meter lamp"><i style="width:${vacPct}%"></i></div></div>
      <div class="cities">${cities}</div>
      <div class="actions">${canVac ? `<button class="btn-ghost" id="vac">Взять отпуск (−${price})</button>` : '<span></span>'}<button class="btn-main" id="back">Вернуться в игру</button></div>`);
    say(S.arrest ? 'Gotcha! Great job, agent!' : 'Great job, agent!');
    $('back').onclick = async () => { $('back').disabled = true; await api.invoke('session:end', { solved: S.clean }); };
    $('back').focus();
    const v = $('vac');
    if (v) {
      v.onclick = async () => {
        v.disabled = true;
        const res = await api.invoke('session:vacation');
        profile = res.profile;
        v.textContent = res.ok ? 'Отпуск взят: следующее занятие пропускается' : (res.why || 'Не получилось');
        if (res.ok) $('vacNote').textContent = `Отпуск взят! В копилке осталось ${profile.coins}.`;
      };
    }
  }

  briefing();
})();
