# Test copy of WDCOPS on Render (free) + Neon (free Postgres)

Purpose: a throwaway **test** copy while the office internet is sorted out.
**Use dummy data only.** Do not load real debtor data on a free third-party host
(personal and financial data; no backup or uptime guarantee; data-protection duties).

Free-tier limits change. Check each provider's pricing page before you start.

## Why Render, not Vercel
- WDCOPS runs large file imports and reconciliations in the background
  (`/api/worker/tick`, `after()`), and keeps long-lived work between requests.
  Vercel's serverless functions have short time limits and no persistent process,
  so big imports will fail there.
- Render runs `next start` as a normal long-running server, which is how this app
  already ran before it moved to the office machine (see `.github/workflows/worker-tick.yml`).

## What you need
- The GitHub repo `MoshMoris67/WDCOPS` (Render deploys from it).
- A Render account and a Neon account (free; sign in with GitHub is fine).
- Node 20+ and this repo cloned locally (to seed the database once).

## Step 1: Create the database on Neon
1. In Neon, create a project (any name, pick the region closest to your agents).
2. Open **Connection details** and copy the **connection string**. It looks like
   `postgresql://USER:PASSWORD@HOST/neondb?sslmode=require`.
3. Keep it secret. This is your `DATABASE_URL`.

Do **not** use Render's own free Postgres for anything you want to keep: it has been
deleted after about 30 days on the free plan.

## Step 2: Create the tables and the starter users (run once, locally)
On any computer with the repo cloned:

```bash
cd WDCOPS
npm install
export DATABASE_URL='postgresql://USER:PASSWORD@HOST/neondb?sslmode=require'
npx prisma migrate deploy      # creates all tables
npx prisma db seed             # disposition codes + starter users
```

The seed creates admin and agent users with **known default passwords**
(see `prisma/seed.js`). On a public host, **change every password the first time
you log in**, or delete the starter users you don't need.

## Step 3: Generate two secrets
```bash
openssl rand -hex 32   # use as SESSION_SECRET
openssl rand -hex 32   # use as WORKER_SECRET
```

## Step 4: Create the web service on Render
1. Render dashboard > **New > Web Service** > connect GitHub > pick `WDCOPS`.
2. Settings:
   - **Runtime:** Node
   - **Branch:** `main`
   - **Build command:** `npm install && npm run build`
     (the build runs `prisma migrate deploy` first, so `DATABASE_URL` must be set)
   - **Start command:** `npm start`
   - **Instance type:** Free
3. **Environment variables:**

   | Name | Value |
   |---|---|
   | `DATABASE_URL` | the Neon connection string |
   | `SESSION_SECRET` | from Step 3 |
   | `WORKER_SECRET` | from Step 3 |
   | `NODE_VERSION` | `20` |
   | `NODE_OPTIONS` | `--max-old-space-size=460` (free instances have about 512 MB RAM) |

4. Click **Create Web Service**. The first build takes several minutes.
5. When it says **Live**, open the `https://<name>.onrender.com` URL and log in.

## Step 5: Turn on background processing (file imports and reconciliation)
Render's free tier has no background worker, so something must call the tick
endpoint every few minutes.

Option A, cron-job.org (simplest, free):
1. Create a cron job, URL: `https://<name>.onrender.com/api/worker/tick`
2. Method: `POST`. Header: `Authorization: Bearer <WORKER_SECRET>`.
3. Schedule: every 5 minutes.

Option B, GitHub Actions: in the repo's **Settings > Secrets and variables > Actions**
add `APP_URL` and `WORKER_SECRET`, then re-add a `schedule:` block to
`.github/workflows/worker-tick.yml` (its comments explain this). GitHub's scheduler
can fire late, so Option A is more reliable.

## Step 6: Check it works
1. Log in as an admin; open Settings and the main pages.
2. Import one **small dummy** file from `test-files/` (File Management > Import).
   It should move from "Importing..." to done within a few minutes of the tick running.
3. Log in as an agent on another device; open a debtor; log a call.

## Things you will notice on the free tier
- **Cold starts:** the service sleeps after about 15 minutes with no traffic. The first
  request after that takes 30-60 seconds. (The tick job above also keeps it awake
  while it runs.)
- **Memory:** very large imports may be killed. The app marks them "failed" after
  several attempts. Split big files.
- **Neon storage cap:** the free database is small (around 0.5 GB). Large debtor tables
  will not fit.
- **Data usage:** the app refreshes the agent queue every 45 seconds from every open
  tab. On a cloud host this traffic goes over each agent's own internet connection.

## Updating and shutting down
- Redeploy: push to `main`; Render rebuilds automatically.
- Stop the test: Render > the service > **Settings > Delete Web Service**, and delete
  the Neon project. Remove the cron job too.

## If you want Vercel anyway (not recommended)
Set `DATABASE_URL`, `SESSION_SECRET` and `WORKER_SECRET` as project environment
variables, import the repo, and use the default Next.js build. Expect background
imports and reconciliation to time out; only simple pages and call logging are likely
to work.
