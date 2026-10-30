# SME Intelligence Platform

An analytics workspace for small and medium businesses, with a public directory of business reports and separate business and investor accounts.

## Structure

- `frontend/` - responsive dashboard pages, styles, browser-side charting, and assets.
- `backend/` - Express API, Supabase authentication, billing hooks, and profile endpoints.
- `backend/supabase/schema.sql` - PostgreSQL tables, indexes, and Row Level Security policies.
- `frontend/home.html` - public business directory and investor entry point.

## Run locally

```powershell
cd backend
npm install
npm start
```

Open `http://localhost:3001` for the public directory. Business owners can open the business workspace after signing in.

## Deploy on Cloudflare Workers

This repository deploys the Express API and static frontend together on Cloudflare Workers. `wrangler.jsonc` points to `cloudflare-worker.mjs`, serves files from `frontend/`, and routes `/api/*` requests through Express.

1. Push the repository to GitHub, then in Cloudflare open **Workers & Pages -> Create application -> Workers -> Import a repository** and select this project. Keep the project root as the root directory and use `npx wrangler deploy` as the deploy command.
2. Add `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` under the Worker **Settings -> Variables and Secrets**. Keep the server key secret and never add it to frontend code. Add payment variables only if you enable those features.
3. Deploy and check `https://YOUR-WORKER-DOMAIN/api/health` for the app health response.
4. In Supabase Auth -> URL Configuration, allow `https://YOUR-WORKER-DOMAIN/home.html` as a redirect URL. Keep the Supabase Auth callback URL as the authorized redirect URI in Google Cloud Console.

For command-line deployment, run `npm install`, `npx wrangler login`, add the three Supabase secrets with `npx wrangler secret put SUPABASE_URL` and equivalent commands for the other two names, then run `npm run cloudflare:deploy`. For local Worker development, create a root `.dev.vars` file with the same three values; it is excluded from Git.

## Local Supabase setup

Create a Supabase project, run `backend/supabase/schema.sql` in its SQL Editor, and copy `backend/.env.example` to `backend/.env`. Set `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and the server-only `SUPABASE_SERVICE_ROLE_KEY`. Re-run the schema after updates to add the public listing and share request tables. Never place the server key in the frontend or commit it.

## Google sign-in setup

1. In Google Cloud Console, create a Web application OAuth client and add the Supabase callback URL shown in Supabase Auth -> Providers -> Google as an authorized redirect URI.
2. Enable Google in Supabase Auth -> Providers -> Google and enter the Google client ID and client secret.
3. In Supabase Auth -> URL Configuration, allow `http://localhost:3001/home.html` and `https://YOUR-WORKER-DOMAIN/home.html` as redirect URLs.
4. Set `SUPABASE_PUBLISHABLE_KEY` in `backend/.env` to the project's publishable key (`sb_publishable_...`). Keep the server key on the backend only.
5. Start the app locally at `http://localhost:3001`, or use your Cloudflare Worker domain, then select Continue with Google.

Business profiles are private until the owner enables public listing in profile settings. Investors can view published profiles and 12-month sales and profit reports. Share requests are non-binding expressions of interest; the app does not collect payment or transfer shares. Stripe and M-Pesa remain separate billing integration hooks.

Business records are stored in USD. The business dashboard and investor reports use the same display currency and conversion rates from `frontend/config.js`; changing currency affects presentation only. These configured rates are fixed until updated in that file, not a live foreign-exchange feed.