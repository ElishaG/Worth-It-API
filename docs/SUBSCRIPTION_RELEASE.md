# Verified subscription rollout

This release reconciles RevenueCat customer state into a server-owned snapshot. The mobile release uses product `com.worthitscan.app.premium.monthly`. The default entitlement identifier is `premium`; verify it against RevenueCat before deploying.

## Required configuration

- `REVENUECAT_SECRET_API_KEY`: server-only RevenueCat v1 secret key with subscriber-read access. Store it in the API host's secret settings, never in Git or EXPO_PUBLIC variables.
- `REVENUECAT_MONTHLY_PRODUCT_ID=com.worthitscan.app.premium.monthly`
- `REVENUECAT_ENTITLEMENT_ID=premium` (or the verified identifier, changed in both services).
- `REVENUECAT_WEBHOOK_AUTH`: must exactly match the RevenueCat webhook Authorization header.

Apple sandbox is intentionally supported for App Review and TestFlight. Test Store/promotional grants, missing transactions, refunds and subscriptions without an expiry do not grant access.

## Deployment

1. Back up and inspect the live schema: `account_entitlements`, `entitlement_events`, `is_premium_active` and any scan/locker quota functions. The repository contains generated types, not the original schema migrations. Validate the new SQL against those actual constraints and privileges in staging first.
2. Configure the API secrets and RevenueCat webhook delivery before rollout. Enable events for purchases, renewals, cancellation/refund, expiration, billing issues and transfers; the handler reconciles current state rather than trusting event order or event type as a grant.
3. Apply `migrations/20260906_verified_subscriptions.sql`, then deploy this API commit in a coordinated window. The migration adds a private snapshot table and transactionally reconciles access/audit records. It preserves scan balances. Legacy beta flags alone no longer grant Premium. Existing real subscribers regain verified access on `/me` or restore; avoid leaving the migration deployed without the new API.
4. Verify authenticated `POST /v1/subscription/restore` returns `reconciled: true` and the correct `account`. It accepts no client-supplied customer ID. `/me` also refreshes subscriptions and falls back only to bounded verified access on an upstream outage.
5. Verify successful and retrying webhook events in `webhook_events`. Confirm both sides of a transfer are updated and that anonymous identities map to the correct app UUID. An ambiguous multi-account alias is rejected for investigation.
6. Verify real scans and locker limits use `is_premium_active` and not a separate legacy boolean. The exact live quota-function definitions were not available in the repository.
7. Only then build and test the coordinated mobile release and resubmit to Apple.

## Validation and limits

`npm run check` runs the API build and tests. Supply the placeholder Supabase variables used in `.github/workflows/validate.yml` when testing locally without a server environment.

The migration is exercised in an isolated PostgreSQL-compatible PGlite database using a minimal schema matching the generated types. Tests cover stale/duplicate snapshots, finite expiry/grace, legacy flags and client privilege denial. This validates SQL behavior but cannot establish compatibility with untracked production constraints or deployed quota functions.

The live RevenueCat key/mappings, API host environment, database schema, and Apple review flow must be verified during deployment. Do not roll back to the old event-based grant handler while leaving the new snapshot helper in place; deploy coordinated versions.
