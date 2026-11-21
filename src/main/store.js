// Настройки, прогресс и PIN родителя. Хранятся в папке пользователя Windows (%APPDATA%\Детектив Ошибкин).
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SETTINGS_DEFAULTS = {
  childName: 'Лева',
  intervalMin: 15,
  warnSec: 120,
  postponeSec: 120,
  postponeLimit: 1,
  idleStartSec: 7,
  maxWaitPauseSec: 300,
  finalSec: 10,
  awaySec: 120,
  maxTasks: 3,
  vacationPrice: 150,
  vacationsPerDay: 1,
  quietFrom: '',
  quietTo: '',
  autostart: true,
  telegramToken: '',
  telegramChatId: '',
  reportEachSession: true,
  dailyReportAt: '20:00',
  pinHash: '',
  pinSalt: '',
};

const PROFILE_DEFAULTS = {
  coins: 0, // в копилке
  total: 0, // заработано за всё время (для званий)
  cleanCases: 0,
  sessions: 0,
  stats: {}, // { правило: { ok, miss } }
  drillIndex: {},
  lastCase: null,
  vacationsUsed: {}, // { 'ГГГГ-ММ-ДД': число }
  vacationPending: false,
  activeSec: 0,
  log: [], // последние занятия для отчёта
  lastDailyReport: '',
};

function readJson(file, defaults) {
  try {
    return Object.assign({}, defaults, JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (e) {
    return Object.assign({}, defaults);
  }
}

// Запись через временный файл: при сбое питания не останется полузаписанного JSON.
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function hashPin(pin, salt) {
  return crypto.scryptSync(String(pin), salt, 32).toString('hex');
}

class Store {
  constructor(dir) {
    this.dir = dir;
    this.settingsFile = path.join(dir, 'settings.json');
    this.profileFile = path.join(dir, 'progress.json');
    this.settings = readJson(this.settingsFile, SETTINGS_DEFAULTS);
    this.profile = readJson(this.profileFile, PROFILE_DEFAULTS);
  }

  saveSettings(patch) {
    const clean = {};
    Object.keys(SETTINGS_DEFAULTS).forEach((k) => {
      if (patch[k] === undefined || k === 'pinHash' || k === 'pinSalt') return;
      const def = SETTINGS_DEFAULTS[k];
      if (typeof def === 'number') {
        const n = Number(patch[k]);
        if (Number.isFinite(n) && n >= 0) clean[k] = n;
      } else if (typeof def === 'boolean') clean[k] = !!patch[k];
      else clean[k] = String(patch[k]).trim();
    });
    if (clean.maxTasks != null) clean.maxTasks = Math.min(5, Math.max(1, Math.round(clean.maxTasks)));
    Object.assign(this.settings, clean);
    writeJson(this.settingsFile, this.settings);
    return this.settings;
  }

  saveProfile() {
    writeJson(this.profileFile, this.profile);
  }

  hasPin() {
    return !!this.settings.pinHash;
  }

  setPin(pin) {
    if (!/^\d{4,8}$/.test(String(pin))) throw new Error('PIN — от 4 до 8 цифр');
    const salt = crypto.randomBytes(16).toString('hex');
    this.settings.pinSalt = salt;
    this.settings.pinHash = hashPin(pin, salt);
    writeJson(this.settingsFile, this.settings);
  }

  checkPin(pin) {
    if (!this.hasPin()) return true;
    const h = hashPin(pin, this.settings.pinSalt);
    return crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(this.settings.pinHash, 'hex'));
  }

  // Настройки без секретов — для окна настроек.
  publicSettings() {
    const s = Object.assign({}, this.settings);
    delete s.pinHash;
    delete s.pinSalt;
    s.hasPin = this.hasPin();
    return s;
  }

  vacationsToday(date) {
    return this.profile.vacationsUsed[dayKey(date || new Date())] || 0;
  }

  // Ребёнок «покупает» отпуск: следующее занятие пропускается.
  buyVacation(date) {
    const p = this.profile;
    const s = this.settings;
    if (p.vacationPending) return { ok: false, why: 'Отпуск уже взят' };
    if (p.coins < s.vacationPrice) return { ok: false, why: 'Не хватает коинов' };
    if (this.vacationsToday(date) >= s.vacationsPerDay) return { ok: false, why: 'Сегодня отпуск уже был' };
    p.coins -= s.vacationPrice;
    p.vacationPending = true;
    const k = dayKey(date || new Date());
    p.vacationsUsed[k] = (p.vacationsUsed[k] || 0) + 1;
    this.saveProfile();
    return { ok: true };
  }
}

function dayKey(d) {
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

module.exports = { Store, SETTINGS_DEFAULTS, PROFILE_DEFAULTS, dayKey, writeJson };
