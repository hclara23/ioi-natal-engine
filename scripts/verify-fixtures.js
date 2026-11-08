#!/usr/bin/env node
'use strict';
// Prints the largest deviation between this build and the pyswisseph fixtures.
// Run inside the container after a build: `node scripts/verify-fixtures.js`.
const eph = require('../src/ephemeris');
const fixtures = require('../test/fixtures/placidus-reference.json');
eph.init();
let worst = 0, worstName = '';
for (const c of fixtures.cases) {
  const h = eph.houses(eph.julianDay(c.instant), c.latitude, c.longitude, 'placidus');
  const devs = [Math.abs(h.ascendant - c.ascendant), Math.abs(h.midheaven - c.midheaven), ...c.cusps.map((x, i) => Math.abs(h.cusps[i] - x))];
  const d = Math.max(...devs);
  if (d > worst) { worst = d; worstName = c.name; }
  console.log(`${c.name.padEnd(12)} max deviation ${d.toExponential(2)}°`);
}
console.log(`swisseph ${eph.version()} — worst case ${worstName}: ${worst.toExponential(2)}° (${(worst * 3600).toFixed(4)} arcsec)`);
process.exit(worst < 1e-6 ? 0 : 1);
