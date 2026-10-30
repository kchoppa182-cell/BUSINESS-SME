# SME Intelligence Platform

An analytics workspace for small and medium businesses, with a public directory of business reports and separate business and investor accounts.

## Structure

- `frontend/` — responsive dashboard pages, styles, browser-side charting, and assets.
- `backend/` — Express API, Supabase authentication, billing hooks, and profile endpoints.
- `backend/supabase/schema.sql` — PostgreSQL tables, indexes, and Row Level Security policies.
- `frontend/home.html` — public business directory and investor entry point.

## Run locally

```powershell
cd backend
npm install
npm start
```

Open `http://localhost:3001` for the public directory. Business owners can open the business workspace after signing in.

## Deploy on Vercel

Deploy the repository root. Vercel runs the Express app as a function and serves the copied frontend files from `public/` through its static file hosting.

1. Push the project files to GitHub and import the repository in Vercel. Keep the project root as the Root Directory.
2. In Vercel Project Settings → Environment Variables, add `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`. Keep the service-role key on the server; never add it to frontend code. Add optional Stripe and M-Pesa variables from `backend/.env.example` only if you configure those payment features.
3. Deploy, then check `https://YOUR-VERCEL-DOMAIN/api/health` for the app health response.
4. In Supabase Auth → URL Configuration, allow `https://YOUR-VERCEL-DOMAIN/home.html` as a redirect URL. In Google Cloud Console, keep the Supabase Auth callback URL as the authorized redirect URI; Google redirects to Supabase, and Supabase returns users to the Vercel app.

The root `vercel.json` selects the Express framework and runs `npm run build`, which copies the frontend into Vercel's `public/` directory. See [Vercel's Express deployment guide](https://vercel.com/docs/frameworks/backend/express), [project configuration](https://vercel.com/docs/project-configuration/vercel-json), and [environment variables guide](https://vercel.com/docs/projects/environment-variables).

For local setup, create a Supabase project, run `backend/supabase/schema.sql` in its SQL Editor, and copy `backend/.env.example` to `backend/.env`. Set `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and the server-only `SUPABASE_SERVICE_ROLE_KEY`. Re-run the schema after updates to add the public listing and share request tables. Never place the service-role key in the frontend or commit it.

## Google sign-in setup

1. In Google Cloud Console, create an OAuth client ID for a Web application and add the Supabase callback URL shown in Supabase Auth → Providers → Google as an authorized redirect URI.
2. Enable Google in Supabase Auth → Providers → Google and enter the Google client ID and client secret.
3. In Supabase Auth → URL Configuration, allow `http://localhost:3001/home.html` and `https://YOUR-VERCEL-DOMAIN/home.html` as redirect URLs.
4. Set `SUPABASE_PUBLISHABLE_KEY` in `backend/.env` to the project's publishable key (`sb_publishable_...`). Keep `SUPABASE_SERVICE_ROLE_KEY` server-side only.
5. Start the app locally at `http://localhost:3001`, or use your Vercel domain, then select Continue with Google.

Supabase's Google provider guide: https://supabase.com/docs/guides/auth/social-login/auth-google. Redirect URL configuration: https://supabase.com/docs/guides/auth/redirect-urls.

Business profiles are private until the owner enables public listing in profile settings. Investors can view published profiles and 12-month sales and profit reports. Share requests are non-binding expressions of interest; the app does not collect payment or transfer shares. Stripe and M-Pesa remain separate billing integration hooks.

Business records are stored in USD. The business dashboard and investor reports use the same display currency and conversion rates from `frontend/config.js`; changing currency affects presentation only. These configured rates are fixed until updated in that file, not a live foreign-exchange feed.
# Business SME INTELLIGENCE
#
