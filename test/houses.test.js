'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const eph = require('../src/ephemeris');
const fixtures = require('./fixtures/placidus-reference.json');

const TOL = 1e-6; // degrees; the fixtures were produced by pyswisseph with the same library

test('Placidus cusps, Ascendant and Midheaven match the pyswisseph reference fixtures', () => {
  eph.init();
  for (const c of fixtures.cases) {
    const jd = eph.julianDay(c.instant);
    const h = eph.houses(jd, c.latitude, c.longitude, 'placidus');
    assert.equal(h.fallback, null, `${c.name}: unexpected fallback`);
    assert.ok(Math.abs(h.ascendant - c.ascendant) < TOL, `${c.name} ascendant ${h.ascendant} vs ${c.ascendant}`);
    assert.ok(Math.abs(h.midheaven - c.midheaven) < TOL, `${c.name} midheaven ${h.midheaven} vs ${c.midheaven}`);
    c.cusps.forEach((expected, i) => {
      assert.ok(Math.abs(h.cusps[i] - expected) < TOL, `${c.name} cusp ${i + 1}: ${h.cusps[i]} vs ${expected}`);
    });
  }
});

test('Placidus and Koch fall back to Porphyry inside the polar circle and say so', () => {
  eph.init();
  const jd = eph.julianDay('1990-06-21T12:00:00Z');
  for (const sys of ['placidus', 'koch']) {
    const h = eph.houses(jd, 70, 25, sys);
    assert.equal(h.fallback, 'porphyry');
    assert.equal(h.system_used, 'porphyry');
    assert.match(h.fallback_reason, /Porphyry/i);
  }
  const por = eph.houses(jd, 70, 25, 'porphyry');
  assert.equal(por.fallback, null);
});

test('every supported house system returns twelve cusps with cusp 1 = Ascendant for quadrant systems', () => {
  eph.init();
  const jd = eph.julianDay('1985-12-01T03:45:00Z');
  for (const sys of Object.keys(eph.HOUSE_CODES)) {
    const h = eph.houses(jd, -33.87, 151.21, sys);
    assert.equal(h.cusps.length, 12, sys);
    if (sys !== 'whole_sign') assert.ok(Math.abs(h.cusps[0] - h.ascendant) < 1e-9, `${sys} cusp1 should equal ASC`);
    else assert.equal(h.cusps[0] % 30, 0, 'whole sign cusp 1 is a sign boundary');
  }
});
