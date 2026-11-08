'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveLocal, fromFixedOffset, isValidZone } = require('../src/time');

test('resolves an ordinary local time to UTC with the zone offset', () => {
  const r = resolveLocal({ date: '1979-04-08', time: '14:30', zone: 'America/Mexico_City' });
  assert.equal(r.kind, 'resolved');
  assert.equal(r.instant, '1979-04-08T20:30:00.000Z');
  assert.equal(r.utc_offset_minutes, -360);
});

test('detects a spring-forward gap', () => {
  const r = resolveLocal({ date: '2024-03-10', time: '02:30', zone: 'America/New_York' });
  assert.equal(r.kind, 'missing');
  assert.equal(r.suggestion.instant, '2024-03-10T07:30:00.000Z');
});

test('detects a fall-back overlap and honours the disambiguation choice', () => {
  const amb = resolveLocal({ date: '2024-11-03', time: '01:30', zone: 'America/New_York' });
  assert.equal(amb.kind, 'ambiguous');
  assert.equal(amb.candidates.length, 2);
  assert.equal(resolveLocal({ date: '2024-11-03', time: '01:30', zone: 'America/New_York', choice: 'earlier' }).instant, '2024-11-03T05:30:00.000Z');
  assert.equal(resolveLocal({ date: '2024-11-03', time: '01:30', zone: 'America/New_York', choice: 'later' }).instant, '2024-11-03T06:30:00.000Z');
});

test('handles historical offsets and a fixed offset', () => {
  // Local Mean Time era: Intl carries the tz database's LMT offsets.
  const r = resolveLocal({ date: '1850-06-01', time: '12:00', zone: 'Europe/London' });
  assert.equal(r.kind, 'resolved');
  assert.ok(Math.abs(r.utc_offset_minutes) < 2);
  const f = fromFixedOffset({ date: '1950-02-01', time: '06:00', utc_offset_minutes: 330 });
  assert.equal(f.instant, '1950-02-01T00:30:00.000Z');
});

test('validates zones', () => {
  assert.equal(isValidZone('Asia/Kolkata'), true);
  assert.equal(isValidZone('Mars/Olympus'), false);
  assert.equal(isValidZone(''), false);
});
