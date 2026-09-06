-- Apply before deploying the API. Existing scan credits/inventory are not changed.
begin;

create table if not exists public.revenuecat_subscription_state (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  observed_at timestamptz not null,
  active boolean not null,
  expires_at timestamptz,
  grace_ends_at timestamptz,
  product_id text,
  store text,
  environment text,
  check (not active or (expires_at is not null and product_id <> '' and store = 'APP_STORE'))
);
alter table public.revenuecat_subscription_state enable row level security;
revoke all on public.revenuecat_subscription_state from public, anon, authenticated;
grant select on public.revenuecat_subscription_state to service_role;

create or replace function public.reconcile_revenuecat_entitlement(
  p_user_id uuid, p_observed_at timestamptz, p_active boolean,
  p_expires_at timestamptz, p_grace_ends_at timestamptz, p_started_at timestamptz,
  p_product_id text, p_store text, p_source_event_id text, p_environment text
) returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare
  previous public.account_entitlements%rowtype;
  last_observed timestamptz;
  effective_active boolean;
begin
  if p_observed_at is null or p_observed_at > clock_timestamp() + interval '5 minutes' then
    raise exception 'Invalid RevenueCat snapshot time';
  end if;
  select * into strict previous from public.account_entitlements where user_id = p_user_id for update;
  select observed_at into last_observed from public.revenuecat_subscription_state where user_id = p_user_id;
  if last_observed is not null and p_observed_at <= last_observed then return false; end if;
  effective_active := coalesce(p_active and p_store = 'APP_STORE' and p_product_id <> ''
    and p_expires_at is not null and greatest(p_expires_at, p_grace_ends_at) > clock_timestamp(), false);

  insert into public.revenuecat_subscription_state
    (user_id, observed_at, active, expires_at, grace_ends_at, product_id, store, environment)
  values (p_user_id, p_observed_at, effective_active, p_expires_at, p_grace_ends_at, p_product_id, p_store, p_environment)
  on conflict (user_id) do update set observed_at = excluded.observed_at, active = excluded.active,
    expires_at = excluded.expires_at, grace_ends_at = excluded.grace_ends_at, product_id = excluded.product_id,
    store = excluded.store, environment = excluded.environment;

  update public.account_entitlements set
    premium_active = effective_active, premium_expires_at = p_expires_at,
    premium_grace_ends_at = p_grace_ends_at, premium_started_at = p_started_at,
    premium_product_id = p_product_id, premium_store = p_store,
    revenuecat_app_user_id = p_user_id::text, last_reconciled_at = p_observed_at,
    version = version + 1, updated_at = clock_timestamp()
  where user_id = p_user_id;

  if previous.premium_active is distinct from effective_active
    or previous.premium_expires_at is distinct from p_expires_at
    or previous.premium_grace_ends_at is distinct from p_grace_ends_at
    or previous.premium_product_id is distinct from p_product_id then
    insert into public.entitlement_events
      (user_id, event_key, event_type, source, external_event_id, delta_available, delta_reserved,
       available_after, reserved_after, premium_after, metadata)
    values (p_user_id, 'rc-sync:' || p_user_id || ':' || p_observed_at,
      (case when effective_active then 'premium_restored' else 'premium_revoked' end)::public.entitlement_event_type,
      'revenuecat', p_source_event_id, 0, 0, previous.available_scan_credits, previous.reserved_scan_credits,
      effective_active, jsonb_build_object('observed_at', p_observed_at, 'environment', p_environment));
  end if;
  return true;
end;
$$;

revoke all on function public.reconcile_revenuecat_entitlement(uuid,timestamptz,boolean,timestamptz,timestamptz,timestamptz,text,text,text,text) from public, anon, authenticated;
grant execute on function public.reconcile_revenuecat_entitlement(uuid,timestamptz,boolean,timestamptz,timestamptz,timestamptz,text,text,text,text) to service_role;

-- Existing database quota functions use this helper. Legacy/manual flags alone no longer grant access.
create or replace function public.is_premium_active(p_user_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.revenuecat_subscription_state
    where user_id = p_user_id and active and store = 'APP_STORE'
      and product_id is not null and expires_at is not null
      and greatest(expires_at, grace_ends_at) > now()
  );
$$;

-- Block direct client entitlement writes and the old grant RPC. Trusted server reconciliation owns access.
revoke insert, update, delete on public.account_entitlements from public, anon, authenticated;
do $$ declare item record; begin
  for item in select oid::regprocedure as signature from pg_proc
    where pronamespace = 'public'::regnamespace and proname = 'apply_premium_entitlement'
  loop execute format('revoke execute on function %s from public, anon, authenticated', item.signature); end loop;
end $$;
commit;
