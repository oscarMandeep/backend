# SkillSwap API

REST and Socket.io back end for **SkillSwap**, a Tinder-style skill exchange. People list skills they **have**
and **want**, swipe a deck ranked by **match %**, chat in real time, book sessions, review each other and move
time credits. A **swap chain** finder links A → B → C → A loops when no direct swap exists.

| | |
|---|---|
| **Git (this repo)** | https://github.com/oscarMandeep/backend |
| **Live API (Render)** | https://skillswap-api-c1ex.onrender.com — health `/v1/health`, Swagger `/docs` |
| **Web repo (Vercel)** | https://github.com/oscarMandeep/Frontend |
| **Live site** | https://swapskill-dusky.vercel.app |
| **Database (Neon)** | Postgres 18, project `skillswap`, AWS Singapore |

Stack: NestJS 11, TypeScript strict, Prisma 7, PostgreSQL (`pgvector`, `pg_trgm`, `btree_gist`), Socket.io.

## Features

- **Auth:** email and password (scrypt hashing, rate limited), httpOnly cookie sessions with refresh rotation.
  Google OAuth routes exist but are off until keys are set.
- **Profile:** skills I have (level 1–5) and want (current level, goal, priority), weekly availability, mode
  (online, in person or both), languages, city.
- **Discover:** candidate deck ranked by a pure, unit-tested match score with a visible breakdown.
- **Swipes and matches:** a mutual like creates a match; a one-way match can be paid for with credits.
- **Chat:** Socket.io gateway with optimistic send (`clientId`), typing, presence and read receipts.
- **Sessions:** one person proposes a slot and the *other* confirms; complete, then review. Double booking is
  blocked in the database and in code.
- **Credits:** `ceil(minutes / 60)` credits per session, the learner pays the teacher, one ledger row per movement.
- **Swap chains:** a background job finds loops; members accept or decline.
- **Safety:** block and report users, archive a match.
- **Public SEO endpoints** (`/v1/public/*`) for the marketing pages.
- **Skill search:** typo tolerant (trigram) and meaning aware (local embedding model, 384-dim vectors).

## Architecture

```
Browser ──▶ Vercel (Next.js) ──rewrite /api/*──▶ Render (this API) ──▶ Neon Postgres
   └────────── Socket.io, 60-second token ─────────▶ Render
```

One Nest module per feature folder in `src/`:

| Module | Job |
|---|---|
| `auth` | register, login, refresh, logout, Google routes, socket token |
| `users`, `skills` | profile, haves, wants, availability, skill catalogue and search |
| `matching` | `score.ts` (a pure function) and similarity lookups |
| `discover`, `swipes`, `matches` | the deck, swiping, match lifecycle |
| `chat` | REST history and the Socket.io gateway |
| `sessions`, `reviews`, `credits` | scheduling, ratings, ledger |
| `chains` | swap chain finder, accept and decline |
| `notifications`, `safety`, `public`, `health`, `ai` | feed, blocks and reports, SEO data, probes, Groq skill-name cleanup |
| `common`, `config`, `prisma` | filters, pipes, utils, env validation (zod), Prisma service |

Background work uses `@nestjs/schedule` and the event emitter, with no Redis, because of the free tier.
Cron jobs run every 30 minutes at most so Neon can sleep.

## Run it locally

Requirements: Node 22, pnpm 12 (`corepack enable`), Docker.

```bash
# 1. database, from the docs repo root where docker-compose.yml lives (Postgres 16 + pgvector on :5433)
docker compose up -d

# 2. this repo
cp .env.example .env          # then edit, see the table below
pnpm install                  # also runs `prisma generate`
pnpm prisma:migrate           # create the tables
pnpm prisma:seed              # 40 skills, 33 users, demo user, one swap chain (local only!)
pnpm embed:skills             # downloads a small ML model once and fills skill vectors
pnpm start:dev                # API on http://localhost:4000, Swagger on /docs

# optional: 20 showcase accounts with matches, chat, sessions and chains (API must be running)
pnpm seed:showcase
```

Every seeded account signs in with `<username>@skillswap.dev` and password `password123`, for example
`priya@skillswap.dev` (matches, chat and sessions in every state).

> `pnpm prisma:seed` **deletes all data first.** Never point it at a database you care about. For production use
> `pnpm prisma:seed:skills` (skills only, safe to repeat).

## Environment variables

Validated at boot by `src/config/env.schema.ts`. The app refuses to start if a required one is missing or wrong.

| Variable | Required | Meaning |
|---|---|---|
| `DATABASE_URL` | yes | Runtime connection. On Neon use the **pooled** host (`-pooler`) |
| `DIRECT_URL` | yes | Direct connection, used by `prisma migrate` and `prisma generate` |
| `WEB_URL` | yes | Exact web origin, no trailing slash. Drives CORS and the socket origin |
| `JWT_SECRET` | yes | Signs session cookies, 32+ characters |
| `SOCKET_JWT_SECRET` | yes | Signs the 60-second socket token, 32+ characters |
| `REVALIDATE_SECRET` | yes | Shared with the web app for cache-refresh calls |
| `GOOGLE_CALLBACK_URL` | yes | Has a default; only used by Google login |
| `PORT` | no | Default `4000` |
| `NODE_ENV` | no | `development` enables `POST /v1/auth/dev-login`, which is a 404 otherwise |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | no | Turn on Google sign-in |
| `GROQ_API_KEY` | no | Cleans up newly created skill names; without it they are title-cased |
| `RESEND_API_KEY`, `EMAIL_FROM` | no | Email sending (not built yet) |
| `CLOUDINARY_URL` | no | Avatar upload (not built yet) |

Local values: `DATABASE_URL` and `DIRECT_URL` both `postgresql://skillswap:skillswap_dev@localhost:5433/skillswap`,
`WEB_URL=http://localhost:3000`, and random 32+ character strings for the secrets.

## Scripts

| Command | What it does |
|---|---|
| `pnpm start:dev` | API with reload |
| `pnpm build` / `pnpm start:prod` | compile to `dist/` and run it |
| `pnpm prisma:migrate` / `pnpm prisma:migrate:deploy` | dev migrations / production migrations |
| `pnpm prisma:seed` | local demo data (**wipes the database**) |
| `pnpm prisma:seed:skills` | skills only, idempotent, production safe |
| `pnpm embed:skills` | fill `skills.embedding` with the local model |
| `pnpm seed:showcase` | 20 showcase accounts through the real API; set `API_URL` to target another host |
| `pnpm chains:find` | look for swap chains now (the cron does it every 30 minutes) |
| `pnpm openapi:export` | rewrite `openapi.json` after changing an endpoint |
| `pnpm lint`, `pnpm typecheck` | style and types |
| `pnpm test`, `pnpm test:e2e` | unit and end-to-end tests |

## Tests

```bash
pnpm lint && pnpm typecheck
pnpm test        # 98 unit tests
pnpm test:e2e    # 156 end-to-end tests; needs the local Postgres from `docker compose up -d`
```

- **Unit:** the match score (every factor and edge case), password hashing, credit maths, session rules,
  slug and text utilities, chain finding.
- **End to end** (Supertest and real sockets against a real Postgres): auth and password login, profile, skill
  search, discover, swipes and matches, chat over sockets, sessions (including overlapping slots and
  settlement), credits, chains, safety (block and report), notifications, public endpoints.
- Rules that must never break are also enforced **in the database** (unique indexes, exclusion constraints),
  and the e2e tests try to break them.

## API

- Interactive docs at `/docs` (Swagger UI). Machine-readable: `openapi.json` in this repo.
- Full contract with the error envelope and socket events: `docs/04-api-contract.md` in the docs repo.
- All routes are under `/v1`. Errors look like
  `{ "statusCode": 409, "error": { "code": "EMAIL_TAKEN", "message": "...", "details": {} } }`.
- The web client is **generated from `openapi.json`** (orval), so the two cannot drift apart.

## Deployment (Render)

`render.yaml` is a Render Blueprint (free plan, Singapore region).

- **Build:** `pnpm install --frozen-lockfile --prod=false && pnpm prisma generate && pnpm build && pnpm prisma:migrate:deploy`.
  `--prod=false` is needed because Render sets `NODE_ENV=production` while building, which would skip the Nest CLI
  and Prisma. `prisma generate` is explicit because a cached rebuild skips `postinstall`. Migrations run in the build
  because pre-deploy commands are not on the free plan.
- **Start:** `pnpm start:prod`. **Health check:** `/v1/health`, which never touches the database, so a sleeping Neon
  does not fail it.
- **Set in the dashboard:** `DATABASE_URL`, `DIRECT_URL`, `REVALIDATE_SECRET`, `WEB_URL`. Render generates
  `JWT_SECRET` and `SOCKET_JWT_SECRET`.
- The free plan sleeps after 15 minutes, so the first request after a pause takes about a minute.
- Step by step: `docs/09-deploy-steps.md` in the docs repo.

## Key decisions

| Decision | Why |
|---|---|
| Browser → API goes through the Next.js rewrite | Cookies stay first-party and REST needs no CORS |
| Socket.io is the one direct browser → API connection, with a 60-second token | WebSockets cannot go through the Vercel rewrite; a short token keeps the long-lived cookie off that connection |
| Match score is a pure function with unit tests | The most important rule in the product must be easy to test and change |
| Postgres enforces the hard rules (exclusion constraint, unique ledger rows) | Code can have bugs and races; a constraint cannot be bypassed |
| Per-user advisory locks when booking a session | The exclusion constraint only stops overlap inside one role; teaching and learning at the same time is checked in code |
| Credits settle exactly once (unique `credit_tx(user, session, reason)`) | A retried request can never pay twice |
| In-process cron and event emitter instead of Redis | Free tier; every job is cheap and safe to run twice |
| Prisma 7 with the pg driver adapter | Pooled runtime connection, direct connection for migrations |
| Passwords use Node `scrypt` | No native dependency to compile on Render |
| `dev-login` only when `NODE_ENV=development` | A passwordless login must not exist in production |

## Known limitations

Google sign-in, email, avatar upload and a stored cancel reason are not built. REST rate limiting is in memory
per instance (sockets have their own limiter). The seeded demo accounts are public, so delete them before real
users arrive.
