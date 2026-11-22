// Детектив Ошибкин — фоновая программа в трее Windows.
'use strict';
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, Tray, Menu, ipcMain, globalShortcut, powerMonitor, screen, nativeImage } = require('electron');
const { Store, dayKey, PROFILE_DEFAULTS } = require('./store');
const { Scheduler } = require('../core/scheduler');
const core = require('../core/content');
const english = require('../core/english');
const { VeloLink } = require('./velo');
const telegram = require('./telegram');
const updater = require('./updater');

const ROOT = path.join(__dirname, '..', '..');
const RENDERER = path.join(__dirname, '..', 'renderer');
const PRELOAD = path.join(__dirname, 'preload.js');
const DEMO = process.argv.includes('--demo'); // ускоренный режим для проверки: 1 минута вместо 15

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let store;
let content;
let enBank = null; // английский банк заданий (content/english.json)
let nextSubj = null; // предмет ближайшего занятия: 'ru' | 'en'
let scheduler;
let velo;
let appUpdates;
let tray;
let phoneWin = null;
let sessionWin = null;
let settingsWin = null;
let allowSessionClose = false;
let session = null; // итоги текущего занятия
let hotkeys = false;

function log(msg) {
  const line = `${new Date().toISOString()} ${msg}`;
  // eslint-disable-next-line no-console
  console.log(line);
  // Журнал на диске, чтобы разбирать проблемы на компьютере ребёнка.
  try {
    const file = path.join(app.getPath('userData'), 'oshibkin.log');
    if (fs.existsSync(file) && fs.statSync(file).size > 512 * 1024) fs.renameSync(file, file + '.old');
    fs.appendFileSync(file, line + '\n');
  } catch (e) { /* журнал не важнее работы */ }
}

function schedulerSettings() {
  const s = Object.assign({}, store.settings);
  if (DEMO) Object.assign(s, { intervalMin: 1, warnSec: 15, postponeSec: 15, maxWaitPauseSec: 30 });
  return s;
}

// ---------- окна ----------

function webPrefs() {
  return { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, sandbox: true };
}

const PHONE = { w: 190, h: 290 };
const PHONE_MENU = { w: 480, h: 300 };

function placePhone(size) {
  const wa = screen.getPrimaryDisplay().workArea;
  phoneWin.setBounds({ x: wa.x + wa.width - size.w - 16, y: wa.y + wa.height - size.h - 16, width: size.w, height: size.h });
}

function showPhone(mode) {
  if (!phoneWin) {
    phoneWin = new BrowserWindow({
      width: PHONE.w, height: PHONE.h, frame: false, transparent: true, resizable: false, movable: false,
      skipTaskbar: true, alwaysOnTop: true, focusable: false, show: false, webPreferences: webPrefs(),
    });
    phoneWin.setAlwaysOnTop(true, 'screen-saver');
    phoneWin.loadFile(path.join(RENDERER, 'phone.html'));
    phoneWin.on('closed', () => { phoneWin = null; });
    phoneWin.webContents.once('did-finish-load', () => pushPhone(mode, true));
    placePhone(PHONE);
  } else {
    pushPhone(mode, true);
  }
  if (!phoneWin.isVisible()) phoneWin.showInactive();
  registerHotkeys();
}

// Какой предмет следующим: по настройкам чередования. Без английского банка — всегда русский.
function chooseSubject() {
  if (!enBank) return 'ru';
  return english.nextSubject(store.settings, store.profile.queue, new Date());
}

function pushPhone(mode, buzz) {
  if (!phoneWin) return;
  phoneWin.webContents.send('phone:update', {
    subject: nextSubj || 'ru',
    mode: mode || scheduler.state,
    left: Math.max(0, Math.ceil(scheduler.left)),
    canPostpone: scheduler.canPostpone(),
    buzz: !!buzz,
  });
}

function hidePhone() {
  unregisterHotkeys();
  if (phoneWin) phoneWin.hide();
  if (phoneWin) placePhone(PHONE);
}

function registerHotkeys() {
  if (hotkeys) return;
  // Клавиши заняты только пока телефон на экране, чтобы не мешать игре.
  hotkeys = globalShortcut.register('F9', () => readNow()) && globalShortcut.register('F10', () => postpone());
}

function unregisterHotkeys() {
  if (!hotkeys) return;
  globalShortcut.unregister('F9');
  globalShortcut.unregister('F10');
  hotkeys = false;
}

function openSessionWindow(subject) {
  hidePhone();
  const subj = subject || nextSubj || chooseSubject();
  nextSubj = subj;
  velo.set('session', 'task');
  log(`Занятие началось (${subj === 'en' ? 'английский' : 'русский'})`);
  session = { subject: subj, started: Date.now(), tasks: 0, found: 0, total: 0, coins: 0, falseHits: 0, missedRules: [], solved: false, vacation: false, words: 0, wordsOk: 0, intercept: false, arrest: null };
  allowSessionClose = false;
  sessionWin = new BrowserWindow({
    fullscreen: true, frame: false, alwaysOnTop: true, skipTaskbar: false, closable: true, minimizable: false,
    backgroundColor: '#1d1a24', show: false, webPreferences: webPrefs(),
  });
  sessionWin.setAlwaysOnTop(true, 'screen-saver');
  sessionWin.setMenuBarVisibility(false);
  sessionWin.loadFile(path.join(RENDERER, subj === 'en' ? 'session-en.html' : 'session.html'));
  sessionWin.once('ready-to-show', () => { sessionWin.show(); sessionWin.focus(); });
  // Закрыть окно занятия можно только кнопкой «Вернуться в игру» или из трея по PIN.
  sessionWin.on('close', (e) => { if (!allowSessionClose) e.preventDefault(); });
  sessionWin.on('blur', () => { if (sessionWin && !allowSessionClose) setTimeout(() => sessionWin && sessionWin.focus(), 150); });
  sessionWin.on('closed', () => { sessionWin = null; });
  buildTray();
  if (settingsWin) settingsWin.webContents.send('settings:changed');
}

function closeSessionWindow() {
  allowSessionClose = true;
  if (sessionWin) sessionWin.close();
  nextSubj = null;
  velo.set('idle');
  scheduler.finish();
  store.profile.activeSec = 0;
  store.saveProfile();
  buildTray();
  if (settingsWin) settingsWin.webContents.send('settings:changed');
}

function openSettings() {
  if (settingsWin) { settingsWin.show(); settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 760, height: 760, title: 'Детектив Ошибкин — настройки', autoHideMenuBar: true,
    backgroundColor: '#1d1a24', webPreferences: webPrefs(),
  });
  settingsWin.loadFile(path.join(RENDERER, 'settings.html'));
  settingsWin.on('closed', () => { settingsWin = null; });
}

// ---------- трей ----------

function trayIcon() {
  const img = nativeImage.createFromPath(path.join(ROOT, 'build', 'tray.png'));
  return img.isEmpty() ? nativeImage.createEmpty() : img;
}

function buildTray() {
  if (!tray) {
    tray = new Tray(trayIcon());
    tray.setToolTip(`Детектив Ошибкин ${app.getVersion()}`);
    tray.on('double-click', openSettings);
  }
  const items = [
    { label: 'Открыть дело сейчас', enabled: !sessionWin, click: () => startNow() },
    { label: 'Дело Интерпола (английский) сейчас', enabled: !sessionWin && !!enBank, click: () => startNow('en') },
    { label: 'Настройки и отчёт…', click: openSettings },
    { type: 'separator' },
  ];
  if (sessionWin) items.push({ label: 'Прервать занятие (нужен PIN)…', click: () => openSettings() });
  items.push({ label: 'Выход (нужен PIN)…', click: () => openSettings() });
  tray.setContextMenu(Menu.buildFromTemplate(items));
}

// ---------- действия ребёнка ----------

function readNow() {
  if (scheduler.readNow()) openSessionWindow();
}

function postpone() {
  if (scheduler.postpone()) {
    hidePhone();
    velo.set('idle');
  }
}

function startNow(subject) {
  if (sessionWin) return;
  scheduler.forceStart();
  openSessionWindow(subject === 'ru' || (subject === 'en' && enBank) ? subject : chooseSubject());
}

// ---------- главный цикл ----------

function onRing() {
  if (store.profile.vacationPending) {
    // «Отпуск»: занятие пропускается, телефон только поздравляет.
    store.profile.vacationPending = false;
    store.saveProfile();
    scheduler.finish();
    showPhone('vacation');
    setTimeout(hidePhone, 8000);
    return;
  }
  nextSubj = chooseSubject();
  velo.set('warning');
  showPhone('warning');
}

function loop() {
  const now = Date.now();
  const idleSec = powerMonitor.getSystemIdleTime();
  const veloState = velo.readVelo(now);
  const ev = scheduler.tick({ dt: 1, idleSec, date: new Date(now), velo: veloState });
  if (ev.includes('ring')) onRing();
  if (ev.includes('waitPause')) showPhone('waitPause');
  if (ev.includes('final')) showPhone('final');
  if (ev.includes('start')) openSessionWindow();
  else if (ev.includes('countdown')) pushPhone(scheduler.state, false);
  velo.tick(now);

  if (now % 30000 < 1000) {
    store.profile.activeSec = scheduler.activeSec;
    store.saveProfile();
  }
  dailyReport(new Date(now));
  if (appUpdates.maybeInstall) appUpdates.maybeInstall(idleSec);
}

// Отправка в Telegram с записью результата: его видно в окне родителя и в журнале.
async function report(kind, text) {
  const s = store.settings;
  const r = await telegram.send(s.telegramToken, s.telegramChatId, text);
  store.profile.lastReport = { kind, at: new Date().toISOString(), ok: !!r.ok, why: r.why || '' };
  store.saveProfile();
  log(`Telegram (${kind}): ${r.ok ? 'отправлено' : 'ошибка: ' + r.why}`);
  if (settingsWin) settingsWin.webContents.send('settings:changed');
  return r;
}

function dailyReport(date) {
  const s = store.settings;
  const [h, m] = (s.dailyReportAt || '').split(':').map(Number);
  if (!Number.isFinite(h)) return;
  const day = dayKey(date);
  if (store.profile.lastDailyReport === day) return;
  if (date.getHours() * 60 + date.getMinutes() < h * 60 + (m || 0)) return;
  store.profile.lastDailyReport = day;
  store.saveProfile();
  report('итог дня', telegram.dailyText(s.childName, store.profile.log, store.profile, content.rules, day, enBank));
}

async function checkUpdates() {
  const r = await updater.updateContent(app.getPath('userData'), content);
  if (r.updated) {
    content = r.content;
    log(`Банк заданий обновлён до версии ${content.version}`);
  } else if (r.why !== 'уже последняя версия') {
    log(`Банк заданий не обновлён: ${r.why}`);
  }
  if (enBank) {
    const e = await updater.updateEnglish(app.getPath('userData'), enBank);
    if (e.updated) {
      enBank = e.content;
      log(`Английский банк обновлён до версии ${enBank.version}`);
    } else if (e.why !== 'уже последняя версия') {
      log(`Английский банк не обновлён: ${e.why}`);
    }
  }
  appUpdates.check();
}

// ---------- связь с окнами ----------

// Английский прогресс для окна родителя.
function englishSummary() {
  if (!enBank) return null;
  const pen = english.ensure(store.profile.en);
  const { chapter, patrol } = english.chapterOf(enBank, pen);
  const learned = english.learnedCount(pen);
  return {
    version: enBank.version,
    chapter: chapter.city, topic: chapter.topic, patrol, clues: pen.clues[chapter.id] || 0, need: chapter.clues,
    villain: (enBank.rules[chapter.rule] || {}).villain || chapter.rule,
    learned, introduced: Object.keys(pen.words).length, wordsTotal: Object.keys(enBank.words).length,
    rank: english.rankOf(learned).rank.n, arrested: pen.arrested.map((r) => (enBank.rules[r] || {}).villain || r),
    sessions: pen.sessions,
    rules: Object.keys(enBank.rules).map((r) => ({ name: enBank.rules[r].name, villain: enBank.rules[r].villain, st: pen.stats[r] || null })),
  };
}

function publicProfile() {
  const p = store.profile;
  return { coins: p.coins, total: p.total, stats: p.stats, drillIndex: p.drillIndex, lastCase: p.lastCase, seenCases: p.seenCases || [], lastReport: p.lastReport || null, vacationPending: p.vacationPending, cleanCases: p.cleanCases, sessions: p.sessions, log: (p.log || []).slice(-60) };
}

function registerIpc() {
  ipcMain.on('phone:read', readNow);
  ipcMain.on('phone:later', postpone);
  ipcMain.on('phone:menu', (_e, open) => {
    if (!phoneWin) return;
    placePhone(open ? PHONE_MENU : PHONE);
  });

  ipcMain.handle('session:data', () => ({
    content,
    profile: publicProfile(),
    settings: { maxTasks: store.settings.maxTasks, vacationPrice: store.settings.vacationPrice, childName: store.settings.childName, vacationsLeftToday: Math.max(0, store.settings.vacationsPerDay - store.vacationsToday()) },
  }));
  ipcMain.handle('session:task', (_e, r) => {
    // Итог одного дела: { caseTitle, drillRule, coins, found, total, falseHits, statsAfter, reviewRules, clean }
    const p = store.profile;
    p.coins += r.coins; p.total += r.coins;
    if (r.clean) p.cleanCases++;
    p.stats = r.statsAfter || p.stats;
    if (r.caseTitle) {
      p.lastCase = r.caseTitle;
      p.seenCases = core.rememberCase(p.seenCases, r.caseTitle);
    }
    if (r.drillRule) p.drillIndex[r.drillRule] = (p.drillIndex[r.drillRule] || 0) + 1;
    store.saveProfile();
    Object.assign(session, {
      tasks: session.tasks + 1, found: session.found + r.found, total: session.total + r.total,
      coins: session.coins + r.coins, falseHits: session.falseHits + (r.falseHits || 0),
    });
    (r.reviewRules || []).forEach((x) => { if (!session.missedRules.includes(x)) session.missedRules.push(x); });
    velo.set('session', r.reviewRules && r.reviewRules.length ? 'rule' : 'result');
    return publicProfile();
  });
  ipcMain.handle('session:quiz', (_e, ok) => {
    if (ok) { store.profile.coins += 5; store.profile.total += 5; session.coins += 5; store.saveProfile(); }
    return publicProfile();
  });
  // ---------- английское занятие ----------
  ipcMain.handle('en:data', () => ({
    bank: enBank,
    pen: english.ensure(store.profile.en),
    profile: publicProfile(),
    now: Date.now(),
    settings: {
      maxTasks: store.settings.enMaxTasks, newWords: store.settings.enNewWords, speechRate: store.settings.speechRate, voiceOn: store.settings.voiceOn,
      vacationPrice: store.settings.vacationPrice, childName: store.settings.childName,
      vacationsLeftToday: Math.max(0, store.settings.vacationsPerDay - store.vacationsToday()),
    },
  }));
  ipcMain.handle('en:save', (_e, patch) => {
    // Шаг английского занятия: { coins, words: [{ w, ok }], phonics, intercept, note: { id, tokens, found, total, falseHits, clean }, drillRule }
    const p = store.profile;
    const coins = Math.max(0, Math.round(Number(patch.coins) || 0));
    p.coins += coins; p.total += coins;
    const r = english.applyResult(enBank, p.en, patch, Date.now());
    p.en = r.pen;
    session.coins += coins;
    (patch.words || []).forEach((x) => { session.words++; if (x.ok) session.wordsOk++; });
    if (patch.intercept) session.intercept = true;
    if (r.arrest) {
      session.arrest = r.arrest;
      log(`Глава закрыта, пойман бандит «${r.arrest}»`);
    }
    if (patch.note) {
      const n = patch.note;
      session.tasks++;
      session.found += n.found || 0; session.total += n.total || 0; session.falseHits += n.falseHits || 0;
      if (n.clean) p.cleanCases++;
      (n.tokens || []).filter((t) => t.t === 'e' && t.state !== 'ok').forEach((t) => { if (!session.missedRules.includes(t.rule)) session.missedRules.push(t.rule); });
      velo.set('session', session.missedRules.length ? 'rule' : 'result');
    }
    store.saveProfile();
    return { pen: p.en, profile: publicProfile(), arrest: r.arrest };
  });
  ipcMain.handle('session:vacation', () => {
    const r = store.buyVacation();
    if (r.ok) session.vacation = true;
    return Object.assign(r, { profile: publicProfile() });
  });
  ipcMain.handle('session:end', (_e, { solved }) => {
    const p = store.profile;
    session.solved = !!solved;
    session.minutes = Math.max(1, Math.round((Date.now() - session.started) / 60000));
    p.sessions++;
    p.queue = english.advanceQueue(p.queue, new Date());
    const entry = { day: dayKey(new Date()), subject: session.subject, minutes: session.minutes, found: session.found, total: session.total, coins: session.coins, tasks: session.tasks };
    if (session.subject === 'en') {
      Object.assign(entry, { words: session.words, wordsOk: session.wordsOk });
      p.en = english.applyResult(enBank, p.en, { sessionEnd: true }, Date.now()).pen;
    }
    p.log = (p.log || []).concat([entry]).slice(-200);
    store.saveProfile();
    log(`Занятие окончено (${session.subject}): дел ${session.tasks}, улик ${session.found} из ${session.total}${session.subject === 'en' ? `, слов ${session.wordsOk} из ${session.words}` : ''}`);
    const s = store.settings;
    if (s.reportEachSession) {
      report('занятие', session.subject === 'en'
        ? telegram.enSessionText(s.childName, session, p, enBank)
        : telegram.sessionText(s.childName, session, p, content.rules));
    }
    else log('Отчёт после занятия выключен в настройках');
    closeSessionWindow();
    return true;
  });

  // Окно настроек. Всё, что меняет настройки, требует PIN.
  let unlocked = false;
  ipcMain.handle('settings:state', () => ({
    unlocked: unlocked || !store.hasPin(), settings: store.publicSettings(), profile: publicProfile(), inSession: !!sessionWin,
    contentVersion: content.version, casesTotal: content.cases.length, logFile: path.join(app.getPath('userData'), 'oshibkin.log'),
    appVersion: app.getVersion(), rules: content.rules, english: englishSummary(), nextSubject: nextSubj || chooseSubject(),
  }));
  ipcMain.handle('settings:unlock', (_e, pin) => (unlocked = store.checkPin(pin)));
  const guard = (fn) => (...a) => { if (!(unlocked || !store.hasPin())) throw new Error('Нужен PIN'); return fn(...a); };
  ipcMain.handle('settings:save', guard((_e, patch) => {
    const s = store.saveSettings(patch);
    scheduler.setSettings(schedulerSettings());
    app.setLoginItemSettings({ openAtLogin: !!s.autostart });
    return store.publicSettings();
  }));
  ipcMain.handle('settings:pin', guard((_e, pin) => { store.setPin(pin); unlocked = true; return true; }));
  ipcMain.handle('settings:telegramTest', guard(() => report('проверка', `Детектив Ошибкин на связи. Отчёты о занятиях (${store.settings.childName}) будут приходить сюда.`)));
  ipcMain.handle('settings:stopSession', guard(() => { if (sessionWin) { session.minutes = 0; closeSessionWindow(); } return true; }));
  ipcMain.handle('settings:startNow', guard((_e, subject) => { startNow(subject); return true; }));
  ipcMain.handle('settings:checkUpdates', guard(async () => { await checkUpdates(); return content.version; }));
  ipcMain.handle('settings:resetProgress', guard(() => {
    store.profile = JSON.parse(JSON.stringify(PROFILE_DEFAULTS));
    store.saveProfile();
    return publicProfile();
  }));
  ipcMain.handle('settings:quit', guard(() => { allowSessionClose = true; app.exit(0); }));
  ipcMain.on('settings:lock', () => { unlocked = false; });
}

// ---------- запуск ----------

app.on('second-instance', openSettings);
app.on('window-all-closed', () => {}); // живём в трее, без окон не выходим

app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId('ru.gramma.oshibkin');
  store = new Store(app.getPath('userData'));
  content = updater.loadContent(app.getPath('userData'), path.join(ROOT, 'content', 'content.json'));
  try {
    enBank = updater.loadEnglish(app.getPath('userData'), path.join(ROOT, 'content', 'english.json'));
  } catch (e) {
    enBank = null;
    log('Английский банк не загрузился: ' + e.message);
  }
  scheduler = new Scheduler(schedulerSettings(), { activeSec: store.profile.activeSec });
  velo = new VeloLink();
  velo.set('idle');
  appUpdates = updater.setupAppUpdates(log, () => !!sessionWin || scheduler.state !== 'play');
  if (!DEMO) app.setLoginItemSettings({ openAtLogin: !!store.settings.autostart });
  registerIpc();
  buildTray();
  if (!store.hasPin()) openSettings(); // первый запуск: родитель задаёт PIN
  setInterval(loop, 1000);
  setTimeout(checkUpdates, 30 * 1000);
  setInterval(checkUpdates, 6 * 3600 * 1000);
  log(`Запущено. Банк заданий v${content.version}${enBank ? `, английский v${enBank.version}` : ''}${DEMO ? ', демо-режим' : ''}`);
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (velo) velo.set('idle');
});
