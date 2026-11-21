// Обмен состоянием с велоконтроллером через файлы в %ProgramData%.
// Формат описан в документе «Велоконтроллер: пауза на время занятия».
'use strict';
const fs = require('fs');
const path = require('path');
const { writeJson } = require('./store');

const HEARTBEAT_SEC = 5;
const STALE_SEC = 15;

function programData() {
  return process.env.ProgramData || process.env.PROGRAMDATA || path.join(require('os').tmpdir(), 'ProgramData');
}

class VeloLink {
  constructor(base) {
    const root = base || programData();
    this.ourFile = path.join(root, 'DetectiveOshibkin', 'state.json');
    this.veloFile = path.join(root, 'VeloController', 'state.json');
    this.state = 'idle';
    this.phase = null;
    this.sessionId = null;
    this.startedAt = null;
    this.lastWrite = 0;
  }

  set(state, phase) {
    if (state === 'session' && this.state !== 'session') {
      this.startedAt = new Date().toISOString();
      this.sessionId = this.startedAt;
    }
    if (state === 'idle') {
      this.sessionId = null;
      this.startedAt = null;
    }
    const changed = state !== this.state || phase !== this.phase;
    this.state = state;
    this.phase = phase || null;
    if (changed) this.write();
  }

  // Раз в секунду; файл переписывается раз в 5 секунд (heartbeat).
  tick(nowMs) {
    if (nowMs - this.lastWrite >= HEARTBEAT_SEC * 1000) this.write(nowMs);
  }

  write(nowMs) {
    const now = nowMs || Date.now();
    this.lastWrite = now;
    try {
      writeJson(this.ourFile, {
        version: 1,
        state: this.state,
        phase: this.phase,
        session_id: this.sessionId,
        started_at: this.startedAt,
        heartbeat: new Date(now).toISOString(),
      });
    } catch (e) {
      // Нет прав на ProgramData — тренажёр работает и без велоконтроллера.
    }
  }

  // Что сейчас делает велоконтроллер: 'idle' | 'riding' | 'blocking' | null (нет файла или он устарел).
  readVelo(nowMs) {
    try {
      const v = JSON.parse(fs.readFileSync(this.veloFile, 'utf8'));
      const age = ((nowMs || Date.now()) - Date.parse(v.heartbeat)) / 1000;
      if (!Number.isFinite(age) || age > STALE_SEC) return null;
      return ['idle', 'riding', 'blocking'].includes(v.state) ? v.state : null;
    } catch (e) {
      return null;
    }
  }
}

module.exports = { VeloLink, STALE_SEC };
