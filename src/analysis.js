'use strict';
// Derived classifications: balances, rulership, patterns, lunar phase,
// chart shape, dominants. Numbers and labels only.
const { SIGNS, wrap, signIndex, rulerOf } = require('./zodiac');

const CORE = ['sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'];
const byId = (bodies) => Object.fromEntries(bodies.map((b) => [b.id, b]));

// ---------- balances ----------
function balances(bodies, angles, { hasHouses }) {
  const core = bodies.filter((b) => CORE.includes(b.id));
  const zero = (keys) => Object.fromEntries(keys.map((k) => [k, 0]));
  const counts = {
    elements: zero(['fire', 'earth', 'air', 'water']),
    modalities: zero(['cardinal', 'fixed', 'mutable']),
    polarity: zero(['masculine', 'feminine']),
    signs: zero(SIGNS),
  };
  const weighted = {
    elements: zero(['fire', 'earth', 'air', 'water']),
    modalities: zero(['cardinal', 'fixed', 'mutable']),
    polarity: zero(['masculine', 'feminine']),
  };
  const W = { sun: 3, moon: 3, mercury: 2, venus: 2, mars: 2, jupiter: 1.5, saturn: 1.5, uranus: 1, neptune: 1, pluto: 1 };
  const add = (target, b, w) => {
    target.elements[b.element] += w; target.modalities[b.modality] += w; target.polarity[b.polarity] += w;
    if (target.signs) target.signs[b.sign] += w;
  };
  for (const b of core) { add(counts, b, 1); add(weighted, b, W[b.id]); }
  if (hasHouses && angles?.ascendant) add(weighted, angles.ascendant, 3);
  if (hasHouses && angles?.midheaven) add(weighted, angles.midheaven, 1);

  let hemispheres = null, quadrants = null;
  if (hasHouses) {
    hemispheres = { north: 0, south: 0, east: 0, west: 0 };
    quadrants = { first: 0, second: 0, third: 0, fourth: 0 };
    for (const b of core) {
      const h = b.house;
      if (!h) continue;
      if (h <= 6) hemispheres.north += 1; else hemispheres.south += 1;
      if (h >= 10 || h <= 3) hemispheres.east += 1; else hemispheres.west += 1;
      quadrants[['first', 'second', 'third', 'fourth'][Math.floor((h - 1) / 3)]] += 1;
    }
  }
  const dominant = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1])[0][0];
  return {
    scope: 'sun_to_pluto',
    elements: counts.elements, modalities: counts.modalities, polarity: counts.polarity, signs: counts.signs,
    hemispheres, quadrants,
    weighted: { ...weighted, note: 'Sun, Moon, Ascendant ×3; Mercury, Venus, Mars ×2; Jupiter, Saturn ×1.5; outer planets and Midheaven ×1' },
    dominant_element: dominant(weighted.elements), dominant_modality: dominant(weighted.modalities),
    lacking_elements: Object.entries(counts.elements).filter(([, v]) => v === 0).map(([k]) => k),
  };
}

// ---------- rulership ----------
function rulership(bodies, angles, cusps, scheme) {
  const map = byId(bodies);
  const core = bodies.filter((b) => CORE.includes(b.id));
  const dispositors = {};
  for (const b of core) dispositors[b.id] = rulerOf(b.sign_index, scheme);
  // Final dispositor: a planet in its own sign that every chain reaches.
  const terminal = (start) => {
    const seen = new Set(); let cur = start;
    while (!seen.has(cur)) { seen.add(cur); const next = dispositors[cur]; if (!next || next === cur) return next === cur ? cur : null; cur = next; }
    return null; // cycle without a domicile planet
  };
  const terminals = new Set(core.map((b) => terminal(b.id)));
  const final_dispositor = terminals.size === 1 && !terminals.has(null) ? [...terminals][0] : null;
  const mutual_receptions = [];
  for (let i = 0; i < core.length; i++) for (let j = i + 1; j < core.length; j++) {
    const a = core[i], b = core[j];
    if (dispositors[a.id] === b.id && dispositors[b.id] === a.id) mutual_receptions.push({ a: a.id, b: b.id, kind: 'domicile' });
  }
  const chart_ruler = angles?.ascendant ? rulerOf(angles.ascendant.sign_index, scheme) : null;
  const cuspRulers = cusps ? cusps.map((c) => {
    const r = rulerOf(signIndex(c.longitude), scheme);
    return { house: c.house, ruler: r, ruler_house: map[r]?.house ?? null, ruler_sign: map[r]?.sign ?? null };
  }) : [];
  return { scheme, chart_ruler, chart_ruler_house: chart_ruler ? map[chart_ruler]?.house ?? null : null, dispositors, final_dispositor, mutual_receptions, house_rulers: cuspRulers };
}

// ---------- patterns ----------
function patterns(bodies, aspects, { stelliumSet }) {
  const ids = new Set(stelliumSet);
  const has = {};
  for (const a of aspects) { if (!a.major) continue; has[`${a.a}|${a.b}`] = a.type; has[`${a.b}|${a.a}`] = a.type; }
  const rel = (x, y) => has[`${x}|${y}`];
  const P = bodies.filter((b) => ids.has(b.id)).map((b) => b.id);
  const found = [];
  const key = (type, members) => `${type}:${[...members].sort().join(',')}`;
  const seen = new Set();
  const push = (p) => { const k = key(p.type, p.bodies); if (!seen.has(k)) { seen.add(k); found.push(p); } };
  const map = byId(bodies);
  const modalityOf = (id) => map[id].modality;
  const elementOf = (id) => map[id].element;

  // Stelliums: three or more core bodies in one sign, or in one house.
  const group = (keyFn, label) => {
    const buckets = {};
    for (const id of P) { const k = keyFn(map[id]); if (k == null) continue; (buckets[k] ||= []).push(id); }
    for (const [k, members] of Object.entries(buckets)) if (members.length >= 3) push({ type: 'stellium', bodies: members, [label]: label === 'house' ? Number(k) : k });
  };
  group((b) => b.sign, 'sign');
  group((b) => b.house, 'house');

  for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
    const a = P[i], b = P[j];
    if (rel(a, b) === 'opposition') {
      for (const c of P) {
        if (c === a || c === b) continue;
        if (rel(a, c) === 'square' && rel(b, c) === 'square') push({ type: 't_square', bodies: [a, b, c], apex: c, modality: modalityOf(c) });
      }
    }
    if (rel(a, b) === 'sextile') {
      for (const c of P) {
        if (c === a || c === b) continue;
        if (rel(a, c) === 'quincunx' && rel(b, c) === 'quincunx') push({ type: 'yod', bodies: [a, b, c], apex: c });
      }
    }
    if (rel(a, b) === 'trine') {
      for (let k = j + 1; k < P.length; k++) {
        const c = P[k];
        if (rel(a, c) === 'trine' && rel(b, c) === 'trine') {
          push({ type: 'grand_trine', bodies: [a, b, c], element: elementOf(a) });
          for (const d of P) {
            if ([a, b, c].includes(d)) continue;
            const opp = [a, b, c].find((x) => rel(x, d) === 'opposition');
            if (opp && [a, b, c].filter((x) => x !== opp).every((x) => rel(x, d) === 'sextile')) push({ type: 'kite', bodies: [a, b, c, d], apex: d, spine: opp });
          }
        }
      }
    }
  }
  // Grand cross: two oppositions whose members are all square to each other.
  const opps = aspects.filter((x) => x.type === 'opposition' && ids.has(x.a) && ids.has(x.b));
  for (let i = 0; i < opps.length; i++) for (let j = i + 1; j < opps.length; j++) {
    const [a, b] = [opps[i].a, opps[i].b], [c, d] = [opps[j].a, opps[j].b];
    if (new Set([a, b, c, d]).size < 4) continue;
    if (rel(a, c) === 'square' && rel(a, d) === 'square' && rel(b, c) === 'square' && rel(b, d) === 'square') push({ type: 'grand_cross', bodies: [a, b, c, d], modality: modalityOf(a) });
    // Mystic rectangle: two oppositions joined by sextiles and trines.
    const st = (x, y) => ['sextile', 'trine'].includes(rel(x, y));
    if (st(a, c) && st(a, d) && st(b, c) && st(b, d)) push({ type: 'mystic_rectangle', bodies: [a, b, c, d] });
  }
  return found;
}

// ---------- lunar phase ----------
const PHASES = ['New Moon', 'Waxing Crescent', 'First Quarter', 'Waxing Gibbous', 'Full Moon', 'Waning Gibbous', 'Last Quarter', 'Balsamic'];
function lunarPhase(sun, moon, pheno, uncertain) {
  const elongation = wrap(moon.longitude - sun.longitude);
  const index = Math.floor(elongation / 45) % 8;
  return {
    name: PHASES[index], index: index + 1, elongation: Math.round(elongation * 100) / 100,
    illumination: Math.round(pheno.illumination * 1000) / 1000, waxing: elongation < 180,
    uncertain: Boolean(uncertain),
  };
}

// ---------- chart shape (Jones patterns) ----------
function chartShape(bodies) {
  const core = bodies.filter((b) => CORE.includes(b.id)).map((b) => ({ id: b.id, lon: wrap(b.longitude) })).sort((a, b) => a.lon - b.lon);
  const n = core.length;
  if (n < 10) return { type: null, leading_planet: null, note: 'needs Sun through Pluto' };
  const gaps = core.map((b, i) => { const next = core[(i + 1) % n]; return { from: b.id, to: next.id, size: wrap(next.lon - b.lon), index: i }; });
  const sorted = [...gaps].sort((a, b) => b.size - a.size);
  const largest = sorted[0];
  const span = 360 - largest.size;
  const leading = largest.to; // first planet after the biggest empty arc, in zodiacal order
  // Bucket: all but one within 180°, that one isolated by at least 30° on both sides.
  for (let i = 0; span > 180 && i < n; i++) {
    const rest = core.filter((_, k) => k !== i);
    const rg = rest.map((b, k) => wrap(rest[(k + 1) % (n - 1)].lon - b.lon));
    const restSpan = 360 - Math.max(...rg);
    const before = gaps[(i - 1 + n) % n].size, after = gaps[i].size;
    if (restSpan <= 180 && before >= 30 && after >= 30) {
      const restLead = rest[(rg.indexOf(Math.max(...rg)) + 1) % (n - 1)].id;
      return { type: 'bucket', handle: core[i].id, leading_planet: restLead, span: Math.round(restSpan * 100) / 100 };
    }
  }
  if (span <= 120) return { type: 'bundle', leading_planet: leading, span: round2(span) };
  if (span <= 180) return { type: 'bowl', leading_planet: leading, span: round2(span) };
  if (span <= 240) return { type: 'locomotive', leading_planet: leading, span: round2(span) };
  const big = gaps.filter((g) => g.size >= 60);
  if (big.length === 0) return { type: 'splash', leading_planet: leading, span: round2(span) };
  if (big.length === 2) return { type: 'seesaw', leading_planet: leading, span: round2(span) };
  return { type: 'splay', leading_planet: leading, span: round2(span) };
}
const round2 = (x) => Math.round(x * 100) / 100;

// ---------- dominants ----------
function dominants(bodies, angles, aspects, rule, { hasHouses }) {
  const map = byId(bodies);
  const scores = Object.fromEntries(CORE.map((id) => [id, 0]));
  const reasons = Object.fromEntries(CORE.map((id) => [id, []]));
  const credit = (id, pts, why) => { if (scores[id] === undefined) return; scores[id] += pts; reasons[id].push(why); };
  credit(rule.dispositors.sun, 3, 'rules the Sun sign');
  credit(rule.dispositors.moon, 3, 'rules the Moon sign');
  if (hasHouses && rule.chart_ruler) credit(rule.chart_ruler, 3, 'rules the Ascendant');
  if (hasHouses && angles?.midheaven) credit(rulerOf(angles.midheaven.sign_index, rule.scheme), 2, 'rules the Midheaven');
  for (const [planet, disp] of Object.entries(rule.dispositors)) if (planet !== disp && !['sun', 'moon'].includes(planet)) credit(disp, 1, `disposits ${planet}`);
  for (const id of CORE) {
    const b = map[id];
    if (!b) continue;
    if (hasHouses && [1, 4, 7, 10].includes(b.house)) credit(id, 2, 'angular house');
    if (b.dignity?.domicile) credit(id, 2, 'in domicile');
    if (b.dignity?.exaltation) credit(id, 1, 'exalted');
  }
  for (const a of aspects) {
    if (!a.major) continue;
    const conjAngle = a.type === 'conjunction' && (['ascendant', 'midheaven', 'sun', 'moon'].includes(a.a) || ['ascendant', 'midheaven', 'sun', 'moon'].includes(a.b));
    for (const id of [a.a, a.b]) {
      if (scores[id] === undefined) continue;
      credit(id, 0.5, `${a.type} ${a.a === id ? a.b : a.a}`);
      if (conjAngle && !['sun', 'moon'].includes(id)) credit(id, 1, 'conjunct a luminary or angle');
    }
  }
  const ranked = CORE.map((id) => ({ id, score: round2(scores[id]), reasons: reasons[id] })).sort((a, b) => b.score - a.score);
  return { method: 'ioi.dominants/1', planets: ranked };
}

function retrogrades(bodies) {
  return bodies.filter((b) => b.retrograde).map((b) => b.id);
}

module.exports = { CORE, balances, rulership, patterns, lunarPhase, chartShape, dominants, retrogrades };
