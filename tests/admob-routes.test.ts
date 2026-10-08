import { createHmac, generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import Fastify, { type FastifyInstance } from "fastify";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ db: null as PGlite | null, executions: 0 }));
vi.mock("../src/config/env.js", () => ({ env: { ADMOB_REWARDED_AD_UNIT_IDS: ["8982386338"], AD_WEBHOOK_SECRET: "test-secret" } }));
vi.mock("../src/lib/auth.js", () => ({
  requireAuth: async (request: { auth: unknown; headers: Record<string,string> }) => {
    request.auth = { userId: request.headers.authorization === "Bearer other" ?
      "00000000-0000-4000-8000-000000000009" : "00000000-0000-4000-8000-000000000001" };
  },
  requireIdempotencyKey: (request: { headers: Record<string,string> }) => request.headers["idempotency-key"],
}));
vi.mock("../src/lib/idempotency.js", () => ({ runIdempotent: async (input: { execute: () => Promise<unknown> }) => {
  state.executions++;
  return input.execute();
} }));
vi.mock("../src/lib/supabase.js", () => ({ serviceSupabase: {
  from: (table: string) => {
    let columns = "*";
    const filters: [string,unknown][] = [];
    const builder = {
      select: (selection: string) => { columns = selection; return builder; },
      eq: (field: string, value: unknown) => { filters.push([field,value]); return builder; },
      maybeSingle: async () => ({ data: (await state.db!.query(`select ${columns} from ${table} where ${filters.map(([k], i) => `${k}=$${i+1}`).join(" and ")}`,
        filters.map(([,v]) => v))).rows[0] ?? null, error: null }),
    };
    return builder;
  },
  rpc: async (name: string, args: Record<string,string>) => {
    try {
      const ordered = name === "record_admob_reward" ? ["p_challenge_id","p_challenge_token_hash","p_user_id","p_transaction_id","p_rewarded_at","p_ad_unit"] :
        ["p_challenge_id","p_provider_transaction_id"];
      const placeholders = name === "record_admob_reward" ? "$1::uuid,$2,$3::uuid,$4,$5::timestamptz,$6" : "$1::uuid,$2";
      return { data: (await state.db!.query(`select public.${name}(${placeholders}) as result`, ordered.map(k => args[k]))).rows[0]!.result, error: null };
    } catch (error) { return { data: null, error }; }
  },
} }));

import { adRoutes, adWebhookRoutes } from "../src/routes/ads.js";
import { AdMobVerifier, adMobVerifier } from "../src/lib/admob.js";
import { sha256, stableJson } from "../src/lib/hash.js";
import { sendError } from "../src/lib/errors.js";

const user = "00000000-0000-4000-8000-000000000001";
const challenge = "00000000-0000-4000-8000-000000000003";
const tx = "abcdef0123456789abcdef0123456789";
const { privateKey,publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
let app: FastifyInstance;
const headers = { authorization: "Bearer owner", "idempotency-key": "reward-claim-stable-key" };

function callback() {
  const query = Object.entries({ ad_network:"5450213213286189855",ad_unit:"8982386338",
    custom_data:JSON.stringify({challenge_id:challenge,challenge_token:"secret-token"}),
    reward_amount:"1",reward_item:"scan",timestamp:String(Date.now()),transaction_id:tx,user_id:user,
  }).map(([k,v])=>`${k}=${encodeURIComponent(v)}`).join("&");
  return `/v1/webhooks/admob/ssv?${query}&signature=${sign("sha256",Buffer.from(decodeURIComponent(query)),privateKey).toString("base64url")}&key_id=1234`;
}

beforeEach(async () => {
  state.db = new PGlite(); state.executions = 0;
  await state.db.exec(readFileSync(new URL("./fixtures/reward-schema.sql",import.meta.url),"utf8"));
  await state.db.exec(readFileSync(new URL("./fixtures/legacy-reward-functions.sql",import.meta.url),"utf8"));
  await state.db.exec(readFileSync(new URL("../supabase/migrations/20261008014752_admob_reward_verification.sql",import.meta.url),"utf8"));
  await state.db.exec(readFileSync(new URL("../supabase/migrations/20261008023317_restrict_legacy_reward_rpcs.sql",import.meta.url),"utf8"));
  await state.db.exec(`set request.jwt.claim.role='service_role';
    insert into profiles values ('${user}'); insert into account_entitlements(user_id) values ('${user}');
    insert into ad_reward_challenges(id,user_id,provider,challenge_token_hash,created_at,expires_at)
    values ('${challenge}','${user}','admob','${sha256("secret-token")}',now()-interval '1 minute',now()+interval '14 minutes');`);
  const verifier = new AdMobVerifier(async () => new Response(JSON.stringify({ keys:[{keyId:1234,pem:publicKey.export({type:"spki",format:"pem"}).toString()}] })));
  vi.spyOn(adMobVerifier,"verifyCallback").mockImplementation((url,units)=>verifier.verifyCallback(url,units));
  app = Fastify(); app.setErrorHandler(sendError);
  await app.register(async v1 => { await v1.register(adRoutes); await v1.register(adWebhookRoutes); }, {prefix:"/v1"});
});
afterEach(async () => { await app.close(); await state.db!.close(); vi.restoreAllMocks(); });

describe("SSV to mobile claim integration",()=>{
  it("returns pending without idempotency caching; later succeeds with same key and real transaction",async()=>{
    const pending=await app.inject({method:"POST",url:"/v1/ad-rewards/claims",headers,payload:{challenge_id:challenge}});
    expect(pending.statusCode).toBe(202); expect(pending.json()).toMatchObject({granted:false,status:"verification_pending"});
    expect(state.executions).toBe(0);
    expect((await app.inject({url:callback()})).statusCode).toBe(200);
    const status=await app.inject({url:`/v1/ad-rewards/challenges/${challenge}`,headers});
    expect(status.json()).toMatchObject({granted:true,status:"claimed",provider_transaction_id:tx});
    for(let i=0;i<3;i++) {
      const claim=await app.inject({method:"POST",url:"/v1/ad-rewards/claims",headers,payload:{challenge_id:challenge,provider_transaction_id:tx}});
      expect(claim.statusCode).toBe(200); expect(claim.json()).toMatchObject({granted:true,already_claimed:true,provider_transaction_id:tx});
    }
    expect((await state.db!.query("select available_scan_credits as n from account_entitlements")).rows[0]!.n).toBe(1);
  });
  it("duplicate signed callbacks return 200 and grant only once, even after claim expiry",async()=>{
    const url=callback();
    expect((await app.inject({url})).statusCode).toBe(200);
    await state.db!.exec(`update ad_reward_challenges set created_at=now()-interval '2 days',expires_at=now()-interval '1 day';`);
    expect((await app.inject({url})).statusCode).toBe(200);
    expect((await state.db!.query("select count(*)::int as n from entitlement_events")).rows[0]!.n).toBe(1);
  });
  it("supports old builds' client IDs without trusting them",async()=>{
    await app.inject({url:callback()});
    const claim=await app.inject({method:"POST",url:"/v1/ad-rewards/claims",headers,payload:{challenge_id:challenge,provider_transaction_id:"client-fabricated"}});
    expect(claim.statusCode).toBe(200); expect(claim.json().provider_transaction_id).toBe(tx);
  });
  it("invalid signatures never reach verification or credit writes",async()=>{
    const result=await app.inject({url:callback().replace("reward_amount=1","reward_amount=2")});
    expect(result.statusCode).toBe(401);
    expect((await state.db!.query("select status from ad_reward_challenges")).rows[0]!.status).toBe("pending");
    expect((await state.db!.query("select count(*)::int as n from webhook_events")).rows[0]!.n).toBe(0);
  });
  it("hides other users' reward status and claims",async()=>{
    const otherHeaders={...headers,authorization:"Bearer other"};
    expect((await app.inject({url:`/v1/ad-rewards/challenges/${challenge}`,headers:otherHeaders})).statusCode).toBe(404);
    expect((await app.inject({method:"POST",url:"/v1/ad-rewards/claims",headers:otherHeaders,payload:{challenge_id:challenge}})).statusCode).toBe(404);
  });
  it("generic HMAC cannot verify AdMob challenges",async()=>{
    const body={event_id:"event-1",challenge_id:challenge,challenge_token:"secret-token",provider_transaction_id:"fake",status:"verified"};
    const result=await app.inject({method:"POST",url:"/v1/webhooks/ad-provider",headers:{"x-webhook-signature":createHmac("sha256","test-secret").update(stableJson(body)).digest("hex")},payload:body});
    expect(result.statusCode).toBe(403); expect(result.json().error.code).toBe("admob_ssv_required");
  });
});
