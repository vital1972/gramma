// Окно родителя: PIN, отчёт, настройки.
'use strict';
(() => {
  const api = window.oshibkin;
  const core = window.OshibkinCore;
  const $ = (id) => document.getElementById(id);
  const NUM = ['intervalMin', 'maxTasks', 'warnSec', 'postponeSec', 'postponeLimit', 'idleStartSec', 'maxWaitPauseSec', 'vacationPrice', 'vacationsPerDay'];
  const TEXT = ['childName', 'quietFrom', 'quietTo', 'telegramToken', 'telegramChatId', 'dailyReportAt'];
  const BOOL = ['reportEachSession', 'autostart'];
  const TIME = ['quietFrom', 'quietTo', 'dailyReportAt'];
  let state = null;

  function say(id, msg, cls) {
    const el = $(id);
    el.className = 'toast ' + (cls || '');
    // Ошибки из main-процесса приходят с длинной приставкой Electron.
    el.textContent = String(msg || '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  }

  async function load() {
    state = await api.invoke('settings:state');
    const needPin = !state.settings.hasPin;
    $('lock').hidden = state.unlocked && !needPin;
    $('main').hidden = !$('lock').hidden;
    if (needPin) {
      $('lockTitle').textContent = 'Придумайте PIN родителя';
      $('lockHelp').textContent = 'От 4 до 8 цифр. Без PIN нельзя менять настройки, прерывать занятие и выходить из программы.';
      $('pin2Wrap').hidden = false;
      $('pinOk').textContent = 'Сохранить PIN';
    } else {
      $('lockTitle').textContent = 'Введите PIN родителя';
      $('lockHelp').textContent = '';
      $('pin2Wrap').hidden = true;
      $('pinOk').textContent = 'Войти';
    }
    if (!$('lock').hidden) { $('pinIn').focus(); return; }
    fill();
  }

  function fill() {
    const s = state.settings;
    NUM.concat(TEXT).forEach((k) => { $(k).value = s[k] == null ? '' : s[k]; });
    BOOL.forEach((k) => { $(k).checked = !!s[k]; });
    header();
  }

  function header() {
    $('ver').textContent = `Программа ${state.appVersion} · задания v${state.contentVersion}${state.inSession ? ' · идёт занятие' : ''}`;
    $('stopSession').disabled = !state.inSession;
    $('startNow').disabled = state.inSession;
    report();
  }

  function report() {
    const p = state.profile;
    const { rank, next } = core.rankOf(p.total);
    const log = (p.log || []).slice(-60);
    const today = log.length ? log[log.length - 1].day : '';
    const sum = (arr, k) => arr.reduce((a, x) => a + (x[k] || 0), 0);
    const t = log.filter((x) => x.day === today);
    $('stats').innerHTML = '';
    [
      [rank.n, next ? `звание · до «${next.n}» ${next.at - p.total}` : 'звание'],
      [p.coins, 'коинов в копилке'],
      [p.sessions, 'занятий всего'],
      [p.cleanCases, 'дел без единой ошибки'],
      [t.length ? `${sum(t, 'found')} из ${sum(t, 'total')}` : '—', 'улик за последний день'],
      [p.vacationPending ? 'да' : 'нет', 'отпуск ждёт'],
    ].forEach(([v, k]) => {
      const d = document.createElement('div');
      d.className = 'stat';
      d.innerHTML = '<div class="v"></div><div class="k"></div>';
      d.firstChild.textContent = v;
      d.lastChild.textContent = k;
      $('stats').append(d);
    });
    $('chips').innerHTML = '';
    Object.keys(state.rules).forEach((r) => {
      const st = p.stats[r];
      const c = document.createElement('span');
      c.className = 'chip' + (st ? (st.miss > st.ok ? ' weak' : st.ok > 0 ? ' strong' : '') : '');
      c.textContent = st ? `${state.rules[r].name}: верно ${st.ok}, ошибок ${st.miss}` : `${state.rules[r].name}: ещё не было`;
      $('chips').append(c);
    });
    // По дням, свежие сверху.
    const days = {};
    log.forEach((x) => {
      const d = days[x.day] || (days[x.day] = { tasks: 0, found: 0, total: 0, coins: 0, minutes: 0 });
      ['tasks', 'found', 'total', 'coins', 'minutes'].forEach((k) => { d[k] += x[k] || 0; });
    });
    $('log').innerHTML = '';
    const keys = Object.keys(days).sort().reverse().slice(0, 14);
    if (!keys.length) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="5">Занятий ещё не было</td>';
      $('log').append(tr);
    }
    keys.forEach((k) => {
      const d = days[k];
      const tr = document.createElement('tr');
      [k.split('-').reverse().join('.'), d.tasks, `${d.found} из ${d.total}`, d.coins, d.minutes].forEach((v) => {
        const td = document.createElement('td');
        td.textContent = v;
        tr.append(td);
      });
      $('log').append(tr);
    });
  }

  function collect() {
    const patch = {};
    for (const k of TIME) {
      const v = $(k).value.trim();
      if (v && !/^([01]?\d|2[0-3]):[0-5]\d$/.test(v)) throw new Error(`Время «${v}» нужно в виде ЧЧ:ММ`);
    }
    NUM.forEach((k) => { patch[k] = Number($(k).value); });
    TEXT.forEach((k) => { patch[k] = $(k).value.trim(); });
    BOOL.forEach((k) => { patch[k] = $(k).checked; });
    if (!(patch.intervalMin >= 5)) throw new Error('Интервал — не меньше 5 минут');
    return patch;
  }

  async function save() {
    const patch = collect();
    state.settings = await api.invoke('settings:save', patch);
    return state.settings;
  }

  $('pinOk').onclick = async () => {
    const pin = $('pinIn').value.trim();
    try {
      if (!state.settings.hasPin) {
        if (!/^\d{4,8}$/.test(pin)) return say('pinToast', 'PIN — от 4 до 8 цифр', 'bad');
        if (pin !== $('pin2In').value.trim()) return say('pinToast', 'PIN не совпадает', 'bad');
        await api.invoke('settings:pin', pin);
      } else if (!(await api.invoke('settings:unlock', pin))) {
        $('pinIn').value = '';
        return say('pinToast', 'Неверный PIN', 'bad');
      }
      $('pinIn').value = '';
      $('pin2In').value = '';
      say('pinToast', '');
      load();
    } catch (e) {
      say('pinToast', e.message, 'bad');
    }
  };
  ['pinIn', 'pin2In'].forEach((id) => { $(id).onkeydown = (e) => { if (e.key === 'Enter') $('pinOk').click(); }; });

  $('lockBtn').onclick = () => { api.send('settings:lock'); load(); };

  $('save').onclick = async () => {
    try {
      await save();
      say('saveToast', 'Сохранено', 'good');
    } catch (e) {
      say('saveToast', e.message, 'bad');
    }
  };

  $('tgTest').onclick = async () => {
    try {
      await save();
      say('tgToast', 'Отправляю…');
      const r = await api.invoke('settings:telegramTest');
      say('tgToast', r.ok ? 'Сообщение отправлено, проверьте Telegram' : r.why, r.ok ? 'good' : 'bad');
    } catch (e) {
      say('tgToast', e.message, 'bad');
    }
  };

  const act = (id, ch, okMsg) => {
    $(id).onclick = async () => {
      try {
        const r = await api.invoke(ch);
        say('actToast', typeof okMsg === 'function' ? okMsg(r) : okMsg, 'good');
        state = await api.invoke('settings:state');
        header();
      } catch (e) {
        say('actToast', e.message, 'bad');
      }
    };
  };
  act('startNow', 'settings:startNow', 'Дело открыто');
  act('stopSession', 'settings:stopSession', 'Занятие прервано');
  act('checkUpdates', 'settings:checkUpdates', (v) => `Проверено. Задания v${v}`);

  $('changePin').onclick = async () => {
    try {
      await api.invoke('settings:pin', $('newPin').value.trim());
      $('newPin').value = '';
      say('actToast', 'PIN изменён', 'good');
    } catch (e) {
      say('actToast', 'PIN — от 4 до 8 цифр', 'bad');
    }
  };

  // Опасные кнопки срабатывают со второго нажатия.
  const twice = (id, label, fn) => {
    let armed = false;
    $(id).onclick = async () => {
      if (!armed) {
        armed = true;
        $(id).textContent = 'Точно? Нажмите ещё раз';
        setTimeout(() => { armed = false; $(id).textContent = label; }, 4000);
        return;
      }
      await fn();
    };
  };
  twice('reset', 'Сбросить прогресс', async () => {
    state.profile = await api.invoke('settings:resetProgress');
    report();
    say('actToast', 'Прогресс сброшен', 'good');
  });
  twice('quit', 'Выйти из программы', () => api.invoke('settings:quit'));

  // Обновить отчёт, когда занятие началось или закончилось.
  const refresh = () => { if (!$('main').hidden) api.invoke('settings:state').then((s) => { state = s; header(); }); };
  window.addEventListener('focus', refresh);
  api.on('settings:changed', refresh);
  load();
})();
