-- Apply to the existing Worth It schema before deploying the API. No balances,
-- RevenueCat functions, subscription records, or RLS policies are rewritten.
begin;

create or replace function public.grant_rewarded_ad_credit(
  p_challenge_id uuid, p_provider_transaction_id text
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_challenge public.ad_reward_challenges%rowtype;
  v_entitlement public.account_entitlements%rowtype;
  v_existing_event public.entitlement_events%rowtype;
  v_event_key text;
begin
  if not public.is_service_actor() then
    raise exception using errcode = '42501', message = 'service role required';
  end if;
  if p_provider_transaction_id is null or length(p_provider_transaction_id) not between 1 and 500 then
    raise exception using errcode = '22023', message = 'provider transaction is required';
  end if;
  select * into v_challenge from public.ad_reward_challenges where id = p_challenge_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'ad challenge not found';
  end if;

  -- A claimed reward remains idempotent after challenge expiry. Verification
  -- records the provider ID; a caller may never replace it with a fabricated ID.
  if v_challenge.status in ('verified', 'claimed') then
    if v_challenge.provider_transaction_id is distinct from p_provider_transaction_id then
      raise exception using errcode = '23505', message = 'provider transaction does not match verified reward';
    end if;
  elsif v_challenge.expires_at <= now() then
    raise exception using errcode = '22023', message = 'ad challenge expired';
  else
    raise exception using errcode = '23514', message = 'ad challenge has not been server-verified';
  end if;

  if v_challenge.status = 'claimed' then
    select * into v_entitlement from public.account_entitlements where user_id = v_challenge.user_id;
    return jsonb_build_object('granted', true, 'already_claimed', true,
      'provider_transaction_id', v_challenge.provider_transaction_id,
      'available_scan_credits', v_entitlement.available_scan_credits);
  end if;

  v_event_key := 'rewarded_ad_grant:' || v_challenge.provider || ':' || p_provider_transaction_id;
  select * into v_existing_event from public.entitlement_events where event_key = v_event_key;
  if found then
    if v_existing_event.user_id is distinct from v_challenge.user_id
      or (v_existing_event.metadata ->> 'challenge_id') is distinct from v_challenge.id::text then
      raise exception using errcode = '23505', message = 'ad provider transaction has already been used';
    end if;
    raise exception using errcode = '23514', message = 'reward ledger and challenge state are inconsistent';
  end if;

  select * into v_entitlement from public.account_entitlements where user_id = v_challenge.user_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'account entitlement not found';
  end if;
  update public.account_entitlements
  set available_scan_credits = available_scan_credits + 1, version = version + 1, updated_at = now()
  where user_id = v_challenge.user_id returning * into v_entitlement;
  update public.ad_reward_challenges
  set status = 'claimed', claimed_at = now(), updated_at = now() where id = v_challenge.id;
  insert into public.entitlement_events (
    user_id, event_type, event_key, source, external_event_id,
    delta_available, delta_reserved, available_after, reserved_after, premium_after, metadata
  ) values (
    v_challenge.user_id, 'rewarded_ad_grant', v_event_key, v_challenge.provider, p_provider_transaction_id,
    1, 0, v_entitlement.available_scan_credits, v_entitlement.reserved_scan_credits,
    public.is_premium_active(v_challenge.user_id),
    jsonb_build_object('challenge_id', v_challenge.id, 'placement', v_challenge.placement)
  );
  return jsonb_build_object('granted', true, 'already_claimed', false,
    'provider_transaction_id', v_challenge.provider_transaction_id,
    'available_scan_credits', v_entitlement.available_scan_credits);
end;
$function$;

-- This RPC is an internal trust boundary: only the API's service role may call
-- it, and only AFTER validating Google's ECDSA signature and ad-unit allowlist.
create or replace function public.record_admob_reward(
  p_challenge_id uuid, p_challenge_token_hash text, p_user_id uuid,
  p_transaction_id text, p_rewarded_at timestamptz, p_ad_unit text
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_challenge public.ad_reward_challenges%rowtype;
  v_result jsonb;
begin
  if not public.is_service_actor() then
    raise exception using errcode = '42501', message = 'service role required';
  end if;
  if p_transaction_id is null or length(p_transaction_id) not between 16 and 256
    or p_transaction_id !~ '^[a-fA-F0-9]+$'
    or p_ad_unit is null or p_ad_unit !~ '^[0-9]+$' then
    raise exception using errcode = '22023', message = 'invalid AdMob transaction';
  end if;
  -- Serializes reuse of the same transaction across different challenges.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('admob:' || p_transaction_id, 0));
  select * into v_challenge from public.ad_reward_challenges where id = p_challenge_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'ad challenge not found';
  end if;
  if v_challenge.provider <> 'admob' or v_challenge.placement <> 'scan_unlock'
    or v_challenge.user_id is distinct from p_user_id
    or v_challenge.challenge_token_hash is distinct from p_challenge_token_hash then
    raise exception using errcode = '42501', message = 'AdMob challenge does not match callback';
  end if;
  if v_challenge.status in ('verified', 'claimed') then
    if v_challenge.provider_transaction_id is distinct from p_transaction_id then
      raise exception using errcode = '23505', message = 'challenge already has a different transaction';
    end if;
    return public.grant_rewarded_ad_credit(p_challenge_id, p_transaction_id);
  end if;
  -- Validate the signed EARNED time, not arrival time. A callback can arrive
  -- up to 24 hours later; it cannot prove an ad earned outside the 15m window.
  if v_challenge.status not in ('pending', 'expired') then
    raise exception using errcode = '23514', message = 'ad challenge cannot be rewarded';
  end if;
  if p_rewarded_at is null or p_rewarded_at < v_challenge.created_at
    or p_rewarded_at > v_challenge.expires_at
    or p_rewarded_at > now() + interval '5 minutes'
    or p_rewarded_at < now() - interval '24 hours' then
    raise exception using errcode = '22023', message = 'reward timestamp is outside the challenge window';
  end if;
  if exists (select 1 from public.ad_reward_challenges
    where provider = 'admob' and provider_transaction_id = p_transaction_id and id <> p_challenge_id) then
    raise exception using errcode = '23505', message = 'ad provider transaction has already been used';
  end if;
  update public.ad_reward_challenges
  set status = 'verified', provider_transaction_id = p_transaction_id,
    verified_at = now(), updated_at = now() where id = p_challenge_id;

  -- Existing enum supports ad_provider. Namespace the external ID by network
  -- to keep the generic provider's events separate. Never store bearer tokens.
  insert into public.webhook_events (
    provider, external_event_id, event_type, user_id, signature_verified,
    processing_status, payload, verified_at, processed_at, retention_until
  ) values (
    'ad_provider', 'admob:' || p_transaction_id, 'admob_verified_reward', p_user_id, true,
    'processed', jsonb_build_object('challenge_id', p_challenge_id, 'ad_unit', p_ad_unit,
      'transaction_id', p_transaction_id, 'rewarded_at', p_rewarded_at, 'reward_amount', 1, 'reward_item', 'scan'),
    now(), now(), now() + interval '90 days'
  );
  v_result := public.grant_rewarded_ad_credit(p_challenge_id, p_transaction_id);
  return v_result;
end;
$function$;

revoke all on function public.grant_rewarded_ad_credit(uuid, text) from public, anon, authenticated;
grant execute on function public.grant_rewarded_ad_credit(uuid, text) to service_role;
revoke all on function public.record_admob_reward(uuid, text, uuid, text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.record_admob_reward(uuid, text, uuid, text, timestamptz, text) to service_role;

notify pgrst, 'reload schema';
commit;
