import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireAuth, requireIdempotencyKey } from "../lib/auth.js";
import { ApiError, mapDatabaseError } from "../lib/errors.js";
import { runIdempotent } from "../lib/idempotency.js";
import { createUserSupabase, serviceSupabase } from "../lib/supabase.js";
import { parseBody } from "../lib/validation.js";
import type { Json } from "../database.types.js";

async function accountResponse(userId: string): Promise<Json> {
  const [{ data: profile, error: profileError }, { data: entitlement, error: entitlementError }] = await Promise.all([
    serviceSupabase.from("profiles").select("*").eq("id", userId).single(),
    serviceSupabase.from("account_entitlements").select("*").eq("user_id", userId).single(),
  ]);
  if (profileError) throw mapDatabaseError(profileError);
  if (entitlementError) throw mapDatabaseError(entitlementError);
  const active = entitlement.premium_active && (!entitlement.premium_expires_at || new Date(entitlement.premium_expires_at) > new Date());
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

  app.post("/subscription/restore", { preHandler: requireAuth }, async (request, reply) => {
    const body = parseBody(z.object({ app_user_id: z.string().min(1).optional() }), request.body ?? {});
    const key = requireIdempotencyKey(request);
    const result = await runIdempotent({
      userId: request.auth.userId,
      endpoint: "/subscription/restore",
      key,
      requestBody: body,
      execute: async () => {
        const account = await accountResponse(request.auth.userId) as Record<string, Json | undefined>;
        return {
          status: 200,
          body: {
            reconciled: false,
            plan: (account.plan as string) ?? "free",
            message: "Purchase restoration must first be completed in the mobile RevenueCat SDK; the webhook then reconciles this database.",
          },
        };
      },
    });
    return reply.status(result.status).send(result.body);
  });
};
