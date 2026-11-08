'use strict';
// Aspects, orbs, weighted values, grid, totals, declination aspects.
const { wrap, formatOrb } = require('./zodiac');

const ASPECTS = [
  { type: 'conjunction', angle: 0, major: true, row: 'conj_opp', base: 4 },
  { type: 'opposition', angle: 180, major: true, row: 'conj_opp', base: 3.5 },
  { type: 'trine', angle: 120, major: true, row: 'tri_sq', base: 3 },
  { type: 'square', angle: 90, major: true, row: 'tri_sq', base: 3 },
  { type: 'sextile', angle: 60, major: true, row: 'sextile', base: 2 },
  { type: 'quincunx', angle: 150, major: false, row: 'quincunx', base: 1.5 },
  { type: 'semisextile', angle: 30, major: false, row: 'minor', base: 1 },
  { type: 'semisquare', angle: 45, major: false, row: 'minor', base: 1 },
  { type: 'sesquiquadrate', angle: 135, major: false, row: 'minor', base: 1 },
  { type: 'quintile', angle: 72, major: false, row: 'quintile', base: 1 },
  { type: 'biquintile', angle: 144, major: false, row: 'quintile', base: 1 },
];

// Orb table (degrees) by the higher class of the two bodies: luminary > planet > point.
const DEFAULT_ORBS = {
  conj_opp: { luminary: 10, planet: 8, point: 5 },
  tri_sq: { luminary: 8, planet: 7, point: 4 },
  sextile: { luminary: 6, planet: 5, point: 3 },
  quincunx: { luminary: 3, planet: 3, point: 2 },
  minor: { luminary: 2, planet: 2, point: 1.5 },
  quintile: { luminary: 2, planet: 2, point: 1 },
  declination: { luminary: 1, planet: 1, point: 1 },
};

const HARMONIOUS = new Set(['trine', 'sextile', 'quintile', 'biquintile']);
const MALEFIC_CONJUNCTION = new Set(['mars', 'saturn', 'uranus', 'neptune', 'pluto']);
const WEIGHTS = { sun: 1.5, moon: 1.5, mercury: 1.2, venus: 1.2, mars: 1.2, jupiter: 1, saturn: 1 };
function weightOf(b) {
  if (WEIGHTS[b.id] !== undefined) return WEIGHTS[b.id];
  if (['uranus', 'neptune', 'pluto'].includes(b.id)) return 0.8;
  return 0.6;
}
const CLASS_RANK = { luminary: 3, planet: 2, point: 1 };
function orbClass(a, b) {
  return CLASS_RANK[a.aspect_class] >= CLASS_RANK[b.aspect_class] ? a.aspect_class : b.aspect_class;
}

// Signed shortest arc from a to b, in (-180, 180].
function signedArc(a, b) {
  let d = wrap(b - a);
  if (d > 180) d -= 360;
  return d;
}

function valueOf(aspect, a, b, orb, maxOrb) {
  let sign;
  if (aspect.type === 'conjunction') sign = (MALEFIC_CONJUNCTION.has(a.id) || MALEFIC_CONJUNCTION.has(b.id)) ? -1 : 1;
  else sign = HARMONIOUS.has(aspect.type) ? 1 : -1;
  const tightness = Math.max(0, 1 - orb / maxOrb);
  return Math.round(sign * aspect.base * weightOf(a) * weightOf(b) * tightness * 100) / 100;
}

/**
 * bodies: [{ id, longitude, speed, aspect_class: 'luminary'|'planet'|'point', aspects: true|false }]
 * The order of `bodies` fixes the a/b order in ids and the grid order.
 */
function computeAspects(bodies, { orbs = DEFAULT_ORBS, includeMinor = true, skipPair } = {}) {
  const list = [];
  const active = bodies.filter((b) => b.aspects !== false && Number.isFinite(b.longitude));
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i], b = active[j];
      if (skipPair && skipPair(a, b)) continue;
      const arc = signedArc(a.longitude, b.longitude);           // b relative to a
      const distance = Math.abs(arc);
      const cls = orbClass(a, b);
      let best = null;
      for (const asp of ASPECTS) {
        if (!includeMinor && !asp.major) continue;
        const maxOrb = orbs[asp.row][cls];
        const orb = Math.abs(distance - asp.angle);
        if (orb <= maxOrb && (!best || orb < best.orb)) best = { asp, orb, maxOrb };
      }
      if (!best) continue;
      const { asp, orb, maxOrb } = best;
      // Applying or separating from the actual relative motion.
      let applying = null, exactIn = null;
      if (Number.isFinite(a.speed) && Number.isFinite(b.speed)) {
        const rel = b.speed - a.speed;                            // d(arc)/dt in deg/day
        const dOrb = (distance - asp.angle) * Math.sign(arc || 1) * rel; // >0 means orb growing
        const rate = Math.abs(rel);
        if (rate > 1e-9) {
          applying = dOrb < 0;
          exactIn = Math.round((applying ? orb : -orb) / rate * 100) / 100;
        }
      }
      list.push({
        id: `${a.id}-${b.id}-${asp.type}`,
        a: a.id, b: b.id, type: asp.type, angle: asp.angle, major: asp.major,
        orb_degrees: Math.round(orb * 10000) / 10000, orb_text: formatOrb(orb), max_orb: maxOrb,
        applying, exact_in_days: exactIn,
        value: valueOf(asp, a, b, orb, maxOrb),
      });
    }
  }
  list.sort((x, y) => (x.orb_degrees / x.max_orb) - (y.orb_degrees / y.max_orb));
  return list;
}

function aspectGrid(bodies, aspects) {
  const order = bodies.filter((b) => b.aspects !== false).map((b) => b.id);
  const cells = {};
  for (const a of aspects) cells[`${a.a}|${a.b}`] = a.type;
  return { order, cells };
}

function aspectTotals(aspects) {
  let positive = 0, negative = 0;
  for (const a of aspects) { if (a.value > 0) positive += a.value; else negative += a.value; }
  positive = Math.round(positive * 100) / 100; negative = Math.round(negative * 100) / 100;
  return { positive, negative, net: Math.round((positive + negative) * 100) / 100 };
}

function declinationAspects(bodies, { orbs = DEFAULT_ORBS } = {}) {
  const out = [];
  const active = bodies.filter((b) => b.aspects !== false && Number.isFinite(b.declination) && b.declination_aspects !== false);
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i], b = active[j];
      const maxOrb = orbs.declination[orbClass(a, b)];
      const par = Math.abs(a.declination - b.declination);
      const contra = Math.abs(a.declination + b.declination);
      if (par <= maxOrb && Math.sign(a.declination) === Math.sign(b.declination)) {
        out.push({ a: a.id, b: b.id, type: 'parallel', orb_degrees: Math.round(par * 10000) / 10000 });
      } else if (contra <= maxOrb && Math.sign(a.declination) !== Math.sign(b.declination)) {
        out.push({ a: a.id, b: b.id, type: 'contraparallel', orb_degrees: Math.round(contra * 10000) / 10000 });
      }
    }
  }
  return out.sort((x, y) => x.orb_degrees - y.orb_degrees);
}

module.exports = { ASPECTS, DEFAULT_ORBS, computeAspects, aspectGrid, aspectTotals, declinationAspects, signedArc };
