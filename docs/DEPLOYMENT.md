# Deployment Guide — Vercel + Neon

Step-by-step, from an empty Neon account to a live PWA installed on a phone.

---

## 0. Prerequisites

- A [Neon](https://neon.tech) account (free tier is enough to start)
- A [Vercel](https://vercel.com) account
- Node.js ≥ 20 locally
- This repository

---

## 1. Create the Neon database

1. In the Neon console, click **New Project**.
2. Choose a region close to your users — ideally the same region you will deploy the Vercel function to,
   since every query is a round trip.
3. Open **Connection Details** and copy both connection strings:

| Neon label | Goes into | Used for |
| --- | --- | --- |
| **Pooled connection** | `DATABASE_URL` | The app at runtime (serverless-safe). |
| **Direct connection** | `DATABASE_URL_UNPOOLED` | Migrations and Drizzle Kit. |

Both should end with `?sslmode=require`.

> **Why two strings?** Serverless functions scale horizontally and would exhaust direct Postgres
> connections, so runtime traffic must go through Neon's pooler. Migrations, however, need a stable
> direct session. Mixing these up causes "too many connections" errors under load.

---

## 2. Configure the app locally

```bash
cd tasknote-plus
npm install
cp .env.example .env.local
```

Fill in `.env.local`:

```bash
DATABASE_URL="postgres://user:pass@ep-xxx-pooler.region.aws.neon.tech/neondb?sslmode=require"
DATABASE_URL_UNPOOLED="postgres://user:pass@ep-xxx.region.aws.neon.tech/neondb?sslmode=require"
AUTH_SECRET="<paste the output of: openssl rand -base64 48>"

# Optional — any one of these enables the assistant
GROQ_API_KEY=""
GOOGLE_AI_API_KEY=""
OPENROUTER_API_KEY=""
```

`AUTH_SECRET` is mandatory and must be **at least 32 characters**; token signing fails below that.

---

## 3. Create the schema

```bash
npm run db:generate    # only needed if you changed src/db/schema.ts
npm run db:migrate
```

Expected output:

```
→ applying 0000_....sql (80 statements)
  ✓ 0000_....sql applied

✔ Migrations complete — 1 applied, 0 skipped (already up to date).
```

The runner keeps a `_tasknote_migrations` ledger with a checksum per file, so:

- Re-running is safe — applied files are skipped.
- Editing an already-applied migration is **refused** (it tells you to add a new one instead), which
  prevents local and production schemas from silently diverging.

### Optional: demo data

```bash
npm run db:seed          # demo@tasknote.app / Demo1234Pass
```

Seeds 3 projects, 13 tasks, 3 goals, 4 events (with recurrences), 3 notes, and 4 inbox captures.
Skip this in production.

---

## 4. Verify locally

```bash
npm run dev
```

- Visit `http://localhost:3000` → landing page.
- Register → you should land on the dashboard.
- Visit `http://localhost:3000/api/health` → JSON reporting database and AI status.
- Check **Settings → Security** → your current session and device are listed.

If the database is unreachable the app still builds and runs; it warns rather than crashing, and
health reports the problem.

---

## 5. Deploy to Vercel

### Option A — CLI

```bash
npm i -g vercel
vercel link

# Add each variable for the production environment
vercel env add DATABASE_URL production
vercel env add DATABASE_URL_UNPOOLED production
vercel env add AUTH_SECRET production
vercel env add GROQ_API_KEY production        # optional

vercel --prod
```

Repeat `vercel env add ... preview` if you want pull-request previews to work against a staging
database — **do not** point previews at production data.

### Option B — Dashboard

1. Push the repo to GitHub/GitLab/Bitbucket.
2. Go to [vercel.com/new](https://vercel.com/new) and import it. The framework is detected as Next.js
   automatically; `vercel.json` already supplies the build settings.
3. Add the environment variables **before** clicking Deploy (a missing `DATABASE_URL` builds fine but
   serves an unusable app).
4. Deploy.

---

## 6. Post-deploy checks

| Check | Expected |
| --- | --- |
| `https://your-app.vercel.app/api/health` | `database: "ok"`, and `ai.available` reflecting your keys. |
| Register a new account | Succeeds; redirects to the dashboard. |
| Refresh while signed in | Session survives (refresh-token rotation working). |
| Sign out, then sign in | Works; no "session expired" loop. |
| Lighthouse → PWA | "Installable" passes. |

### Install on a phone

- **Android/Chrome:** open the URL → ⋮ → **Add to Home screen**.
- **iOS/Safari:** open the URL → Share → **Add to Home Screen**.

It launches standalone, without browser chrome.

---

## 7. Routine operations

### Applying schema changes

```bash
# 1. Edit src/db/schema.ts
npm run db:generate                 # produces drizzle/0001_*.sql
git add drizzle/                    # COMMIT the migration — never let it be regenerated
npm run db:migrate                  # apply locally
DATABASE_URL="<prod pooled>" npm run db:migrate   # apply to production
```

Always commit generated migrations. If they aren't in version control, the next `db:generate` on a
different machine will produce a conflicting file.

### Rolling back the app

Vercel keeps every deployment — use **Instant Rollback** in the dashboard. Note this only reverts
*code*; migrations are additive and are not rolled back automatically. To undo a schema change, write
a new forward migration.

### Backups

Neon provides point-in-time restore on paid plans. On the free tier, schedule your own `pg_dump` if
the data matters:

```bash
pg_dump "$DATABASE_URL_UNPOOLED" --no-owner --no-acl -Fc -f "tasknote-$(date +%F).dump"
```

---

## 8. Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `DATABASE_URL is not set` in build logs | Expected without env vars; the build is fine. Set the variable or the app will be unusable at runtime. |
| `too many connections` | Runtime traffic is using the **direct** string. Use the **pooled** one for `DATABASE_URL`. |
| Login succeeds, then immediately signed out | `AUTH_SECRET` differs between environments, or is under 32 chars. Use one long value everywhere. |
| `relation "users" does not exist` | Migrations were never applied. Run `npm run db:migrate` against the target database. |
| Assistant says "no provider configured" | No AI key is set. This is the intended graceful degradation — the rest of the app works. |
| Service worker serves stale content | Hard-reload, or unregister it in DevTools → Application → Service Workers. |
| CORS errors on `/api/` | Should not happen; the API is same-origin. Check that `NEXT_PUBLIC_*` isn't being used for secrets. |

---

## 9. Cost notes

- **Neon free tier:** comfortably handles a personal workspace; the app uses the HTTP driver, so no
  long-lived connections are held.
- **Vercel Hobby:** sufficient for personal use. Every route is dynamic (server-rendered on demand),
  so there is no static-generation cost to worry about.
- **AI:** the default provider order starts with Groq's free tier. With no key at all, AI features stay
  off and cost nothing.
