-- Isolated fixture based on the existing production reward schema. No live data.
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.role() returns text language sql stable as $$
  select coalesce(current_setting('request.jwt.claim.role', true), 'anon');
$$;
create function public.is_service_actor() returns boolean language sql stable as $$ select auth.role() = 'service_role'; $$;
create type public.ad_challenge_status as enum ('pending','verified','claimed','expired','rejected');
create type public.webhook_provider as enum ('revenuecat','ad_provider');
create type public.webhook_processing_status as enum ('received','processed','failed','ignored');
create type public.entitlement_event_type as enum ('rewarded_ad_grant','premium_activated','premium_renewed','premium_expired','premium_revoked','premium_restored');
create table public.profiles(id uuid primary key);
create table public.account_entitlements (
  user_id uuid primary key references public.profiles(id),
  available_scan_credits integer not null default 0 check(available_scan_credits >= 0),
  reserved_scan_credits integer not null default 0 check(reserved_scan_credits >= 0),
  premium_active boolean not null default false, premium_product_id text, premium_store text,
  premium_started_at timestamptz, premium_expires_at timestamptz, premium_grace_ends_at timestamptz,
  revenuecat_app_user_id text, last_reconciled_at timestamptz,
  version bigint not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create function public.is_premium_active(p_user_id uuid) returns boolean language sql stable as $$
  select premium_active from public.account_entitlements where user_id = p_user_id;
$$;
create table public.ad_reward_challenges (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id),
  provider text not null, placement text not null default 'scan_unlock', challenge_token_hash text not null unique,
  device_risk_key_hash text, status public.ad_challenge_status not null default 'pending',
  expires_at timestamptz not null, verified_at timestamptz, claimed_at timestamptz, provider_transaction_id text,
  rejection_reason text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check(expires_at > created_at)
);
create unique index ad_reward_provider_transaction_once_idx on public.ad_reward_challenges(provider,provider_transaction_id)
  where provider_transaction_id is not null;
create table public.entitlement_events (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id),
  event_type public.entitlement_event_type not null, event_key text not null unique, source text not null,
  scan_id uuid, analysis_revision integer, external_event_id text,
  delta_available integer not null default 0, delta_reserved integer not null default 0,
  available_after integer not null check(available_after >= 0), reserved_after integer not null check(reserved_after >= 0),
  premium_after boolean not null, metadata jsonb not null default '{}' check(jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default now()
);
create table public.webhook_events (
  id uuid primary key default gen_random_uuid(), provider public.webhook_provider not null,
  external_event_id text not null, event_type text, user_id uuid references public.profiles(id),
  signature_verified boolean not null default false, processing_status public.webhook_processing_status not null default 'received',
  payload jsonb not null check(jsonb_typeof(payload)='object'), error_code text, error_detail text,
  received_at timestamptz not null default now(), verified_at timestamptz, processed_at timestamptz, retention_until timestamptz,
  unique(provider, external_event_id)
);
alter table public.ad_reward_challenges enable row level security;
alter table public.account_entitlements enable row level security;
alter table public.entitlement_events enable row level security;
alter table public.webhook_events enable row level security;
