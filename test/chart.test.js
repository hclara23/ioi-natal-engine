'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { computeChart, ChartInputError } = require('../src/chart');
const { chartRequest } = require('../src/schema');
const { wrap } = require('../src/zodiac');

const MEXICO = { date: '1979-04-08', time: '14:30', zone: 'America/Mexico_City', latitude: 19.4326, longitude: -99.1332 };
const byId = (c, id) => c.bodies.find((b) => b.id === id);

test('known chart: Sun, Ascendant and Midheaven land where the Swiss Ephemeris puts them', () => {
  const c = computeChart(MEXICO);
  assert.equal(c.schema, 'ioi.natal.factors/1');
  assert.equal(c.engine.input.instant, '1979-04-08T20:30:00.000Z');
  assert.ok(Math.abs(byId(c, 'sun').longitude - 18.4095) < 0.001);
  assert.ok(Math.abs(c.angles.ascendant.longitude - 138.0167) < 0.001);
  assert.ok(Math.abs(c.angles.midheaven.longitude - 47.3325) < 0.001);
  assert.equal(c.engine.input.sect, 'day');
  assert.equal(byId(c, 'sun').house, 9);
});

test('Part of Fortune uses the day formula by day and the night formula by night', () => {
  const day = computeChart(MEXICO);
  const { ascendant } = day.angles;
  const expectDay = wrap(ascendant.longitude + byId(day, 'moon').longitude - byId(day, 'sun').longitude);
  assert.ok(Math.abs(byId(day, 'part_of_fortune').longitude - expectDay) < 1e-4);
  assert.equal(byId(day, 'part_of_fortune').formula, 'day');

  const night = computeChart({ ...MEXICO, time: '02:30' });
  assert.equal(night.engine.input.sect, 'night');
  const expectNight = wrap(night.angles.ascendant.longitude + byId(night, 'sun').longitude - byId(night, 'moon').longitude);
  assert.ok(Math.abs(byId(night, 'part_of_fortune').longitude - expectNight) < 1e-4);
  assert.equal(byId(night, 'part_of_fortune').formula, 'night');

  const forced = computeChart({ ...MEXICO, time: '02:30', fortune: 'day' });
  assert.equal(byId(forced, 'part_of_fortune').formula, 'day');
});

test('south node is opposite the north node and the node kind follows the setting', () => {
  const t = computeChart(MEXICO);
  assert.ok(Math.abs(wrap(byId(t, 'south_node').longitude - byId(t, 'north_node').longitude) - 180) < 1e-6);
  assert.equal(byId(t, 'north_node').longitude, byId(t, 'true_node').longitude);
  const m = computeChart({ ...MEXICO, node: 'mean' });
  assert.equal(byId(m, 'north_node').longitude, byId(m, 'mean_node').longitude);
});

test('unknown birth time omits angles, houses, Moon aspects and time-dependent points', () => {
  const c = computeChart({ ...MEXICO, time: undefined, unknown_time: true });
  assert.equal(c.engine.input.unknown_time, true);
  assert.equal(c.engine.input.time, null);
  assert.equal(c.angles, null);
  assert.equal(c.cusps, null);
  assert.deepEqual(c.houses, []);
  assert.equal(byId(c, 'part_of_fortune'), undefined);
  assert.equal(byId(c, 'vertex'), undefined);
  assert.equal(c.aspect_list.filter((a) => a.a === 'moon' || a.b === 'moon').length, 0);
  assert.equal(c.aspect_list.filter((a) => ['ascendant', 'midheaven'].includes(a.a) || ['ascendant', 'midheaven'].includes(a.b)).length, 0);
  assert.equal(c.balances.hemispheres, null);
  assert.equal(c.lunar_phase.uncertain, true);
  assert.ok(c.unknown_time.moon_range.start_longitude < c.unknown_time.moon_range.end_longitude);
  assert.equal(c.vedic.lagna, null);
  assert.deepEqual(c.vedic.periods, []);
  for (const b of c.bodies) assert.equal(b.house, null);
});

test('aspects respect the orb table and carry orb text, value and applying flag', () => {
  const c = computeChart(MEXICO);
  for (const a of c.aspect_list) {
    assert.ok(a.orb_degrees <= a.max_orb, `${a.id} orb ${a.orb_degrees} > ${a.max_orb}`);
    assert.match(a.orb_text, /^\d+°\d{2}'$/);
    assert.ok(typeof a.value === 'number');
    assert.ok(a.applying === true || a.applying === false || a.applying === null);
  }
  // No point-to-point aspects, no angle-to-angle aspects.
  const pointish = new Set(['north_node', 'lilith', 'chiron', 'ceres', 'pallas', 'juno', 'vesta', 'part_of_fortune', 'vertex']);
  assert.equal(c.aspect_list.filter((a) => pointish.has(a.a) && pointish.has(a.b)).length, 0);
  assert.equal(c.aspect_list.filter((a) => a.a === 'ascendant' && a.b === 'midheaven').length, 0);
  // Totals add up.
  const pos = c.aspect_list.filter((a) => a.value > 0).reduce((s, a) => s + a.value, 0);
  assert.ok(Math.abs(pos - c.aspect_totals.positive) < 0.01);
  // Grid order lists every aspecting body and cells use that order.
  for (const key of Object.keys(c.aspect_grid.cells)) {
    const [x, y] = key.split('|');
    assert.ok(c.aspect_grid.order.indexOf(x) < c.aspect_grid.order.indexOf(y), key);
  }
});

test('legacy arrays keep the shape the IOI wheel reads', () => {
  const c = computeChart(MEXICO);
  assert.equal(c.houses.length, 12);
  for (const p of c.planets) {
    assert.deepEqual(Object.keys(p), ['id', 'label', 'sign', 'degree', 'longitude', 'retrograde', 'house', 'note']);
    assert.match(p.degree, /^\d+°\d{2}'$/);
  }
  for (const h of c.houses) assert.deepEqual(Object.keys(h), ['house', 'id', 'sign', 'degree', 'longitude']);
  for (const a of c.aspects) {
    assert.equal(a.id, `${a.from}-${a.to}-${a.type}`);
    assert.ok(['conjunction', 'opposition', 'trine', 'square', 'sextile'].includes(a.type));
  }
});

test('balances count Sun through Pluto only and sum to ten', () => {
  const c = computeChart(MEXICO);
  const sum = (o) => Object.values(o).reduce((s, v) => s + v, 0);
  assert.equal(sum(c.balances.elements), 10);
  assert.equal(sum(c.balances.modalities), 10);
  assert.equal(sum(c.balances.polarity), 10);
  assert.equal(sum(c.balances.hemispheres), 20); // north+south = 10, east+west = 10
  assert.equal(sum(c.balances.quadrants), 10);
});

test('intercepted and duplicated signs are detected at high latitude', () => {
  const c = computeChart({ date: '1990-07-15', time: '06:30', zone: 'Europe/London', latitude: 51.5, longitude: 0 });
  assert.ok(c.intercepted_signs.length >= 1, 'expected an interception at 51.5N');
  assert.equal(c.intercepted_signs.length, c.duplicated_signs.length);
  for (const cusp of c.cusps) if (cusp.intercepted_sign) assert.ok(c.intercepted_signs.includes(cusp.intercepted_sign));
});

test('house system fallback is reported in the input echo', () => {
  const c = computeChart({ date: '1990-06-21', time: '12:00', zone: 'Europe/Oslo', latitude: 70, longitude: 25 });
  assert.equal(c.engine.input.house_system, 'placidus');
  assert.equal(c.engine.input.house_system_used, 'porphyry');
  assert.equal(c.engine.input.house_system_fallback, 'porphyry');
});

test('DST gap and overlap surface as input errors with details', () => {
  assert.throws(() => computeChart({ date: '2024-03-10', time: '02:30', zone: 'America/New_York', latitude: 40.7, longitude: -74 }), ChartInputError);
  try { computeChart({ date: '2024-11-03', time: '01:30', zone: 'America/New_York', latitude: 40.7, longitude: -74 }); assert.fail('should throw'); } catch (e) {
    assert.ok(e instanceof ChartInputError); assert.equal(e.details.candidates.length, 2);
  }
  const ok = computeChart({ date: '2024-11-03', time: '01:30', zone: 'America/New_York', disambiguation: 'later', latitude: 40.7, longitude: -74 });
  assert.equal(ok.engine.input.utc_offset_minutes, -300);
});

test('request schema rejects bad input and accepts the documented fields', () => {
  assert.equal(chartRequest.safeParse({ ...MEXICO }).success, true);
  assert.equal(chartRequest.safeParse({ ...MEXICO, date: '1979-02-30' }).success, false);
  assert.equal(chartRequest.safeParse({ ...MEXICO, date: '1700-01-01' }).success, false);
  assert.equal(chartRequest.safeParse({ ...MEXICO, time: undefined }).success, false);
  assert.equal(chartRequest.safeParse({ ...MEXICO, time: undefined, unknown_time: true }).success, true);
  assert.equal(chartRequest.safeParse({ ...MEXICO, zone: undefined }).success, false);
  assert.equal(chartRequest.safeParse({ ...MEXICO, zone: undefined, utc_offset_minutes: -360 }).success, true);
  assert.equal(chartRequest.safeParse({ ...MEXICO, latitude: 95 }).success, false);
  assert.equal(chartRequest.safeParse({ ...MEXICO, extra: 1 }).success, false);
  assert.equal(chartRequest.safeParse({ ...MEXICO, house_system: 'placidus', node: 'mean', lilith: 'true', rulership: 'traditional' }).success, true);
});

test('the same input always yields the same factors (apart from computed_at)', () => {
  const a = computeChart(MEXICO), b = computeChart(MEXICO);
  delete a.engine.computed_at; delete b.engine.computed_at;
  assert.deepEqual(a, b);
});
