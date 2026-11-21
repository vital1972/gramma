// Когда звать на занятие. Чистая логика без Electron: на вход время и простой ввода, на выход — состояние.
//
// Состояния:
//   play      — ребёнок играет, копим активное время
//   warning   — телефон звонит, идёт отсчёт предупреждения
//   postponed — ребёнок нажал «Отложить», ждём
//   waitPause — отсчёт кончился, ждём паузы клавиатуры и мыши
//   final     — пауза так и не наступила, последнее предупреждение
//   session   — идёт занятие
'use strict';

const DEFAULTS = {
  intervalMin: 15, // активной игры между занятиями
  warnSec: 120, // предупреждение заранее
  postponeSec: 120, // «Отложить на 2 минуты»
  postponeLimit: 1, // сколько раз можно отложить перед каждым делом
  idleStartSec: 7, // пауза ввода, после которой можно начинать
  maxWaitPauseSec: 300, // сколько ждать паузу, потом последнее предупреждение
  finalSec: 10,
  awaySec: 120, // простой дольше этого — ребёнок отошёл, время игры не копится
  quietFrom: '', // «тихие часы», например '21:00'
  quietTo: '',
};

function minutesOfDay(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function inQuietHours(settings, date) {
  const from = minutesOfDay(settings.quietFrom);
  const to = minutesOfDay(settings.quietTo);
  if (from == null || to == null || from === to) return false;
  const now = date.getHours() * 60 + date.getMinutes();
  return from < to ? now >= from && now < to : now >= from || now < to;
}

class Scheduler {
  constructor(settings, saved) {
    this.s = Object.assign({}, DEFAULTS, settings);
    this.state = 'play';
    this.activeSec = (saved && saved.activeSec) || 0;
    this.left = 0; // секунд до конца текущего отсчёта
    this.waited = 0;
    this.postponed = 0;
  }

  setSettings(settings) {
    this.s = Object.assign({}, DEFAULTS, settings);
  }

  // Вызывается раз в секунду.
  // idleSec — сколько секунд нет ввода; velo — состояние велоконтроллера ('idle' | 'riding' | 'blocking' | null).
  // Возвращает список событий для интерфейса.
  tick({ dt = 1, idleSec = 0, date = new Date(), velo = null }) {
    const ev = [];
    const veloBusy = velo === 'riding' || velo === 'blocking';
    switch (this.state) {
      case 'play':
        if (idleSec < this.s.awaySec) this.activeSec += dt;
        if (this.activeSec >= this.s.intervalMin * 60 && !inQuietHours(this.s, date) && !veloBusy) {
          this.state = 'warning';
          this.left = this.s.warnSec;
          this.postponed = 0;
          ev.push('ring');
        }
        break;
      case 'warning':
        this.left -= dt;
        if (this.left <= 0) {
          this.state = 'waitPause';
          this.waited = 0;
          ev.push('waitPause');
        }
        break;
      case 'postponed':
        this.left -= dt;
        if (this.left <= 0) {
          this.state = 'warning';
          this.left = Math.min(60, this.s.warnSec);
          ev.push('ring');
        }
        break;
      case 'waitPause':
        this.waited += dt;
        if (idleSec >= this.s.idleStartSec) {
          this.startSession(ev);
        } else if (this.waited >= this.s.maxWaitPauseSec) {
          this.state = 'final';
          this.left = this.s.finalSec;
          ev.push('final');
        }
        break;
      case 'final':
        this.left -= dt;
        if (this.left <= 0 || idleSec >= this.s.idleStartSec) this.startSession(ev);
        break;
      case 'session':
        break;
    }
    if (this.state !== 'session' && this.state !== 'play') ev.push('countdown');
    return ev;
  }

  startSession(ev) {
    this.state = 'session';
    (ev || []).push('start');
  }

  // Ребёнок нажал «Прочитать».
  readNow() {
    if (this.state === 'play' || this.state === 'session') return false;
    this.startSession();
    return true;
  }

  canPostpone() {
    return this.state === 'warning' && this.postponed < this.s.postponeLimit;
  }

  // Ребёнок нажал «Отложить».
  postpone() {
    if (!this.canPostpone()) return false;
    this.postponed++;
    this.state = 'postponed';
    this.left = this.s.postponeSec;
    return true;
  }

  // Занятие закончено (или родитель закрыл его / ребёнок взял «отпуск»).
  finish() {
    this.state = 'play';
    this.activeSec = 0;
    this.left = 0;
  }

  // Вызов «прямо сейчас» из меню в трее.
  forceStart() {
    this.startSession();
  }

  snapshot() {
    return { activeSec: this.activeSec };
  }
}

module.exports = { Scheduler, DEFAULTS, inQuietHours };
