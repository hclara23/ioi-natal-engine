# ioi-natal-engine — AGPL-3.0-or-later. Source: see SOURCE_URL served at /.
FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# sweph ships prebuilt linux-x64/arm64 glibc binaries; no compiler needed.
RUN npm ci --omit=dev && npm cache clean --force

FROM node:24-slim
ENV NODE_ENV=production PORT=3060 EPHE_PATH=/app/ephe
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY ephe ./ephe
COPY test/fixtures ./test/fixtures
COPY scripts/verify-fixtures.js ./scripts/verify-fixtures.js
# Prove the ephemeris files load and the house math matches the reference before the image is accepted.
RUN node scripts/verify-fixtures.js
USER node
EXPOSE 3060
HEALTHCHECK --interval=20s --timeout=5s --retries=5 --start-period=10s \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3060)+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "src/index.js"]
