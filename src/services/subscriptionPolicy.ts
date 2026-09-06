import { z } from 'zod';

const date = z.string().refine((value) => Number.isFinite(Date.parse(value)), 'Invalid subscription date');
const nullableDate = date.nullable();
export const CustomerSnapshot = z.object({
  request_date: date,
  subscriber: z.object({
    entitlements: z.record(z.string(), z.object({
      product_identifier: z.string(),
      expires_date: nullableDate,
      grace_period_expires_date: nullableDate.optional(),
      purchase_date: date.optional(),
    })),
    subscriptions: z.record(z.string(), z.object({
      store: z.string(),
      expires_date: nullableDate,
      grace_period_expires_date: nullableDate.optional(),
      purchase_date: date.optional(),
      refunded_at: nullableDate.optional(),
      is_sandbox: z.boolean(),
      store_transaction_id: z.union([z.string(), z.number()]).nullable().optional(),
    })),
  }),
});

export interface VerifiedSubscription {
  active: boolean;
  expiresAt: string | null;
  graceEndsAt: string | null;
  startedAt: string | null;
  productId: string | null;
  store: string | null;
  environment: 'SANDBOX' | 'PRODUCTION' | null;
}

export function subscriptionFromSnapshot(
  snapshot: z.infer<typeof CustomerSnapshot>, entitlementId: string, productId: string, now = Date.now(),
): VerifiedSubscription {
  const inactive: VerifiedSubscription = { active: false, expiresAt: null, graceEndsAt: null,
    startedAt: null, productId: null, store: null, environment: null };
  const entitlement = snapshot.subscriber.entitlements[entitlementId];
  if (!productId || entitlement?.product_identifier !== productId) return inactive;
  const subscription = snapshot.subscriber.subscriptions[productId];
  // Apple sandbox receipts are valid for review. RevenueCat Test Store/promotional grants are not.
  if (!subscription || subscription.store !== 'app_store' || subscription.refunded_at ||
      !subscription.store_transaction_id || !entitlement.expires_date || !subscription.expires_date) return inactive;
  const expiresAt = new Date(Math.min(Date.parse(entitlement.expires_date), Date.parse(subscription.expires_date))).toISOString();
  const graceEndsAt = entitlement.grace_period_expires_date ?? subscription.grace_period_expires_date ?? null;
  return {
    active: Math.max(Date.parse(expiresAt), graceEndsAt ? Date.parse(graceEndsAt) : 0) > now,
    expiresAt, graceEndsAt, startedAt: subscription.purchase_date ?? entitlement.purchase_date ?? null,
    productId, store: 'APP_STORE', environment: subscription.is_sandbox ? 'SANDBOX' : 'PRODUCTION',
  };
}

export function hasBoundedPremium(entitlement: {
  premium_active: boolean; premium_expires_at: string | null; premium_grace_ends_at: string | null;
  premium_store: string | null; premium_product_id: string | null;
}, productId: string, now = Date.now()): boolean {
  return Boolean(productId && entitlement.premium_active && entitlement.premium_store === 'APP_STORE' &&
    entitlement.premium_product_id === productId && entitlement.premium_expires_at &&
    Number.isFinite(Date.parse(entitlement.premium_expires_at)) &&
    Math.max(Date.parse(entitlement.premium_expires_at),
      entitlement.premium_grace_ends_at ? Date.parse(entitlement.premium_grace_ends_at) : 0) > now);
}
