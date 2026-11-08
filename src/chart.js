'use strict';
// Assembles ChartFactors v1 from the ephemeris and the derivation modules.
const eph = require('./ephemeris');
const Z = require('./zodiac');
const A = require('./aspects');
const AN = require('./analysis');
const { vedicLayer } = require('./vedic');
const { resolveLocal, fromFixedOffset, isValidZone } = require('./time');

const SCHEMA = 'ioi.natal.factors/1';
const PLANETS = ['sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'];
const STATION = { mercury: 0.05, venus: 0.05, mars: 0.03, jupiter: 0.01, saturn: 0.006, uranus: 0.003, neptune: 0.002, pluto: 0.002, chiron: 0.005, ceres: 0.01, pallas: 0.01, juno: 0.01, vesta: 0.01 };

const DEFAULTS = {
  house_system: 'placidus', node: 'true', lilith: 'mean', fortune: 'day_night', rulership: 'modern',
  zodiac: 'tropical', include_minor_aspects: true, include_asteroids: true,
};

class ChartInputError extends Error {
  constructor(message, details) { super(message); this.name = 'ChartInputError'; this.status = 422; this.details = details; }
}

function resolveInstant(input) {
  const unknown = Boolean(input.unknown_time) || !input.time;
  const time = unknown ? '12:00' : input.time;
  let res;
  if (input.zone) {
    if (!isValidZone(input.zone)) throw new ChartInputError(`Unknown time zone: ${input.zone}`);
    res = resolveLocal({ date: input.date, time, zone: input.zone, choice: input.disambiguation });
    if (res.kind === 'ambiguous') throw new ChartInputError('This local time occurred twice (clocks went back). Send disambiguation: "earlier" or "later".', { candidates: res.candidates });
    if (res.kind === 'missing') throw new ChartInputError('This local time did not occur (clocks went forward). Check the birth record.', { suggestion: res.suggestion });
  } else if (Number.isFinite(input.utc_offset_minutes)) {
    res = fromFixedOffset({ date: input.date, time, utc_offset_minutes: input.utc_offset_minutes });
  } else {
    throw new ChartInputError('Provide either an IANA zone or utc_offset_minutes.');
  }
  return { instant: res.instant, utc_offset_minutes: res.utc_offset_minutes, unknown_time: unknown, local_time: time, disambiguation: res.disambiguation || null };
}

function decorate(id, kind, aspect_class, pos, extra = {}) {
  const info = Z.signInfo(pos.longitude);
  return {
    id, label: Z.LABELS[id] || id, kind, aspect_class,
    longitude: round(pos.longitude, 6), latitude: pos.latitude == null ? null : round(pos.latitude, 6),
    declination: pos.declination == null ? null : round(pos.declination, 6),
    right_ascension: pos.right_ascension == null ? null : round(pos.right_ascension, 6),
    distance_au: pos.distance_au == null ? null : round(pos.distance_au, 6),
    speed: pos.speed == null ? null : round(pos.speed, 6),
    retrograde: pos.speed != null ? pos.speed < 0 : false,
    stationary: pos.speed != null && STATION[id] != null ? Math.abs(pos.speed) < STATION[id] : false,
    sign: info.sign, sign_index: info.sign_index, element: info.element, modality: info.modality, polarity: info.polarity,
    sign_degree: info.sign_degree, sign_minute: info.sign_minute, sign_second: info.sign_second,
    degree_text: Z.formatDegree(pos.longitude),
    decan: Z.decanOf(pos.longitude),
    house: null, house_position: null, house_whole_sign: null,
    out_of_bounds: pos.declination != null ? Math.abs(pos.declination) > extra.obliquity : false,
    ...extra.fields,
  };
}
const round = (x, n) => (x == null ? null : Math.round(x * 10 ** n) / 10 ** n);

function declinationFromEcliptic(lon, eps) {
  const r = Math.PI / 180;
  return Math.asin(Math.sin(eps * r) * Math.sin(lon * r)) / r;
}

function computeChart(rawInput) {
  eph.init();
  const settings = { ...DEFAULTS, ...pick(rawInput, Object.keys(DEFAULTS)) };
  const t = resolveInstant(rawInput);
  const jd = eph.julianDay(t.instant);
  const { true_obliquity: eps } = eph.obliquity(jd);
  const lat = rawInput.latitude, lon = rawInput.longitude;
  const unknown = t.unknown_time;

  // ---- raw positions ----
  const raw = {};
  const ids = [...PLANETS, 'mean_node', 'true_node', 'lilith_mean', 'lilith_true', 'chiron'];
  if (settings.include_asteroids) ids.push('ceres', 'pallas', 'juno', 'vesta');
  for (const id of ids) raw[id] = eph.body(jd, id);

  // ---- houses & angles ----
  let H = null, angles = null, cusps = null;
  if (!unknown) {
    H = eph.houses(jd, lat, lon, settings.house_system);
    const angleOf = (id, L) => decorate(id, 'angle', 'point', { longitude: L, declination: declinationFromEcliptic(L, eps) }, { obliquity: eps });
    angles = {
      ascendant: angleOf('ascendant', H.ascendant), midheaven: angleOf('midheaven', H.midheaven),
      descendant: angleOf('descendant', H.ascendant + 180), imum_coeli: angleOf('imum_coeli', H.midheaven + 180),
    };
    cusps = H.cusps.map((L, i) => {
      const info = Z.signInfo(L);
      return { house: i + 1, id: `house_${i + 1}`, longitude: round(L, 6), sign: info.sign, sign_index: info.sign_index, sign_degree: info.sign_degree, sign_minute: info.sign_minute, degree_text: Z.formatDegree(L), ruler: Z.rulerOf(info.sign_index, settings.rulership), ruler_house: null, intercepted_sign: null };
    });
  }
  const isDay = unknown ? true : Z.wrap(raw.sun.longitude - (H.ascendant + 180)) < 180;

  // ---- bodies ----
  const bodies = [];
  for (const id of PLANETS) bodies.push(decorate(id, id === 'sun' || id === 'moon' ? 'luminary' : 'planet', id === 'sun' || id === 'moon' ? 'luminary' : 'planet', raw[id], { obliquity: eps }));
  const nodeSrc = settings.node === 'mean' ? raw.mean_node : raw.true_node;
  bodies.push(decorate('north_node', 'node', 'point', nodeSrc, { obliquity: eps, fields: { node_kind: settings.node } }));
  bodies.push(decorate('south_node', 'node', 'point', { ...nodeSrc, longitude: nodeSrc.longitude + 180, latitude: -nodeSrc.latitude, declination: -nodeSrc.declination, right_ascension: nodeSrc.right_ascension + 180 }, { obliquity: eps, fields: { node_kind: settings.node, aspects: false } }));
  bodies.push(decorate('mean_node', 'node', 'point', raw.mean_node, { obliquity: eps, fields: { aspects: false } }));
  bodies.push(decorate('true_node', 'node', 'point', raw.true_node, { obliquity: eps, fields: { aspects: false } }));
  const lilithSrc = settings.lilith === 'true' ? raw.lilith_true : raw.lilith_mean;
  bodies.push(decorate('lilith', 'point', 'point', lilithSrc, { obliquity: eps, fields: { lilith_kind: settings.lilith } }));
  bodies.push(decorate('lilith_mean', 'point', 'point', raw.lilith_mean, { obliquity: eps, fields: { aspects: false } }));
  bodies.push(decorate('lilith_true', 'point', 'point', raw.lilith_true, { obliquity: eps, fields: { aspects: false } }));
  bodies.push(decorate('chiron', 'asteroid', 'point', raw.chiron, { obliquity: eps }));
  if (settings.include_asteroids) for (const id of ['ceres', 'pallas', 'juno', 'vesta']) bodies.push(decorate(id, 'asteroid', 'point', raw[id], { obliquity: eps }));

  if (!unknown) {
    const fortune = settings.fortune === 'day' || isDay
      ? H.ascendant + raw.moon.longitude - raw.sun.longitude
      : H.ascendant + raw.sun.longitude - raw.moon.longitude;
    const pt = (id, L, extra) => decorate(id, 'point', 'point', { longitude: Z.wrap(L), declination: declinationFromEcliptic(L, eps) }, { obliquity: eps, fields: extra });
    bodies.push(pt('part_of_fortune', fortune, { formula: settings.fortune === 'day' || isDay ? 'day' : 'night', declination_aspects: false }));
    bodies.push(pt('vertex', H.vertex, { declination_aspects: false }));
    bodies.push(pt('anti_vertex', H.vertex + 180, { aspects: false }));
    bodies.push(pt('east_point', H.equatorial_ascendant, { aspects: false }));

    // House placement for every body and the whole-sign house.
    const ascSign = Z.signIndex(H.ascendant);
    for (const b of bodies) {
      const posIn = eph.housePosition(H.armc, lat, eps, H.system_used, b.longitude, b.kind === 'angle' ? 0 : (b.latitude || 0));
      b.house_position = round(posIn, 4);
      b.house = Math.floor(posIn);
      b.house_whole_sign = ((b.sign_index - ascSign + 12) % 12) + 1;
    }
    for (const c of cusps) c.ruler_house = bodies.find((b) => b.id === c.ruler)?.house ?? null;
    // Intercepted and duplicated signs.
    const cuspSigns = cusps.map((c) => c.sign_index);
    const intercepted = [], duplicated = [];
    for (let s = 0; s < 12; s++) {
      const n = cuspSigns.filter((x) => x === s).length;
      if (n === 0) intercepted.push(Z.SIGNS[s]);
      if (n >= 2) duplicated.push(Z.SIGNS[s]);
    }
    for (const c of cusps) {
      const next = cusps[c.house % 12];
      const span = Z.wrap(next.longitude - c.longitude);
      for (let k = 1; k < 12; k++) {
        const s = (c.sign_index + k) % 12;
        if (Z.wrap(s * 30 - c.longitude) < span && Z.wrap(s * 30 + 30 - c.longitude) <= span) { if (intercepted.includes(Z.SIGNS[s])) { c.intercepted_sign = Z.SIGNS[s]; break; } }
      }
    }
    H.intercepted = intercepted; H.duplicated = duplicated;
  }
  for (const b of bodies) b.dignity = ['planet', 'luminary'].includes(b.kind) ? Z.dignityOf(b.id, b.longitude, settings.rulership, isDay) : null;

  // ---- aspects ----
  const aspectSet = [...bodies.filter((b) => b.aspects !== false)];
  if (!unknown) aspectSet.push(angles.ascendant, angles.midheaven);
  for (const b of aspectSet) if (unknown && b.id === 'moon') b.aspects_suppressed = true;
  const skipPair = (a, b) => {
    if (unknown && (a.id === 'moon' || b.id === 'moon')) return true;
    const pointish = (x) => x.aspect_class === 'point';
    const angle = (x) => x.kind === 'angle';
    if (angle(a) && angle(b)) return true;
    if (pointish(a) && pointish(b) && !angle(a) && !angle(b)) return true; // no point-to-point aspects
    return false;
  };
  const aspect_list = A.computeAspects(aspectSet, { includeMinor: settings.include_minor_aspects, skipPair });
  const aspect_grid = A.aspectGrid(aspectSet, aspect_list);
  const aspect_totals = A.aspectTotals(aspect_list);
  const declination_aspects = A.declinationAspects(bodies.filter((b) => ['planet', 'luminary', 'node', 'asteroid'].includes(b.kind) && !(unknown && b.id === 'moon')));

  // ---- analysis ----
  const balancesOut = AN.balances(bodies, angles, { hasHouses: !unknown });
  const rule = AN.rulership(bodies, angles, cusps, settings.rulership);
  const pats = AN.patterns(bodies, aspect_list, { stelliumSet: [...PLANETS, 'chiron', 'north_node'] });
  const phase = AN.lunarPhase(raw.sun, raw.moon, eph.moonPhase(jd), unknown);
  const shape = AN.chartShape(bodies);
  const doms = AN.dominants(bodies, angles, aspect_list, rule, { hasHouses: !unknown });

  // ---- unknown time extras ----
  let unknownOut = null;
  if (unknown) {
    const startInstant = resolveInstant({ ...rawInput, time: '00:00', unknown_time: false }).instant;
    const endInstant = resolveInstant({ ...rawInput, time: '23:59', unknown_time: false }).instant;
    unknownOut = {
      omitted: ['ascendant', 'midheaven', 'houses', 'house_placements', 'vertex', 'part_of_fortune', 'moon_aspects', 'lunar_phase_name', 'tithi', 'dasha_periods'],
      computed_at_local: '12:00',
      moon_range: { start_longitude: round(eph.body(eph.julianDay(startInstant), 'moon').longitude, 4), end_longitude: round(eph.body(eph.julianDay(endInstant), 'moon').longitude, 4) },
    };
  }

  // ---- vedic ----
  const ay = eph.ayanamsa(jd, 'lahiri');
  const vedic = vedicLayer({ tropical: Object.fromEntries([...PLANETS, 'north_node'].map((id) => [id, id === 'north_node' ? nodeSrc : raw[id]])), ascendant: unknown ? null : H.ascendant, ayanamsa: ay, instant: t.instant, unknownTime: unknown });

  // ---- legacy arrays (shape the current IOI wheel reads) ----
  const legacyIds = [...PLANETS, 'north_node', 'chiron', 'lilith'];
  const planets = bodies.filter((b) => legacyIds.includes(b.id)).map((b) => ({ id: b.id, label: b.label, sign: b.sign, degree: b.degree_text, longitude: b.longitude, retrograde: b.retrograde, house: b.house, note: '' }));
  const houses = cusps ? cusps.map((c) => ({ house: c.house, id: c.id, sign: c.sign, degree: c.degree_text, longitude: c.longitude })) : [];
  const legacyAspectIds = new Set([...legacyIds, 'ascendant', 'midheaven']);
  const aspects = aspect_list.filter((a) => a.major && legacyAspectIds.has(a.a) && legacyAspectIds.has(a.b)).map((a) => ({ id: a.id, from: a.a, to: a.b, type: a.type, orb: a.orb_text, value: a.value, applying: a.applying }));

  const strip = (b) => { const { aspects: _a, declination_aspects: _d, aspects_suppressed: _s, ...rest } = b; return rest; };
  return {
    schema: SCHEMA,
    engine: {
      name: 'swisseph', version: eph.version(), ephemeris: 'sepl_18,semo_18,seas_18', service: 'ioi-natal-engine', service_version: require('../package.json').version,
      computed_at: new Date().toISOString(),
      julian_day_ut: round(jd, 8), delta_t_seconds: round(eph.deltaT(jd) * 86400, 3), obliquity: round(eps, 6), ayanamsa_lahiri: round(ay, 6),
      input: {
        date: rawInput.date, time: unknown ? null : t.local_time, unknown_time: unknown, zone: rawInput.zone || null,
        utc_offset_minutes: t.utc_offset_minutes, instant: t.instant, disambiguation: t.disambiguation,
        latitude: lat, longitude: lon, place: rawInput.place || null, city_id: rawInput.city_id ?? null,
        house_system: settings.house_system, house_system_used: H ? H.system_used : null, house_system_fallback: H ? H.fallback : null, house_system_fallback_reason: H ? H.fallback_reason : null,
        node: settings.node, lilith: settings.lilith, fortune: settings.fortune, rulership: settings.rulership, zodiac: 'tropical',
        sect: isDay ? 'day' : 'night',
      },
    },
    planets, houses, aspects,
    bodies: bodies.map(strip),
    angles,
    cusps,
    intercepted_signs: H ? H.intercepted : [],
    duplicated_signs: H ? H.duplicated : [],
    aspect_list, aspect_grid, aspect_totals, declination_aspects,
    balances: balancesOut,
    rulership: rule,
    patterns: pats,
    lunar_phase: phase,
    retrogrades: AN.retrogrades(bodies.filter((b) => ['planet', 'luminary', 'node', 'asteroid'].includes(b.kind) && !['south_node', 'mean_node', 'true_node'].includes(b.id))),
    chart_shape: shape,
    dominants: doms,
    unknown_time: unknownOut,
    vedic,
  };
}

function pick(obj, keys) { const o = {}; for (const k of keys) if (obj[k] !== undefined && obj[k] !== null) o[k] = obj[k]; return o; }

module.exports = { computeChart, ChartInputError, DEFAULTS, SCHEMA, PLANETS };
