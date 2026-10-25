import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCoupon, newHouse, apply, brief, ledger, couponICS, addDays } from '../public/js/laventina.mjs';

const today = '2026-10-25'; // a Sunday

test('one sentence becomes a coupon', () => {
  assert.deepEqual(parseCoupon('€5 Carrefour until Friday', today), { shop: 'Carrefour', value: 5, unit: '€', ends: '2026-10-30' });
  assert.deepEqual(parseCoupon('Lidl 10% off till 3/11', today), { shop: 'Lidl', value: 10, unit: '%', ends: '2026-11-03' });
  assert.deepEqual(parseCoupon('7,50€ coupon at Conad, 30 Oct', today), { shop: 'Conad', value: 7.5, unit: '€', ends: '2026-10-30' });
  assert.equal(parseCoupon('carrefour coupon tomorrow', today).ends, '2026-10-26');
  assert.equal(parseCoupon('Esselunga 3 euro 2 Jan', today).ends, '2027-01-02');
  assert.equal(parseCoupon('Coop €2 sunday', today).ends, '2026-11-01');
  assert.equal(parseCoupon('just a shop', today).value, null);
});

test('a new house starts with the first two chapters', () => {
  const h = newHouse({ name: 'Casa', person: 'Nero', today });
  assert.deepEqual(h.stones.map((s) => [s.n, s.title, s.lost]), [[1, 'The coupon', 7], [2, 'The frost', 5]]);
  assert.deepEqual(ledger(h), { lost: 12, caught: 0, stones: 2, net: -12 });
});

test('coupons are caught or become stepping stones', () => {
  const by = 'p1';
  let h = newHouse({ name: 'Casa', person: 'Nero', today, id: by });
  let r = apply(h, { type: 'addCoupon', shop: 'Carrefour', value: 5, unit: '€', ends: addDays(today, 2) }, { by, today });
  h = r.house;
  const id = r.coupon.id;
  let b = brief(h, today, by, 9);
  assert.match(b.hello, /^Good morning, Nero\. One thing/);
  assert.equal(b.lines[0].kind, 'money');
  // Two days after its last day the butler asks.
  b = brief(h, addDays(today, 3), by);
  assert.equal(b.lines[0].kind, 'ask');
  const missed = apply(h, { type: 'missCoupon', id }, { by, today: addDays(today, 3) });
  assert.equal(missed.stone, 3);
  assert.equal(ledger(missed.house).lost, 17);
  const used = apply(h, { type: 'useCoupon', id }, { by, today });
  assert.equal(ledger(used.house).caught, 5);
  assert.throws(() => apply(h, { type: 'addCoupon', shop: 'X', value: 0, ends: today }, { by, today }), /worth/);
  assert.throws(() => apply(h, { type: 'nope' }, { by, today }), /do not know/);
});

test('a stepping stone without a lesson gets asked about', () => {
  let h = newHouse({ name: 'Casa', person: 'Nero', today, id: 'p' });
  h = apply(h, { type: 'addStone', title: 'Late fee', lost: 3 }, { by: 'p', today }).house;
  const b = brief(h, today, 'p');
  assert.equal(b.lines.at(-1).lesson, 3);
  h = apply(h, { type: 'lesson', n: 3, lesson: 'Pay on the day the bill arrives.' }, { by: 'p', today }).house;
  assert.equal(brief(h, today, 'p').lines.length, 0);
});

test('the calendar rings the evening before, with no server', () => {
  const ics = couponICS({ id: 'c1', shop: 'Carrefour', value: 5, unit: '€', ends: '2026-10-30' }, today);
  assert.match(ics, /DTSTART;VALUE=DATE:20261030/);
  assert.match(ics, /TRIGGER:-PT15H/);
  assert.match(ics, /SUMMARY:Last day: €5 at Carrefour/);
});
