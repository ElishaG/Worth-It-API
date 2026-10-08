# Legacy rewarded-scan RPC restriction

The live schema contained two SECURITY DEFINER functions that trusted client events. `reward_ad_scan()` incremented the signed-in user's balance directly. `claim_rewarded_ad_scan(uuid)` accepted any event UUID and enforced beta caps/cooldown without checking an AdMob signature or verified challenge. Both had client EXECUTE grants; the second also had a PUBLIC grant inherited by ordinary roles. RLS does not stop writes inside these owner-privileged functions.

## Caller and permission audit

Inspected all fetched remote branches and pull-request heads before changing permissions: **11 API branches / 10 PR heads** and **23 mobile branches / 16 PR heads**, plus reachable code history. GitHub search indexes were unavailable, so the audit used full local Git revision searches rather than relying on empty code-search results.

The only source callers are `app/(tabs)/settings.tsx:123` on mobile branches `agent/beta-feedback`, `fix/password-recovery`, `fix/premium-upsell`, and old PR heads #1/#2. They call `supabase.rpc('reward_ad_scan')` immediately after the native earned event. No caller of `claim_rewarded_ad_scan` was found. Those historical paths deliberately lose direct reward access after this restriction; their future releases must integrate the verified flow in Mobile #16. Current `main`, the low-scan reward branch and the mobile SSV fix have no legacy RPC caller.

The API/worker source uses `record_admob_reward` for the signed callback and `grant_rewarded_ad_credit` for the verified claim. No API branch or PR head calls either legacy RPC. Production/staging catalog dependency checks and a function-body scan found no database function/trigger/view wrapper calling them. Staging has no Edge Functions; production's sole eBay deletion Edge Function was inspected and has no reward caller. Both accessible Worth It repositories were included. This covers the inspected code and database definitions; it does not claim visibility into external scripts or every installed historical build.

Before the change, both functions were owned by postgres, SECURITY DEFINER, and executable by anon/authenticated/service_role. `claim_rewarded_ad_scan` was additionally executable by PUBLIC. The ordinary roles have no membership in a more privileged role. Their bodies, signatures, owners and existing balance semantics remain intact.

## Migration

`supabase/migrations/20261008023317_restrict_legacy_reward_rpcs.sql` revokes execution from PUBLIC, anon and authenticated on exactly those two signatures, and explicitly preserves service_role execution. It does not modify balances, tables, subscriptions, RevenueCat functions, RLS, other RPC grants, or default privileges. It reloads PostgREST's schema cache and can safely be reapplied.

| Caller | Legacy reward RPCs after migration |
|---|---|
| PUBLIC / anon / authenticated | No execution; direct SQL calls reject with 42501 |
| service_role / postgres owner | Existing trusted behavior retained |

Trusted reward processing continues through the verified `record_admob_reward -> grant_rewarded_ad_credit` path. Keeping legacy server access is compatibility for trusted maintenance/server callers; these legacy bodies do not perform Google verification and should not become a new client-facing API.

Apply after `20261008014752_admob_reward_verification.sql` to the existing schema. Both are required for the authorized production reward rollout. Do not revert this restriction to recover an older beta reward button; upgrade that caller to the verified flow.

## Verification

Applied only to verified **Worth-It-Staging**, `tttojkfynlvpafwnjhtk`. Supabase registered journal version `20261008023804`, name `restrict_legacy_reward_rpcs_20261008023317`; the tool assigns the journal timestamp independently of the file timestamp. Production `nhnqenolqepbwskjdrxv` was read-only and its complete application catalog remained identical before/after.

- **42 backend tests** pass with the TypeScript build. Eight new tests reproduce the old bypass, reject actual authenticated/anon SQL-role calls, block forged service claims under the wrong SQL role, preserve service calls and legacy duplicate/cooldown behavior, verify unchanged function definitions/balances/RLS/default grants and safe reapplication, grant one verified reward on repeats, and preserve RevenueCat activation/idempotency/Premium fields. Existing route/signature tests now apply both migrations.
- **31 mobile tests** pass; full TypeScript and CI TypeScript checks pass. Expo lint has no errors and six existing array-type warnings. No mobile code or build settings change in this follow-up.
- **41 live staging checks** pass using `tests/staging-reward-lockdown.sql`. Actual client roles cannot call either old RPC; trusted server calls remain valid. Signed-verification database processing grants once despite repeated callbacks/claims, rejects transaction reuse and preserves all Premium/RevenueCat/reserved fields. Fixtures are synthetic and the transaction rolls back; all 27 application tables, Auth users and Storage objects/buckets remain empty.

Catalog comparison confirms the only staging changes are the two legacy functions' execution ACLs. All function bodies/owners, existing verified RPCs, table definitions, indexes, triggers, policies, RLS and default grants are unchanged. Supabase's anonymous and authenticated SECURITY DEFINER advisor findings each decrease by two; the legacy reward functions disappear from those findings. Other inherited findings are outside this targeted fix.

Google ECDSA validation remains in the API and is covered by generated real-signature route/unit tests. Live staging SQL uses synthetic verified transactions; real Google delivery and physical-device behavior still need a separately authorized staging API/device trial.

No production migration, Render deployment, mobile build or publication occurred. The follow-up is on a separate review branch based on the backend SSV PR, so production release branches remain unchanged.

Reference: [Supabase function execution guidance](https://supabase.com/docs/guides/observability/advisors?queryGroups=lint&lint=0029_authenticated_security_definer_function_executable).
