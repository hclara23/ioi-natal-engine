'use strict';
// Thin wrapper over the Swiss Ephemeris binding. Everything astronomical that
// the rest of the engine needs comes through here, so the binding is replaceable.

const path = require('path');
const fs = require('fs');
const swe = require('sweph');
const C = swe.constants;
const { instantToUtcParts } = require('./time');

const EPHE_PATH = process.env.EPHE_PATH || path.join(__dirname, '..', 'ephe');
const EPHE_FILES = ['sepl_18.se1', 'semo_18.se1', 'seas_18.se1'];

let initialised = false;
function init() {
  if (initialised) return;
  for (const f of EPHE_FILES) {
    if (!fs.existsSync(path.join(EPHE_PATH, f))) throw new Error(`Ephemeris file missing: ${path.join(EPHE_PATH, f)}`);
  }
  swe.set_ephe_path(EPHE_PATH);
  // Fail fast if the files are unreadable: Sun must come from the Swiss files, not Moshier.
  const probe = swe.calc_ut(2451545.0, C.SE_SUN, C.SEFLG_SWIEPH);
  if (!(probe.flag & C.SEFLG_SWIEPH) || /not found/i.test(probe.error || '')) {
    throw new Error(`Swiss Ephemeris files not usable at ${EPHE_PATH}: ${probe.error}`);
  }
  initialised = true;
}

const BASE = C.SEFLG_SWIEPH | C.SEFLG_SPEED;

const BODY_CODES = {
  sun: C.SE_SUN, moon: C.SE_MOON, mercury: C.SE_MERCURY, venus: C.SE_VENUS, mars: C.SE_MARS,
  jupiter: C.SE_JUPITER, saturn: C.SE_SATURN, uranus: C.SE_URANUS, neptune: C.SE_NEPTUNE, pluto: C.SE_PLUTO,
  mean_node: C.SE_MEAN_NODE, true_node: C.SE_TRUE_NODE,
  lilith_mean: C.SE_MEAN_APOG, lilith_true: C.SE_OSCU_APOG,
  chiron: C.SE_CHIRON, ceres: C.SE_CERES, pallas: C.SE_PALLAS, juno: C.SE_JUNO, vesta: C.SE_VESTA,
};

const HOUSE_CODES = {
  placidus: 'P', koch: 'K', porphyry: 'O', equal: 'E', whole_sign: 'W',
  alcabitius: 'B', regiomontanus: 'R', campanus: 'C',
};

function julianDay(instant) {
  const p = instantToUtcParts(instant);
  return swe.julday(p.year, p.month, p.day, p.hours, C.SE_GREG_CAL);
}

function version() { return swe.version(); }

function obliquity(jd) {
  const r = swe.calc_ut(jd, C.SE_ECL_NUT, 0);
  return { true_obliquity: r.data[0], mean_obliquity: r.data[1] };
}

/** Geocentric apparent ecliptic position plus equatorial coordinates. */
function body(jd, id, { sidereal = false } = {}) {
  const code = BODY_CODES[id];
  if (code === undefined) throw new Error(`Unknown body ${id}`);
  const flags = BASE | (sidereal ? C.SEFLG_SIDEREAL : 0);
  const ecl = swe.calc_ut(jd, code, flags);
  if (ecl.flag < 0) throw new Error(`Ephemeris error for ${id}: ${ecl.error}`);
  const eq = swe.calc_ut(jd, code, BASE | C.SEFLG_EQUATORIAL);
  return {
    longitude: ecl.data[0], latitude: ecl.data[1], distance_au: ecl.data[2],
    speed: ecl.data[3], speed_latitude: ecl.data[4], speed_distance: ecl.data[5],
    right_ascension: eq.data[0], declination: eq.data[1], speed_declination: eq.data[4],
  };
}

/** Phase data for the Moon: [phase angle, illuminated fraction, elongation]. */
function moonPhase(jd) {
  const r = swe.pheno_ut(jd, C.SE_MOON, C.SEFLG_SWIEPH);
  return { phase_angle: r.data[0], illumination: r.data[1], elongation: r.data[2] };
}

/**
 * House cusps and angles. Swiss Ephemeris switches Placidus/Koch to Porphyry
 * inside the polar circles and reports it with flag -1; we surface that as
 * `fallback`.
 */
function houses(jd, latitude, longitude, system) {
  const code = HOUSE_CODES[system];
  if (!code) throw new Error(`Unknown house system ${system}`);
  const r = swe.houses_ex2(jd, 0, latitude, longitude, code);
  const fallback = r.flag < 0 && /porphyry/i.test(r.error || '') ? 'porphyry' : null;
  if (r.flag < 0 && !fallback) throw new Error(`House calculation failed: ${r.error}`);
  const [asc, mc, armc, vertex, equatorial_ascendant, co_ascendant_koch, co_ascendant_munkasey, polar_ascendant] = r.data.points;
  return {
    system, system_used: fallback || system, fallback,
    fallback_reason: fallback ? (r.error || '').trim() : null,
    cusps: r.data.houses.slice(0, 12), cusp_speeds: r.data.housesSpeed ? r.data.housesSpeed.slice(0, 12) : null,
    ascendant: asc, midheaven: mc, armc, vertex, equatorial_ascendant, co_ascendant_koch, co_ascendant_munkasey, polar_ascendant,
  };
}

/** Fractional house position (1.0 .. 12.999) of an ecliptic point. */
function housePosition(armc, latitude, eps, system, lon, lat = 0) {
  const code = HOUSE_CODES[system];
  const r = swe.house_pos(armc, latitude, eps, code, [lon, lat]);
  if (r.error) throw new Error(`house_pos failed: ${r.error}`);
  return r.data;
}

function ayanamsa(jd, mode = 'lahiri') {
  const modes = { lahiri: C.SE_SIDM_LAHIRI, raman: C.SE_SIDM_RAMAN, krishnamurti: C.SE_SIDM_KRISHNAMURTI, fagan_bradley: C.SE_SIDM_FAGAN_BRADLEY };
  swe.set_sid_mode(modes[mode] ?? C.SE_SIDM_LAHIRI, 0, 0);
  const r = swe.get_ayanamsa_ex_ut(jd, C.SEFLG_SWIEPH);
  return r.data;
}

function deltaT(jd) { return swe.deltat(jd); }

module.exports = { init, version, julianDay, obliquity, body, moonPhase, houses, housePosition, ayanamsa, deltaT, BODY_CODES, HOUSE_CODES, EPHE_PATH, EPHE_FILES };
