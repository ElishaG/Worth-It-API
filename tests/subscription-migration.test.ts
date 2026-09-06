import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';

const user = '11111111-1111-4111-8111-111111111111';
let db: PGlite;
const time = Date.now();
const iso = (offset: number) => new Date(time + offset).toISOString();

beforeAll(async () => {
  db = new PGlite();
  // Minimal version of the repository's generated schema; production constraints still need deployment validation.
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create type public.entitlement_event_type as enum ('premium_restored', 'premium_revoked');
    create table public.profiles (id uuid primary key);
    create table public.account_entitlements (
      user_id uuid primary key references profiles(id), premium_active boolean not null default false,
      premium_expires_at timestamptz, premium_grace_ends_at timestamptz, premium_started_at timestamptz,
      premium_product_id text, premium_store text, revenuecat_app_user_id text, last_reconciled_at timestamptz,
      available_scan_credits int default 3, reserved_scan_credits int default 0, version int default 1,
      updated_at timestamptz default now()
    );
    create table public.entitlement_events (
      user_id uuid, event_key text unique, event_type entitlement_event_type, source text,
      external_event_id text, delta_available int, delta_reserved int, available_after int,
      reserved_after int, premium_after boolean, metadata jsonb
    );
    create function public.apply_premium_entitlement(uuid) returns boolean language sql as 'select true';
  `);
  await db.exec(await readFile(new URL('../migrations/20260906_verified_subscriptions.sql', import.meta.url), 'utf8'));
}, 30_000);
beforeEach(async () => {
  await db.exec('truncate public.revenuecat_subscription_state, public.account_entitlements, public.entitlement_events, public.profiles cascade');
  await db.query('insert into profiles(id) values ($1)', [user]);
  await db.query('insert into account_entitlements(user_id) values ($1)', [user]);
});
afterAll(async () => { await db?.close(); });

async function sync(active: boolean, observed = iso(0), expiry: string | null = iso(3_600_000), grace: string | null = null) {
  return db.query('select reconcile_revenuecat_entitlement($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as applied',
    [user, observed, active, expiry, grace, iso(-60_000), 'monthly', 'APP_STORE', null, 'SANDBOX']);
}
async function premium() {
  return (await db.query<{ active: boolean }>('select is_premium_active($1) as active', [user])).rows[0]!.active;
}
describe('subscription database migration', () => {
  it('requires a verified snapshot even if a legacy beta flag is true', async () => {
    await db.exec('update account_entitlements set premium_active = true');
    expect(await premium()).toBe(false);
    await sync(true); expect(await premium()).toBe(true);
  });
  it('ignores an older activation delivered after a newer revocation', async () => {
    await sync(false, iso(1_000));
    const stale = await sync(true, iso(0));
    expect(stale.rows[0]).toEqual({ applied: false });
    expect(await premium()).toBe(false);
  });
  it('does not apply a duplicate snapshot or change scan credits', async () => {
    await sync(true); await sync(true);
    const rows = await db.query('select available_scan_credits, reserved_scan_credits, version from account_entitlements');
    expect(rows.rows[0]).toEqual({ available_scan_credits: 3, reserved_scan_credits: 0, version: 2 });
    expect((await db.query('select * from entitlement_events')).rows).toHaveLength(1);
  });
  it('never creates unbounded access and honors explicit grace', async () => {
    await sync(true, iso(0), null); expect(await premium()).toBe(false);
    await sync(true, iso(1_000), iso(-1_000), iso(3_600_000)); expect(await premium()).toBe(true);
    await sync(true, iso(2_000), iso(-1_000), iso(-1)); expect(await premium()).toBe(false);
  });
  it('does not let app users call grant functions or change subscription snapshots', async () => {
    const grants = await db.query(`select
      has_function_privilege('authenticated', 'public.apply_premium_entitlement(uuid)', 'execute') as old_grant,
      has_function_privilege('authenticated', 'public.reconcile_revenuecat_entitlement(uuid,timestamptz,boolean,timestamptz,timestamptz,timestamptz,text,text,text,text)', 'execute') as new_grant,
      has_table_privilege('authenticated', 'public.revenuecat_subscription_state', 'update') as write_state`);
    expect(grants.rows[0]).toEqual({ old_grant: false, new_grant: false, write_state: false });
  });
});
