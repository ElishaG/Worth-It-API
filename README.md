# Worth It API & Scan Worker v1.0

This is the first runnable application-server code for Worth It. It connects to the live Supabase schema generated for the project and contains both:

1. A Fastify REST API for the mobile app.
2. A background worker that claims and processes identification and market-analysis jobs.

The uploaded `database.types.ts` was converted from Windows UTF-16 output to normal UTF-8 and placed at `src/database.types.ts`.

## Implemented

- Supabase JWT authentication
- Server-only privileged Supabase client
- Persistent idempotency for mutating endpoints
- Scan creation, image upload URLs, identification, manual correction, analysis, cancellation, deletion, and comparables
- Background queue claiming with leases and retries
- OpenAI image-recognition adapter with strict structured output
- eBay Browse active-listings adapter
- Mock recognition and marketplace providers for an immediate end-to-end test
- Worth Score, resale estimates, profit, ROI, and maximum-buy-price calculations
- Atomic scan-credit reservation, consumption, and release through the deployed database functions
- Rewarded-ad challenge and claim flow
- RevenueCat entitlement webhook processing
- Premium inventory, listing updates, completed sales, and realized profit
- Rate limiting, input validation, ownership checks, private image URLs, and structured errors

## What is intentionally not live yet

- OpenAI requires an API key.
- eBay requires developer credentials.
- eBay Browse supplies active listings, not verified sold history.
- A production FX provider is not connected.
- A real rewarded-ad network is not selected.
- RevenueCat must be configured in its dashboard and mobile SDK.
- The mobile app has not yet been connected to these endpoints.

The project runs in mock mode without the external provider credentials, allowing the full database and worker workflow to be tested first.

## Windows setup

Extract this folder, open PowerShell inside it, and run:

```powershell
.\scripts\setup.ps1
```

Then open the environment file:

```powershell
notepad .env
```

Fill in:

```env
SUPABASE_PUBLISHABLE_KEY=your_publishable_key
SUPABASE_SECRET_KEY=your_server_only_secret_key
```

Get the server-only secret key from the Supabase project dashboard under API Keys. Never send it in chat, place it in the mobile app, or commit `.env` to GitHub.

Keep these settings for the first test:

```env
RECOGNITION_PROVIDER=mock
MARKET_PROVIDER=mock
```

Start the API:

```powershell
.\scripts\start-api.ps1
```

Open another PowerShell window in the same folder and start the worker:

```powershell
.\scripts\start-worker.ps1
```

Check the server:

```powershell
Invoke-RestMethod http://localhost:3000/health
```

## Commands

```powershell
npm.cmd run dev
npm.cmd run dev:worker
npm.cmd run build
npm.cmd test
npm.cmd run check
```

## Security rules

- `SUPABASE_SECRET_KEY`, `OPENAI_API_KEY`, eBay secret, RevenueCat webhook secret, and ad webhook secret are server-only.
- The mobile app receives only the Supabase URL and publishable key.
- API requests authenticate with a user's Supabase access token.
- Database ownership filters are applied even when the server uses its privileged key.
- Private scan images are accessed by short-lived signed URLs.
- Monetary values are integer minor units, such as `1299` for `$12.99`.

## Project layout

```text
src/
  app.ts                       Fastify application
  server.ts                    API process entry point
  database.types.ts            Live Supabase TypeScript types
  routes/                      REST endpoints
  worker/                      Queue claim and processing loop
  providers/recognition/       Mock and OpenAI adapters
  providers/market/            Mock and eBay adapters
  services/                    Scan, inventory, and calculation logic
  lib/                         Auth, Supabase, idempotency, errors
scripts/                       Windows setup/start helpers
docs/                          OpenAPI contract and setup notes
tests/                         Calculation tests
```

## Validation performed

- Every TypeScript source file passed a syntax/type-structure compilation using local module shims because this environment cannot download npm packages.
- The generated database types are UTF-8 and correspond to the user's deployed Supabase schema.
- The full dependency-backed build and live database smoke test must run on the user's machine after `npm.cmd install` and `.env` setup.
