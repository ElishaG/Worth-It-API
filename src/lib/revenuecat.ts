import { z } from "zod";
import { env } from "../config/env.js";
import { ApiError } from "./errors.js";

const RevenueCatEntitlement = z.object({
  expires_date: z.string().nullable().optional(),
  grace_period_expires_date: z.string().nullable().optional(),
  product_identifier: z.string().min(1),
  purchase_date: z.string().nullable().optional(),
}).passthrough();

const RevenueCatSubscription = z.object({
  expires_date: z.string().nullable().optional(),
  grace_period_expires_date: z.string().nullable().optional(),
  purchase_date: z.string().nullable().optional(),
  original_purchase_date: z.string().nullable().optional(),
  store: z.string().nullable().optional(),
  is_sandbox: z.boolean().optional(),
}).passthrough();

const RevenueCatCustomerResponse = z.object({
  request_date: z.string().optional(),
  request_date_ms: z.number().optional(),
  subscriber: z.object({
    entitlements: z.record(z.string(), RevenueCatEntitlement).default({}),
    subscriptions: z.record(z.string(), RevenueCatSubscription).default({}),
    original_app_user_id: z.string().nullable().optional(),
  }).passthrough(),
}).passthrough();

export interface RevenueCatPremiumState {
  active: boolean;
  productId: string | null;
  purchaseDate: string | null;
  expiresAt: string | null;
  graceEndsAt: string | null;
  store: string | null;
  isSandbox: boolean | null;
  originalAppUserId: string | null;
  requestDateMs: number | null;
}

function timestampMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function windowIsActive(
  expiresAt: string | null | undefined,
  graceEndsAt: string | null | undefined,
  nowMs: number,
): boolean {
  const expiryMs = timestampMs(expiresAt);
  const graceMs = timestampMs(graceEndsAt);

  // RevenueCat uses a null expiration for non-expiring entitlements. For Worth It
  // Premium we still require a matching store-backed subscription below, so a
  // null entitlement expiration by itself cannot grant Premium.
  if (expiresAt == null) return true;
  if (expiryMs !== null && expiryMs > nowMs) return true;
  return graceMs !== null && graceMs > nowMs;
}

function isAppStoreSubscription(store: string | null | undefined): boolean {
  const normalized = store?.trim().toLowerCase();
  return normalized === "app_store" || normalized === "mac_app_store";
}

export async function getRevenueCatPremiumState(appUserId: string): Promise<RevenueCatPremiumState> {
  if (!env.REVENUECAT_API_KEY) {
    throw new ApiError(
      503,
      "revenuecat_api_not_configured",
      "RevenueCat server verification is not configured.",
      true,
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);

  let response: Response;
  try {
    response = await fetch(
      `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${env.REVENUECAT_API_KEY}`,
        },
        signal: controller.signal,
      },
    );
  } catch (error) {
    throw new ApiError(
      502,
      "revenuecat_unavailable",
      "Could not verify the subscription with RevenueCat.",
      true,
      { reason: error instanceof Error ? error.name : "network_error" },
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new ApiError(
      response.status === 401 ? 503 : 502,
      response.status === 401 ? "revenuecat_api_key_invalid" : "revenuecat_verification_failed",
      response.status === 401
        ? "RevenueCat server verification credentials are invalid."
        : "RevenueCat could not verify the subscription.",
      response.status >= 500,
      { upstream_status: response.status },
    );
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new ApiError(
      502,
      "revenuecat_invalid_response",
      "RevenueCat returned an invalid verification response.",
      true,
    );
  }

  const parsed = RevenueCatCustomerResponse.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError(
      502,
      "revenuecat_invalid_response",
      "RevenueCat returned an unexpected verification response.",
      true,
    );
  }

  const customer = parsed.data;
  const entitlement = customer.subscriber.entitlements[env.REVENUECAT_ENTITLEMENT_ID];
  const productId = entitlement?.product_identifier ?? null;
  const subscription = productId ? customer.subscriber.subscriptions[productId] : undefined;
  const nowMs = Date.now();

  // Do not trust an entitlement alone. Apple review previously observed Premium
  // being activated without payment confirmation. A valid Worth It Premium state
  // therefore requires both the configured entitlement and a matching App Store
  // subscription record in RevenueCat. Temporary/promotional entitlement grants
  // do not satisfy this check.
  const active = Boolean(
    entitlement &&
      subscription &&
      isAppStoreSubscription(subscription.store) &&
      windowIsActive(entitlement.expires_date, entitlement.grace_period_expires_date, nowMs) &&
      windowIsActive(subscription.expires_date, subscription.grace_period_expires_date, nowMs),
  );

  return {
    active,
    productId,
    purchaseDate:
      subscription?.purchase_date ??
      entitlement?.purchase_date ??
      subscription?.original_purchase_date ??
      null,
    expiresAt: subscription?.expires_date ?? entitlement?.expires_date ?? null,
    graceEndsAt:
      subscription?.grace_period_expires_date ??
      entitlement?.grace_period_expires_date ??
      null,
    store: subscription?.store ?? null,
    isSandbox: subscription?.is_sandbox ?? null,
    originalAppUserId: customer.subscriber.original_app_user_id ?? null,
    requestDateMs: customer.request_date_ms ?? null,
  };
}
