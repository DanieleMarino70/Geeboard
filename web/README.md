# web — the panel

Geeboard's panel: a Next.js application (server components, server actions and
`/api/v1`), the poller that runs beside it, the Prisma schema and migrations, the
game definitions, and their tests. An installation runs it from the published image
(`deploy/panel/`), which is built from this folder.

From a checkout, with Postgres from the repository's `docker-compose.yml`
(`docker compose up -d` at the root):

```bash
npm ci
npm run setup:env       # writes .env with two generated secrets
npm run db:migrate
npm run db:seed         # the sample workspace; db:seed:empty is an owner and nothing else
npm run dev             # http://localhost:3000
npm run poll            # the poller, in a second terminal
```

This Next.js is not the one most people know: read [AGENTS.md](AGENTS.md) before
writing code here.

[docs/development.md](../docs/development.md) is the layout, the scripts, the tests
and the conventions; [docs/installation.md](../docs/installation.md) the checkout in
more detail; [docs/architecture.md](../docs/architecture.md) what lives where.
