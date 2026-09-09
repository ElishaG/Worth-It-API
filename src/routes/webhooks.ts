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
  original_app_user_id: z.string().nullish(),
  aliases: z.array(z.string()).nullish(),
  entitlement_ids: z.array(z.string()).nullish(),
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

function isUuid(value: string | null | undefined): value is string {
  return Boolean(value) && z.string().uuid().safeParse(value).success;
}

function resolveWorthItUserId(event: z.infer<typeof RevenueCatEvent>): string | null {
  // RevenueCat recommends checking the current ID, original ID, and aliases.
  // Worth It uses the authenticated Supabase UUID as its custom App User ID.
  if (isUuid(event.app_user_id)) return event.app_user_id;
  if (isUuid(event.original_app_user_id)) return event.original_app_user_id;
  return event.aliases?.find((alias) => isUuid(alias)) ?? null;
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
      // CANCELLATION does not end access immediately, and temporary grants must
      // never be treated as proof of an App Store payment.
      return null;
  }
}

export const revenueCatWebhookRoutes: FastifyPluginAsync = async (app) => {
  app.post("/webhooks/revenuecat", async (request, reply) => {
    if (!env.REVENUECAT_WEBHOOK_AUTH) {
      throw new ApiError(503, "webhook_not_configured", "REVENUECAT_WEBHOOK_AUTH is not configured.");
    }
    const authorization = request.headers.authorization ?? "";
    if (!safeEqual(authorization, env.REVENUECAT_WEBHOOK_AUTH)) {
      throw new ApiError(401, "invalid_webhook_authorization", "Invalid RevenueCat webhook authorization.");
    }

    const body = parseBody(z.object({ api_version: z.string().optional(), event: RevenueCatEvent }), request.body);
    const event = body.event;
    const mapping = mapEvent(event.type);
    const entitlementMatches = event.entitlement_ids?.includes(env.REVENUECAT_ENTITLEMENT_ID) ?? false;
    const worthItUserId = resolveWorthItUserId(event);

    const shouldApply = Boolean(mapping && entitlementMatches && worthItUserId);
    const unresolvedPremiumEvent = Boolean(mapping && entitlementMatches && !worthItUserId);

    const { error: eventInsertError } = await serviceSupabase.from("webhook_events").upsert({
      provider: "revenuecat",
      external_event_id: event.id,
      event_type: event.type,
      user_id: worthItUserId,
      signature_verified: true,
      processing_status: shouldApply
        ? "verified"
        : unresolvedPremiumEvent
          ? "rejected"
          : "processed",
      error_code: unresolvedPremiumEvent ? "revenuecat_user_unresolved" : null,
      error_detail: unresolvedPremiumEvent
        ? "RevenueCat event did not contain the Worth It Supabase UUID in app_user_id, original_app_user_id, or aliases."
        : null,
      payload: JSON.parse(JSON.stringify(body)) as Json,
      verified_at: new Date().toISOString(),
      processed_at: shouldApply ? null : new Date().toISOString(),
      retention_until: new Date(Date.now() + 365 * 86_400_000).toISOString(),
    }, { onConflict: "provider,external_event_id", ignoreDuplicates: true });
    if (eventInsertError) throw mapDatabaseError(eventInsertError);

    if (shouldApply && mapping && worthItUserId) {
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
        await serviceSupabase
          .from("webhook_events")
          .update({ processing_status: "failed", error_code: error.code, error_detail: error.message })
          .eq("provider", "revenuecat")
          .eq("external_event_id", event.id);
        throw mapDatabaseError(error);
      }
      await serviceSupabase
        .from("webhook_events")
        .update({ processing_status: "processed", processed_at: new Date().toISOString() })
        .eq("provider", "revenuecat")
        .eq("external_event_id", event.id);
    }

    // RevenueCat dashboard TEST events use synthetic identities. They are valid
    // connectivity checks and must receive a 2xx even though no user entitlement
    // is changed. Real events that cannot be mapped are also acknowledged and
    // logged as rejected; the authenticated server reconciliation endpoint can
    // recover the account state when the user next opens/restores the app.
    return reply.status(200).send({
      received: true,
      test: event.type === "TEST",
      entitlement_applied: shouldApply,
      user_resolved: Boolean(worthItUserId),
    });
  });
};
