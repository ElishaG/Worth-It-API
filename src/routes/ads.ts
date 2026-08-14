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

export const adRoutes: FastifyPluginAsync = async (app) => {
  app.post("/ad-rewards/challenges", { preHandler: requireAuth }, async (request, reply) => {
    const body = parseBody(z.object({ provider: z.string().min(1).max(100), placement: z.literal("scan_unlock").default("scan_unlock") }), request.body);
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
    const body = parseBody(z.object({ challenge_id: UuidSchema, provider_transaction_id: z.string().min(1).max(500) }), request.body);
    const key = requireIdempotencyKey(request);
    const result = await runIdempotent({
      userId: request.auth.userId,
      endpoint: "/ad-rewards/claims",
      key,
      requestBody: body,
      execute: async () => {
        const { data: challenge, error: challengeError } = await serviceSupabase.from("ad_reward_challenges").select("user_id").eq("id", body.challenge_id).maybeSingle();
        if (challengeError) throw mapDatabaseError(challengeError);
        if (!challenge || challenge.user_id !== request.auth.userId) throw new ApiError(404, "challenge_not_found", "Ad reward challenge not found.");
        const { data, error } = await serviceSupabase.rpc("grant_rewarded_ad_credit", {
          p_challenge_id: body.challenge_id,
          p_provider_transaction_id: body.provider_transaction_id,
        });
        if (error) throw mapDatabaseError(error);
        return { status: 200, body: data };
      },
    });
    return reply.status(result.status).send(result.body);
  });
};

export const adWebhookRoutes: FastifyPluginAsync = async (app) => {
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

    const { data: challenge, error } = await serviceSupabase.from("ad_reward_challenges").select("id, user_id, challenge_token_hash, expires_at").eq("id", body.challenge_id).maybeSingle();
    if (error) throw mapDatabaseError(error);
    if (!challenge || challenge.challenge_token_hash !== sha256(body.challenge_token)) throw new ApiError(401, "invalid_challenge", "The ad challenge is invalid.");
    if (new Date(challenge.expires_at) <= new Date()) throw new ApiError(400, "challenge_expired", "The ad challenge expired.");

    await serviceSupabase.from("webhook_events").upsert({
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

    const { error: updateError } = await serviceSupabase.from("ad_reward_challenges").update({
      status: "verified",
      provider_transaction_id: body.provider_transaction_id,
      verified_at: new Date().toISOString(),
    }).eq("id", body.challenge_id).eq("user_id", challenge.user_id);
    if (updateError) throw mapDatabaseError(updateError);
    return reply.status(204).send();
  });
};
