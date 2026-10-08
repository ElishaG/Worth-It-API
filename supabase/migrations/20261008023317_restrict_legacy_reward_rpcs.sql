-- The old mobile reward RPCs trust device events and bypass Google SSV.
-- RLS cannot protect against their SECURITY DEFINER writes. Remove both
-- explicit client grants and PUBLIC's inherited function execution grant.
-- Keep signatures, bodies, owners and trusted server functionality intact.
begin;

revoke execute on function public.reward_ad_scan() from public, anon, authenticated;
revoke execute on function public.claim_rewarded_ad_scan(uuid) from public, anon, authenticated;

grant execute on function public.reward_ad_scan() to service_role;
grant execute on function public.claim_rewarded_ad_scan(uuid) to service_role;

-- The verified path remains record_admob_reward -> grant_rewarded_ad_credit.
-- No balances, tables, subscription functions, RLS policies or default grants change.
notify pgrst, 'reload schema';
commit;
