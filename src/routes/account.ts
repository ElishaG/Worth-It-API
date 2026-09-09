import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireAuth, requireIdempotencyKey } from "../lib/auth.js";
import { ApiError, mapDatabaseError } from "../lib/errors.js";
import { sha256, stableJson } from "../lib/hash.js";
import { runIdempotent } from "../lib/idempotency.js";
import { getRevenueCatPremiumState } from "../lib/revenuecat.js";
import { createUserSupabase, serviceSupabase } from "../lib/supabase.js";
import { parseBody } from "../lib/validation.js";
import type { Json } from "../database.types.js";

type StoredEntitlement = {
  premium_active: boolean;
  premium_expires_at: string | null;
  premium_grace_ends_at: string | null;
  premium_product_id: string | null;
  premium_started_at: string | null;
  premium_store: string | null;
  revenuecat_app_user_id: string | null;
};

function dateIsFuture(value: string | null): boolean {
  if (!value) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp > Date.now();
}

function storedPremiumIsActive(entitlement: StoredEntitlement): boolean {
  if (!entitlement.premium_active) return false;
  if (!entitlement.premium_expires_at) return true;
  return (
    dateIsFuture(entitlement.premium_expires_at) ||
    dateIsFuture(entitlement.premium_grace_ends_at)
  );
}

async function accountResponse(userId: string): Promise<Json> {
  const [{ data: profile, error: profileError }, { data: entitlement, error: entitlementError }] = await Promise.all([
    serviceSupabase.from("profiles").select("*").eq("id", userId).single(),
    serviceSupabase.from("account_entitlements").select("*").eq("user_id", userId).single(),
  ]);
  if (profileError) throw mapDatabaseError(profileError);
  if (entitlementError) throw mapDatabaseError(entitlementError);
  const active = storedPremiumIsActive(entitlement);
  return {
    id: profile.id,
    preferred_currency: profile.preferred_currency,
    notifications_enabled: profile.notifications_enabled,
    plan: active ? "premium" : "free",
    scan_balance: {
      available: entitlement.available_scan_credits,
      reserved: entitlement.reserved_scan_credits,
    },
    premium: {
      is_active: active,
      expires_at: entitlement.premium_expires_at,
      grace_ends_at: entitlement.premium_grace_ends_at,
      store: entitlement.premium_store,
      product_id: entitlement.premium_product_id,
    },
    created_at: profile.created_at,
    updated_at: profile.updated_at,
  };
}

async function reconcileRevenueCatSubscription(userId: string): Promise<{ account: Json; verifiedActive: boolean; isSandbox: boolean | null }> {
  const state = await getRevenueCatPremiumState(userId);
  const { data: current, error: currentError } = await serviceSupabase
    .from("account_entitlements")
    .select("*")
    .eq("user_id", userId)
    .single();
  if (currentError) throw mapDatabaseError(currentError);

  const currentlyActive = storedPremiumIsActive(current);
  const samePremiumSnapshot =
    current.premium_active === state.active &&
    current.premium_product_id === state.productId &&
    current.premium_expires_at === state.expiresAt &&
    current.premium_grace_ends_at === state.graceEndsAt &&
    current.premium_store === state.store;

  if (!samePremiumSnapshot) {
    const eventType = state.active
      ? currentlyActive
        ? "premium_renewed"
        : "premium_restored"
      : "premium_expired";

    const fingerprint = sha256(stableJson({
      source: "revenuecat_server_reconciliation",
      user_id: userId,
      active: state.active,
      product_id: state.productId,
      purchase_date: state.purchaseDate,
      expires_at: state.expiresAt,
      grace_ends_at: state.graceEndsAt,
      store: state.store,
      sandbox: state.isSandbox,
    }));

    const { error } = await serviceSupabase.rpc("apply_premium_entitlement", {
      p_user_id: userId,
      p_event_type: eventType,
      p_external_event_id: `revenuecat-sync:${fingerprint}`,
      p_active: state.active,
      p_product_id: state.productId ?? current.premium_product_id ?? "",
      p_store: state.store ?? current.premium_store ?? "",
      p_started_at: state.purchaseDate ?? current.premium_started_at,
      p_expires_at: state.expiresAt ?? current.premium_expires_at,
      p_grace_ends_at: state.graceEndsAt,
      // The authenticated Worth It UUID is also a RevenueCat alias and is the
      // stable identifier used for server-side subscriber lookups.
      p_revenuecat_app_user_id: userId,
      p_metadata: {
        source: "revenuecat_server_reconciliation",
        verified_active: state.active,
        is_sandbox: state.isSandbox,
        original_app_user_id: state.originalAppUserId,
        revenuecat_request_date_ms: state.requestDateMs,
      },
    } as never);
    if (error) throw mapDatabaseError(error);
  } else {
    const { error } = await serviceSupabase
      .from("account_entitlements")
      .update({
        last_reconciled_at: new Date().toISOString(),
        revenuecat_app_user_id: userId,
      })
      .eq("user_id", userId);
    if (error) throw mapDatabaseError(error);
  }

  return {
    account: await accountResponse(userId),
    verifiedActive: state.active,
    isSandbox: state.isSandbox,
  };
}

export const accountRoutes: FastifyPluginAsync = async (app) => {
  app.get("/me", { preHandler: requireAuth }, async (request) => accountResponse(request.auth.userId));

  app.patch("/me/settings", { preHandler: requireAuth }, async (request, reply) => {
    const body = parseBody(z.object({
      preferred_currency: z.string().regex(/^[A-Z]{3}$/).optional(),
      notifications_enabled: z.boolean().optional(),
    }).refine((value) => Object.keys(value).length > 0, "At least one setting is required."), request.body);
    const key = requireIdempotencyKey(request);
    const result = await runIdempotent({
      userId: request.auth.userId,
      endpoint: "/me/settings",
      key,
      requestBody: body,
      execute: async () => {
        if (body.preferred_currency) {
          const { data: currency, error } = await serviceSupabase.from("currencies").select("code").eq("code", body.preferred_currency).eq("enabled", true).maybeSingle();
          if (error) throw mapDatabaseError(error);
          if (!currency) throw new ApiError(400, "unsupported_currency", "The selected currency is not supported.");
        }
        const { error } = await serviceSupabase.from("profiles").update(body).eq("id", request.auth.userId);
        if (error) throw mapDatabaseError(error);
        return { status: 200, body: await accountResponse(request.auth.userId) };
      },
    });
    return reply.status(result.status).send(result.body);
  });

  app.post("/account-deletion", { preHandler: requireAuth }, async (request, reply) => {
    const body = parseBody(z.object({ confirmation: z.literal("DELETE") }), request.body);
    const key = requireIdempotencyKey(request);
    const result = await runIdempotent({
      userId: request.auth.userId,
      endpoint: "/account-deletion",
      key,
      requestBody: body,
      execute: async () => {
        const userClient = createUserSupabase(request.auth.accessToken);
        const { data, error } = await userClient.rpc("request_account_deletion", { p_confirmation: body.confirmation });
        if (error) throw mapDatabaseError(error);
        return { status: 202, body: { request_id: data, status: "requested" } };
      },
    });
    return reply.status(result.status).send(result.body);
  });
};

export const subscriptionRoutes: FastifyPluginAsync = async (app) => {
  app.get("/subscription", { preHandler: requireAuth }, async (request) => {
    const account = await accountResponse(request.auth.userId) as Record<string, Json | undefined>;
    return account.premium;
  });

  const registerReconcileRoute = (path: "/subscription/restore" | "/subscription/sync") => {
    app.post(path, { preHandler: requireAuth }, async (request, reply) => {
      const body = parseBody(z.object({}).passthrough(), request.body ?? {});
      const key = requireIdempotencyKey(request);
      const result = await runIdempotent({
        userId: request.auth.userId,
        endpoint: path,
        key,
        requestBody: body,
        execute: async () => {
          const reconciliation = await reconcileRevenueCatSubscription(request.auth.userId);
          const account = reconciliation.account as Record<string, Json | undefined>;
          return {
            status: 200,
            body: {
              reconciled: true,
              plan: (account.plan as string) ?? "free",
              premium: account.premium ?? null,
              verified_active: reconciliation.verifiedActive,
              is_sandbox: reconciliation.isSandbox,
              message: reconciliation.verifiedActive
                ? "Premium subscription verified with RevenueCat."
                : "No active App Store-backed Premium subscription was found.",
            },
          };
        },
      });
      return reply.status(result.status).send(result.body);
    });
  };

  registerReconcileRoute("/subscription/restore");
  registerReconcileRoute("/subscription/sync");
};
