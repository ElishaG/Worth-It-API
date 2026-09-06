import { env } from '../config/env.js';
import { serviceSupabase } from '../lib/supabase.js';
import { ApiError, mapDatabaseError } from '../lib/errors.js';
import { CustomerSnapshot, subscriptionFromSnapshot } from './subscriptionPolicy.js';

export async function reconcileSubscription(userId: string, sourceEventId: string | null = null): Promise<void> {
  if (!env.REVENUECAT_SECRET_API_KEY || !env.REVENUECAT_MONTHLY_PRODUCT_ID) {
    throw new ApiError(503, 'subscription_not_configured', 'Subscriptions are temporarily unavailable. Please try again later.');
  }
  let response: Response;
  try {
    response = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`, {
      headers: { Authorization: `Bearer ${env.REVENUECAT_SECRET_API_KEY}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new ApiError(503, 'subscription_sync_unavailable', 'Purchase received. Account access could not be checked. Please retry.');
  }
  // Neither an upstream failure nor malformed data may grant or revoke access.
  if (!response.ok) throw new ApiError(503, 'subscription_sync_unavailable', 'Account access could not be checked. Please retry.');
  let snapshot: ReturnType<typeof CustomerSnapshot.parse>;
  try { snapshot = CustomerSnapshot.parse(await response.json()); }
  catch { throw new ApiError(503, 'subscription_sync_invalid', 'Account access could not be checked. Please retry.'); }
  const entitlement = subscriptionFromSnapshot(snapshot, env.REVENUECAT_ENTITLEMENT_ID, env.REVENUECAT_MONTHLY_PRODUCT_ID);
  const { error } = await serviceSupabase.rpc('reconcile_revenuecat_entitlement', {
    p_user_id: userId,
    p_observed_at: snapshot.request_date,
    p_active: entitlement.active,
    p_expires_at: entitlement.expiresAt,
    p_grace_ends_at: entitlement.graceEndsAt,
    p_started_at: entitlement.startedAt,
    p_product_id: entitlement.productId,
    p_store: entitlement.store,
    p_source_event_id: sourceEventId,
    p_environment: entitlement.environment,
  });
  if (error) throw mapDatabaseError(error);
}
