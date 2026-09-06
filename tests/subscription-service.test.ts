import { beforeEach, describe, expect, it, vi } from 'vitest';
const rpc = vi.hoisted(() => vi.fn());
vi.mock('../src/config/env.js', () => ({ env: { REVENUECAT_SECRET_API_KEY: 'secret-fixture',
  REVENUECAT_MONTHLY_PRODUCT_ID: 'monthly', REVENUECAT_ENTITLEMENT_ID: 'premium' } }));
vi.mock('../src/lib/supabase.js', () => ({ serviceSupabase: { rpc } }));
import { reconcileSubscription } from '../src/services/subscriptionService.js';

beforeEach(() => { vi.resetAllMocks(); rpc.mockResolvedValue({ data: true, error: null }); });
describe('server-side subscription reconciliation', () => {
  it('fetches the signed-in user and clears access on a valid empty subscriber', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ request_date: new Date().toISOString(),
      subscriber: { entitlements: {}, subscriptions: {} } })));
    vi.stubGlobal('fetch', fetcher);
    await reconcileSubscription('user-a');
    expect(fetcher.mock.calls[0][0]).toBe('https://api.revenuecat.com/v1/subscribers/user-a');
    expect(rpc).toHaveBeenCalledWith('reconcile_revenuecat_entitlement', expect.objectContaining({ p_user_id: 'user-a', p_active: false }));
  });
  it.each([401, 429, 500])('does not change access when RevenueCat returns %s', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status })));
    await expect(reconcileSubscription('user-a')).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });
  it('does not change access on malformed data or network errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')));
    await expect(reconcileSubscription('user-a')).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(reconcileSubscription('user-a')).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });
});
