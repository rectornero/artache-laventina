// The API and the Claude link. Both run only when someone calls them: no schedules, no polling.
import { apply, brief, meter, newHouse, parseCoupon, rid, todayISO, localNow, month, couponValue } from '../public/js/laventina.mjs';

const HOUSE_POINTER = 'site/house'; // one household per site; once it exists, starting another is closed
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const fail = (status, said) => json({ error: said, said }, status);

async function sha(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}
const secret = () => rid() + rid() + rid();

// Reads are counted in memory and written with the next change, so a read never costs a write.
const unwritten = new Map();
const count = (houseId) => unwritten.set(houseId, (unwritten.get(houseId) || 0) + 1);

const dayFrom = (input, now) => (typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input) ? input : todayISO(now));

async function readBody(req) {
  const text = await req.text();
  if (text.length > 16000) throw Object.assign(new Error('That is too much for me to hold.'), { status: 413 });
  try { return text ? JSON.parse(text) : {}; } catch { throw Object.assign(new Error('I could not read that.'), { status: 400 }); }
}

async function open(store, token) {
  const [houseId, key] = String(token || '').split('.');
  if (!houseId || !key || !/^[a-z0-9]{6,20}$/.test(houseId)) return null;
  const r = await store.get(`house/${houseId}`);
  if (!r) return null;
  const k = r.data.keys?.[await sha(key)];
  if (!k || k.kind === 'invite') return null;
  return { houseId, house: r.data, etag: r.etag, person: k.person, kind: k.kind };
}

// Change the household safely when two people (or Claude) write at once.
async function change(store, houseId, today, fn) {
  for (let i = 0; i < 4; i++) {
    const r = await store.get(`house/${houseId}`);
    if (!r) throw Object.assign(new Error('The household is gone.'), { status: 404 });
    const pending = unwritten.get(houseId) || 0;
    const out = await fn(r.data);
    const h = out.house;
    h.meter = { ...(h.meter || {}) };
    h.meter[month(today)] = (h.meter[month(today)] || 0) + pending;
    for (const m of Object.keys(h.meter).sort().slice(0, -3)) delete h.meter[m];
    if (await store.put(`house/${houseId}`, h, { etag: r.etag })) {
      unwritten.set(houseId, (unwritten.get(houseId) || 0) - pending);
      return out;
    }
  }
  throw Object.assign(new Error('Someone else is changing things right now. Try again in a moment.'), { status: 409 });
}

function usage(house, houseId, today) {
  const m = month(today);
  return meter({ meter: { ...(house.meter || {}), [m]: ((house.meter || {})[m] || 0) + (unwritten.get(houseId) || 0) } }, today);
}

export function view(house, personId, today, hour, use) {
  const { keys, invite, ...rest } = house;
  const b = brief(house, today, personId, hour);
  if (use && use.credits >= use.budget * 0.8 && !use.resting) {
    b.lines.unshift({ kind: 'warn', text: `I have used ${use.credits} of my ${use.budget} credits this month. I will rest at ${use.budget}.` });
  }
  return { house: rest, me: personId, brief: b, meter: use };
}

const RESTING = (use) => `I have reached this month's limit of ${use.budget} credits, so I am resting until the 1st. Nothing is lost.`;

export async function handleApi(req, { store, now = new Date() }) {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api/, '') || '/';
  const auth = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  try {
    if (req.method === 'GET' && path === '/hello') {
      const p = await store.get(HOUSE_POINTER);
      return json({ open: !p });
    }
    if (req.method === 'POST' && path === '/start') {
      const body = await readBody(req);
      const today = dayFrom(body.today, now);
      const houseId = rid();
      const personId = rid();
      if (!(await store.put(HOUSE_POINTER, { houseId, created: today }, { create: true }))) {
        return fail(403, 'This house already has its people. Ask them for an invite link.');
      }
      const key = secret();
      const house = newHouse({ name: body.house, person: body.person, today, tz: body.tz, id: personId });
      house.keys = { [await sha(key)]: { person: personId, kind: 'person', since: today } };
      await store.put(`house/${houseId}`, house, { create: true });
      return json({ token: `${houseId}.${key}`, ...view(house, personId, today, body.hour, meter(house, today)) });
    }
    if (req.method === 'POST' && path === '/join') {
      const body = await readBody(req);
      const today = dayFrom(body.today, now);
      const [houseId, code] = String(body.code || '').split('.');
      if (!houseId || !code) return fail(400, 'That invite link looks incomplete.');
      const codeHash = await sha(code);
      const personId = rid();
      const key = secret();
      const out = await change(store, houseId, today, async (house) => {
        const inv = house.keys?.[codeHash];
        if (!inv || inv.kind !== 'invite') throw Object.assign(new Error('That invite has been used or has expired.'), { status: 403 });
        if (house.people.length >= 6) throw Object.assign(new Error('This house is full.'), { status: 403 });
        const h = structuredClone(house);
        delete h.keys[codeHash]; // an invite works once
        h.people.push({ id: personId, name: String(body.person || 'Guest').replace(/\s+/g, ' ').trim().slice(0, 40) || 'Guest' });
        h.keys[await sha(key)] = { person: personId, kind: 'person', since: today };
        return { house: h };
      });
      return json({ token: `${houseId}.${key}`, ...view(out.house, personId, today, body.hour, meter(out.house, today)) });
    }

    const s = await open(store, auth);
    if (!s || s.kind !== 'person') return fail(401, 'I do not recognise this device. Open your invite link again.');
    count(s.houseId);
    const today = dayFrom(url.searchParams.get('today'), now);
    const asked = Number(url.searchParams.get('hour'));
    const hour = url.searchParams.has('hour') && Number.isFinite(asked) ? asked : now.getHours();
    const use = usage(s.house, s.houseId, today);
    if (use.resting) return json({ resting: true, said: RESTING(use), meter: use }, 503);

    if (req.method === 'GET' && path === '/house') return json(view(s.house, s.person, today, hour, use));

    if (req.method === 'POST' && path === '/do') {
      const body = await readBody(req);
      const out = await change(store, s.houseId, today, async (house) => apply(house, body.action, { by: s.person, today }));
      return json({ said: out.said, ...view(out.house, s.person, today, hour, usage(out.house, s.houseId, today)) });
    }
    if (req.method === 'POST' && (path === '/invite' || path === '/claude-link')) {
      const key = secret();
      const kind = path === '/invite' ? 'invite' : 'mcp';
      await change(store, s.houseId, today, async (house) => {
        const h = structuredClone(house);
        h.keys = h.keys || {};
        if (kind === 'invite') for (const [k, v] of Object.entries(h.keys)) if (v.kind === 'invite') delete h.keys[k];
        h.keys[await sha(key)] = { person: s.person, kind, since: today };
        return { house: h };
      });
      return json(kind === 'invite' ? { code: `${s.houseId}.${key}` } : { path: `/mcp/${s.houseId}.${key}` });
    }
    if (req.method === 'POST' && path === '/forget-links') {
      // Closes every Claude link and open invite; the people's own devices stay signed in.
      await change(store, s.houseId, today, async (house) => {
        const h = structuredClone(house);
        for (const [k, v] of Object.entries(h.keys || {})) if (v.kind !== 'person') delete h.keys[k];
        return { house: h };
      });
      return json({ said: 'Every Claude link and invite is closed.' });
    }
    return fail(404, 'There is nothing here.');
  } catch (e) {
    return fail(e.status || 400, e.message || 'Something went wrong.');
  }
}

// ---- The Claude link (MCP over plain HTTP, stateless). Claude on claude.ai, on Nero's own plan. ----

const TOOLS = [
  { name: 'laventina_brief', description: "Laventina's brief for today: what needs attention (coupons ending soon or ended), the coupons being watched, and the story ledger (money lost and caught). Start here.",
    inputSchema: { type: 'object', properties: {} } },
  { name: 'laventina_add_coupon', description: 'Keep a coupon, voucher or discount so Laventina watches its last day. Give either a sentence ("€5 Carrefour until Friday") or the fields.',
    inputSchema: { type: 'object', properties: {
      sentence: { type: 'string', description: 'One sentence describing the coupon' },
      shop: { type: 'string' }, value: { type: 'number' }, unit: { type: 'string', enum: ['€', '%'] },
      ends: { type: 'string', description: 'Last day, YYYY-MM-DD' }, note: { type: 'string' } } } },
  { name: 'laventina_close_coupon', description: 'Say what happened to a coupon: used (money caught) or missed (it becomes a stepping stone in the story). Use the id from laventina_brief or laventina_story.',
    inputSchema: { type: 'object', required: ['id', 'used'], properties: {
      id: { type: 'string' }, used: { type: 'boolean' }, why: { type: 'string', description: 'If missed: what happened' } } } },
  { name: 'laventina_story', description: "The whole story: every stepping stone (losses Nero learns from, with the lesson), every coupon kept, and this month's cost meter.",
    inputSchema: { type: 'object', properties: {} } },
  { name: 'laventina_add_stepping_stone', description: 'Write a new stepping stone into the story: a loss or mistake to learn from (not only coupons). Ask Nero before adding one.',
    inputSchema: { type: 'object', required: ['title'], properties: {
      title: { type: 'string' }, lost: { type: 'number', description: 'Euros lost, if any' },
      story: { type: 'string' }, lesson: { type: 'string', description: 'What would turn this weakness into a strength' } } } },
  { name: 'laventina_set_lesson', description: 'Record the lesson of a stepping stone, by its number.',
    inputSchema: { type: 'object', required: ['n', 'lesson'], properties: { n: { type: 'number' }, lesson: { type: 'string' } } } },
];

const rpc = (id, result) => json({ jsonrpc: '2.0', id, result });
const rpcError = (id, code, message) => json({ jsonrpc: '2.0', id, error: { code, message } });
const text = (id, value) => rpc(id, { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] });

export async function handleMcp(req, { store, now = new Date() }) {
  if (req.method !== 'POST') return new Response('Laventina speaks MCP over POST.', { status: 405, headers: { allow: 'POST' } });
  const token = new URL(req.url).pathname.split('/').filter(Boolean)[1];
  const s = await open(store, token);
  if (!s || s.kind !== 'mcp') return new Response('Unknown link', { status: 401 });
  let msg;
  try { msg = await readBody(req); } catch { return rpcError(null, -32700, 'Parse error'); }
  if (Array.isArray(msg)) return rpcError(null, -32600, 'One message at a time, please.');
  const { id = null, method, params = {} } = msg || {};
  if (id === null || id === undefined) return new Response(null, { status: 202 }); // a notification
  count(s.houseId);
  const { today, hour } = localNow(now, s.house.tz); // Claude has no clock of the house's own: use the house's time zone
  const use = usage(s.house, s.houseId, today);

  if (method === 'initialize') {
    return rpc(id, { protocolVersion: params.protocolVersion || '2025-06-18', capabilities: { tools: {} },
      serverInfo: { name: 'laventina', version: '2.0.0' },
      instructions: 'Laventina is Nero\'s household butler: kind, brief, and fond of lavender. It watches coupons and keeps the story of stepping stones (small losses turned into lessons). Speak to Nero as a butler would: only what matters, with a proposal.' });
  }
  if (method === 'ping') return rpc(id, {});
  if (method === 'tools/list') return rpc(id, { tools: TOOLS });
  if (method !== 'tools/call') return rpcError(id, -32601, 'Unknown method');
  if (use.resting) return text(id, RESTING(use));

  const a = params.arguments || {};
  const doIt = async (action) => {
    const out = await change(store, s.houseId, today, async (house) => apply(house, action, { by: s.person, today }));
    return { said: out.said, brief: brief(out.house, today, s.person, hour) };
  };
  try {
    switch (params.name) {
      case 'laventina_brief': return text(id, brief(s.house, today, s.person, hour));
      case 'laventina_story': {
        const { stones, coupons } = s.house;
        return text(id, { stones, coupons: coupons.map((c) => ({ ...c, worth: couponValue(c) })), meter: use });
      }
      case 'laventina_add_coupon': {
        const p = a.sentence ? parseCoupon(a.sentence, today) : {};
        return text(id, await doIt({ type: 'addCoupon', shop: a.shop || p.shop, value: a.value ?? p.value,
          unit: a.unit || p.unit, ends: a.ends || p.ends, note: a.note }));
      }
      case 'laventina_close_coupon': return text(id, await doIt({ type: a.used ? 'useCoupon' : 'missCoupon', id: a.id, why: a.why }));
      case 'laventina_add_stepping_stone': return text(id, await doIt({ type: 'addStone', ...a }));
      case 'laventina_set_lesson': return text(id, await doIt({ type: 'lesson', n: a.n, lesson: a.lesson }));
      default: return rpcError(id, -32602, 'Unknown tool');
    }
  } catch (e) {
    return rpc(id, { isError: true, content: [{ type: 'text', text: e.message }] });
  }
}
