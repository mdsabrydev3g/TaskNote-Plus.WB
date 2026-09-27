# TaskNote Plus

> An AI-powered personal productivity operating system — Notes, Tasks, Projects, Calendar, Goals,
> and a Capture inbox, bound together by a permission-scoped assistant. Installable PWA, Arabic/English
> with full RTL and Hijri calendar support.

Built as a single full-stack Next.js app that deploys to **Vercel** with a **Neon** Postgres database.

---

## What it does

| Module | Highlights |
| --- | --- |
| **Capture** | Never-blocking inbox. Text is saved first; AI triage is an optional suggestion you accept or ignore. Idempotent (duplicate content is detected by hash). |
| **Notes** | Block-based editor, pinning, project linking, debounced autosave with no save button, AI summarise and task extraction with a review-before-commit step. |
| **Tasks** | List **and** drag-and-drop Kanban, priorities, energy tags, due dates, recurrence, subtask counts, optimistic toggling. |
| **Projects** | Progress rolls up bottom-up from linked tasks and goals. |
| **Calendar** | Month and week views, Gregorian **and** Hijri (`islamic-umalqura`) side by side, RRULE expansion, natural-language date parsing in Arabic and English. |
| **Goals** | Metric goals and habits, check-ins with configurable grace days, streak tracking, task linking. |
| **Assistant** | Grounded Q&A that cites its sources, daily/weekly briefs, natural-language quick-add, and capture routing. |

### Design principles the code actually enforces

- **AI is optional.** Every core flow works with no provider configured. AI features degrade with a
  clear message rather than breaking (see `src/lib/ai/gateway.ts`).
- **Per-user isolation on every query.** A `UserScope` class requires a `userId`; there is no way to
  build a query without one (`src/lib/db/scope.ts`).
- **Reversible AI writes.** AI-created records are logged with a 48-hour undo window.
- **Prompt-injection defence.** User content is fenced as data with explicit boundary instructions and
  instruction-pattern neutralisation (`src/lib/ai/safety.ts`).
- **Soft deletes as sync tombstones.** `deletedAt` + a Lamport `version` column on every entity,
  with a `change_events` log, ready for real-time sync.

---

## Quick start (local)

**Prerequisites:** Node.js ≥ 20 and a free Neon database.

```bash
# 1. Install dependencies
npm install

# 2. Create your env file
cp .env.example .env.local
#    → paste your Neon pooled connection string into DATABASE_URL

# 3. Create the schema
npm run db:generate   # only if you changed src/db/schema.ts
npm run db:migrate

# 4. (Optional) load demo data
npm run db:seed       # demo@tasknote.app / Demo1234Pass

# 5. Run it
npm run dev           # http://localhost:3000
```

### Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | **Yes** | Neon **pooled** connection string. |
| `DATABASE_URL_UNPOOLED` | Recommended | Neon direct connection; used by migrations and `drizzle-kit`. |
| `AUTH_SECRET` | **Yes** | ≥ 32 chars. Signs access tokens. Generate with `openssl rand -base64 48`. |
| `GROQ_API_KEY` | Optional | Free tier. Highest priority AI provider. |
| `GOOGLE_AI_API_KEY` | Optional | Google AI Studio free tier. |
| `OPENROUTER_API_KEY` | Optional | OpenRouter free models. |
| `OLLAMA_BASE_URL` / `OLLAMA_MODEL` | Optional | Local, fully private inference. |
| `AI_PROVIDER` | Optional | Pin a provider instead of using priority order. |

Providers are tried in order **Groq → Google → OpenRouter → Ollama**, skipping any that are unset.

### Where the database URL is read from

The app resolves its connection string from the first *usable* variable it finds, in this order:

1. `DATABASE_URL`
2. `POSTGRES_URL` / `NEON_DATABASE_URL`
3. A Vercel Neon integration name, e.g. `MYAPP_DB_DATABASE_URL`
4. Any other variable ending in `POSTGRES_URL` / `DATABASE_URL`

This matters because attaching a database through the Vercel Neon integration stores the credentials
under a **project-prefixed** name, not `DATABASE_URL`. A hard-coded lookup would leave the app
reporting "database unreachable" even though the integration was attached successfully. Values that
are blank, still hold a placeholder, or are unpooled are skipped for the runtime path.

`GET /api/health` reports which variable won (`checks.databaseSource`) and the underlying driver error
(`checks.databaseError`) when the connection fails — so a misconfiguration is diagnosable from the
deployed app without shell access.


---

## Deploying to Vercel + Neon

### 1. Create the database (Neon)

1. Sign up at [neon.tech](https://neon.tech) and create a project.
2. Open **Connection Details** and copy **both** strings:
   - the **Pooled** connection → `DATABASE_URL`
   - the **Direct** connection → `DATABASE_URL_UNPOOLED`

### 2. Apply the schema

Run migrations from your machine against Neon (the database must exist before the app can serve traffic):

```bash
DATABASE_URL="postgres://...-pooler.../neondb?sslmode=require" npm run db:migrate
```

Migrations are tracked in a `_tasknote_migrations` ledger table, so this is safe to re-run and safe to
run from CI — already-applied files are skipped and checksummed.

### 3. Deploy

```bash
npm i -g vercel
vercel link
vercel env add DATABASE_URL production        # paste the pooled string
vercel env add AUTH_SECRET production         # openssl rand -base64 48
vercel env add GROQ_API_KEY production        # optional
vercel --prod
```

Or import the repo at [vercel.com/new](https://vercel.com/new) — the framework is auto-detected as
Next.js and `vercel.json` supplies the build settings. Add the environment variables in the
dashboard before the first deploy.

> `AUTH_SECRET` must be at least 32 characters. The app refuses to sign tokens with a shorter one.

### 4. Verify

- `GET /api/health` reports app status and whether the database and an AI provider are reachable.
- Register an account, then check **Settings → Security** to confirm your session and device are listed.

---

## Installing as a mobile app

TaskNote Plus is a PWA — no app store required.

- **Android / Chrome:** open the site → menu → **Add to Home screen**.
- **iOS / Safari:** open the site → Share → **Add to Home Screen**.

The service worker caches the shell and static assets, and serves `/offline` when the network is gone.
API routes are deliberately never cached.

---

## Project structure

```
src/
  app/
    (app)/              Protected routes: dashboard, tasks, notes, projects, calendar, goals,
                        inbox, capture, assistant, settings
    actions/            Server actions — auth, content CRUD, AI capabilities
    api/                health check, theme preference
    login/ register/    Public auth routes + landing page
  components/           UI. Client components import actions via tasks-bridge.ts
  db/                   Drizzle schema (23 tables) and client
  lib/
    ai/                 Provider-agnostic gateway + prompt-injection safety
    auth.ts session.ts  JWT access tokens, rotating refresh tokens, constant-time comparison
    calendar.ts         Gregorian/Hijri formatting, RRULE expansion, natural-date parsing
    db/scope.ts         UserScope — the tenancy enforcement boundary
    validation.ts       Zod schemas for every API boundary
scripts/
  migrate.ts            Idempotent migration runner
  seed.ts               Demo data
  generate-icons.mjs    PWA icon generation (no native dependencies)
drizzle/                Generated SQL migrations
public/                 manifest.webmanifest, sw.js, icons
```

### Why `tasks-bridge.ts` exists

A `"use server"` module may only export async functions. Modules that mix actions with helpers,
constants, or types can't be imported into client components without pulling server-only code into the
browser bundle. `src/app/actions/tasks-bridge.ts` is a thin, explicit client-facing surface that
declares one async wrapper per action. Client components import only from there.

---

## Security model

| Concern | Approach |
| --- | --- |
| Session tokens | Short-lived HS256 JWT access token (15 min) in an **HttpOnly** cookie. |
| Refresh tokens | 256-bit opaque, stored only as a SHA-256 hash, 30-day expiry, **rotated on every use**. |
| Token replay | Reuse of a rotated token is detected and revokes the entire token family. |
| Password hashing | bcrypt, cost 12. Login failures are constant-time and use a uniform message. |
| Brute force | Account locks for 15 minutes after 5 failed attempts. |
| Tenancy | `UserScope` requires `userId`; ownership is asserted on read as well as write. |
| Transport | HSTS, CSP, `X-Frame-Options`, `Permissions-Policy` set in `next.config.ts`. |

**Scope note:** isolation is enforced at the application layer, not via database-level RLS, and the
database is not end-to-end encrypted. See `docs/SECURITY.md` for the full threat model and the
trade-offs involved.

---

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server. |
| `npm run build` / `start` | Production build and serve. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run lint` | ESLint (next/core-web-vitals + typescript). |
| `npm run db:generate` | Generate SQL from `src/db/schema.ts`, then refresh the bundled copy. |
| `npm run db:migrate` | Apply migrations (idempotent, checksummed). |
| `npm run db:check` | Read-only: report the connection source and list existing tables. |
| `npm run db:bundle` | Re-inline `drizzle/*.sql` into `src/lib/db/migrations/bundle.ts`. |
| `npm run db:push` | Push schema directly — prototyping only, skips migration history. |
| `npm run db:seed` | Load demo data. |
| `npm run db:studio` | Drizzle Studio data browser. |

---

## Tech stack

Next.js 15 (App Router, React 19, Server Actions) · TypeScript · Tailwind CSS · Drizzle ORM ·
Neon Postgres · `jose` · bcrypt · Zod · Lucide
