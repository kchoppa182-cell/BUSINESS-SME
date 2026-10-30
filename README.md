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

For global access, deploy the backend and frontend to a public HTTPS host. The easiest setup is to host this Express app as one service so the API and pages share the same domain. If the frontend is hosted separately, set `window.BSI_API_URL` in `frontend/config.js` to the backend's public HTTPS URL before deploying. A `localhost` address only works on the computer running the app.

Before starting, create a Supabase project, run `backend/supabase/schema.sql` in its SQL Editor, copy `.env.example` to `.env`, and set `SUPABASE_URL` plus the server-only `SUPABASE_SERVICE_ROLE_KEY`. Re-run the schema after updates to add the public listing and share request tables. Never place the service-role key in the frontend or commit it.

## Google sign-in setup

1. In Google Cloud Console, create an OAuth client ID for a Web application and add the Supabase callback URL shown in Supabase Auth → Providers → Google as an authorized redirect URI.
2. Enable Google in Supabase Auth → Providers → Google and enter the Google client ID and client secret.
3. In Supabase Auth → URL Configuration, allow the app callback `http://localhost:3001/home.html` as a redirect URL. Add your deployed app URL there when deploying.
4. Set `SUPABASE_PUBLISHABLE_KEY` in `backend/.env` to the project's publishable key (`sb_publishable_...`). Keep `SUPABASE_SERVICE_ROLE_KEY` server-side only.
5. Start the app at `http://localhost:3001` and choose Business or Investor before selecting Continue with Google.

Supabase's Google provider guide: https://supabase.com/docs/guides/auth/social-login/auth-google. Redirect URL configuration: https://supabase.com/docs/guides/auth/redirect-urls.

Business profiles are private until the owner enables public listing in profile settings. Investors can view published profiles and 12-month sales and profit reports. Share requests are non-binding expressions of interest; the app does not collect payment or transfer shares. Stripe and M-Pesa remain separate billing integration hooks.

Business records are stored in USD. The business dashboard and investor reports use the same display currency and conversion rates from `frontend/config.js`; changing currency affects presentation only. These configured rates are fixed until updated in that file, not a live foreign-exchange feed.
# Business SME INTELLIGENCE
