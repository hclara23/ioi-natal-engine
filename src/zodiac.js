'use strict';
// Zodiac reference tables. Pure data and arithmetic, no interpretation.

const SIGNS = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
  'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'];

const ELEMENTS = ['fire', 'earth', 'air', 'water'];       // index % 4
const MODALITIES = ['cardinal', 'fixed', 'mutable'];      // index % 3
const POLARITIES = ['masculine', 'feminine'];             // index % 2

const MODERN_RULERS = ['mars', 'venus', 'mercury', 'moon', 'sun', 'mercury',
  'venus', 'pluto', 'jupiter', 'saturn', 'uranus', 'neptune'];
const TRADITIONAL_RULERS = ['mars', 'venus', 'mercury', 'moon', 'sun', 'mercury',
  'venus', 'mars', 'jupiter', 'saturn', 'saturn', 'jupiter'];

// Exaltations by sign index (classical, with the outer-planet conventions used
// by most modern software kept out: only the seven plus the nodes are classical).
const EXALTATION = { sun: 0, moon: 1, mercury: 5, venus: 11, mars: 9, jupiter: 3, saturn: 6, north_node: 2, south_node: 8 };

// Dorothean triplicity rulers [day, night, participating]
const TRIPLICITY = {
  fire: ['sun', 'jupiter', 'saturn'],
  earth: ['venus', 'moon', 'mars'],
  air: ['saturn', 'mercury', 'jupiter'],
  water: ['venus', 'mars', 'moon'],
};

// Egyptian terms (bounds): [ruler, upper degree bound) per sign, in order.
const TERMS = [
  [['jupiter', 6], ['venus', 12], ['mercury', 20], ['mars', 25], ['saturn', 30]],
  [['venus', 8], ['mercury', 14], ['jupiter', 22], ['saturn', 27], ['mars', 30]],
  [['mercury', 6], ['jupiter', 12], ['venus', 17], ['mars', 24], ['saturn', 30]],
  [['mars', 7], ['venus', 13], ['mercury', 19], ['jupiter', 26], ['saturn', 30]],
  [['jupiter', 6], ['venus', 11], ['saturn', 18], ['mercury', 24], ['mars', 30]],
  [['mercury', 7], ['venus', 17], ['jupiter', 21], ['mars', 28], ['saturn', 30]],
  [['saturn', 6], ['mercury', 14], ['jupiter', 21], ['venus', 28], ['mars', 30]],
  [['mars', 7], ['venus', 11], ['mercury', 19], ['jupiter', 24], ['saturn', 30]],
  [['jupiter', 12], ['venus', 17], ['mercury', 21], ['saturn', 26], ['mars', 30]],
  [['mercury', 7], ['jupiter', 14], ['venus', 22], ['saturn', 26], ['mars', 30]],
  [['mercury', 7], ['venus', 13], ['jupiter', 20], ['mars', 25], ['saturn', 30]],
  [['venus', 12], ['jupiter', 16], ['mercury', 19], ['mars', 28], ['saturn', 30]],
];

// Chaldean decan (face) rulers: Mars, Sun, Venus, Mercury, Moon, Saturn, Jupiter,
// cycling from Aries' first decan.
const CHALDEAN = ['mars', 'sun', 'venus', 'mercury', 'moon', 'saturn', 'jupiter'];

const LABELS = {
  sun: 'Sun', moon: 'Moon', mercury: 'Mercury', venus: 'Venus', mars: 'Mars',
  jupiter: 'Jupiter', saturn: 'Saturn', uranus: 'Uranus', neptune: 'Neptune', pluto: 'Pluto',
  north_node: 'North Node', south_node: 'South Node', mean_node: 'Mean Node', mean_south_node: 'Mean South Node',
  lilith_mean: 'Black Moon Lilith', lilith_true: 'True Lilith',
  chiron: 'Chiron', ceres: 'Ceres', pallas: 'Pallas', juno: 'Juno', vesta: 'Vesta',
  part_of_fortune: 'Part of Fortune', vertex: 'Vertex', anti_vertex: 'Anti-Vertex', east_point: 'East Point',
  ascendant: 'Ascendant', midheaven: 'Midheaven', descendant: 'Descendant', imum_coeli: 'Imum Coeli',
};

const wrap = (deg) => ((deg % 360) + 360) % 360;

function signIndex(longitude) { return Math.floor(wrap(longitude) / 30) % 12; }

function splitDegrees(longitude) {
  const lon = wrap(longitude);
  const inSign = lon - Math.floor(lon / 30) * 30;
  let deg = Math.floor(inSign);
  let totalSeconds = Math.round((inSign - deg) * 3600);
  let min = Math.floor(totalSeconds / 60);
  let sec = totalSeconds - min * 60;
  if (min === 60) { min = 0; deg += 1; }
  return { sign_degree: deg, sign_minute: min, sign_second: sec };
}

function formatDegree(longitude) {
  const { sign_degree, sign_minute } = splitDegrees(longitude);
  return `${sign_degree}°${String(sign_minute).padStart(2, '0')}'`;
}

function formatOrb(orb) {
  const total = Math.round(Math.abs(orb) * 60);
  const d = Math.floor(total / 60);
  const m = total - d * 60;
  return `${d}°${String(m).padStart(2, '0')}'`;
}

function signInfo(longitude) {
  const i = signIndex(longitude);
  return {
    sign: SIGNS[i],
    sign_index: i,
    element: ELEMENTS[i % 4],
    modality: MODALITIES[i % 3],
    polarity: POLARITIES[i % 2],
    ...splitDegrees(longitude),
  };
}

function rulerOf(signIdx, scheme = 'modern') {
  return (scheme === 'traditional' ? TRADITIONAL_RULERS : MODERN_RULERS)[signIdx];
}

function decanOf(longitude) {
  const i = signIndex(longitude);
  const inSign = wrap(longitude) - i * 30;
  const index = Math.min(2, Math.floor(inSign / 10));
  const chaldean = CHALDEAN[(i * 3 + index) % 7];
  // Triplicity decans: the sign's own ruler, then the next two signs of its element.
  const triplicity = TRADITIONAL_RULERS[(i + index * 4) % 12];
  return { index: index + 1, ruler_chaldean: chaldean, ruler_triplicity: triplicity };
}

function termOf(longitude) {
  const i = signIndex(longitude);
  const inSign = wrap(longitude) - i * 30;
  for (const [ruler, upper] of TERMS[i]) if (inSign < upper) return ruler;
  return TERMS[i][4][0];
}

function dignityOf(bodyId, longitude, scheme, isDay) {
  const i = signIndex(longitude);
  const info = signInfo(longitude);
  const out = {
    domicile: rulerOf(i, scheme) === bodyId,
    detriment: rulerOf((i + 6) % 12, scheme) === bodyId,
    exaltation: EXALTATION[bodyId] === i,
    fall: EXALTATION[bodyId] !== undefined && (EXALTATION[bodyId] + 6) % 12 === i,
    triplicity: false,
    term: termOf(longitude) === bodyId,
    face: decanOf(longitude).ruler_chaldean === bodyId,
    peregrine: false,
    essential: 'none',
  };
  const trip = TRIPLICITY[info.element];
  out.triplicity = trip[isDay ? 0 : 1] === bodyId || trip[2] === bodyId;
  if (out.domicile) out.essential = 'domicile';
  else if (out.exaltation) out.essential = 'exaltation';
  else if (out.detriment) out.essential = 'detriment';
  else if (out.fall) out.essential = 'fall';
  out.peregrine = !(out.domicile || out.exaltation || out.triplicity || out.term || out.face);
  return out;
}

module.exports = {
  SIGNS, ELEMENTS, MODALITIES, POLARITIES, MODERN_RULERS, TRADITIONAL_RULERS, EXALTATION, TRIPLICITY, LABELS,
  wrap, signIndex, signInfo, splitDegrees, formatDegree, formatOrb, rulerOf, decanOf, termOf, dignityOf,
};
