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

## Deploy on Railway

This project runs as a standard Node.js and Express web service. The root `package.json` contains the dependencies and `npm start` command Railway needs.

1. Push the repository to GitHub and create a new Railway project from that repository. Keep the default root directory (the repository root). Railway detects the root `package.json` and its `npm start` command; set the Start Command to `npm start` if needed.
2. In the Railway service's Variables settings, add `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`. Keep the server key in Railway variables only, never in frontend code or Git. Add payment variables only if you enable those features.
3. Generate a public domain in Railway's Networking settings. Check `https://YOUR-RAILWAY-DOMAIN/api/health` for the app health response.
4. In Supabase Auth -> URL Configuration, allow `https://YOUR-RAILWAY-DOMAIN/home.html` as a redirect URL. Keep the Supabase Auth callback URL as the authorized redirect URI in Google Cloud Console.
## Local Supabase setup

Create a Supabase project, run `backend/supabase/schema.sql` in its SQL Editor, and copy `backend/.env.example` to `backend/.env`. Set `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and the server-only `SUPABASE_SERVICE_ROLE_KEY`. Re-run the schema after updates to add the public listing and share request tables. Never place the server key in the frontend or commit it.

## Google sign-in setup

1. In Google Cloud Console, create a Web application OAuth client and add the Supabase callback URL shown in Supabase Auth -> Providers -> Google as an authorized redirect URI.
2. Enable Google in Supabase Auth -> Providers -> Google and enter the Google client ID and client secret.
3. In Supabase Auth -> URL Configuration, allow `http://localhost:3001/home.html` and `https://YOUR-RAILWAY-DOMAIN/home.html` as redirect URLs.
4. Set `SUPABASE_PUBLISHABLE_KEY` in `backend/.env` to the project's publishable key (`sb_publishable_...`). Keep the server key on the backend only.
5. Start the app locally at `http://localhost:3001`, or use your Railway domain, then select Continue with Google.

Business profiles are private until the owner enables public listing in profile settings. Investors can view published profiles and 12-month sales and profit reports. Share requests are non-binding expressions of interest; the app does not collect payment or transfer shares. Stripe and M-Pesa remain separate billing integration hooks.

Business records are stored in USD. The business dashboard and investor reports use the same display currency and conversion rates from `frontend/config.js`; changing currency affects presentation only. These configured rates are fixed until updated in that file, not a live foreign-exchange feed.