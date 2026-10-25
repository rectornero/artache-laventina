import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi, handleMcp } from '../lib/server.mjs';
import { memoryStore } from '../lib/memory-store.mjs';
import { CREDITS_PER_CALL, BUDGET_CREDITS } from '../public/js/laventina.mjs';

const now = new Date('2026-10-25T10:00:00Z');
const base = 'https://laventina.test';
function call(store, path, { method = 'GET', body, token } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const fn = path.startsWith('/mcp') ? handleMcp : handleApi;
  return fn(new Request(base + path, { method, headers, body: body && JSON.stringify(body) }), { store, now })
    .then(async (r) => ({ status: r.status, body: r.status === 202 ? null : await r.json().catch(() => null) }));
}

test('one household per site, invites work once, strangers are turned away', async () => {
  const store = memoryStore();
  assert.equal((await call(store, '/api/hello')).body.open, true);
  const a = await call(store, '/api/start', { method: 'POST', body: { person: 'Nero', house: 'Casa', today: '2026-10-25' } });
  assert.equal(a.status, 200);
  assert.equal(a.body.house.stones.length, 2);
  assert.equal(a.body.house.keys, undefined, 'secrets never leave the server');
  assert.equal((await call(store, '/api/start', { method: 'POST', body: { person: 'Eve' } })).status, 403);
  assert.equal((await call(store, '/api/hello')).body.open, false);
  assert.equal((await call(store, '/api/house', { token: 'nope.nope' })).status, 401);

  const inv = await call(store, '/api/invite', { method: 'POST', body: {}, token: a.body.token });
  const b = await call(store, '/api/join', { method: 'POST', body: { code: inv.body.code, person: 'Sam' } });
  assert.equal(b.status, 200);
  assert.equal(b.body.house.people.length, 2);
  assert.equal((await call(store, '/api/join', { method: 'POST', body: { code: inv.body.code, person: 'Eve' } })).status, 403);
  // The invite code itself is not a sign-in.
  assert.equal((await call(store, '/api/house', { token: inv.body.code })).status, 401);

  const add = await call(store, '/api/do?today=2026-10-25', { method: 'POST', token: b.body.token,
    body: { action: { type: 'addCoupon', shop: 'Carrefour', value: 5, unit: '€', ends: '2026-10-27' } } });
  assert.match(add.body.said, /Kept: €5 at Carrefour/);
  const seen = await call(store, '/api/house?today=2026-10-25', { token: a.body.token });
  assert.equal(seen.body.house.coupons.length, 1, 'both people see the same house');
});

test('two writes at once both land', async () => {
  const store = memoryStore();
  const a = await call(store, '/api/start', { method: 'POST', body: { person: 'Nero' } });
  const add = (shop) => call(store, '/api/do', { method: 'POST', token: a.body.token,
    body: { action: { type: 'addCoupon', shop, value: 2, ends: '2026-11-01' } } });
  await Promise.all([add('Lidl'), add('Coop'), add('Conad')]);
  const v = await call(store, '/api/house', { token: a.body.token });
  assert.equal(v.body.house.coupons.length, 3);
});

test('the meter warns, then the butler rests at the budget', async () => {
  const store = memoryStore();
  const a = await call(store, '/api/start', { method: 'POST', body: { person: 'Nero' } });
  const houseId = a.body.token.split('.')[0];
  const rec = store.m.get(`house/${houseId}`);
  rec.data.meter = { '2026-10': Math.ceil((BUDGET_CREDITS * 0.85) / CREDITS_PER_CALL) };
  const warn = await call(store, '/api/house', { token: a.body.token });
  assert.equal(warn.body.brief.lines[0].kind, 'warn');
  rec.data.meter = { '2026-10': Math.ceil(BUDGET_CREDITS / CREDITS_PER_CALL) };
  const rest = await call(store, '/api/house', { token: a.body.token });
  assert.equal(rest.status, 503);
  assert.match(rest.body.said, /resting until the 1st/);
});

test('the meter counts reads without writing them', async () => {
  const store = memoryStore();
  const a = await call(store, '/api/start', { method: 'POST', body: { person: 'Nero' } });
  const houseId = a.body.token.split('.')[0];
  const before = store.m.get(`house/${houseId}`).etag;
  for (let i = 0; i < 5; i++) await call(store, '/api/house', { token: a.body.token });
  assert.equal(store.m.get(`house/${houseId}`).etag, before, 'reads never write');
  const v = await call(store, '/api/house', { token: a.body.token });
  assert.equal(v.body.meter.calls, 6);
  await call(store, '/api/do', { method: 'POST', token: a.body.token, body: { action: { type: 'rename', name: 'Nero' } } });
  assert.equal(store.m.get(`house/${houseId}`).data.meter['2026-10'], 7);
});

test('Claude can read the brief and keep a coupon through the link', async () => {
  const store = memoryStore();
  const a = await call(store, '/api/start', { method: 'POST', body: { person: 'Nero' } });
  const { body: { path } } = await call(store, '/api/claude-link', { method: 'POST', body: {}, token: a.body.token });
  const rpc = (method, params, id = 1) => call(store, path, { method: 'POST', body: { jsonrpc: '2.0', id, method, params } });
  const init = await rpc('initialize', { protocolVersion: '2025-06-18' });
  assert.equal(init.body.result.serverInfo.name, 'laventina');
  assert.equal((await call(store, path, { method: 'POST', body: { jsonrpc: '2.0', method: 'notifications/initialized' } })).status, 202);
  const tools = await rpc('tools/list', {});
  assert.ok(tools.body.result.tools.some((t) => t.name === 'laventina_brief'));
  const kept = await rpc('tools/call', { name: 'laventina_add_coupon', arguments: { sentence: '€5 Carrefour until Friday' } });
  assert.match(kept.body.result.content[0].text, /Kept: €5 at Carrefour/);
  const story = await rpc('tools/call', { name: 'laventina_story', arguments: {} });
  assert.equal(JSON.parse(story.body.result.content[0].text).stones.length, 2);
  // A person's own token is not a Claude link, and closing links works.
  assert.equal((await call(store, `/mcp/${a.body.token}`, { method: 'POST', body: { jsonrpc: '2.0', id: 1, method: 'ping' } })).status, 401);
  await call(store, '/api/forget-links', { method: 'POST', body: {}, token: a.body.token });
  assert.equal((await rpc('ping', {})).status, 401);
});
