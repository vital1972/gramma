'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Scheduler, inQuietHours } = require('../src/core/scheduler');

const noon = new Date(2026, 10, 21, 12, 0);

function run(s, seconds, opts) {
  const events = [];
  for (let i = 0; i < seconds; i++) events.push(...s.tick(Object.assign({ date: noon }, opts)));
  return events;
}

test('через 15 минут активной игры звонит телефон', () => {
  const s = new Scheduler({});
  run(s, 899, { idleSec: 0 });
  assert.strictEqual(s.state, 'play');
  const ev = run(s, 1, { idleSec: 0 });
  assert.ok(ev.includes('ring'));
  assert.strictEqual(s.state, 'warning');
});

test('пока ребёнок отошёл от компьютера, время игры не копится', () => {
  const s = new Scheduler({});
  run(s, 2000, { idleSec: 500 });
  assert.strictEqual(s.state, 'play');
  assert.strictEqual(s.activeSec, 0);
});

test('после предупреждения ждём паузы ввода и только тогда начинаем', () => {
  const s = new Scheduler({ intervalMin: 1, warnSec: 5 });
  run(s, 60, { idleSec: 0 });
  run(s, 5, { idleSec: 0 });
  assert.strictEqual(s.state, 'waitPause');
  run(s, 30, { idleSec: 1 }); // ребёнок всё ещё жмёт клавиши
  assert.strictEqual(s.state, 'waitPause');
  const ev = run(s, 1, { idleSec: 7 });
  assert.ok(ev.includes('start'));
  assert.strictEqual(s.state, 'session');
});

test('если пауза так и не наступила — последнее предупреждение и старт', () => {
  const s = new Scheduler({ intervalMin: 1, warnSec: 5, maxWaitPauseSec: 20, finalSec: 10 });
  run(s, 65, { idleSec: 0 });
  const ev = run(s, 20, { idleSec: 0 });
  assert.ok(ev.includes('final'));
  assert.strictEqual(s.state, 'final');
  const ev2 = run(s, 10, { idleSec: 0 });
  assert.ok(ev2.includes('start'));
});

test('отложить можно один раз за звонок', () => {
  const s = new Scheduler({ intervalMin: 1, warnSec: 30, postponeSec: 120 });
  run(s, 60, { idleSec: 0 });
  assert.ok(s.postpone());
  assert.strictEqual(s.state, 'postponed');
  assert.strictEqual(s.postpone(), false);
  const ev = run(s, 120, { idleSec: 0 });
  assert.ok(ev.includes('ring'));
  assert.strictEqual(s.state, 'warning');
  assert.strictEqual(s.canPostpone(), false);
  s.finish();
  run(s, 60, { idleSec: 0 });
  assert.strictEqual(s.canPostpone(), true, 'перед следующим делом снова можно отложить');
});

test('«Прочитать» начинает занятие сразу', () => {
  const s = new Scheduler({ intervalMin: 1 });
  assert.strictEqual(s.readNow(), false, 'без звонка не начинаем');
  run(s, 60, { idleSec: 0 });
  assert.strictEqual(s.readNow(), true);
  assert.strictEqual(s.state, 'session');
});

test('после занятия счёт начинается заново', () => {
  const s = new Scheduler({ intervalMin: 1 });
  run(s, 60, { idleSec: 0 });
  s.readNow();
  run(s, 600, { idleSec: 0 });
  assert.strictEqual(s.state, 'session', 'во время занятия ничего не происходит');
  s.finish();
  assert.strictEqual(s.activeSec, 0);
  run(s, 59, { idleSec: 0 });
  assert.strictEqual(s.state, 'play');
});

test('пока ребёнок крутит педали, не зовём', () => {
  const s = new Scheduler({ intervalMin: 1 });
  run(s, 120, { idleSec: 0, velo: 'riding' });
  assert.strictEqual(s.state, 'play');
  run(s, 1, { idleSec: 0, velo: 'idle' });
  assert.strictEqual(s.state, 'warning');
});

test('тихие часы, в том числе через полночь', () => {
  const at = (h, m) => new Date(2026, 10, 21, h, m);
  const s = { quietFrom: '21:00', quietTo: '07:30' };
  assert.strictEqual(inQuietHours(s, at(22, 0)), true);
  assert.strictEqual(inQuietHours(s, at(6, 0)), true);
  assert.strictEqual(inQuietHours(s, at(12, 0)), false);
  assert.strictEqual(inQuietHours({ quietFrom: '13:00', quietTo: '14:00' }, at(13, 30)), true);
  assert.strictEqual(inQuietHours({}, at(13, 30)), false);
  const sch = new Scheduler(Object.assign({ intervalMin: 1 }, s));
  for (let i = 0; i < 120; i++) sch.tick({ idleSec: 0, date: at(22, 0) });
  assert.strictEqual(sch.state, 'play');
});
