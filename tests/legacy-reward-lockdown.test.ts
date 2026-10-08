import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const owner = "00000000-0000-4000-8000-000000000001";
const freeUser = "00000000-0000-4000-8000-000000000002";
const challenge = "00000000-0000-4000-8000-000000000003";
const event = "00000000-0000-4000-8000-000000000004";
const tx = "abcdef0123456789abcdef0123456789";
const lockdown = readFileSync(new URL("../supabase/migrations/20261008023317_restrict_legacy_reward_rpcs.sql", import.meta.url), "utf8");
let db: PGlite;

async function asRole<T>(role: "anon" | "authenticated" | "service_role", run: () => Promise<T>, user = freeUser): Promise<T> {
  await db.exec(`set request.jwt.claim.role='${role}'; set request.jwt.claim.sub='${user}'; set role ${role};`);
  try { return await run(); } finally { await db.exec("reset role;"); }
}

async function balance(user = freeUser) {
  return (await db.query<{ available_scan_credits: number }>("select available_scan_credits from account_entitlements where user_id=$1", [user])).rows[0]!.available_scan_credits;
}

async function verify() {
  return (await db.query<{ result: { granted: boolean; already_claimed: boolean } }>(
    "select public.record_admob_reward($1::uuid,'token-hash',$2::uuid,$3,now(),'8982386338') as result", [challenge, owner, tx],
  )).rows[0]!.result;
}

beforeEach(async () => {
  db = new PGlite();
  for (const file of ["./fixtures/reward-schema.sql", "./fixtures/legacy-reward-functions.sql", "../supabase/migrations/20261008014752_admob_reward_verification.sql"]) {
    await db.exec(readFileSync(new URL(file, import.meta.url), "utf8"));
  }
  await db.exec(`insert into profiles values ('${owner}'),('${freeUser}');
    insert into account_entitlements(user_id,available_scan_credits,reserved_scan_credits,premium_active,
      premium_product_id,premium_store,premium_expires_at,revenuecat_app_user_id) values
      ('${owner}',7,2,true,'original-premium','app_store',now()+interval '30 days','original-rc'),
      ('${freeUser}',3,1,false,null,null,null,null);
    insert into ad_reward_challenges(id,user_id,provider,challenge_token_hash,created_at,expires_at)
      values('${challenge}','${owner}','admob','token-hash',now()-interval '1 minute',now()+interval '14 minutes');`);
});

afterEach(async () => { await db?.close(); });

describe("legacy reward RPC lockdown", () => {
  it("reproduces both old client bypasses then rejects them after migration", async () => {
    await asRole("authenticated", async () => {
      await db.query("select public.reward_ad_scan()");
      await db.query("select public.claim_rewarded_ad_scan($1::uuid)", [event]);
    });
    expect(await balance()).toBe(5);
    await db.exec(lockdown);
    await asRole("authenticated", async () => {
      await expect(db.query("select public.reward_ad_scan()")).rejects.toMatchObject({ code: "42501" });
      await expect(db.query("select public.claim_rewarded_ad_scan($1::uuid)", [event])).rejects.toMatchObject({ code: "42501" });
    });
    expect(await balance()).toBe(5);
  });

  it.each(["anon", "authenticated"] as const)("rejects %s execution before any balance or ledger change", async (role) => {
    await db.exec(lockdown);
    const before = (await db.query("select * from account_entitlements order by user_id")).rows;
    await asRole(role, async () => {
      await expect(db.query("select public.reward_ad_scan()")).rejects.toMatchObject({ code: "42501" });
      await expect(db.query("select public.claim_rewarded_ad_scan($1::uuid)", [event])).rejects.toMatchObject({ code: "42501" });
    });
    expect((await db.query("select * from account_entitlements order by user_id")).rows).toEqual(before);
    expect((await db.query<{ n: number }>("select count(*)::int n from entitlement_events")).rows[0]!.n).toBe(0);
  });

  it("does not trust a service JWT claim under the authenticated SQL role", async () => {
    await db.exec(lockdown);
    await asRole("authenticated", async () => {
      await db.exec("set request.jwt.claim.role='service_role';");
      await expect(db.query("select public.reward_ad_scan()")).rejects.toMatchObject({ code: "42501" });
      await expect(db.query("select public.claim_rewarded_ad_scan($1::uuid)", [event])).rejects.toMatchObject({ code: "42501" });
    });
    expect(await balance()).toBe(3);
  });

  it("keeps trusted service calls and legacy duplicate/cap behavior intact", async () => {
    await db.exec(lockdown);
    await asRole("service_role", async () => {
      await db.query("select public.reward_ad_scan()");
      const first = await db.query<{ result: { granted: boolean } }>("select public.claim_rewarded_ad_scan($1::uuid) as result", [event]);
      expect(first.rows[0]!.result.granted).toBe(true);
      const repeat = await db.query<{ result: { duplicate: boolean } }>("select public.claim_rewarded_ad_scan($1::uuid) as result", [event]);
      expect(repeat.rows[0]!.result.duplicate).toBe(true);
      await expect(db.query("select public.claim_rewarded_ad_scan(gen_random_uuid())")).rejects.toMatchObject({ code: "23514" });
    });
    expect(await balance()).toBe(5);
  });

  it("changes only legacy client execution grants and is safe to reapply", async () => {
    const definitions = "select p.oid::regprocedure::text as identity,pg_get_functiondef(p.oid) as definition,p.proowner,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by identity";
    const beforeFunctions = (await db.query(definitions)).rows;
    const beforeRows = (await db.query("select * from account_entitlements order by user_id")).rows;
    const beforeRls = (await db.query("select relname,relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by relname")).rows;
    const beforeDefaults = (await db.query("select * from pg_default_acl")).rows;
    await db.exec(lockdown);
    await db.exec(lockdown);
    expect((await db.query(definitions)).rows).toEqual(beforeFunctions);
    expect((await db.query("select * from account_entitlements order by user_id")).rows).toEqual(beforeRows);
    expect((await db.query("select relname,relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by relname")).rows).toEqual(beforeRls);
    expect((await db.query("select * from pg_default_acl")).rows).toEqual(beforeDefaults);
    for (const fn of ["public.reward_ad_scan()", "public.claim_rewarded_ad_scan(uuid)"]) {
      for (const role of ["anon", "authenticated", "service_role"]) {
        const access = await db.query<{ allowed: boolean }>("select has_function_privilege($1,$2,'EXECUTE') as allowed", [role, fn]);
        expect(access.rows[0]!.allowed).toBe(role === "service_role");
      }
    }
  });

  it("verified AdMob callback and repeated claims still grant exactly one scan", async () => {
    await db.exec(lockdown);
    await asRole("service_role", async () => {
      await expect(db.query("select public.grant_rewarded_ad_credit($1::uuid,$2)", [challenge, tx])).rejects.toMatchObject({ code: "23514" });
      expect(await verify()).toMatchObject({ granted: true, already_claimed: false });
      expect(await verify()).toMatchObject({ granted: true, already_claimed: true });
      for (let i = 0; i < 3; i++) await db.query("select public.grant_rewarded_ad_credit($1::uuid,$2)", [challenge, tx]);
    }, owner);
    expect(await balance(owner)).toBe(8);
    expect((await db.query<{ n: number }>("select count(*)::int n from entitlement_events")).rows[0]!.n).toBe(1);
    expect((await db.query<{ n: number }>("select count(*)::int n from webhook_events")).rows[0]!.n).toBe(1);
  });

  it("preserves RevenueCat activation/idempotency and Premium fields during a verified reward", async () => {
    await db.exec(lockdown);
    await asRole("service_role", async () => {
      const sql = "select public.apply_premium_entitlement($1::uuid,'premium_activated','rc-regression',true,'new-premium','app_store',now(),now()+interval '30 days',null,'rc-original','{}') as applied";
      expect((await db.query<{ applied: boolean }>(sql, [owner])).rows[0]!.applied).toBe(true);
      expect((await db.query<{ applied: boolean }>(sql, [owner])).rows[0]!.applied).toBe(false);
    }, owner);
    const snapshot = "select to_jsonb(e)-'available_scan_credits'-'version'-'updated_at' as fields from account_entitlements e where user_id=$1";
    const before = (await db.query(snapshot, [owner])).rows;
    await asRole("service_role", verify, owner);
    expect((await db.query(snapshot, [owner])).rows).toEqual(before);
    expect(await balance(owner)).toBe(8);
  });
});
