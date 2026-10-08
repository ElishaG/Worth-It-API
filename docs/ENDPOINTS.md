# Worth It API endpoints

Base URL for local development: `http://localhost:3000/v1`

Public:
- `GET /health` (outside `/v1`)
- `GET /v1/currencies`
- `GET /v1/categories`
- `POST /v1/webhooks/revenuecat`
- `POST /v1/webhooks/ad-provider`
- `GET /v1/webhooks/admob/ssv` (Google ECDSA-signed query, no bearer token)

Authenticated account:
- `GET /v1/me`
- `PATCH /v1/me/settings`
- `POST /v1/account-deletion`
- `GET /v1/subscription`
- `POST /v1/subscription/restore`

Authenticated scan flow:
- `POST /v1/scans`
- `GET /v1/scans`
- `GET /v1/scans/{scan_id}`
- `DELETE /v1/scans/{scan_id}`
- `POST /v1/scans/{scan_id}/upload-urls`
- `POST /v1/scans/{scan_id}/identify`
- `PATCH /v1/scans/{scan_id}/item`
- `POST /v1/scans/{scan_id}/analyze`
- `POST /v1/scans/{scan_id}/cancel`
- `GET /v1/scans/{scan_id}/comparables`

Authenticated Premium inventory:
- `GET /v1/inventory`
- `POST /v1/inventory`
- `PATCH /v1/inventory/{inventory_id}`
- `DELETE /v1/inventory/{inventory_id}`
- `POST /v1/inventory/{inventory_id}/sale`

Rewarded ads:
- `POST /v1/ad-rewards/challenges`
- `GET /v1/ad-rewards/challenges/{challenge_id}` (owner only; status and verified transaction ID)
- `POST /v1/ad-rewards/claims`

For AdMob, claims use the Google transaction stored by SSV; a client-supplied ID cannot replace it. An unverified reward returns `202 verification_pending` and is not cached as a completed idempotent request. Retry with the same key after polling status. The signed callback grants the credit atomically even if the app closes, and repeated callbacks/claims grant once. The generic HMAC webhook cannot verify AdMob challenges.

See [AdMob setup and release sequence](ADMOB_REWARDS_RELEASE.md) before enabling the integration.

All authenticated routes use `Authorization: Bearer <SUPABASE_ACCESS_TOKEN>`. All mutating mobile routes require an `Idempotency-Key` header containing 16–128 characters.
