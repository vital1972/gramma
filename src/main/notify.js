// Куда слать отчёты родителю: Telegram, ВКонтакте (сообщество) или MAX (бот).
// В России Telegram без VPN не работает, поэтому есть ВК и MAX.
'use strict';
const telegram = require('./telegram');

const CHANNELS = { telegram: 'Telegram', vk: 'ВКонтакте', max: 'MAX' };
const VK_API = 'https://api.vk.com/method/';
const VK_V = '5.199';
const MAX_API = 'https://platform-api2.max.ru';

function netWhy(e, name) {
  const m = String((e && (e.message || e.code)) || '');
  if (/CERT|certificate/i.test(m)) return `${name}: не доверен сертификат сайта. Установите сертификат Минцифры (gosuslugi.ru/crt) и перезапустите программу`;
  return `Нет связи с ${name}`;
}

// ---------- ВКонтакте: сообщения от имени сообщества ----------

async function vkCall(method, params, f) {
  const body = new URLSearchParams(Object.assign({ v: VK_V }, params));
  const r = await f(VK_API + method, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
  const j = await r.json().catch(() => ({}));
  if (j.error) throw Object.assign(new Error(j.error.error_msg || 'ошибка ВК'), { vk: j.error.error_code });
  return j.response;
}

function vkWhy(e) {
  if (e.vk === 5) return 'ВК: ключ сообщества неверный или отозван';
  if (e.vk === 901) return 'ВК: вы ещё не написали сообществу. Откройте сообщество в ВК и отправьте ему любое сообщение';
  if (e.vk === 917 || e.vk === 15) return 'ВК: у ключа нет доступа к сообщениям сообщества';
  if (e.vk) return `ВК: ${e.message}`;
  return netWhy(e, 'ВКонтакте');
}

async function vkSend(s, text, f) {
  if (!s.vkToken || !s.vkPeerId) return { ok: false, why: 'ВКонтакте не настроен: нужен ключ сообщества и ваш номер в ВК' };
  try {
    await vkCall('messages.send', { access_token: s.vkToken, peer_id: s.vkPeerId, random_id: String(Date.now() % 2147483647), message: text }, f);
    return { ok: true };
  } catch (e) {
    return { ok: false, why: vkWhy(e) };
  }
}

// Кто последним написал сообществу — это и есть родитель.
async function vkFind(s, f) {
  if (!s.vkToken) return { ok: false, why: 'Сначала вставьте ключ сообщества' };
  try {
    const res = await vkCall('messages.getConversations', { access_token: s.vkToken, count: '20', extended: '1' }, f);
    const item = (res.items || []).find((x) => x.conversation && x.conversation.peer && x.conversation.peer.type === 'user');
    if (!item) return { ok: false, why: 'Сообществу ещё никто не писал. Напишите ему любое сообщение из своего ВК и нажмите ещё раз' };
    const id = item.conversation.peer.id;
    const p = (res.profiles || []).find((x) => x.id === id);
    return { ok: true, id: String(id), name: p ? `${p.first_name} ${p.last_name}` : `id${id}` };
  } catch (e) {
    return { ok: false, why: vkWhy(e) };
  }
}

// ---------- MAX: бот, зарегистрированный в business.max.ru ----------

function maxWhy(status, j) {
  if (status === 401) return 'MAX: ключ бота неверный';
  if (status === 404) return 'MAX: чат не найден. Напишите боту в MAX и нажмите «Найти мой чат»';
  return `MAX: ${(j && (j.message || j.code)) || 'HTTP ' + status}`;
}

async function maxSend(s, text, f) {
  if (!s.maxToken || !s.maxUserId) return { ok: false, why: 'MAX не настроен: нужен ключ бота и ваш номер в MAX' };
  try {
    const r = await f(`${MAX_API}/messages?user_id=${encodeURIComponent(s.maxUserId)}`, {
      method: 'POST',
      headers: { Authorization: s.maxToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const j = await r.json().catch(() => ({}));
    return r.ok ? { ok: true } : { ok: false, why: maxWhy(r.status, j) };
  } catch (e) {
    return { ok: false, why: netWhy(e, 'MAX') };
  }
}

async function maxFind(s, f) {
  if (!s.maxToken) return { ok: false, why: 'Сначала вставьте ключ бота' };
  try {
    const r = await f(`${MAX_API}/updates?limit=50&timeout=0`, { headers: { Authorization: s.maxToken } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, why: maxWhy(r.status, j) };
    const ups = (j.updates || []).filter((u) => u.message && u.message.sender && u.message.sender.user_id);
    const u = ups[ups.length - 1];
    if (!u) return { ok: false, why: 'Боту ещё никто не писал. Напишите ему в MAX любое сообщение и нажмите ещё раз' };
    const snd = u.message.sender;
    return { ok: true, id: String(snd.user_id), name: snd.name || [snd.first_name, snd.last_name].filter(Boolean).join(' ') || `id${snd.user_id}` };
  } catch (e) {
    return { ok: false, why: netWhy(e, 'MAX') };
  }
}

// ---------- общий вход ----------

function channelOf(s) {
  return CHANNELS[s.reportChannel] ? s.reportChannel : 'telegram';
}

function send(s, text, fetchImpl) {
  const f = fetchImpl || fetch;
  const ch = channelOf(s);
  if (ch === 'vk') return vkSend(s, text, f);
  if (ch === 'max') return maxSend(s, text, f);
  return telegram.send(s.telegramToken, s.telegramChatId, text, f);
}

function findChat(s, fetchImpl) {
  const f = fetchImpl || fetch;
  const ch = channelOf(s);
  if (ch === 'vk') return vkFind(s, f);
  if (ch === 'max') return maxFind(s, f);
  return Promise.resolve({ ok: false, why: 'Для Telegram номер чата узнайте у @userinfobot' });
}

module.exports = { send, findChat, channelOf, CHANNELS, VK_API, MAX_API };
