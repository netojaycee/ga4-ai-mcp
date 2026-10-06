# Container build for Azure Container Apps / App Service / any Docker host.
# The Vercel deployment does not use this file. Build:  docker build -t insights-mcp .
# Run:  docker run -p 3000:3000 --env-file <your-env-file> insights-mcp
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1 BUILD_STANDALONE=1
# No secrets are needed to build: env is validated lazily at runtime.
RUN npm run build

FROM node:24-alpine AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
USER app
EXPOSE 3000
# Cron jobs (vercel.json) do not run in a container: schedule GET /api/cron/trial-notices and
# /api/cron/cleanup with "Authorization: Bearer $CRON_SECRET" from your platform's scheduler.
CMD ["node", "server.js"]
