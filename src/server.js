'use strict';
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { chartRequest } = require('./schema');
const { computeChart, ChartInputError, DEFAULTS } = require('./chart');
const { DEFAULT_ORBS, ASPECTS } = require('./aspects');
const eph = require('./ephemeris');
const pkg = require('../package.json');

const SOURCE_URL = process.env.SOURCE_URL || 'https://github.com/hclara23/ioi-natal-engine';
const API_KEY = process.env.NATAL_API_KEY || '';
const PUBLIC_COMPUTE = process.env.PUBLIC_COMPUTE === '1';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);

function timingSafeEqual(a, b) {
  const crypto = require('crypto');
  const ba = Buffer.from(String(a)), bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);
  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"] } } }));

  // Access log: method, path, status, duration. Never the body, never the query.
  app.use((req, res, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      if (req.path === '/health') return;
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      process.stdout.write(`${new Date().toISOString()} ${req.method} ${req.path} ${res.statusCode} ${ms.toFixed(1)}ms\n`);
    });
    next();
  });

  // CORS for the public tool, if any origin is configured.
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Vary', 'Origin');
      res.set('Access-Control-Allow-Headers', 'Content-Type, X-Api-Key');
      res.set('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
      res.set('Access-Control-Max-Age', '600');
    }
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });

  app.use(express.json({ limit: '16kb' }));

  app.get('/health', (req, res) => res.json({ ok: true, service: pkg.name, version: pkg.version, ephemeris: eph.version() }));

  // AGPL section 13: anyone interacting with this service over a network must be
  // offered its complete corresponding source.
  app.get('/', (req, res) => {
    res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${pkg.name}</title>
<style>body{font:16px/1.6 system-ui,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1rem;color:#222}code{background:#f3f3f3;padding:.1rem .3rem}</style></head><body>
<h1>${pkg.name} <small>v${pkg.version}</small></h1>
<p>A natal chart calculation service: birth date, time and place in; planetary positions, house cusps, aspects and classifications out. No interpretation, no storage, no logging of request bodies.</p>
<p>Free software under the <a href="https://www.gnu.org/licenses/agpl-3.0.html">GNU Affero General Public License v3</a>. Complete corresponding source: <a href="${SOURCE_URL}">${SOURCE_URL}</a>.</p>
<p>Astronomical calculations by the <a href="https://www.astro.com/swisseph/">Swiss Ephemeris</a> (Astrodienst AG), version ${eph.version()}, also under the AGPL.</p>
<h2>API</h2>
<ul><li><code>GET /v1/options</code> – supported house systems, bodies, orbs and defaults</li>
<li><code>POST /v1/chart</code> – JSON body, see <code>/v1/options</code> for fields${API_KEY && !PUBLIC_COMPUTE ? ' (requires <code>X-Api-Key</code>)' : ''}</li>
<li><code>GET /health</code></li></ul>
</body></html>`);
  });
  app.get('/source', (req, res) => res.redirect(302, SOURCE_URL));

  app.get('/v1/options', (req, res) => {
    res.json({
      schema: 'ioi.natal.factors/1',
      defaults: DEFAULTS,
      house_systems: Object.keys(eph.HOUSE_CODES),
      bodies: ['sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto', 'north_node', 'south_node', 'mean_node', 'true_node', 'lilith', 'lilith_mean', 'lilith_true', 'chiron', 'ceres', 'pallas', 'juno', 'vesta', 'part_of_fortune', 'vertex', 'anti_vertex', 'east_point'],
      angles: ['ascendant', 'midheaven', 'descendant', 'imum_coeli'],
      aspects: ASPECTS.map(({ type, angle, major }) => ({ type, angle, major })),
      orbs: DEFAULT_ORBS,
      date_range: { min: '1800-01-01', max: '2399-12-31' },
      request_fields: ['date', 'time', 'unknown_time', 'zone', 'utc_offset_minutes', 'disambiguation', 'latitude', 'longitude', 'place', 'city_id', 'house_system', 'node', 'lilith', 'fortune', 'rulership', 'include_minor_aspects', 'include_asteroids'],
      engine: { name: 'swisseph', version: eph.version(), ephemeris: eph.EPHE_FILES },
      source: SOURCE_URL,
    });
  });

  const limiter = rateLimit({
    windowMs: 60 * 1000, limit: Number(process.env.RATE_LIMIT_PER_MINUTE || 60),
    standardHeaders: 'draft-7', legacyHeaders: false,
    skip: (req) => Boolean(API_KEY) && req.get('x-api-key') != null && timingSafeEqual(req.get('x-api-key'), API_KEY),
  });

  const auth = (req, res, next) => {
    if (!API_KEY) return next();                          // no key configured: open (dev)
    const presented = req.get('x-api-key');
    if (presented && timingSafeEqual(presented, API_KEY)) return next();
    if (PUBLIC_COMPUTE) return next();                     // public tool: allowed, rate-limited
    return res.status(401).json({ error: 'unauthorized' });
  };

  app.post('/v1/chart', limiter, auth, (req, res) => {
    const parsed = chartRequest.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_request', issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    }
    try {
      const chart = computeChart(parsed.data);
      res.set('Cache-Control', 'no-store');
      return res.json(chart);
    } catch (err) {
      if (err instanceof ChartInputError) return res.status(err.status).json({ error: 'unresolvable_input', message: err.message, ...(err.details || {}) });
      process.stderr.write(`chart error: ${err.stack || err}\n`);
      return res.status(500).json({ error: 'calculation_failed' });
    }
  });

  app.use((req, res) => res.status(404).json({ error: 'not_found' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid_json' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'payload_too_large' });
    process.stderr.write(`unhandled: ${err.stack || err}\n`);
    res.status(500).json({ error: 'internal' });
  });
  return app;
}

module.exports = { createApp };
