# ioi-natal-engine

A small HTTP service that turns a birth date, time and place into natal chart
factors: planetary positions, house cusps, angles, aspects with orbs and
weights, element and modality balances, dignities, dispositors, patterns,
chart shape and a sidereal (Lahiri) layer. It returns numbers and labels only.
It stores nothing, logs no request bodies, and carries no interpretive text.

Astronomy is by the [Swiss Ephemeris](https://www.astro.com/swisseph/)
(Astrodienst AG) through the [`sweph`](https://github.com/timotejroiko/sweph)
Node binding, with the 1800–2400 ephemeris files bundled in `ephe/`.

## License

GNU Affero General Public License v3.0 or later. See `LICENSE`.

The Swiss Ephemeris and its data files are also distributed under the AGPL.
Because this program is used over a network, section 13 of the AGPL applies:
every running instance must offer its complete corresponding source to its
users. The service does this itself: `GET /` shows the notice and links to
`SOURCE_URL`, and `GET /source` redirects there. If you modify this program,
publish your modified source and point `SOURCE_URL` at it.

Keep interpretive content out of this repository. Anything added here becomes
part of an AGPL program. Clients that merely call the HTTP API are separate
works and are not affected.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness; reports the Swiss Ephemeris version |
| `GET` | `/v1/options` | House systems, bodies, aspects, orb table, defaults, date range |
| `POST` | `/v1/chart` | Compute a chart. JSON in, `ioi.natal.factors/1` JSON out |
| `GET` | `/` | AGPL source notice (human readable) |
| `GET` | `/source` | 302 to the source repository |

### Request

```json
{
  "date": "1979-04-08",
  "time": "14:30",
  "unknown_time": false,
  "zone": "America/Mexico_City",
  "latitude": 19.4326,
  "longitude": -99.1332,
  "place": "Mexico City",
  "house_system": "placidus",
  "node": "true",
  "lilith": "mean",
  "fortune": "day_night",
  "rulership": "modern"
}
```

- `zone` is an IANA name. Alternatively send `utc_offset_minutes`.
- `unknown_time: true` computes at local noon and omits the Ascendant, Midheaven,
  houses, house placements, Vertex, Part of Fortune, Moon aspects, tithi and
  dasha periods. `unknown_time.moon_range` gives the Moon's span over the day.
- If the local time falls in a DST gap the response is `422` with a
  `suggestion`; if it occurred twice, `422` with `candidates`, and you resend
  with `disambiguation: "earlier" | "later"`.
- House systems: `placidus` (default), `koch`, `porphyry`, `equal`,
  `whole_sign`, `alcabitius`, `regiomontanus`, `campanus`. Placidus and Koch
  fall back to Porphyry inside the polar circles; the response says so in
  `engine.input.house_system_fallback`.
- Dates 1800-01-01 to 2399-12-31.

### Response

`schema: "ioi.natal.factors/1"`. Top level keys:

`engine` (versions, Julian day, ΔT, obliquity, ayanamsa, and an echo of the
resolved input), `planets` / `houses` / `aspects` (compact legacy arrays),
`bodies`, `angles`, `cusps`, `intercepted_signs`, `duplicated_signs`,
`aspect_list`, `aspect_grid`, `aspect_totals`, `declination_aspects`,
`balances`, `rulership`, `patterns`, `lunar_phase`, `retrogrades`,
`chart_shape`, `dominants`, `unknown_time`, `vedic`.

Identifiers are lowercase snake case (`sun`, `north_node`, `part_of_fortune`),
houses are `house_N`, aspects are `a-b-type` with bodies in `aspect_grid.order`.

### Calculation rules

- Geocentric, tropical, apparent positions, true equinox of date.
- Orbs by the higher class of the pair (luminary > planet > point); see
  `/v1/options`. Minor aspects and asteroids are on by default and can be
  turned off per request.
- Aspect value: `sign × base × weight(a) × weight(b) × (1 − orb / max_orb)`.
  Trines, sextiles and quintiles are positive; squares, oppositions, quincunxes
  and the semi-aspects negative; conjunctions positive unless Mars, Saturn,
  Uranus, Neptune or Pluto is involved. Weights: Sun, Moon 1.5; Mercury, Venus,
  Mars 1.2; Jupiter, Saturn 1.0; outer planets 0.8; points 0.6.
- Applying/separating from the actual daily speeds; `exact_in_days` is signed.
- Part of Fortune: day `Asc + Moon − Sun`, night `Asc + Sun − Moon`; the Sun
  is a day Sun when it is above the horizon. `fortune: "day"` forces the day formula.
- Balances count Sun through Pluto; a weighted variant adds the Ascendant.
- Dignities: domicile and detriment by the chosen rulership scheme,
  exaltation and fall, Dorothean triplicities by sect, Egyptian terms,
  Chaldean faces.
- Sidereal layer uses the Lahiri ayanamsa.

## Authentication and exposure

- `NATAL_API_KEY` set: `POST /v1/chart` requires `X-Api-Key`. Requests that
  present the key are not rate limited.
- `PUBLIC_COMPUTE=1`: requests without a key are accepted but rate limited
  (`RATE_LIMIT_PER_MINUTE`, per client IP). `ALLOWED_ORIGINS` enables CORS for
  a browser tool. `TRUST_PROXY` tells Express how many proxy hops to trust.
- The access log records method, path, status and duration only.

## Run

```bash
npm ci
npm test            # 24 tests, including the pyswisseph Placidus fixtures
npm start           # http://127.0.0.1:3060
```

Docker:

```bash
cp .env.example .env   # set NATAL_API_KEY
docker compose up -d --build
curl -s localhost:3060/health
```

The image build runs `scripts/verify-fixtures.js` and fails if the bundled
ephemeris files do not reproduce the reference house cusps.

## Layout

```
src/ephemeris.js   Swiss Ephemeris wrapper (positions, houses, obliquity, ayanamsa)
src/time.js        IANA zone -> UTC with DST gap/overlap detection (Intl only)
src/zodiac.js      Signs, rulers, dignities, decans, terms
src/aspects.js     Orb table, aspects, values, grid, totals, declinations
src/analysis.js    Balances, rulership, patterns, lunar phase, chart shape, dominants
src/vedic.js       Lahiri sidereal layer
src/chart.js       Assembles ChartFactors v1
src/schema.js      Request validation
src/server.js      HTTP API
ephe/              sepl_18, semo_18, seas_18 (1800–2400)
test/              node --test
```
