import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { env } from "../config/env.js";
import { ApiError, mapDatabaseError } from "../lib/errors.js";
import { safeEqual } from "../lib/hash.js";
import { serviceSupabase } from "../lib/supabase.js";
import { parseBody } from "../lib/validation.js";
import type { Json } from "../database.types.js";

const RevenueCatEvent = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  app_user_id: z.string().min(1),
  aliases: z.array(z.string()).optional(),
  entitlement_ids: z.array(z.string()).optional(),
  product_id: z.string().nullable().optional(),
  store: z.string().nullable().optional(),
  purchased_at_ms: z.number().nullable().optional(),
  expiration_at_ms: z.number().nullable().optional(),
  grace_period_expiration_at_ms: z.number().nullable().optional(),
  event_timestamp_ms: z.number().optional(),
}).passthrough();

function isoFromMs(value: number | null | undefined): string | null {
  return value == null ? null : new Date(value).toISOString();
}

function isUuid(value: string): boolean {
  return z.string().uuid().safeParse(value).success;
}

function resolveWorthItUserId(event: z.infer<typeof RevenueCatEvent>): string {
  if (isUuid(event.app_user_id)) return event.app_user_id;

  const aliasUserId = event.aliases?.find((alias) => isUuid(alias));
  if (aliasUserId) return aliasUserId;

  throw new ApiError(
    400,
    "revenuecat_user_unresolved",
    "RevenueCat event does not contain a Worth It user UUID in app_user_id or aliases.",
  );
}

function mapEvent(type: string): { eventType: "premium_activated" | "premium_renewed" | "premium_expired" | "premium_revoked" | "premium_restored"; active: boolean } | null {
  switch (type) {
    case "INITIAL_PURCHASE":
      return { eventType: "premium_activated", active: true };
    case "RENEWAL":
      return { eventType: "premium_renewed", active: true };
    case "UNCANCELLATION":
    case "SUBSCRIPTION_EXTENDED":
      return { eventType: "premium_restored", active: true };
    case "EXPIRATION":
      return { eventType: "premium_expired", active: false };
    case "REFUND":
      return { eventType: "premium_revoked", active: false };
    default:
      // In particular, TEMPORARY_ENTITLEMENT_GRANT is deliberately ignored.
      // Worth It must not mark an account premium unless RevenueCat reports a
      // completed subscription lifecycle event backed by the App Store.
      return null;
  }
}

export const revenueCatWebhookRoutes: FastifyPluginAsync = async (app) => {
  app.post("/webhooks/revenuecat", async (request, reply) => {
    if (!env.REVENUECAT_WEBHOOK_AUTH) throw new ApiError(503, "webhook_not_configured", "REVENUECAT_WEBHOOK_AUTH is not configured.");
    const authorization = request.headers.authorization ?? "";
    if (!safeEqual(authorization, env.REVENUECAT_WEBHOOK_AUTH)) throw new ApiError(401, "invalid_webhook_authorization", "Invalid RevenueCat webhook authorization.");

    const body = parseBody(z.object({ api_version: z.string().optional(), event: RevenueCatEvent }), request.body);
    const event = body.event;
    const worthItUserId = resolveWorthItUserId(event);
    const mapping = mapEvent(event.type);
    const entitlementMatches = event.entitlement_ids?.includes(env.REVENUECAT_ENTITLEMENT_ID) ?? false;

    const { error: eventInsertError } = await serviceSupabase.from("webhook_events").upsert({
      provider: "revenuecat",
      external_event_id: event.id,
      event_type: event.type,
      user_id: worthItUserId,
      signature_verified: true,
      processing_status: mapping && entitlementMatches ? "verified" : "processed",
      payload: JSON.parse(JSON.stringify(body)) as Json,
      verified_at: new Date().toISOString(),
      processed_at: mapping && entitlementMatches ? null : new Date().toISOString(),
      retention_until: new Date(Date.now() + 365 * 86_400_000).toISOString(),
    }, { onConflict: "provider,external_event_id", ignoreDuplicates: true });
    if (eventInsertError) throw mapDatabaseError(eventInsertError);

    if (mapping && entitlementMatches) {
      const { error } = await serviceSupabase.rpc("apply_premium_entitlement", {
        p_user_id: worthItUserId,
        p_event_type: mapping.eventType,
        p_external_event_id: event.id,
        p_active: mapping.active,
        p_product_id: event.product_id ?? "",
        p_store: event.store ?? "",
        p_started_at: isoFromMs(event.purchased_at_ms),
        p_expires_at: isoFromMs(event.expiration_at_ms),
        p_grace_ends_at: isoFromMs(event.grace_period_expiration_at_ms),
        p_revenuecat_app_user_id: event.app_user_id,
        p_metadata: body,
      } as never);
      if (error) {
        await serviceSupabase.from("webhook_events").update({ processing_status: "failed", error_code: error.code, error_detail: error.message }).eq("provider", "revenuecat").eq("external_event_id", event.id);
        throw mapDatabaseError(error);
      }
      await serviceSupabase.from("webhook_events").update({ processing_status: "processed", processed_at: new Date().toISOString() }).eq("provider", "revenuecat").eq("external_event_id", event.id);
    }

    return reply.status(200).send({ received: true });
  });
};
