'use strict';
// Local wall time + IANA zone -> UTC instant, with DST gap/overlap detection.
// Uses Intl only; no polyfill. Node ships full ICU, so any IANA zone resolves.

const fmtCache = new Map();
function formatter(zone) {
  let f = fmtCache.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    fmtCache.set(zone, f);
  }
  return f;
}

function isValidZone(zone) {
  if (typeof zone !== 'string' || !zone) return false;
  try { formatter(zone); return true; } catch { return false; }
}

// Offset (ms, local - UTC) in `zone` at the UTC instant `utcMs`.
function offsetAt(zone, utcMs) {
  const parts = formatter(zone).formatToParts(new Date(utcMs));
  const v = {};
  for (const p of parts) if (p.type !== 'literal') v[p.type] = Number(p.value);
  const asUtc = Date.UTC(v.year, v.month - 1, v.day, v.hour === 24 ? 0 : v.hour, v.minute, v.second);
  // Date.UTC two-digit-year quirk cannot bite: Intl returns 4-digit years >= 1000 for our range.
  return asUtc - (utcMs - (utcMs % 1000));
}

/**
 * Resolve a local date/time in an IANA zone.
 * Returns { kind: 'resolved', instant, utc_offset_minutes }
 *      or { kind: 'ambiguous', candidates: [{instant, utc_offset_minutes}, ...] }
 *      or { kind: 'missing', suggestion: {instant, utc_offset_minutes} }.
 * `choice` = 'earlier' | 'later' picks a candidate when ambiguous.
 */
function resolveLocal({ date, time, zone, choice }) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const localAsUtc = Date.UTC(y, m - 1, d, hh, mm, 0);
  const DAY = 86400000;
  const guesses = new Set([offsetAt(zone, localAsUtc - DAY), offsetAt(zone, localAsUtc + DAY), offsetAt(zone, localAsUtc)]);
  const valid = [];
  for (const off of guesses) {
    const cand = localAsUtc - off;
    if (offsetAt(zone, cand) === off) valid.push(cand);
  }
  const uniq = [...new Set(valid)].sort((a, b) => a - b);
  const pack = (ms) => ({ instant: new Date(ms).toISOString(), utc_offset_minutes: offsetAt(zone, ms) / 60000 });
  if (uniq.length === 1) return { kind: 'resolved', ...pack(uniq[0]) };
  if (uniq.length > 1) {
    if (choice === 'earlier') return { kind: 'resolved', ...pack(uniq[0]), disambiguation: 'earlier' };
    if (choice === 'later') return { kind: 'resolved', ...pack(uniq[uniq.length - 1]), disambiguation: 'later' };
    return { kind: 'ambiguous', candidates: uniq.map(pack) };
  }
  // Gap: the wall time never happened. Suggest the instant using the pre-transition offset.
  const before = offsetAt(zone, localAsUtc - DAY);
  return { kind: 'missing', suggestion: pack(localAsUtc - before) };
}

function fromFixedOffset({ date, time, utc_offset_minutes }) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const ms = Date.UTC(y, m - 1, d, hh, mm, 0) - utc_offset_minutes * 60000;
  return { kind: 'resolved', instant: new Date(ms).toISOString(), utc_offset_minutes };
}

// Decimal UT hours and civil date for Swiss Ephemeris julday().
function instantToUtcParts(instant) {
  const dt = new Date(instant);
  return {
    year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate(),
    hours: dt.getUTCHours() + dt.getUTCMinutes() / 60 + dt.getUTCSeconds() / 3600 + dt.getUTCMilliseconds() / 3600000,
  };
}

module.exports = { isValidZone, offsetAt, resolveLocal, fromFixedOffset, instantToUtcParts };
