import { describe, expect, it } from 'vitest';
import { CustomerSnapshot, subscriptionFromSnapshot, hasBoundedPremium } from '../src/services/subscriptionPolicy.js';

const now = Date.parse('2026-09-06T12:00:00Z');
function fixture() {
  return { request_date: '2026-09-06T12:00:00Z', subscriber: {
    entitlements: { premium: { product_identifier: 'monthly', expires_date: '2026-10-01T00:00:00Z' } },
    subscriptions: { monthly: { store: 'app_store', expires_date: '2026-10-01T00:00:00Z',
      is_sandbox: false, store_transaction_id: '1234', refunded_at: null as string | null,
      grace_period_expires_date: null as string | null } },
  } };
}
const access = (input: unknown) => subscriptionFromSnapshot(CustomerSnapshot.parse(input), 'premium', 'monthly', now);
describe('verified server access', () => {
  it('accepts a confirmed Apple subscription, including sandbox review', () => {
    expect(access(fixture()).active).toBe(true);
    const input = fixture(); input.subscriber.subscriptions.monthly.is_sandbox = true;
    expect(access(input)).toMatchObject({ active: true, environment: 'SANDBOX' });
  });
  it.each(['test_store', 'promotional', 'play_store'])('rejects %s grants', (store) => {
    const input = fixture(); input.subscriber.subscriptions.monthly.store = store;
    expect(access(input).active).toBe(false);
  });
  it('rejects missing entitlements, missing transactions, refunds and unbounded monthly access', () => {
    const input = fixture();
    expect(access({ ...input, subscriber: { ...input.subscriber, entitlements: {} } }).active).toBe(false);
    input.subscriber.subscriptions.monthly.store_transaction_id = '';
    expect(access(input).active).toBe(false);
    input.subscriber.subscriptions.monthly.store_transaction_id = '1234';
    input.subscriber.subscriptions.monthly.refunded_at = '2026-09-06T11:00:00Z';
    expect(access(input).active).toBe(false);
    expect(access({ ...fixture(), subscriber: { ...fixture().subscriber, entitlements: {
      premium: { product_identifier: 'monthly', expires_date: null },
    } } }).active).toBe(false);
  });
  it('preserves paid access after cancellation and honors finite billing grace', () => {
    const input = fixture();
    expect(access({ ...input, subscriber: { ...input.subscriber, subscriptions: { monthly: {
      ...input.subscriber.subscriptions.monthly, unsubscribe_detected_at: '2026-09-01T00:00:00Z',
    } } } }).active).toBe(true);
    input.subscriber.subscriptions.monthly.expires_date = '2026-09-05T00:00:00Z';
    input.subscriber.entitlements.premium.expires_date = '2026-09-05T00:00:00Z';
    expect(access(input).active).toBe(false);
    input.subscriber.subscriptions.monthly.grace_period_expires_date = '2026-09-08T00:00:00Z';
    expect(access(input).active).toBe(true);
  });
  it('rejects malformed upstream data instead of interpreting it as access', () => {
    expect(() => access({ subscriber: {} })).toThrow();
    const input = fixture(); input.subscriber.entitlements.premium.expires_date = 'invalid';
    expect(() => access(input)).toThrow();
  });
  it('does not trust a legacy premium boolean without expiry', () => {
    expect(hasBoundedPremium({ premium_active: true, premium_expires_at: null, premium_grace_ends_at: null,
      premium_store: 'APP_STORE', premium_product_id: 'monthly' }, 'monthly', now)).toBe(false);
  });
});
