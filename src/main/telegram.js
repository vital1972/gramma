// Отчёт родителю в Telegram. Нужен бот (токен от @BotFather) и номер чата родителя.
'use strict';
const core = require('../core/content');
const english = require('../core/english');

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

function enSessionText(name, s, profile, bank) {
  const pen = english.ensure(profile.en);
  const learned = english.learnedCount(pen);
  const { chapter, patrol } = bank ? english.chapterOf(bank, pen) : { chapter: null, patrol: false };
  const ruleName = (r) => (bank && bank.rules[r] ? bank.rules[r].name : r);
  const lines = [
    `${name}: английский (дело Интерпола) за ${s.minutes} мин.`,
    `Слова: верно с первого раза ${s.wordsOk} из ${s.words}. Перехват ${s.intercept ? 'расшифрован' : 'не расшифрован'}.`,
    `Записки бандитов: ошибок найдено ${s.found} из ${s.total}.`,
    `+${s.coins} коинов, в копилке ${profile.coins}. Выучено слов: ${learned}, звание: ${english.rankOf(learned).rank.n}.`,
  ];
  if (s.missedRules && s.missedRules.length) lines.push(`Разбирали: ${s.missedRules.map(ruleName).join('; ')}.`);
  if (s.arrest && bank) lines.push(`Глава закрыта, пойман ${bank.rules[s.arrest] ? bank.rules[s.arrest].villain : s.arrest}.`);
  else if (chapter && !patrol) lines.push(`Глава «${chapter.city}»: улик ${pen.clues[chapter.id] || 0} из ${chapter.clues}.`);
  if (s.vacation) lines.push('Ребёнок взял «отпуск» на следующее занятие.');
  return lines.join('\n');
}

function dailyText(name, log, profile, rules, day, bank) {
  const today = log.filter((x) => x.day === day);
  if (!today.length) return `${name}: сегодня занятий не было.`;
  const sum = (arr, k) => arr.reduce((s, x) => s + (x[k] || 0), 0);
  const ru = today.filter((x) => x.subject !== 'en');
  const en = today.filter((x) => x.subject === 'en');
  const lines = [`Итог дня, ${name}: занятий ${today.length}, ${sum(today, 'minutes')} мин, коинов +${sum(today, 'coins')}.`];
  if (ru.length) lines.push(`Русский: занятий ${ru.length}, улик найдено ${sum(ru, 'found')} из ${sum(ru, 'total')}.`);
  if (en.length) lines.push(`Английский: занятий ${en.length}, слова верно ${sum(en, 'wordsOk')} из ${sum(en, 'words')}, ошибок в записках найдено ${sum(en, 'found')} из ${sum(en, 'total')}.`);
  const weak = weakRules(profile.stats, rules);
  if (weak.length) lines.push(`Слабые правила русского: ${weak.join('; ')}.`);
  if (bank && profile.en) {
    const pen = english.ensure(profile.en);
    const weakEn = weakRules(pen.stats, bank.rules);
    if (weakEn.length) lines.push(`Слабые темы английского: ${weakEn.join('; ')}.`);
    lines.push(`Выучено английских слов: ${english.learnedCount(pen)} из ${Object.keys(bank.words).length}.`);
  }
  return lines.join('\n');
}

module.exports = { send, sessionText, enSessionText, dailyText, weakRules };
