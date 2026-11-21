// Отчёт родителю в Telegram. Нужен бот (токен от @BotFather) и номер чата родителя.
'use strict';
const core = require('../core/content');

async function send(token, chatId, text, fetchImpl) {
  if (!token || !chatId) return { ok: false, why: 'Telegram не настроен' };
  if (!/^\d+:[\w-]+$/.test(token)) return { ok: false, why: 'Токен бота выглядит неверно (должен быть вида 123456:ABC...)' };
  const f = fetchImpl || fetch;
  try {
    const r = await f(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    const j = await r.json().catch(() => ({}));
    return j.ok ? { ok: true } : { ok: false, why: j.description || `HTTP ${r.status}` };
  } catch (e) {
    return { ok: false, why: 'Нет связи с Telegram' };
  }
}

function weakRules(stats, rules) {
  return Object.keys(stats || {})
    .filter((r) => stats[r].miss > stats[r].ok)
    .sort((a, b) => stats[b].miss - stats[a].miss)
    .slice(0, 3)
    .map((r) => (rules[r] ? rules[r].name : r));
}

function sessionText(name, s, profile, rules) {
  const rank = core.rankOf(profile.total).rank.n;
  const lines = [
    `${name}: ${s.solved ? 'дело раскрыто' : 'занятие окончено'} за ${s.minutes} мин.`,
    `Дел: ${s.tasks}, улик найдено ${s.found} из ${s.total}, ошибочных обвинений ${s.falseHits}.`,
    `+${s.coins} коинов, в копилке ${profile.coins}. Звание: ${rank}.`,
  ];
  if (s.missedRules && s.missedRules.length) lines.push(`Разбирали: ${s.missedRules.map((r) => (rules[r] ? rules[r].name : r)).join('; ')}.`);
  if (s.vacation) lines.push('Ребёнок взял «отпуск» на следующее занятие.');
  return lines.join('\n');
}

function dailyText(name, log, profile, rules, day) {
  const today = log.filter((x) => x.day === day);
  if (!today.length) return `${name}: сегодня занятий не было.`;
  const sum = (k) => today.reduce((s, x) => s + (x[k] || 0), 0);
  const weak = weakRules(profile.stats, rules);
  const lines = [
    `Итог дня, ${name}: занятий ${today.length}, ${sum('minutes')} мин.`,
    `Улик найдено ${sum('found')} из ${sum('total')}, коинов +${sum('coins')}.`,
  ];
  if (weak.length) lines.push(`Слабые правила: ${weak.join('; ')}.`);
  return lines.join('\n');
}

module.exports = { send, sessionText, dailyText, weakRules };
