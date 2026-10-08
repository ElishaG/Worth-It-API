# AdMob rewarded scans: configuration and release

This change is prepared for review. Applying the SQL, deploying Render and publishing a mobile build are separate release actions. None is performed by the pull requests.

## What fixes the 409

Google sends an ECDSA-signed GET callback. The old generic HMAC POST webhook could not verify it, and the app immediately claimed with a fabricated `client-*` transaction. The new API validates Google's P-256/SHA-256 signature using Google's rotating public keys, validates the unit/reward/user/challenge/token/earned time, and stores Google's actual transaction ID. Verification, audit and the single scan credit commit in one database transaction. Replays and repeated claims return success without another credit. A valid delayed callback credits the account even after the app closes.

The app waits up to approximately 90 seconds for server status, then uses the verified transaction and a stable claim key. Pending claims return 202 without completing an idempotency record. If verification takes longer, the app explains that the credit will appear after verification and a balance refresh; it does not report success based on the device's earned event.

## Render configuration

Service: `worth-it-api`, ID `srv-d9va2j1t0dsc73cldd10`.

1. Before merging into `main`, open [Render service settings](https://dashboard.render.com/web/srv-d9va2j1t0dsc73cldd10) and set **Auto-Deploy → Off** if deployment must remain paused. This service currently follows `main`; merging with auto-deploy enabled can release immediately.
2. In **Environment**, add exactly:

   ```env
   ADMOB_REWARDED_AD_UNIT_IDS=ca-app-pub-7651425836406503/8982386338
   ```

   This is the iOS rewarded unit already used by Worth It's production mobile code. For additional rewarded units, comma-separate their actual full SDK IDs. Google supplies the numeric suffix in SSV; the API normalizes both forms. Keep this variable empty until preparing the release if rewards should remain disabled. Do not add Google's sample ad units to production.
3. Preserve all existing Supabase, RevenueCat, recognition, marketplace, host and port settings. In particular, do not replace `SUPABASE_SECRET_KEY`, `REVENUECAT_WEBHOOK_AUTH`, `REVENUECAT_API_KEY` or `REVENUECAT_ENTITLEMENT_ID`. The Docker build/start commands need no change.
4. AdMob does **not** use `AD_WEBHOOK_SECRET`. No Google private key or shared signing secret belongs in Render. The API fetches public keys from `https://www.gstatic.com/admob/reward/verifier-keys.json` over outbound HTTPS and refreshes them automatically.
5. When making configuration changes before authorization to deploy, choose **Save only** if offered, and do not choose a save-and-deploy option or Manual Deploy. The prepared branches and draft PRs do not modify Render.

## Database release prerequisite

Review and apply `supabase/migrations/20261008014752_admob_reward_verification.sql` to a staging copy of the **existing Worth It schema**, then to production project `nhnqenolqepbwskjdrxv` only when release is authorized. Apply this before the new API is deployed. The repository does not contain a complete Supabase migration baseline: do not reset the database or blindly push a reconstructed baseline. This standalone transaction can be applied through the Supabase SQL editor or the established database release process.

The migration replaces the existing reward-grant function and adds the internal verification function. Both require the service role; public/mobile roles cannot call them. It keeps table RLS, existing balances, reserved credits, subscription functions and RevenueCat records intact. The callback increments only available scan credits and the entitlement version. Existing unique transaction and ledger indexes, row locks and an advisory transaction lock protect against duplicate rewards.

New rewards must have a signed earned time inside their 15-minute challenge window. Delivery may occur up to 24 hours after the earned time. Previously expired, unverified ads are not credited without a valid Google-signed callback; the old failure cannot safely be repaired from a client event alone.

## AdMob configuration

In AdMob: **Apps → Worth It → Ad units → the iOS rewarded unit `8982386338` → Advanced settings**.

1. Set the reward amount to **1** and reward item/type to **scan** (lowercase, exact spelling). The API rejects any other signed amount or item.
2. Under **Server-side verification**, configure this exact callback URL:

   ```text
   https://worth-it-api.onrender.com/v1/webhooks/admob/ssv
   ```

   Use the URL without a query string. This is a public Google-signed GET endpoint; do not add a bearer token or point AdMob at `/v1/webhooks/ad-provider`.
3. For the dashboard URL verification test, use a dedicated test account and a fresh `POST /v1/ad-rewards/challenges` response (`provider: "admob"`, `placement: "scan_unlock"`). Set test **User ID** to that account's Supabase UUID and test **Custom data** to the exact JSON below, substituting that fresh response's values:

   ```json
   {"challenge_id":"<challenge_id>","challenge_token":"<challenge_token>"}
   ```

   These are verification-test fields. The mobile SDK supplies its signed-in user's UUID and fresh challenge JSON automatically for each real ad. Do not hardcode a user's UUID or challenge token as production defaults. A successful signed test intentionally grants one scan to that test account. Never put a Supabase access token or service key in these fields.
4. After the new database functions and API are live, select **Verify URL**, then **Use verified URL**, and **Save**. If using mediation, apply the SSV setting to every supported mediated network as appropriate. The allowlist, exact reward values and challenge checks also apply to mediated callbacks.

The URL verification test will fail while the old API is deployed; configuration alone cannot supply the missing endpoint. AdMob's dashboard test must use a fresh challenge because its earned time must fall inside that challenge window.

## Mobile release prerequisite

The mobile PR is based on `feature/low-scan-reward-popup` to retain the current subscription and scan popup work. Integrate that branch's existing work along with the fix before publishing any replacement build. No subscription code, purchase flow, RevenueCat configuration, app version or native build setting is changed by this fix.

iOS continues to use `ca-app-pub-7651425836406503/8982386338`. Android needs its actual production rewarded unit in `EXPO_PUBLIC_ADMOB_REWARDED_ANDROID_ID` and the same unit added to Render's allowlist before enabling Android rewards. Do not use an invented Android ID. Development currently uses Google's `TestIds.REWARDED`; that sample unit does not exercise this app's configured production callback. Test end-to-end with the configured unit and an AdMob-registered test device in an isolated environment before release.

## Authorized release order and acceptance checks

1. Apply and validate the database migration in staging; deploy the API to staging with the correct unit allowlist and staging callback configuration. Review the backend and mobile PRs together.
2. Once authorized, apply the production migration, merge/deploy the backend, then verify and save the production AdMob callback. Keep new builds unpublished until end-to-end checks pass.
3. Test a real signed callback: status changes from pending to claimed, one ledger grant and one webhook audit appear, and available credits increase by exactly one. Repeated callbacks/claims must leave that increase at one. Confirm Premium, subscription fields and reserved credits are unchanged.
4. Test callback delay, closing the app after earning, reopening/refreshing the balance, invalid signatures, another account's challenge, and transaction reuse. No callback means no credit; a late valid callback credits automatically.
5. Publish the mobile build only after separate authorization. Existing builds may still show their old immediate-claim error during a delay, although the new callback can credit the account independently and the new API ignores their fabricated transaction ID.

Local validation: `npm run check` with the workflow's mock environment runs the TypeScript build and 34 tests, including real generated ECDSA signatures, HTTP route tests and the migration executed against isolated PGlite PostgreSQL. The mobile suite has 31 tests plus TypeScript and lint validation. No local test calls production Supabase or grants a live reward. Real AdMob delivery/device behavior still requires the staging/release checks above.

References: [Google SSV specification](https://developers.google.com/admob/ios/ssv), [Google/Tink verification implementation](https://github.com/tink-crypto/tink-java-apps/blob/main/rewardedads/src/main/java/com/google/crypto/tink/apps/rewardedads/RewardedAdsVerifier.java), [AdMob URL setup](https://support.google.com/admob/answer/9603226?hl=en), [Render deploy controls](https://render.com/docs/deploys).
