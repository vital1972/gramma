'use strict';
const test = require('node:test');
const assert = require('node:assert');
const notify = require('../src/main/notify');

function fake(reply) {
  const calls = [];
  const f = async (url, opts) => { calls.push({ url, opts }); const r = reply(url, opts); return { ok: (r.status || 200) < 300, status: r.status || 200, json: async () => r.body }; };
  return { f, calls };
}

test('ВК: отправка сообщения от сообщества', async () => {
  const { f, calls } = fake(() => ({ body: { response: 1 } }));
  const r = await notify.send({ reportChannel: 'vk', vkToken: 'tok', vkPeerId: '42' }, 'привет', f);
  assert.deepStrictEqual(r, { ok: true });
  assert.ok(calls[0].url.endsWith('messages.send'));
  const body = new URLSearchParams(calls[0].opts.body);
  assert.strictEqual(body.get('peer_id'), '42');
  assert.strictEqual(body.get('message'), 'привет');
  assert.ok(body.get('random_id'));
});

test('ВК: понятные ошибки', async () => {
  const { f } = fake(() => ({ body: { error: { error_code: 901, error_msg: 'Can\'t send' } } }));
  const r = await notify.send({ reportChannel: 'vk', vkToken: 'tok', vkPeerId: '42' }, 'x', f);
  assert.strictEqual(r.ok, false);
  assert.match(r.why, /написали сообществу/);
  assert.match((await notify.send({ reportChannel: 'vk' }, 'x', f)).why, /не настроен/);
});

test('ВК: поиск чата родителя', async () => {
  const { f } = fake(() => ({ body: { response: { items: [{ conversation: { peer: { id: 7, type: 'user' } } }], profiles: [{ id: 7, first_name: 'Виталий', last_name: 'П' }] } } }));
  const r = await notify.findChat({ reportChannel: 'vk', vkToken: 'tok' }, f);
  assert.deepStrictEqual(r, { ok: true, id: '7', name: 'Виталий П' });
});

test('MAX: ключ в заголовке без Bearer, получатель в адресе', async () => {
  const { f, calls } = fake(() => ({ body: { message: {} } }));
  const r = await notify.send({ reportChannel: 'max', maxToken: 'abc', maxUserId: '99' }, 'текст', f);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(calls[0].url, `${notify.MAX_API}/messages?user_id=99`);
  assert.strictEqual(calls[0].opts.headers.Authorization, 'abc');
  assert.deepStrictEqual(JSON.parse(calls[0].opts.body), { text: 'текст' });
  const bad = fake(() => ({ status: 401, body: {} }));
  assert.match((await notify.send({ reportChannel: 'max', maxToken: 'x', maxUserId: '1' }, 't', bad.f)).why, /ключ бота неверный/);
});

test('по умолчанию — Telegram', async () => {
  assert.strictEqual(notify.channelOf({}), 'telegram');
  const r = await notify.send({}, 'x', async () => { throw new Error('не должен звать'); });
  assert.match(r.why, /Telegram не настроен/);
});
