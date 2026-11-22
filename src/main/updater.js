// Обновления с GitHub: банки заданий (content/content.json и content/english.json в ветке main) и сама программа (релизы).
'use strict';
const fs = require('fs');
const path = require('path');
const core = require('../core/content');
const { writeJson } = require('./store');

const REPO = 'vital1972/gramma';
const CONTENT_URL = `https://raw.githubusercontent.com/${REPO}/main/content/content.json`;

const ENGLISH_URL = `https://raw.githubusercontent.com/${REPO}/main/content/english.json`;
const english = require('../core/english');

// Берём банк заданий: скачанный (если новее и без ошибок) или встроенный в программу.
function loadBank(userDir, bundledFile, fileName, validate) {
  const bundled = JSON.parse(fs.readFileSync(bundledFile, 'utf8'));
  try {
    const local = JSON.parse(fs.readFileSync(path.join(userDir, fileName), 'utf8'));
    if ((local.version || 0) > (bundled.version || 0) && validate(local).length === 0) return local;
  } catch (e) {
    /* скачанного банка нет */
  }
  return bundled;
}

async function updateBank(userDir, current, url, fileName, validate, fetchImpl) {
  const f = fetchImpl || fetch;
  try {
    const r = await f(url, { cache: 'no-store' });
    if (!r.ok) return { updated: false, why: `HTTP ${r.status}` };
    const next = await r.json();
    if ((next.version || 0) <= ((current && current.version) || 0)) return { updated: false, why: 'уже последняя версия' };
    const problems = validate(next);
    if (problems.length) return { updated: false, why: 'в новом банке ошибки: ' + problems.slice(0, 3).join('; ') };
    writeJson(path.join(userDir, fileName), next);
    return { updated: true, content: next };
  } catch (e) {
    return { updated: false, why: 'нет связи' };
  }
}

const loadContent = (userDir, bundledFile) => loadBank(userDir, bundledFile, 'content.json', core.validate);
const updateContent = (userDir, current, fetchImpl) => updateBank(userDir, current, CONTENT_URL, 'content.json', core.validate, fetchImpl);
const loadEnglish = (userDir, bundledFile) => loadBank(userDir, bundledFile, 'english.json', english.validate);
const updateEnglish = (userDir, current, fetchImpl) => updateBank(userDir, current, ENGLISH_URL, 'english.json', english.validate, fetchImpl);

// Обновление программы через electron-updater. Ставим только когда занятия нет.
function setupAppUpdates(log, isBusy) {
  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (e) {
    return { check() {} };
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  let ready = false;
  autoUpdater.on('update-downloaded', (info) => {
    ready = true;
    log(`Скачана версия ${info.version}, установится при выходе или в паузе`);
  });
  autoUpdater.on('error', (e) => log('Обновление программы: ' + (e && e.message)));
  return {
    check() {
      autoUpdater.checkForUpdates().catch(() => {});
    },
    // Вызывается периодически: если обновление скачано и ребёнок давно не за компьютером — ставим.
    maybeInstall(idleSec) {
      if (ready && !isBusy() && idleSec > 600) autoUpdater.quitAndInstall(true, true);
    },
  };
}

module.exports = { loadContent, updateContent, loadEnglish, updateEnglish, setupAppUpdates, CONTENT_URL, ENGLISH_URL };
