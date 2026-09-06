import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const user = '11111111-1111-4111-8111-111111111111';
const fixture = vi.hoisted(() => ({ reconcile: vi.fn(), from: vi.fn(), rpc: vi.fn(), processed: false }));
vi.mock('../src/config/env.js', () => ({ env: { REVENUECAT_WEBHOOK_AUTH: 'fixture-auth', REVENUECAT_MONTHLY_PRODUCT_ID: 'monthly' } }));
vi.mock('../src/services/subscriptionService.js', () => ({ reconcileSubscription: fixture.reconcile }));
vi.mock('../src/lib/supabase.js', () => ({ serviceSupabase: { from: fixture.from, rpc: fixture.rpc }, createUserSupabase: vi.fn() }));
vi.mock('../src/lib/auth.js', () => ({ requireAuth: async (request: any) => { request.auth = { userId: user }; }, requireIdempotencyKey: () => 'fixture-key' }));
vi.mock('../src/lib/idempotency.js', () => ({ runIdempotent: async (input: any) => input.execute() }));
import { affectedUserIds, revenueCatWebhookRoutes } from '../src/routes/webhooks.js';
import { subscriptionRoutes } from '../src/routes/account.js';

beforeEach(() => {
  vi.resetAllMocks(); fixture.processed = false;
  fixture.reconcile.mockResolvedValue(undefined);
  fixture.rpc.mockResolvedValue({ data: true, error: null });
  fixture.from.mockImplementation((table: string) => {
    const value = table === 'profiles' ? { id: user } : table === 'webhook_events'
      ? { processing_status: fixture.processed ? 'processed' : 'verified' }
      : { premium_active: true, premium_product_id: 'monthly', premium_store: 'APP_STORE',
          premium_expires_at: '2099-01-01T00:00:00Z', premium_grace_ends_at: null };
    const chain: any = { select: () => chain, eq: () => chain, update: () => chain,
      single: async () => ({ data: value, error: null }), in: async (_key: string, ids: string[]) => ({ data: ids.map((id) => ({ id })), error: null }),
      upsert: async () => ({ error: null }), then: (resolve: any) => resolve({ error: null }) };
    return chain;
  });
});

describe('restore and webhook routes', () => {
  it('reconciles the authenticated account and returns updated access', async () => {
    const app = Fastify(); await app.register(subscriptionRoutes);
    const response = await app.inject({ method: 'POST', url: '/subscription/restore', payload: {} });
    expect(response.statusCode).toBe(200);
    expect(fixture.reconcile).toHaveBeenCalledWith(user);
    expect(response.json()).toMatchObject({ reconciled: true, plan: 'premium', account: { id: user } });
    await app.close();
  });
  it('does not accept a different customer identity from the mobile request', async () => {
    const app = Fastify(); await app.register(subscriptionRoutes);
    const response = await app.inject({ method: 'POST', url: '/subscription/restore', payload: { app_user_id: 'someone-else' } });
    expect(response.statusCode).toBeGreaterThanOrEqual(400); expect(fixture.reconcile).not.toHaveBeenCalled();
    await app.close();
  });
  it('rejects unsigned notifications', async () => {
    const app = Fastify(); await app.register(revenueCatWebhookRoutes);
    const response = await app.inject({ method: 'POST', url: '/webhooks/revenuecat', payload: { event: { id: 'e1', type: 'INITIAL_PURCHASE', app_user_id: user } } });
    expect(response.statusCode).toBe(401); expect(fixture.reconcile).not.toHaveBeenCalled(); await app.close();
  });
  it.each(['INITIAL_PURCHASE', 'CANCELLATION', 'BILLING_ISSUE', 'EXPIRATION', 'TEMPORARY_ENTITLEMENT_GRANT'])('rechecks authoritative state for %s instead of granting from its type', async (type) => {
    const app = Fastify(); await app.register(revenueCatWebhookRoutes);
    const response = await app.inject({ method: 'POST', url: '/webhooks/revenuecat', headers: { authorization: 'fixture-auth' },
      payload: { event: { id: 'e1', type, app_user_id: user, entitlement_ids: null } } });
    expect(response.statusCode).toBe(200); expect(fixture.reconcile).toHaveBeenCalledWith(user, 'e1'); await app.close();
  });
  it('reconciles both sides of a transfer with no app_user_id field', async () => {
    const other = '22222222-2222-4222-8222-222222222222';
    const event = { id: 'e1', type: 'TRANSFER', transferred_from: [user], transferred_to: [other] };
    expect(affectedUserIds(event)).toEqual([user, other]);
    const app = Fastify(); await app.register(revenueCatWebhookRoutes);
    const response = await app.inject({ method: 'POST', url: '/webhooks/revenuecat', headers: { authorization: 'fixture-auth' }, payload: { event } });
    expect(response.statusCode).toBe(200); expect(fixture.reconcile).toHaveBeenCalledWith(user, 'e1');
    expect(fixture.reconcile).toHaveBeenCalledWith(other, 'e1'); await app.close();
  });
  it('resolves an anonymous event using a UUID alias', () => {
    expect(affectedUserIds({ id: 'e1', type: 'RENEWAL', app_user_id: '$RCAnonymousID:fixture', aliases: [user] })).toEqual([user]);
  });
  it('acknowledges an already processed event without applying it again', async () => {
    fixture.processed = true;
    const app = Fastify(); await app.register(revenueCatWebhookRoutes);
    const response = await app.inject({ method: 'POST', url: '/webhooks/revenuecat', headers: { authorization: 'fixture-auth' },
      payload: { event: { id: 'e1', type: 'RENEWAL', app_user_id: user } } });
    expect(response.statusCode).toBe(200); expect(fixture.reconcile).not.toHaveBeenCalled(); await app.close();
  });
});
