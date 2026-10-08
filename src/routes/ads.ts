import { createHmac } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { env } from "../config/env.js";
import { requireAuth, requireIdempotencyKey } from "../lib/auth.js";
import { ApiError, mapDatabaseError } from "../lib/errors.js";
import { randomToken, safeEqual, sha256, stableJson } from "../lib/hash.js";
import { runIdempotent } from "../lib/idempotency.js";
import { serviceSupabase } from "../lib/supabase.js";
import { UuidSchema, parseBody } from "../lib/validation.js";
import { adMobVerifier } from "../lib/admob.js";

export const adRoutes: FastifyPluginAsync = async (app) => {
  app.post("/ad-rewards/challenges", { preHandler: requireAuth }, async (request, reply) => {
    const body = parseBody(z.object({ provider: z.string().min(1).max(100), placement: z.literal("scan_unlock").default("scan_unlock") }), request.body);
    if (body.provider === "admob" && env.ADMOB_REWARDED_AD_UNIT_IDS.length === 0) {
      throw new ApiError(503, "admob_not_configured", "AdMob rewarded ad units are not configured.");
    }
    const key = requireIdempotencyKey(request);
    const result = await runIdempotent({
      userId: request.auth.userId,
      endpoint: "/ad-rewards/challenges",
      key,
      requestBody: body,
      execute: async () => {
        const token = randomToken();
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
        const { data, error } = await serviceSupabase.from("ad_reward_challenges").insert({
          user_id: request.auth.userId,
          provider: body.provider,
          placement: body.placement,
          challenge_token_hash: sha256(token),
          expires_at: expiresAt,
        }).select("id").single();
        if (error) throw mapDatabaseError(error);
        return {
          status: 201,
          body: { challenge_id: data.id, challenge_token: token, expires_at: expiresAt },
          resourceType: "ad_reward_challenge",
          resourceId: data.id,
        };
      },
    });
    return reply.status(result.status).send(result.body);
  });

  app.post("/ad-rewards/claims", { preHandler: requireAuth }, async (request, reply) => {
    const body = parseBody(z.object({ challenge_id: UuidSchema, provider_transaction_id: z.string().min(1).max(500).optional() }), request.body);
    const key = requireIdempotencyKey(request);
    const { data: challenge, error: challengeError } = await serviceSupabase.from("ad_reward_challenges")
      .select("user_id, provider, status, provider_transaction_id, expires_at").eq("id", body.challenge_id).maybeSingle();
    if (challengeError) throw mapDatabaseError(challengeError);
    if (!challenge || challenge.user_id !== request.auth.userId) throw new ApiError(404, "challenge_not_found", "Ad reward challenge not found.");
    const isAdMob = challenge.provider === "admob";
    if (isAdMob && (challenge.status === "pending" || challenge.status === "expired")) {
      if (Date.now() > new Date(challenge.expires_at).getTime() + 24 * 60 * 60 * 1000) {
        throw new ApiError(410, "ad_reward_expired", "The ad reward verification window has ended.");
      }
      // Never cache a pending response in idempotency_records. The same request
      // must be able to succeed once the delayed Google callback arrives.
      return reply.header("Retry-After", "2").status(202).send({
        granted: false, status: "verification_pending", retry_after_ms: 1500,
      });
    }
    if (isAdMob && challenge.status !== "verified" && challenge.status !== "claimed") {
      throw new ApiError(409, "ad_reward_rejected", "The ad reward cannot be claimed.");
    }
    // Existing builds supply a client-* ID. For AdMob, only the ID established
    // by Google's signature is authoritative, including on legacy requests.
    const transactionId = isAdMob ? challenge.provider_transaction_id : body.provider_transaction_id;
    if (!transactionId) throw new ApiError(400, "provider_transaction_required", "A verified provider transaction is required.");
    const result = await runIdempotent({
      userId: request.auth.userId,
      endpoint: "/ad-rewards/claims",
      key,
      requestBody: isAdMob ? { challenge_id: body.challenge_id } : body,
      execute: async () => {
        const { data, error } = await serviceSupabase.rpc("grant_rewarded_ad_credit", {
          p_challenge_id: body.challenge_id,
          p_provider_transaction_id: transactionId,
        });
        if (error) throw mapDatabaseError(error);
        return { status: 200, body: data };
      },
    });
    return reply.status(result.status).send(result.body);
  });

  app.get("/ad-rewards/challenges/:challenge_id", { preHandler: requireAuth }, async (request) => {
    const { challenge_id } = z.object({ challenge_id: UuidSchema }).parse(request.params);
    const { data, error } = await serviceSupabase.from("ad_reward_challenges")
      .select("id, user_id, status, provider_transaction_id, expires_at").eq("id", challenge_id).maybeSingle();
    if (error) throw mapDatabaseError(error);
    if (!data || data.user_id !== request.auth.userId) throw new ApiError(404, "challenge_not_found", "Ad reward challenge not found.");
    return {
      challenge_id: data.id, status: data.status, granted: data.status === "claimed",
      provider_transaction_id: data.status === "verified" || data.status === "claimed" ? data.provider_transaction_id : null,
      expires_at: data.expires_at,
    };
  });
};

export const adWebhookRoutes: FastifyPluginAsync = async (app) => {
  app.get("/webhooks/admob/ssv", async (request, reply) => {
    const reward = await adMobVerifier.verifyCallback(request.raw.url ?? "", env.ADMOB_REWARDED_AD_UNIT_IDS);
    const { error } = await serviceSupabase.rpc("record_admob_reward", {
      p_challenge_id: reward.challengeId, p_challenge_token_hash: sha256(reward.challengeToken),
      p_user_id: reward.userId, p_transaction_id: reward.transactionId,
      p_rewarded_at: reward.rewardedAt, p_ad_unit: reward.adUnit,
    });
    if (error) throw mapDatabaseError(error);
    // Google requires 200 (not 204) and retries callbacks that fail.
    return reply.status(200).send({ status: "ok" });
  });

  app.post("/webhooks/ad-provider", async (request, reply) => {
    if (!env.AD_WEBHOOK_SECRET) throw new ApiError(503, "webhook_not_configured", "AD_WEBHOOK_SECRET is not configured.");
    const signatureHeader = request.headers["x-webhook-signature"];
    const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
    const body = parseBody(z.object({
      event_id: z.string().min(1),
      challenge_id: UuidSchema,
      challenge_token: z.string().min(1),
      provider_transaction_id: z.string().min(1),
      status: z.literal("verified"),
    }), request.body);
    const expected = createHmac("sha256", env.AD_WEBHOOK_SECRET).update(stableJson(body)).digest("hex");
    if (!signature || !safeEqual(signature, expected)) throw new ApiError(401, "invalid_webhook_signature", "Invalid ad-provider webhook signature.");

    const { data: challenge, error } = await serviceSupabase.from("ad_reward_challenges").select("id, user_id, provider, status, provider_transaction_id, challenge_token_hash, expires_at").eq("id", body.challenge_id).maybeSingle();
    if (error) throw mapDatabaseError(error);
    if (!challenge || challenge.challenge_token_hash !== sha256(body.challenge_token)) throw new ApiError(401, "invalid_challenge", "The ad challenge is invalid.");
    if (challenge.provider === "admob") throw new ApiError(403, "admob_ssv_required", "AdMob rewards require Google's signed SSV callback.");
    if (challenge.status === "claimed" || challenge.status === "verified") {
      if (challenge.provider_transaction_id !== body.provider_transaction_id) throw new ApiError(409, "conflict", "The challenge already has a different transaction.");
      return reply.status(204).send();
    }
    if (challenge.status !== "pending" || new Date(challenge.expires_at) <= new Date()) throw new ApiError(400, "challenge_expired", "The ad challenge expired.");

    const { error: eventError } = await serviceSupabase.from("webhook_events").upsert({
      provider: "ad_provider",
      external_event_id: body.event_id,
      event_type: "verified_reward",
      user_id: challenge.user_id,
      signature_verified: true,
      processing_status: "processed",
      payload: body,
      verified_at: new Date().toISOString(),
      processed_at: new Date().toISOString(),
      retention_until: new Date(Date.now() + 90 * 86_400_000).toISOString(),
    }, { onConflict: "provider,external_event_id", ignoreDuplicates: true });
    if (eventError) throw mapDatabaseError(eventError);

    const { error: updateError } = await serviceSupabase.from("ad_reward_challenges").update({
      status: "verified",
      provider_transaction_id: body.provider_transaction_id,
      verified_at: new Date().toISOString(),
    }).eq("id", body.challenge_id).eq("user_id", challenge.user_id).eq("status", "pending");
    if (updateError) throw mapDatabaseError(updateError);
    return reply.status(204).send();
  });
};
