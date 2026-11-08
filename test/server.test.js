'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NATAL_API_KEY = 'test-key';
process.env.PUBLIC_COMPUTE = '0';
const { createApp } = require('../src/server');

let server, base;
test.before(async () => {
  server = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

const body = { date: '1979-04-08', time: '14:30', zone: 'America/Mexico_City', latitude: 19.4326, longitude: -99.1332 };
const post = (payload, headers = {}) => fetch(`${base}/v1/chart`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof payload === 'string' ? payload : JSON.stringify(payload) });

test('health, options and the AGPL source notice are served', async () => {
  const h = await (await fetch(`${base}/health`)).json();
  assert.equal(h.ok, true);
  const o = await (await fetch(`${base}/v1/options`)).json();
  assert.ok(o.house_systems.includes('placidus'));
  const home = await (await fetch(`${base}/`)).text();
  assert.match(home, /Affero/);
  assert.match(home, /Swiss Ephemeris/);
  const src = await fetch(`${base}/source`, { redirect: 'manual' });
  assert.equal(src.status, 302);
});

test('rejects without the API key when public compute is off', async () => {
  const r = await post(body);
  assert.equal(r.status, 401);
});

test('computes a chart with the API key', async () => {
  const r = await post(body, { 'x-api-key': 'test-key' });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const c = await r.json();
  assert.equal(c.schema, 'ioi.natal.factors/1');
  assert.equal(c.planets.length > 0, true);
});

test('validation errors are 400 with field paths; unresolvable local times are 422', async () => {
  const bad = await post({ ...body, latitude: 'x' }, { 'x-api-key': 'test-key' });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).issues[0].path, 'latitude');
  const gap = await post({ ...body, date: '2024-03-10', time: '02:30', zone: 'America/New_York' }, { 'x-api-key': 'test-key' });
  assert.equal(gap.status, 422);
  const bogus = await post('{not json', { 'x-api-key': 'test-key' });
  assert.equal(bogus.status, 400);
});
