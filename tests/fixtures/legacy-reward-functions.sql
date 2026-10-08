-- Exact existing legacy/Premium function bodies from the read-only staging audit.
-- No production data. Deliberately reproduce old client/PUBLIC grants for the regression.
create function auth.uid() returns uuid language sql stable as $uid$
 select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
$uid$;
grant usage on schema public, auth to anon, authenticated, service_role;
create table public.rewarded_ad_rewards (
 id uuid primary key default gen_random_uuid(),
 event_id uuid not null unique, user_id uuid not null references public.profiles(id) on delete cascade,
 reward_scans integer not null default 1 check(reward_scans=1),
 created_at timestamptz not null default now()
);
alter table public.rewarded_ad_rewards enable row level security;
CREATE OR REPLACE FUNCTION public.apply_premium_entitlement(p_user_id uuid, p_event_type public.entitlement_event_type, p_external_event_id text, p_active boolean, p_product_id text, p_store text, p_started_at timestamp with time zone, p_expires_at timestamp with time zone, p_grace_ends_at timestamp with time zone, p_revenuecat_app_user_id text, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_entitlement public.account_entitlements%rowtype;
  v_existing_event public.entitlement_events%rowtype;
  v_event_key text;
begin
  if not public.is_service_actor() then
    raise exception using errcode = '42501', message = 'service role required';
  end if;

  if p_event_type not in (
    'premium_activated', 'premium_renewed', 'premium_expired',
    'premium_revoked', 'premium_restored'
  ) then
    raise exception using errcode = '22023', message = 'invalid premium entitlement event type';
  end if;

  v_event_key := 'revenuecat:' || p_external_event_id;

  select * into v_entitlement
  from public.account_entitlements
  where user_id = p_user_id
  for update;

  if v_entitlement.user_id is null then
    raise exception using errcode = 'P0002', message = 'entitlement state not found';
  end if;

  select * into v_existing_event
  from public.entitlement_events
  where event_key = v_event_key;

  if v_existing_event.id is not null then
    if v_existing_event.user_id <> p_user_id then
      raise exception using errcode = '23505', message = 'RevenueCat event is already associated with another user';
    end if;
    return false;
  end if;

  update public.account_entitlements
  set premium_active = p_active,
      premium_product_id = p_product_id,
      premium_store = p_store,
      premium_started_at = coalesce(p_started_at, premium_started_at),
      premium_expires_at = p_expires_at,
      premium_grace_ends_at = p_grace_ends_at,
      revenuecat_app_user_id = coalesce(p_revenuecat_app_user_id, revenuecat_app_user_id),
      last_reconciled_at = now(),
      version = version + 1,
      updated_at = now()
  where user_id = p_user_id
  returning * into v_entitlement;

  insert into public.entitlement_events (
    user_id, event_type, event_key, source, external_event_id,
    delta_available, delta_reserved, available_after, reserved_after,
    premium_after, metadata
  ) values (
    p_user_id,
    p_event_type,
    v_event_key,
    'revenuecat',
    p_external_event_id,
    0,
    0,
    v_entitlement.available_scan_credits,
    v_entitlement.reserved_scan_credits,
    p_active,
    coalesce(p_metadata, '{}'::jsonb)
  );

  return true;
end;
$function$;
CREATE OR REPLACE FUNCTION public.claim_rewarded_ad_scan(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_entitlement public.account_entitlements%rowtype;
  v_today_count integer := 0;
  v_last_reward_at timestamptz;
  v_event_key text;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  if public.is_premium_active(v_user_id) then
    raise exception using errcode = '23514', message = 'rewarded ads are not available for premium accounts';
  end if;

  if exists (select 1 from public.rewarded_ad_rewards where event_id = p_event_id) then
    return jsonb_build_object('granted', false, 'duplicate', true);
  end if;

  select count(*), max(created_at)
  into v_today_count, v_last_reward_at
  from public.rewarded_ad_rewards
  where user_id = v_user_id
    and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc';

  if coalesce(v_today_count, 0) >= 5 then
    raise exception using errcode = '23514', message = 'daily rewarded-ad scan limit reached';
  end if;

  if v_last_reward_at is not null and v_last_reward_at > now() - interval '60 seconds' then
    raise exception using errcode = '23514', message = 'please wait before claiming another rewarded scan';
  end if;

  select * into v_entitlement
  from public.account_entitlements
  where user_id = v_user_id
  for update;

  if v_entitlement.user_id is null then
    raise exception using errcode = 'P0002', message = 'account entitlement not found';
  end if;

  insert into public.rewarded_ad_rewards(user_id, event_id, reward_scans)
  values (v_user_id, p_event_id, 1);

  update public.account_entitlements
  set available_scan_credits = available_scan_credits + 1,
      version = version + 1,
      updated_at = now()
  where user_id = v_user_id
  returning * into v_entitlement;

  v_event_key := 'rewarded_ad_grant:' || p_event_id::text;

  insert into public.entitlement_events (
    user_id, event_type, event_key, source, external_event_id,
    delta_available, delta_reserved, available_after, reserved_after,
    premium_after, metadata
  ) values (
    v_user_id, 'rewarded_ad_grant', v_event_key, 'admob_rewarded_beta', p_event_id::text,
    1, 0, v_entitlement.available_scan_credits, v_entitlement.reserved_scan_credits,
    false, jsonb_build_object('reward_scans', 1, 'beta_cap_per_day', 5, 'cooldown_seconds', 60)
  );

  return jsonb_build_object(
    'granted', true,
    'reward_scans', 1,
    'available_scan_credits', v_entitlement.available_scan_credits,
    'remaining_daily_rewards', greatest(0, 5 - (coalesce(v_today_count, 0) + 1))
  );
end;
$function$;
CREATE OR REPLACE FUNCTION public.reward_ad_scan()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  new_balance integer;
begin
  update public.account_entitlements
  set available_scan_credits = coalesce(available_scan_credits, 0) + 1
  where user_id = auth.uid()
  returning available_scan_credits into new_balance;

  if new_balance is null then
    raise exception 'Account entitlement not found';
  end if;

  return new_balance;
end;
$function$;
grant execute on function public.reward_ad_scan(), public.claim_rewarded_ad_scan(uuid) to public, anon, authenticated, service_role;
revoke all on function public.apply_premium_entitlement(uuid,public.entitlement_event_type,text,boolean,text,text,timestamptz,timestamptz,timestamptz,text,jsonb) from public,anon,authenticated;
grant execute on function public.apply_premium_entitlement(uuid,public.entitlement_event_type,text,boolean,text,text,timestamptz,timestamptz,timestamptz,text,jsonb) to service_role;
