'use strict';
const eph = require('./ephemeris');
const { createApp } = require('./server');

eph.init();
const port = Number(process.env.PORT || 3060);
const host = process.env.HOST || '0.0.0.0';
const server = createApp().listen(port, host, () => {
  process.stdout.write(`ioi-natal-engine listening on ${host}:${port} (swisseph ${eph.version()}, ephe ${eph.EPHE_PATH})\n`);
});
const stop = () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 5000).unref(); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
