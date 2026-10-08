import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const user = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const challenge = "00000000-0000-4000-8000-000000000003";
const second = "00000000-0000-4000-8000-000000000004";
const tx = "abcdef0123456789abcdef0123456789";
let db: PGlite;
let earned: string;
const migration = readFileSync(new URL("../supabase/migrations/20261008014752_admob_reward_verification.sql", import.meta.url), "utf8");

async function record(id = challenge, transaction = tx, options: { token?: string; user?: string; time?: string } = {}) {
  return (await db.query<{ result: { granted: boolean; already_claimed: boolean; provider_transaction_id: string } }>(
    "select public.record_admob_reward($1::uuid,$2,$3::uuid,$4,$5::timestamptz,$6) as result",
    [id, options.token ?? "token-hash", options.user ?? user, transaction, options.time ?? earned, "8982386338"],
  )).rows[0]!.result;
}

beforeEach(async () => {
  db = new PGlite();
  await db.exec(readFileSync(new URL("./fixtures/reward-schema.sql", import.meta.url), "utf8"));
  await db.exec(migration);
  await db.exec(`set request.jwt.claim.role = 'service_role';
    insert into profiles values ('${user}'),('${other}');
    insert into account_entitlements(user_id,available_scan_credits,reserved_scan_credits,premium_active,
      premium_product_id,premium_store,premium_expires_at,revenuecat_app_user_id) values
      ('${user}',3,2,true,'com.worthitscan.app.premium.monthly','app_store',now()+interval '30 days','rc-original'),
      ('${other}',0,0,false,null,null,null,null);
    insert into ad_reward_challenges(id,user_id,provider,challenge_token_hash,created_at,expires_at) values
      ('${challenge}','${user}','admob','token-hash',now()-interval '1 minute',now()+interval '14 minutes'),
      ('${second}','${user}','admob','second-hash',now()-interval '1 minute',now()+interval '14 minutes');`);
  earned = (await db.query<{ time: string }>("select now()::text as time")).rows[0]!.time;
});
afterEach(async () => { await db?.close(); });

describe("transactional reward migration", () => {
  it("records, verifies and grants atomically; preserves Premium, reserved credits and RevenueCat fields", async () => {
    const before = (await db.query("select * from account_entitlements where user_id=$1", [user])).rows[0]!;
    expect(await record()).toMatchObject({ granted: true, already_claimed: false, provider_transaction_id: tx });
    const after = (await db.query("select * from account_entitlements where user_id=$1", [user])).rows[0]!;
    for (const key of Object.keys(before).filter(k => !["available_scan_credits","version","updated_at"].includes(k))) {
      expect(after[key]).toEqual(before[key]);
    }
    expect(after.available_scan_credits).toBe(4);
    const reward = (await db.query("select status,provider_transaction_id from ad_reward_challenges where id=$1", [challenge])).rows[0]!;
    expect(reward).toEqual({ status: "claimed", provider_transaction_id: tx });
    expect((await db.query("select payload from webhook_events")).rows[0]!.payload).not.toHaveProperty("challenge_token");
  });

  it("duplicate callbacks and repeated claims grant once, including after expiry", async () => {
    const results = await Promise.all([record(), record(), record()]);
    expect(results.filter(r => !r.already_claimed)).toHaveLength(1);
    await db.exec(`update ad_reward_challenges set created_at=now()-interval '2 days',expires_at=now()-interval '1 day' where id='${challenge}';`);
    expect(await record()).toMatchObject({ already_claimed: true });
    const result = (await db.query("select grant_rewarded_ad_credit($1::uuid,$2) as result", [challenge,tx])).rows[0]!.result;
    expect(result).toMatchObject({ granted: true, already_claimed: true });
    expect((await db.query("select count(*)::int as n from entitlement_events")).rows[0]!.n).toBe(1);
    expect((await db.query("select count(*)::int as n from webhook_events")).rows[0]!.n).toBe(1);
  });

  it("accepts delayed valid earned times even when challenge is marked expired", async () => {
    await db.exec(`update ad_reward_challenges set created_at=now()-interval '2 hours',
      expires_at=now()-interval '105 minutes',status='expired' where id='${challenge}';`);
    const time = (await db.query<{ time:string }>("select (now()-interval '110 minutes')::text as time")).rows[0]!.time;
    expect(await record(challenge,tx,{time})).toMatchObject({ granted:true });
  });

  it("rejects pending claims, wrong users/tokens, and fabricated transaction IDs", async () => {
    await expect(db.query("select grant_rewarded_ad_credit($1::uuid,$2)",[challenge,tx])).rejects.toMatchObject({code:"23514"});
    await expect(record(challenge,tx,{user:other})).rejects.toMatchObject({code:"42501"});
    await expect(record(challenge,tx,{token:"wrong"})).rejects.toMatchObject({code:"42501"});
    await record();
    await expect(db.query("select grant_rewarded_ad_credit($1::uuid,$2)",[challenge,"client-fake"])).rejects.toMatchObject({code:"23505"});
  });

  it("rejects a second transaction for a challenge and a reused transaction on another challenge", async () => {
    await record();
    await expect(record(challenge,"11111111111111111111111111111111")).rejects.toMatchObject({code:"23505"});
    await expect(record(second,tx,{token:"second-hash"})).rejects.toMatchObject({code:"23505"});
    expect((await db.query("select available_scan_credits as n from account_entitlements where user_id=$1",[user])).rows[0]!.n).toBe(4);
  });

  it.each(["now()-interval '2 minutes'","now()+interval '16 minutes'","now()+interval '6 minutes'"])("rejects reward outside challenge/clock window: %s",async expression=>{
    const time = (await db.query<{time:string}>(`select (${expression})::text as time`)).rows[0]!.time;
    await expect(record(challenge,tx,{time})).rejects.toMatchObject({code:"22023"});
  });

  it("rolls verification, audit and credit back together when the grant fails",async()=>{
    await db.exec(`delete from account_entitlements where user_id='${user}';`);
    await expect(record()).rejects.toMatchObject({code:"P0002"});
    expect((await db.query("select status from ad_reward_challenges where id=$1",[challenge])).rows[0]!.status).toBe("pending");
    expect((await db.query("select count(*)::int as n from webhook_events")).rows[0]!.n).toBe(0);
  });

  it("requires service role, revokes public execution, and retains table RLS",async()=>{
    await db.exec("set request.jwt.claim.role='authenticated';");
    await expect(record()).rejects.toMatchObject({code:"42501"});
    const access = await db.query("select has_function_privilege('authenticated', 'public.record_admob_reward(uuid,text,uuid,text,timestamptz,text)','EXECUTE') as allowed");
    expect(access.rows[0]!.allowed).toBe(false);
    const rls=await db.query("select bool_and(relrowsecurity) as enabled from pg_class where relname in ('ad_reward_challenges','account_entitlements','entitlement_events','webhook_events')");
    expect(rls.rows[0]!.enabled).toBe(true);
    await db.exec(migration); // Reapplying the migration is safe.
  });
});
