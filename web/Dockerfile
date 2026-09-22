# The panel and the poller: one image, two commands.
#
#   docker run … geeboard-panel panel     the web panel, on 3000
#   docker run … geeboard-panel poller    the watchdog and scheduler
#   docker run … geeboard-panel migrate   prisma migrate deploy, and nothing else
#   docker run … geeboard-panel setup …   first installation: schema, catalog, first owner
#   docker run … geeboard-panel recover … a new temporary password for an owner
#
# It carries the source and every dependency, development ones included,
# on purpose. The poller, the setup and the recovery are the repository's
# own TypeScript run with tsx, and the migrations are applied by the
# Prisma CLI: a slimmed "standalone" image would run the pages and none of
# those, and the second image needed for them would be one more thing to
# drift from the first. It is a few hundred megabytes larger for it.

FROM node:24-bookworm-slim AS build
WORKDIR /app
# Prisma's engines want OpenSSL, and the version providers want certificates.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# Nothing here is contacted during the build; importing the database
# module needs the variable to exist, and that is all it is for.
ENV DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build" \
    NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate && npm run build

FROM node:24-bookworm-slim
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

COPY --from=build --chown=node:node /app /app
COPY --chown=node:node docker-entrypoint.sh /usr/local/bin/geeboard
RUN chmod +x /usr/local/bin/geeboard

# Not root: nothing the panel does needs it, and it holds every node's token.
USER node
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/geeboard"]
CMD ["panel"]
