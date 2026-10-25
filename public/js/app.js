// The butler's front door. It talks to the server only when you open it or tap something:
// no timers, no polling, no push. Nothing runs while nobody is looking.
import { parseCoupon, todayISO, couponICS, couponValue, euros } from './laventina.mjs';

const $ = (s) => document.querySelector(s);
const feed = $('#feed');
const quick = $('#quick');
const TOKEN = 'laventina.token';
const store = {
  get: () => { try { return localStorage.getItem(TOKEN); } catch { return null; } },
  set: (v) => { try { v ? localStorage.setItem(TOKEN, v) : localStorage.removeItem(TOKEN); } catch {} },
};

let state = null;      // the last view from the server
let loadedAt = 0;
let mode = null;       // what the next sentence is for: { kind: 'coupon', draft } | { kind: 'lesson', n }
let cascade = 0;       // messages of one turn arrive one after another

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function say(text, cls = '') {
  const m = el('div', `msg butler ${cls}`);
  m.style.setProperty('--i', cascade++);
  for (const t of [].concat(text)) m.append(el('p', null, t));
  feed.append(m);
  m.scrollIntoView({ block: 'end', behavior: 'smooth' });
  return m;
}
function you(text) { cascade = 0; feed.append(el('div', 'msg user', text)); }
// The butler bows a little each time it speaks.
function bow() {
  const b = $('#butler');
  b.classList.remove('bow');
  void b.offsetWidth;
  b.classList.add('bow');
}
function chips(target, list) {
  const row = el('div', 'chips');
  for (const c of list) {
    const b = el('button', `chip ${c.main ? 'main' : ''}`, c.label);
    b.type = 'button';
    b.onclick = () => { if (target !== quick) row.remove(); c.run(); };
    row.append(b);
  }
  target.append(row);
  return row;
}
const status = (t) => { $('#status').textContent = t; };

async function api(path, { method = 'GET', body, auth = true } = {}) {
  const now = new Date();
  const q = `${path.includes('?') ? '&' : '?'}today=${todayISO(now)}&hour=${now.getHours()}`;
  const headers = { 'content-type': 'application/json' };
  if (auth && store.get()) headers.authorization = `Bearer ${store.get()}`;
  document.body.classList.add('busy');
  let res, data;
  try {
    res = await fetch(`/api${path}${q}`, { method, headers, body: body ? JSON.stringify({ today: todayISO(now), hour: now.getHours(), ...body }) : undefined });
    data = await res.json().catch(() => ({ said: 'I could not reach the house just now.' }));
  } catch {
    throw Object.assign(new Error('I could not reach the house just now.'), { status: 0 });
  } finally {
    document.body.classList.remove('busy');
  }
  if (res.status === 401) { store.set(null); }
  if (!res.ok) throw Object.assign(new Error(data.said || 'Something went wrong.'), { status: res.status, data });
  return data;
}

// ---- Arriving ----

async function arrive() {
  const join = location.hash.match(/^#join=([a-z0-9]+\.[a-z0-9]+)$/);
  if (join) { history.replaceState(null, '', '/'); return welcome(join[1]); }
  if (!store.get()) return welcome();
  try {
    show(await api('/house'));
  } catch (e) {
    if (e.status === 401) return welcome();
    if (e.status === 503) { status('Resting'); return say(e.message, 'quiet'); }
    say(e.message, 'quiet');
  }
}

async function welcome(code) {
  cascade = 0;
  feed.replaceChildren();
  $('#dock').hidden = true;
  let open = false;
  if (!code) { try { open = (await api('/hello', { auth: false })).open; } catch {} }
  if (!code && !open) {
    say(['Good day. I am Laventina, the butler of this house.', 'This house already has its people. If you are one of them, open the invite link they sent you.'], 'hello');
    return;
  }
  say(code ? ['Good day, and welcome. I am Laventina, the butler of this house.', 'What shall I call you?']
    : ['Good day. I am Laventina, a butler who loves lavender.', 'Before we begin: what shall I call you, and what is the house called?'], 'hello');
  const f = el('form', 'welcome');
  const name = el('input'); name.placeholder = 'Your name'; name.maxLength = 40; name.required = true;
  f.append(name);
  let house;
  if (!code) { house = el('input'); house.placeholder = 'The house (for example, Casa Nero)'; house.maxLength = 60; f.append(house); }
  const go = el('button', 'chip main', code ? 'Come in' : 'Open the house'); go.type = 'submit';
  f.append(go);
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    go.disabled = true;
    try {
      const v = code ? await api('/join', { method: 'POST', auth: false, body: { code, person: name.value } })
        : await api('/start', { method: 'POST', auth: false, body: { person: name.value, house: house.value, tz: Intl.DateTimeFormat().resolvedOptions().timeZone } });
      store.set(v.token);
      show(v, true);
    } catch (e) { go.disabled = false; say(e.message, 'quiet'); }
  };
  feed.append(f);
  name.focus();
}

// ---- The brief ----

function show(v, first = false) {
  state = v;
  loadedAt = Date.now();
  cascade = 0;
  bow();
  feed.replaceChildren();
  $('#dock').hidden = false;
  $('#story-btn').hidden = false;
  $('#menu-btn').hidden = false;
  const me = v.house.people.find((p) => p.id === v.me);
  status(`${v.house.name}${me ? ' · ' + me.name : ''}`);
  if (first) say('Your house is open. I have already written the first two chapters of its story: the coupon and the frost. Tap the book to read them.', 'ask');
  say(v.brief.hello, 'hello');
  for (const line of v.brief.lines) {
    const m = say(line.kind === 'letter' ? line.text.split(/\n+/) : line.text, line.kind);
    if (line.kind === 'letter') m.append(el('div', 'sign', 'Written by Claude, with the butler\'s pen'));
    const list = (line.replies || []).map((r) => ({ label: r.label, main: !!r.action && r.action.type === 'useCoupon',
      run: () => (r.calendar ? calendar(r.calendar) : act(r.action, r.label)) }));
    if (line.lesson) list.push({ label: 'Tell you', main: true, run: () => { mode = { kind: 'lesson', n: line.lesson }; $('#say').placeholder = 'What would have helped?'; $('#say').focus(); } });
    if (list.length) chips(m, list);
  }
  if (v.brief.watching.length) say(v.brief.watching.map((w) => `Watching: ${w.text}.`), 'quiet');
  ledgerCard(v.brief.ledger);
  setQuick();
}

function ledgerCard(l) {
  const box = el('div', 'msg butler quiet');
  box.style.setProperty('--i', cascade++);
  box.append(el('p', null, 'The story so far'));
  const g = el('div', 'ledger');
  for (const [n, label] of [[euros(l.lost), 'lost'], [euros(l.caught), 'caught'], [l.stones, l.stones === 1 ? 'stepping stone' : 'stepping stones']]) {
    const d = el('div'); d.style.setProperty('--j', g.children.length);
    d.append(el('b', null, n), el('small', null, label)); g.append(d);
  }
  box.append(g);
  feed.append(box);
}

function setQuick() {
  quick.replaceChildren();
  $('#say').placeholder = 'A coupon? Say it in one sentence';
  chips(quick, [
    { label: 'Keep a coupon', run: () => { $('#say').value = ''; $('#say').placeholder = 'For example: €5 Carrefour until Friday'; $('#say').focus(); } },
    { label: 'Something went wrong', run: () => { mode = { kind: 'stone' }; say('I am sorry to hear it. Tell me in one sentence what was lost, and I will write it into the story.', 'ask'); $('#say').focus(); } },
  ]);
}

async function act(action, label) {
  if (label) you(label);
  try {
    const v = await api('/do', { method: 'POST', body: { action } });
    show(v);
    if (v.said) say(v.said, 'ask');
    return v;
  } catch (e) { say(e.message, e.status === 503 ? 'quiet' : 'warn'); }
}

function calendar(id) {
  const c = state.house.coupons.find((x) => x.id === id);
  if (!c) return;
  const url = URL.createObjectURL(new Blob([couponICS(c, todayISO())], { type: 'text/calendar' }));
  const a = el('a'); a.href = url; a.download = `${c.shop}-coupon.ics`; document.body.append(a); a.click(); a.remove();
  say('Your phone will ring the evening before its last day. No server needed.', 'quiet');
}

// ---- One sentence in ----

$('#composer').onsubmit = async (ev) => {
  ev.preventDefault();
  const text = $('#say').value.trim();
  if (!text) return;
  $('#say').value = '';
  you(text);
  const m = mode; mode = null;
  if (m?.kind === 'lesson') return act({ type: 'lesson', n: m.n, lesson: text });
  if (m?.kind === 'stone') {
    const money = text.match(/€\s*(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s*(?:€|eur)/i);
    const lost = money ? parseFloat((money[1] || money[2]).replace(',', '.')) : 0;
    return act({ type: 'addStone', title: text.split(/[.,;:!?]/)[0].slice(0, 60), lost, story: text });
  }
  const today = todayISO();
  const p = parseCoupon(text, today);
  const draft = { ...(m?.kind === 'coupon' ? m.draft : {}) };
  for (const k of ['shop', 'value', 'ends']) if (p[k] != null && p[k] !== '') { draft[k] = p[k]; if (k === 'value') draft.unit = p.unit; }
  if (!draft.value) { mode = { kind: 'coupon', draft }; return say('How much is it worth? (€5, or 10%)', 'ask'); }
  if (!draft.shop) { mode = { kind: 'coupon', draft }; return say('Which shop is it for?', 'ask'); }
  if (!draft.ends) { mode = { kind: 'coupon', draft }; return say('And its last day? (Friday, 3/11, 30 Oct)', 'ask'); }
  const d = new Date(`${draft.ends}T12:00:00`);
  const q = say(`A ${couponValue({ value: draft.value, unit: draft.unit || '€' })} coupon at ${draft.shop}, last day ${d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}. Shall I keep it?`, 'money');
  chips(q, [
    { label: 'Keep it', main: true, run: () => act({ type: 'addCoupon', ...draft }) },
    { label: 'Not quite', run: () => { say('Tell me again, in one sentence.', 'ask'); } },
  ]);
};

// ---- The story and the menu ----

const sheet = $('#sheet');
const sheetIn = $('#sheet-in');
function openSheet(build) {
  sheetIn.replaceChildren();
  build(sheetIn);
  const close = el('button', 'chip', 'Close'); close.type = 'button'; close.onclick = () => sheet.close();
  const row = el('div', 'chips'); row.append(close); sheetIn.append(row);
  sheet.showModal();
}
sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.close(); });

$('#story-btn').onclick = () => openSheet((s) => {
  s.append(el('h2', null, "Laventina's story"));
  const l = state.brief.ledger;
  s.append(el('p', 'muted', `${euros(l.lost)} lost, ${euros(l.caught)} caught. Every loss becomes a stepping stone, and every stepping stone a lesson.`));
  for (const st of [...state.house.stones].sort((a, b) => a.n - b.n)) {
    const d = el('div', 'stone');
    d.append(el('h3', null, `${st.n}. ${st.title}`));
    d.append(el('div', 'lost', `${st.lost ? euros(st.lost) + ' lost · ' : ''}${st.date}`));
    if (st.story) d.append(el('p', null, st.story));
    if (st.lesson) d.append(el('div', 'lesson', st.lesson));
    s.append(d);
  }
});

$('#menu-btn').onclick = () => openSheet((s) => {
  const m = state.meter;
  s.append(el('h2', null, 'The butler\'s pantry'));
  s.append(el('h3', null, 'What I cost this month'));
  s.append(el('p', null, `About ${m.credits} of ${m.budget} credits (${m.calls} visits). I never run on my own, so when nobody opens me, I cost nothing.`));
  const bar = el('div', 'meter'); const fill = el('i'); fill.style.width = `${Math.min(100, (m.credits / m.budget) * 100)}%`; bar.append(fill); s.append(bar);
  s.append(el('p', 'muted', 'An estimate from my own count. Netlify\'s usage page has the exact numbers.'));

  s.append(el('h3', null, 'Light'));
  const day = document.documentElement.dataset.theme === 'day';
  s.append(el('p', 'muted', day ? 'Lavender daylight, as you asked.' : 'Night, the house\'s own light. Candles in the corners.'));
  chips(s, [{ label: day ? 'Back to night' : 'Daylight, please', run: () => theme(day ? 'night' : 'day') }]);

  s.append(el('h3', null, 'Invite someone'));
  s.append(el('p', 'muted', 'A link that works once, for the other person in the house.'));
  const inv = el('div');
  chips(s, [{ label: 'Make an invite link', run: async () => {
    try { const r = await api('/invite', { method: 'POST', body: {} }); copyRow(inv, `${location.origin}/#join=${r.code}`); } catch (e) { inv.textContent = e.message; }
  } }]);
  s.append(inv);

  s.append(el('h3', null, 'Connect Claude'));
  s.append(el('p', 'muted', 'In claude.ai, add a custom connector with this link. Claude then reads the brief and keeps coupons for you, on your own Claude plan.'));
  const cl = el('div');
  chips(s, [
    { label: 'Make a Claude link', run: async () => {
      try { const r = await api('/claude-link', { method: 'POST', body: {} }); copyRow(cl, `${location.origin}${r.path}`); } catch (e) { cl.textContent = e.message; }
    } },
    { label: 'Close all links', run: async () => {
      try { const r = await api('/forget-links', { method: 'POST', body: {} }); cl.textContent = r.said; } catch (e) { cl.textContent = e.message; }
    } },
  ]);
  s.append(cl);
});

function theme(t) {
  if (t === 'day') document.documentElement.dataset.theme = 'day';
  else delete document.documentElement.dataset.theme;
  document.querySelector('meta[name="theme-color"]').content = t === 'day' ? '#F8F5FC' : '#18181B';
  try { localStorage.setItem('laventina.theme', t); } catch {}
  sheet.close();
}

function copyRow(where, text) {
  where.replaceChildren();
  const row = el('div', 'copy');
  const i = el('input'); i.readOnly = true; i.value = text;
  const b = el('button', 'chip main', 'Copy'); b.type = 'button';
  b.onclick = async () => { try { await navigator.clipboard.writeText(text); b.textContent = 'Copied'; } catch { i.select(); } };
  row.append(i, b);
  where.append(row);
}

// Coming back to the app after a while: look once. Never on a timer.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state && Date.now() - loadedAt > 10 * 60 * 1000) arrive();
});

arrive();
