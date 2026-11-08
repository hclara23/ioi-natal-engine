'use strict';
// Sidereal (Lahiri) layer: rasi, nakshatra, navamsa, whole-sign bhava from the
// lagna, tithi, and first-level Vimshottari periods. Labels only.
const { SIGNS, wrap } = require('./zodiac');

const NAKSHATRAS = ['Ashwini', 'Bharani', 'Krittika', 'Rohini', 'Mrigashira', 'Ardra', 'Punarvasu', 'Pushya', 'Ashlesha',
  'Magha', 'Purva Phalguni', 'Uttara Phalguni', 'Hasta', 'Chitra', 'Swati', 'Vishakha', 'Anuradha', 'Jyeshtha',
  'Mula', 'Purva Ashadha', 'Uttara Ashadha', 'Shravana', 'Dhanishta', 'Shatabhisha', 'Purva Bhadrapada', 'Uttara Bhadrapada', 'Revati'];
const DASHA_ORDER = ['ketu', 'venus', 'sun', 'moon', 'mars', 'rahu', 'jupiter', 'saturn', 'mercury'];
const DASHA_YEARS = { ketu: 7, venus: 20, sun: 6, moon: 10, mars: 7, rahu: 18, jupiter: 16, saturn: 19, mercury: 17 };
const YEAR_MS = 365.25 * 86400000;
const SPAN = 360 / 27;
const OWN = { sun: [4], moon: [3], mercury: [2, 5], venus: [1, 6], mars: [0, 7], jupiter: [8, 11], saturn: [9, 10] };
const EXALT = { sun: 0, moon: 1, mercury: 5, venus: 11, mars: 9, jupiter: 3, saturn: 6 };

function nakshatraAt(lon) {
  const l = wrap(lon);
  const index = Math.floor(l / SPAN);
  const within = l - index * SPAN;
  return { index: index + 1, name: NAKSHATRAS[index], pada: Math.floor(within / (SPAN / 4)) + 1, ruler: DASHA_ORDER[index % 9], fraction: within / SPAN };
}
function navamsaAt(lon) { return SIGNS[Math.floor(wrap(lon) * 9 / 30) % 12]; }
function dignity(body, signIdx) {
  if (!(body in EXALT)) return null;
  if (signIdx === EXALT[body]) return 'exaltation';
  if (signIdx === (EXALT[body] + 6) % 12) return 'debilitation';
  if (OWN[body].includes(signIdx)) return 'own_sign';
  return null;
}
function vimshottari(moonLon, instant) {
  const n = nakshatraAt(moonLon);
  const first = DASHA_ORDER.indexOf(n.ruler);
  const birth = new Date(instant).getTime();
  let start = birth - n.fraction * DASHA_YEARS[n.ruler] * YEAR_MS;
  return Array.from({ length: 9 }, (_, i) => {
    const ruler = DASHA_ORDER[(first + i) % 9];
    const end = start + DASHA_YEARS[ruler] * YEAR_MS;
    const p = { ruler, start: new Date(start).toISOString(), end: new Date(end).toISOString(), years: DASHA_YEARS[ruler], remaining_at_birth_years: i === 0 ? Math.round((end - birth) / YEAR_MS * 100) / 100 : null };
    start = end; return p;
  });
}

/**
 * tropical: map of id -> { longitude, speed } for sun..saturn and north_node
 * ascendant: tropical longitude or null
 */
function vedicLayer({ tropical, ascendant, ayanamsa, instant, unknownTime }) {
  const sid = (lon) => wrap(lon - ayanamsa);
  const lagnaLon = ascendant == null ? null : sid(ascendant);
  const lagnaSign = lagnaLon == null ? null : Math.floor(lagnaLon / 30);
  const entries = ['sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn'].map((id) => [id, tropical[id]]);
  entries.push(['rahu', tropical.north_node], ['ketu', { longitude: tropical.north_node.longitude + 180, speed: tropical.north_node.speed }]);
  const planets = entries.map(([id, p]) => {
    const lon = sid(p.longitude);
    const s = Math.floor(lon / 30);
    const uncertain = unknownTime && id === 'moon';
    return {
      id, longitude: Math.round(lon * 10000) / 10000, sign: SIGNS[s], sign_index: s, sign_degree: Math.floor(lon - s * 30),
      retrograde: p.speed < 0, house: lagnaSign == null ? null : ((s - lagnaSign + 12) % 12) + 1,
      nakshatra: uncertain ? null : (({ fraction, ...rest }) => rest)(nakshatraAt(lon)),
      navamsa: uncertain ? null : navamsaAt(lon),
      dignity: dignity(id, s), uncertain,
    };
  });
  const moon = planets.find((p) => p.id === 'moon'), sun = planets.find((p) => p.id === 'sun');
  const elong = wrap(moon.longitude - sun.longitude);
  const tithi = Math.floor(elong / 12) + 1;
  return {
    ayanamsa_mode: 'lahiri', ayanamsa: Math.round(ayanamsa * 10000) / 10000,
    lagna: lagnaLon == null ? null : { longitude: Math.round(lagnaLon * 10000) / 10000, sign: SIGNS[lagnaSign], nakshatra: (({ fraction, ...rest }) => rest)(nakshatraAt(lagnaLon)) },
    planets,
    tithi: unknownTime ? null : { number: tithi, paksha: tithi <= 15 ? 'shukla' : 'krishna', within_paksha: ((tithi - 1) % 15) + 1 },
    moon_nakshatra: unknownTime ? null : moon.nakshatra,
    periods: unknownTime ? [] : vimshottari(sid(tropical.moon.longitude), instant),
    sign_changes: planets.filter((p) => p.id !== 'rahu' && p.id !== 'ketu').map((p) => ({ id: p.id, tropical: SIGNS[Math.floor(wrap(tropical[p.id].longitude) / 30)], sidereal: p.sign })).filter((c) => c.tropical !== c.sidereal),
  };
}

module.exports = { vedicLayer, nakshatraAt, navamsaAt, NAKSHATRAS };
