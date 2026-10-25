// Laventina's heart: pure functions shared by the page, the API and the Claude link.
// No network, no clocks, no storage here: the caller passes in the household and today's date.

export const BUDGET_CREDITS = 50; // Nero's monthly ceiling for Laventina (2026-10-25)
// One API call is about 0.3 s of a 1 GB function (10 credits per GB-hour) plus one web request (2 per 10,000).
export const CREDITS_PER_CALL = (0.3 / 3600) * 10 + 2 / 10000;

const DAY = 86400000;
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

export function todayISO(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
// Today's date and hour in a time zone, for callers without a clock of their own (Claude).
export function localNow(now = new Date(), tz = 'Europe/Rome') {
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
      .formatToParts(now).map((x) => [x.type, x.value]));
    return { today: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
  } catch {
    return { today: todayISO(now), hour: now.getHours() };
  }
}
const toUTC = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
export const addDays = (iso, n) => new Date(toUTC(iso) + n * DAY).toISOString().slice(0, 10);
export const daysUntil = (iso, today) => Math.round((toUTC(iso) - toUTC(today)) / DAY);
export const month = (iso) => iso.slice(0, 7);

export function euros(n) {
  const v = Math.round(n * 100) / 100;
  return '€' + (Number.isInteger(v) ? v : v.toFixed(2));
}
export const couponValue = (c) => (c.unit === '%' ? `${c.value}% off` : euros(c.value));

function niceDay(iso, today) {
  const d = daysUntil(iso, today);
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  if (d === -1) return 'yesterday';
  if (d > 1 && d < 7) return WEEKDAYS[new Date(toUTC(iso)).getUTCDay()].replace(/^./, (c) => c.toUpperCase());
  return `${+iso.slice(8, 10)} ${MONTHS[+iso.slice(5, 7) - 1].replace(/^./, (c) => c.toUpperCase())}`;
}

// "€5 Carrefour until Friday", "Lidl 10% off till 3/11", "7€ coupon at Conad, 30 Oct"
export function parseCoupon(text, today) {
  let rest = ` ${String(text || '').trim()} `;
  const out = { shop: '', value: null, unit: '€', ends: null };
  const money = rest.match(/(?:€\s*(\d+(?:[.,]\d{1,2})?)|(\d+(?:[.,]\d{1,2})?)\s*(?:€|eur(?:o|os)?\b))/i);
  const pct = rest.match(/(\d{1,2})\s*%/);
  if (money) { out.value = parseFloat((money[1] || money[2]).replace(',', '.')); rest = rest.replace(money[0], ' '); }
  else if (pct) { out.value = +pct[1]; out.unit = '%'; rest = rest.replace(pct[0], ' '); }

  const low = rest.toLowerCase();
  let m;
  if (/\btoday\b|\btonight\b/.test(low)) out.ends = today;
  else if (/\btomorrow\b/.test(low)) out.ends = addDays(today, 1);
  else if ((m = low.match(/\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/))) {
    const want = WEEKDAYS.findIndex((w) => w.startsWith(m[1]));
    const now = new Date(toUTC(today)).getUTCDay();
    out.ends = addDays(today, (want - now + 7) % 7 || 7);
  } else if ((m = low.match(/\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/))) {
    out.ends = dateFrom(+m[1], +m[2], m[3], today);
  } else if ((m = low.match(/\b(\d{1,2})\s*(?:st|nd|rd|th)?\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/))) {
    out.ends = dateFrom(+m[1], MONTHS.indexOf(m[2]) + 1, null, today);
  } else if ((m = low.match(/\bin\s+(\d{1,2})\s+days?\b/))) out.ends = addDays(today, +m[1]);

  // The shop: the first word that isn't filler or part of the date.
  const filler = /^(coupon|voucher|discount|off|at|from|for|on|until|till|by|ends?|ending|expires?|valid|the|a|an|of|in|days?|today|tonight|tomorrow|and|with|my|code|buono|sconto)$/i;
  const words = rest.replace(/[^\p{L}\p{N}'&\s-]/gu, ' ').split(/\s+/).filter(Boolean);
  const shop = words.find((w) => !filler.test(w) && !/^\d/.test(w) &&
    !/^(sun|mon|tue|wed|thu|fri|sat)/i.test(w) && !MONTHS.includes(w.slice(0, 3).toLowerCase()));
  if (shop) out.shop = shop.replace(/^./, (c) => c.toUpperCase());
  return out;
}

function dateFrom(day, mon, year, today) {
  const p = (n) => String(n).padStart(2, '0');
  let y = year ? (+year < 100 ? 2000 + +year : +year) : +today.slice(0, 4);
  if (mon < 1 || mon > 12 || day < 1 || day > 31) return null;
  let iso = `${y}-${p(mon)}-${p(day)}`;
  if (!year && daysUntil(iso, today) < -60) iso = `${y + 1}-${p(mon)}-${p(day)}`;
  return iso;
}

// The story so far. Every new household starts with Nero's first two stepping stones.
export const CHAPTERS = [
  { n: 1, title: 'The coupon', lost: 7, date: '2026-10-25',
    story: 'A €7 Carrefour coupon, forgotten on a €35 shop. A small loss, and the first stepping stone: the moment Laventina was asked to exist.',
    lesson: 'Things with an end date need someone watching the end date. Coupons now live here, with their last day in sight.' },
  { n: 2, title: 'The frost', lost: 5, date: '2026-10-25',
    story: 'The first butler built a clock that ticked every minute and kept a paid lamp burning day and night, on a purse shared by five houses. €5 of credits bought the other houses their light. It came early, and nobody was ready.',
    lesson: 'Nothing runs on its own. Nothing costs anything unless someone is using it. Every cost gets a price before it ships, and the butler watches its own meter.' },
];

export function newHouse({ name, person, today, tz, id = rid() }) {
  return {
    v: 1, name: String(name || 'Our house').slice(0, 60), created: today,
    tz: typeof tz === 'string' && /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(tz) ? tz : 'Europe/Rome',
    people: [{ id, name: String(person || 'Nero').slice(0, 40) }],
    coupons: [],
    stones: CHAPTERS.map((c) => ({ id: rid(), ...c })),
    meter: {},
  };
}

export function rid() {
  const a = new Uint8Array(9);
  globalThis.crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 12);
}

const clean = (s, n = 80) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

// Every change goes through here, from the page and from Claude alike.
export function apply(house, action, { by, today }) {
  const h = structuredClone(house);
  const a = action || {};
  if (a.type === 'addCoupon') {
    const value = Number(a.value);
    if (!clean(a.shop)) throw new Error('Which shop is the coupon for?');
    if (!(value > 0) || value > 10000) throw new Error('How much is the coupon worth?');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a.ends || '')) throw new Error('When is its last day?');
    if (h.coupons.filter((c) => c.state === 'open').length >= 200) throw new Error('That is a lot of coupons already.');
    const c = { id: rid(), shop: clean(a.shop, 40), value, unit: a.unit === '%' ? '%' : '€', ends: a.ends,
      note: clean(a.note, 140), state: 'open', added: today, by };
    h.coupons.push(c);
    return { house: h, said: `Kept: ${couponValue(c)} at ${c.shop}, until ${niceDay(c.ends, today)}.`, coupon: c };
  }
  const c = a.id && h.coupons.find((x) => x.id === a.id);
  if (a.type === 'useCoupon' || a.type === 'missCoupon' || a.type === 'dropCoupon') {
    if (!c) throw new Error('I could not find that coupon.');
    if (a.type === 'dropCoupon') {
      h.coupons = h.coupons.filter((x) => x !== c);
      return { house: h, said: `Let go of the ${c.shop} coupon.` };
    }
    c.state = a.type === 'useCoupon' ? 'used' : 'missed';
    c.closed = today;
    if (c.state === 'used') return { house: h, said: `Well caught: ${couponValue(c)} saved at ${c.shop}.` };
    const n = Math.max(0, ...h.stones.map((s) => s.n)) + 1;
    h.stones.push({ id: rid(), n, title: `The ${c.shop} coupon`, lost: c.unit === '€' ? c.value : 0, date: today,
      story: clean(a.why, 280) || `${couponValue(c)} at ${c.shop} ran out before it was used.`, lesson: '' });
    return { house: h, said: `Written in the story as stepping stone ${n}. What would have helped you catch it?`, stone: n };
  }
  if (a.type === 'lesson') {
    const s = h.stones.find((x) => x.n === Number(a.n));
    if (!s) throw new Error('No such stepping stone.');
    s.lesson = clean(a.lesson, 280);
    return { house: h, said: 'Thank you. I will remember that.' };
  }
  if (a.type === 'addStone') {
    if (!clean(a.title)) throw new Error('What should the stepping stone be called?');
    const n = Math.max(0, ...h.stones.map((s) => s.n)) + 1;
    h.stones.push({ id: rid(), n, title: clean(a.title, 60), lost: Math.max(0, Number(a.lost) || 0), date: today,
      story: clean(a.story, 280), lesson: clean(a.lesson, 280) });
    return { house: h, said: `Stepping stone ${n} is in the story.`, stone: n };
  }
  if (a.type === 'leaveNote') {
    // Claude's words for the butler to hand over at the door. Written when Nero talks to Claude, never generated here.
    const text = String(a.text ?? '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, 1200);
    if (!text) throw new Error('What should the note say?');
    h.notes = [...(h.notes || []), { id: rid(), text, date: today, by, read: false }].slice(-10);
    return { house: h, said: 'The note is on the silver tray. It will be waiting at the door.' };
  }
  if (a.type === 'readNote') {
    const n = (h.notes || []).find((x) => x.id === a.id);
    if (n) n.read = true;
    return { house: h, said: 'Put away.' };
  }
  if (a.type === 'rename') {
    const p = h.people.find((x) => x.id === by);
    if (p && clean(a.name)) p.name = clean(a.name, 40);
    return { house: h, said: 'Noted.' };
  }
  throw new Error('I do not know how to do that yet.');
}

export function ledger(house) {
  const lost = house.stones.reduce((t, s) => t + (s.lost || 0), 0);
  const caught = house.coupons.filter((c) => c.state === 'used' && c.unit === '€').reduce((t, c) => t + c.value, 0);
  return { lost, caught, stones: house.stones.length, net: caught - lost };
}

// The brief: what the butler says when you open the door. Short, and only what matters.
export function brief(house, today, personId, hour = 12) {
  const me = house.people.find((p) => p.id === personId);
  const name = me ? me.name : '';
  const part = hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const open = house.coupons.filter((c) => c.state === 'open').sort((a, b) => a.ends.localeCompare(b.ends));
  const lines = [];

  for (const c of open.filter((c) => daysUntil(c.ends, today) < 0)) {
    lines.push({ kind: 'ask', coupon: c.id,
      text: `The ${couponValue(c)} ${c.shop} coupon ended ${niceDay(c.ends, today)}. Did you use it?`,
      replies: [{ label: 'Yes, used it', action: { type: 'useCoupon', id: c.id } },
        { label: 'No, missed it', action: { type: 'missCoupon', id: c.id } }] });
  }
  for (const c of open.filter((c) => { const d = daysUntil(c.ends, today); return d >= 0 && d <= 3; })) {
    lines.push({ kind: 'money', coupon: c.id,
      text: `${couponValue(c)} at ${c.shop} ends ${niceDay(c.ends, today)}.${c.note ? ' ' + c.note : ''}`,
      replies: [{ label: 'Used it', action: { type: 'useCoupon', id: c.id } }, { label: 'Calendar', calendar: c.id }] });
  }
  const note = (house.notes || []).filter((n) => !n.read && daysUntil(n.date, today) >= -3).slice(-1)[0];
  if (note) lines.unshift({ kind: 'letter', note: note.id, text: note.text,
    replies: [{ label: 'Thank you', action: { type: 'readNote', id: note.id } }] });
  const unlearned = house.stones.filter((s) => !s.lesson).slice(-1)[0];
  if (unlearned) lines.push({ kind: 'ask', stone: unlearned.n,
    text: `About stepping stone ${unlearned.n}, "${unlearned.title}": what would have helped you catch it?`, lesson: unlearned.n });

  const later = open.filter((c) => daysUntil(c.ends, today) > 3);
  let hello;
  if (!lines.length && !open.length) hello = `${part}${name ? ', ' + name : ''}. All is quiet. If a coupon comes your way, tell me in one sentence and I will watch its last day.`;
  else if (!lines.length) hello = `${part}${name ? ', ' + name : ''}. Nothing needs you today. I am watching ${later.length} coupon${later.length === 1 ? '' : 's'} for you.`;
  else {
    const things = lines.filter((l) => l.kind !== 'letter').length;
    hello = `${part}${name ? ', ' + name : ''}. ${note ? 'A note is waiting for you' + (things ? ', and ' : '.') : ''}${things ? (things === 1 ? 'one thing' : things + ' things') + ' worth a moment.' : ''}`;
    if (!note) hello = hello.replace(/\. one/, '. One').replace(/\. (\d)/, '. $1');
  }
  return { hello, lines, watching: later.map((c) => ({ id: c.id, text: `${couponValue(c)} at ${c.shop}, until ${niceDay(c.ends, today)}` })), ledger: ledger(house) };
}

// Usage meter: counts calls per month so the butler can rest before it costs too much.
export function meter(house, today) {
  const calls = (house.meter && house.meter[month(today)]) || 0;
  const credits = Math.round(calls * CREDITS_PER_CALL * 100) / 100;
  return { month: month(today), calls, credits, budget: BUDGET_CREDITS, resting: credits >= BUDGET_CREDITS };
}

// A calendar event with an alarm the morning before: the phone rings, no server clock needed.
export function couponICS(c, today) {
  const d = c.ends.replace(/-/g, '');
  const next = addDays(c.ends, 1).replace(/-/g, '');
  const stamp = today.replace(/-/g, '') + 'T090000Z';
  const esc = (s) => String(s).replace(/[\\;,]/g, (m) => '\\' + m).replace(/\n/g, '\\n');
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Laventina//Coupons//EN', 'BEGIN:VEVENT',
    `UID:${c.id}@laventina`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${next}`,
    `SUMMARY:${esc(`Last day: ${couponValue(c)} at ${c.shop}`)}`,
    `DESCRIPTION:${esc(c.note || 'Laventina is keeping this coupon for you.')}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(`${c.shop} coupon ends today`)}`, 'TRIGGER:-PT15H', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
}
