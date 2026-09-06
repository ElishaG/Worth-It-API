import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { env } from '../config/env.js';
import { ApiError, mapDatabaseError } from '../lib/errors.js';
import { safeEqual } from '../lib/hash.js';
import { serviceSupabase } from '../lib/supabase.js';
import { parseBody } from '../lib/validation.js';
import { reconcileSubscription } from '../services/subscriptionService.js';
import type { Json } from '../database.types.js';

export const RevenueCatEvent = z.object({
  id: z.string().min(1), type: z.string().min(1),
  app_user_id: z.string().nullish(),
  original_app_user_id: z.string().nullish(),
  aliases: z.array(z.string()).max(100).nullish(),
  transferred_from: z.array(z.string()).max(100).nullish(),
  transferred_to: z.array(z.string()).max(100).nullish(),
}).passthrough();

export function affectedUserIds(event: z.infer<typeof RevenueCatEvent>): string[] {
  const ids = event.type === 'TRANSFER'
    ? [...event.transferred_from ?? [], ...event.transferred_to ?? []]
    : event.app_user_id && z.string().uuid().safeParse(event.app_user_id).success
      ? [event.app_user_id]
      : [event.original_app_user_id, ...event.aliases ?? []];
  return [...new Set(ids.filter((id): id is string => Boolean(id && z.string().uuid().safeParse(id).success)))];
}

export const revenueCatWebhookRoutes: FastifyPluginAsync = async (app) => {
  app.post('/webhooks/revenuecat', async (request, reply) => {
    if (!env.REVENUECAT_WEBHOOK_AUTH) throw new ApiError(503, 'webhook_not_configured', 'Webhook unavailable.');
    if (!safeEqual(request.headers.authorization ?? '', env.REVENUECAT_WEBHOOK_AUTH)) {
      throw new ApiError(401, 'invalid_webhook_authorization', 'Invalid webhook authorization.');
    }
    const body = parseBody(z.object({ api_version: z.string().optional(), event: RevenueCatEvent }), request.body);
    const event = body.event;
    const ids = event.type === 'TEST' ? [] : affectedUserIds(event);
    const knownUsers = ids.length
      ? await serviceSupabase.from('profiles').select('id').in('id', ids)
      : { data: [], error: null };
    if (knownUsers.error) throw mapDatabaseError(knownUsers.error);

    const { error: insertError } = await serviceSupabase.from('webhook_events').upsert({
      provider: 'revenuecat', external_event_id: event.id, event_type: event.type,
      user_id: knownUsers.data?.length === 1 ? knownUsers.data[0]!.id : null,
      signature_verified: true, processing_status: 'verified',
      payload: JSON.parse(JSON.stringify(body)) as Json,
      verified_at: new Date().toISOString(), processed_at: null,
      retention_until: new Date(Date.now() + 365 * 86_400_000).toISOString(),
    }, { onConflict: 'provider,external_event_id', ignoreDuplicates: true });
    if (insertError) throw mapDatabaseError(insertError);

    const existing = await serviceSupabase.from('webhook_events').select('processing_status')
      .eq('provider', 'revenuecat').eq('external_event_id', event.id).single();
    if (existing.error) throw mapDatabaseError(existing.error);
    if (existing.data.processing_status === 'processed') return reply.send({ received: true });

    try {
      if (event.type !== 'TRANSFER' && !z.string().uuid().safeParse(event.app_user_id).success &&
          (knownUsers.data?.length ?? 0) > 1) {
        throw new ApiError(409, 'ambiguous_subscription_identity', 'Subscription identity requires reconciliation.');
      }
      // Re-fetch authoritative state for purchases, refunds, expiry, grace, and both sides of transfers.
      // Never grant access directly from INITIAL_PURCHASE or TEMPORARY_ENTITLEMENT_GRANT.
      for (const user of knownUsers.data ?? []) await reconcileSubscription(user.id, event.id);
      const updated = await serviceSupabase.from('webhook_events').update({
        processing_status: 'processed', processed_at: new Date().toISOString(), error_code: null, error_detail: null,
      }).eq('provider', 'revenuecat').eq('external_event_id', event.id);
      if (updated.error) throw mapDatabaseError(updated.error);
    } catch (error) {
      await serviceSupabase.from('webhook_events').update({
        processing_status: 'failed', error_code: 'reconciliation_failed',
        error_detail: 'Subscription reconciliation failed; retry required.',
      }).eq('provider', 'revenuecat').eq('external_event_id', event.id);
      throw error;
    }
    return reply.send({ received: true });
  });
};
