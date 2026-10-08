-- Staging-only AdMob and legacy-RPC lockdown behavioral tests. Synthetic records only; every fixture rolls back.
-- Run only on verified Worth-It-Staging tttojkfynlvpafwnjhtk.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $test$
declare
 v_user uuid := gen_random_uuid();
 v_other uuid := gen_random_uuid();
 v_missing uuid := gen_random_uuid();
 v_challenge uuid := gen_random_uuid();
 v_second uuid := gen_random_uuid();
 v_delayed uuid := gen_random_uuid();
 v_verified uuid := gen_random_uuid();
 v_old uuid := gen_random_uuid();
 v_missing_challenge uuid := gen_random_uuid();
 v_tx text := md5(gen_random_uuid()::text);
 v_delayed_tx text := md5(gen_random_uuid()::text);
 v_verified_tx text := md5(gen_random_uuid()::text);
 v_bad_tx text := md5(gen_random_uuid()::text);
 v_result jsonb;
 v_before jsonb;
 v_after jsonb;
 v_passed jsonb := '[]'::jsonb;
 v_count integer;
begin
 if exists(select 1 from auth.users) or exists(select 1 from public.profiles) then
   raise exception 'Tests require empty verified staging';
 end if;
 perform set_config('request.jwt.claims',jsonb_build_object('role','service_role')::text,true);
 perform set_config('request.jwt.claim.role','service_role',true);
 insert into public.currencies(code,display_name,symbol,minor_units) values ('CAD','Synthetic staging CAD','TEST',2);
 insert into auth.users(id) values(v_user),(v_other),(v_missing);
if ((select count(*) from public.profiles)=3 and (select available_scan_credits from public.account_entitlements where user_id=v_user)=10) is not true then raise exception 'Failed: signup trigger creates profile and ten-credit entitlement'; end if;
v_passed := v_passed || jsonb_build_array('signup trigger creates profile and ten-credit entitlement');
update public.account_entitlements set reserved_scan_credits=2 where user_id=v_user;
v_result := to_jsonb(public.apply_premium_entitlement(v_user,'premium_activated','synthetic-rc-event',true,'synthetic-premium','app_store',now(),now()+interval '30 days',null,'synthetic-rc-user','{}'));
if (v_result='true'::jsonb and public.is_premium_active(v_user) and (select available_scan_credits from public.account_entitlements where user_id=v_user)=10) is not true then raise exception 'Failed: RevenueCat activation works without changing scan credits'; end if;
v_passed := v_passed || jsonb_build_array('RevenueCat activation works without changing scan credits');
v_result := to_jsonb(public.apply_premium_entitlement(v_user,'premium_activated','synthetic-rc-event',true,'synthetic-premium','app_store',now(),now()+interval '30 days',null,'synthetic-rc-user','{}'));
if (v_result='false'::jsonb) is not true then raise exception 'Failed: RevenueCat duplicate remains idempotent'; end if;
v_passed := v_passed || jsonb_build_array('RevenueCat duplicate remains idempotent');
select to_jsonb(e)-'available_scan_credits'-'version'-'updated_at' into v_before from public.account_entitlements e where user_id=v_user;
insert into public.ad_reward_challenges(id,user_id,provider,challenge_token_hash,created_at,expires_at,status) values
 (v_challenge,v_user,'admob','synthetic-token',now()-interval '1 minute',now()+interval '14 minutes','pending'),
 (v_second,v_user,'admob','second-token',now()-interval '1 minute',now()+interval '14 minutes','pending'),
 (v_delayed,v_user,'admob','delayed-token',now()-interval '2 hours',now()-interval '105 minutes','expired'),
 (v_verified,v_user,'admob','verified-token',now()-interval '2 hours',now()-interval '105 minutes','verified'),
 (v_old,v_user,'admob','old-token',now()-interval '25 hours 15 minutes',now()-interval '25 hours','expired'),
 (v_missing_challenge,v_missing,'admob','missing-token',now()-interval '1 minute',now()+interval '14 minutes','pending');
update public.ad_reward_challenges set provider_transaction_id=v_verified_tx where id=v_verified;
begin
 perform public.grant_rewarded_ad_credit(v_challenge,v_tx);
 raise exception 'Expected rejection: pending claim rejected until server verification';
exception when sqlstate '23514' then
 v_passed := v_passed || jsonb_build_array('pending claim rejected until server verification');
end;
begin
 perform public.record_admob_reward(v_challenge,'synthetic-token',v_other,v_tx,now(),'8982386338');
 raise exception 'Expected rejection: wrong callback user rejected';
exception when sqlstate '42501' then
 v_passed := v_passed || jsonb_build_array('wrong callback user rejected');
end;
begin
 perform public.record_admob_reward(v_challenge,'wrong-token',v_user,v_tx,now(),'8982386338');
 raise exception 'Expected rejection: wrong callback token rejected';
exception when sqlstate '42501' then
 v_passed := v_passed || jsonb_build_array('wrong callback token rejected');
end;
begin
 perform public.record_admob_reward(v_challenge,'synthetic-token',v_user,'client-fake',now(),'8982386338');
 raise exception 'Expected rejection: fabricated client transaction rejected';
exception when sqlstate '22023' then
 v_passed := v_passed || jsonb_build_array('fabricated client transaction rejected');
end;
begin
 perform public.record_admob_reward(v_challenge,'synthetic-token',v_user,v_tx,now()-interval '2 minutes','8982386338');
 raise exception 'Expected rejection: earned before challenge rejected';
exception when sqlstate '22023' then
 v_passed := v_passed || jsonb_build_array('earned before challenge rejected');
end;
begin
 perform public.record_admob_reward(v_challenge,'synthetic-token',v_user,v_tx,now()+interval '16 minutes','8982386338');
 raise exception 'Expected rejection: earned after expiry rejected';
exception when sqlstate '22023' then
 v_passed := v_passed || jsonb_build_array('earned after expiry rejected');
end;
begin
 perform public.record_admob_reward(v_challenge,'synthetic-token',v_user,v_tx,now()+interval '6 minutes','8982386338');
 raise exception 'Expected rejection: future clock window rejected';
exception when sqlstate '22023' then
 v_passed := v_passed || jsonb_build_array('future clock window rejected');
end;
begin
 perform public.record_admob_reward(v_old,'old-token',v_user,v_tx,now()-interval '25 hours 5 minutes','8982386338');
 raise exception 'Expected rejection: delivery older than 24 hours rejected';
exception when sqlstate '22023' then
 v_passed := v_passed || jsonb_build_array('delivery older than 24 hours rejected');
end;
v_result := public.record_admob_reward(v_challenge,'synthetic-token',v_user,v_tx,now(),'8982386338');
if ((v_result->>'granted')::boolean and not (v_result->>'already_claimed')::boolean and v_result->>'provider_transaction_id'=v_tx and (select available_scan_credits from public.account_entitlements where user_id=v_user)=11 and (select status from public.ad_reward_challenges where id=v_challenge)='claimed') is not true then raise exception 'Failed: verified callback atomically grants exactly one scan'; end if;
v_passed := v_passed || jsonb_build_array('verified callback atomically grants exactly one scan');
select to_jsonb(e)-'available_scan_credits'-'version'-'updated_at' into v_after from public.account_entitlements e where user_id=v_user;
if (v_before=v_after) is not true then raise exception 'Failed: reward preserves all Premium RevenueCat and reserved fields'; end if;
v_passed := v_passed || jsonb_build_array('reward preserves all Premium RevenueCat and reserved fields');
if ((select count(*) from public.webhook_events where external_event_id='admob:'||v_tx)=1 and (select count(*) from public.entitlement_events where external_event_id=v_tx)=1 and not (select payload ? 'challenge_token' from public.webhook_events where external_event_id='admob:'||v_tx)) is not true then raise exception 'Failed: one audit and ledger event with no raw token'; end if;
v_passed := v_passed || jsonb_build_array('one audit and ledger event with no raw token');
v_result := public.record_admob_reward(v_challenge,'synthetic-token',v_user,v_tx,now(),'8982386338');
if ((v_result->>'already_claimed')::boolean and (select available_scan_credits from public.account_entitlements where user_id=v_user)=11 and (select count(*) from public.entitlement_events where external_event_id=v_tx)=1) is not true then raise exception 'Failed: duplicate callback grants once'; end if;
v_passed := v_passed || jsonb_build_array('duplicate callback grants once');
begin
 perform public.record_admob_reward(v_second,'second-token',v_user,v_tx,now(),'8982386338');
 raise exception 'Expected rejection: same transaction on another challenge rejected';
exception when sqlstate '23505' then
 v_passed := v_passed || jsonb_build_array('same transaction on another challenge rejected');
end;
begin
 perform public.record_admob_reward(v_challenge,'synthetic-token',v_user,v_bad_tx,now(),'8982386338');
 raise exception 'Expected rejection: second transaction on claimed challenge rejected';
exception when sqlstate '23505' then
 v_passed := v_passed || jsonb_build_array('second transaction on claimed challenge rejected');
end;
begin
 perform public.grant_rewarded_ad_credit(v_challenge,'client-fake');
 raise exception 'Expected rejection: claim cannot replace Google transaction';
exception when sqlstate '23505' then
 v_passed := v_passed || jsonb_build_array('claim cannot replace Google transaction');
end;
update public.ad_reward_challenges set created_at=now()-interval '2 days',expires_at=now()-interval '1 day' where id=v_challenge;
v_result := public.grant_rewarded_ad_credit(v_challenge,v_tx);
if ((v_result->>'already_claimed')::boolean and (select available_scan_credits from public.account_entitlements where user_id=v_user)=11) is not true then raise exception 'Failed: claim repeat after challenge expiry is idempotent'; end if;
v_passed := v_passed || jsonb_build_array('claim repeat after challenge expiry is idempotent');
v_result := public.record_admob_reward(v_delayed,'delayed-token',v_user,v_delayed_tx,now()-interval '110 minutes','8982386338');
if ((v_result->>'granted')::boolean and (select available_scan_credits from public.account_entitlements where user_id=v_user)=12) is not true then raise exception 'Failed: valid delayed callback on expired challenge succeeds'; end if;
v_passed := v_passed || jsonb_build_array('valid delayed callback on expired challenge succeeds');
v_result := public.grant_rewarded_ad_credit(v_verified,v_verified_tx);
if ((v_result->>'granted')::boolean and not (v_result->>'already_claimed')::boolean and (select available_scan_credits from public.account_entitlements where user_id=v_user)=13) is not true then raise exception 'Failed: verified unclaimed reward can claim after expiry'; end if;
v_passed := v_passed || jsonb_build_array('verified unclaimed reward can claim after expiry');
delete from public.account_entitlements where user_id=v_missing;
begin
 perform public.record_admob_reward(v_missing_challenge,'missing-token',v_missing,v_bad_tx,now(),'8982386338');
 raise exception 'Expected rejection: grant failure rolls back entire verification transaction';
exception when sqlstate 'P0002' then
 v_passed := v_passed || jsonb_build_array('grant failure rolls back entire verification transaction');
end;
if ((select status from public.ad_reward_challenges where id=v_missing_challenge)='pending' and not exists(select 1 from public.webhook_events where external_event_id='admob:'||v_bad_tx) and not exists(select 1 from public.entitlement_events where external_event_id=v_bad_tx)) is not true then raise exception 'Failed: failed grant leaves challenge pending and no audit or ledger'; end if;
v_passed := v_passed || jsonb_build_array('failed grant leaves challenge pending and no audit or ledger');
perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',v_user)::text,true);
perform set_config('request.jwt.claim.role','authenticated',true);
begin
 perform public.record_admob_reward(v_second,'second-token',v_user,v_bad_tx,now(),'8982386338');
 raise exception 'Expected rejection: internal callback requires service JWT actor even for database owner';
exception when sqlstate '42501' then
 v_passed := v_passed || jsonb_build_array('internal callback requires service JWT actor even for database owner');
end;
if (has_function_privilege('service_role','public.record_admob_reward(uuid,text,uuid,text,timestamptz,text)','EXECUTE') and has_function_privilege('service_role','public.grant_rewarded_ad_credit(uuid,text)','EXECUTE') and not has_function_privilege('authenticated','public.record_admob_reward(uuid,text,uuid,text,timestamptz,text)','EXECUTE') and not has_function_privilege('anon','public.record_admob_reward(uuid,text,uuid,text,timestamptz,text)','EXECUTE') and not has_function_privilege('authenticated','public.grant_rewarded_ad_credit(uuid,text)','EXECUTE') and not has_function_privilege('anon','public.grant_rewarded_ad_credit(uuid,text)','EXECUTE')) is not true then raise exception 'Failed: service role alone has callback and grant execute'; end if;
v_passed := v_passed || jsonb_build_array('service role alone has callback and grant execute');
execute 'set local role authenticated';
select count(*) into v_count from public.ad_reward_challenges;
if (v_count=5) is not true then raise exception 'Failed: RLS hides other users challenges'; end if;
v_passed := v_passed || jsonb_build_array('RLS hides other users challenges');
perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',v_other)::text,true);
perform set_config('request.jwt.claim.sub',v_other::text,true);
select count(*) into v_count from public.ad_reward_challenges;
if (v_count=0) is not true then raise exception 'Failed: other account cannot read original reward challenges'; end if;
v_passed := v_passed || jsonb_build_array('other account cannot read original reward challenges');
begin
 perform public.record_admob_reward(v_second,'second-token',v_user,v_bad_tx,now(),'8982386338');
 raise exception 'Expected rejection: authenticated role cannot invoke internal callback';
exception when sqlstate '42501' then
 v_passed := v_passed || jsonb_build_array('authenticated role cannot invoke internal callback');
end;
execute 'reset role';
perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',v_other)::text,true);
perform set_config('request.jwt.claim.role','authenticated',true);
perform set_config('request.jwt.claim.sub',v_other::text,true);
execute 'set local role authenticated';
begin
 perform public.reward_ad_scan();
 raise exception 'Expected permission denial: authenticated cannot execute reward_ad_scan';
exception when sqlstate '42501' then
 v_passed := v_passed || jsonb_build_array('authenticated cannot execute reward_ad_scan');
end;
begin
 perform public.claim_rewarded_ad_scan(gen_random_uuid());
 raise exception 'Expected permission denial: authenticated cannot execute claim_rewarded_ad_scan';
exception when sqlstate '42501' then
 v_passed := v_passed || jsonb_build_array('authenticated cannot execute claim_rewarded_ad_scan');
end;
execute 'reset role';
perform set_config('request.jwt.claims',jsonb_build_object('role','anon','sub',v_other)::text,true);
perform set_config('request.jwt.claim.role','anon',true);
perform set_config('request.jwt.claim.sub',v_other::text,true);
execute 'set local role anon';
begin
 perform public.reward_ad_scan();
 raise exception 'Expected permission denial: anon cannot execute reward_ad_scan';
exception when sqlstate '42501' then
 v_passed := v_passed || jsonb_build_array('anon cannot execute reward_ad_scan');
end;
begin
 perform public.claim_rewarded_ad_scan(gen_random_uuid());
 raise exception 'Expected permission denial: anon cannot execute claim_rewarded_ad_scan';
exception when sqlstate '42501' then
 v_passed := v_passed || jsonb_build_array('anon cannot execute claim_rewarded_ad_scan');
end;
execute 'reset role';
if ((select available_scan_credits from public.account_entitlements where user_id=v_user)=13 and (select available_scan_credits from public.account_entitlements where user_id=v_other)=10) is not true then raise exception 'Failed: rejected legacy client calls preserve all existing balances'; end if;
v_passed := v_passed || jsonb_build_array('rejected legacy client calls preserve all existing balances');
perform set_config('request.jwt.claims',jsonb_build_object('role','service_role','sub',v_other)::text,true);
perform set_config('request.jwt.claim.role','service_role',true);
execute 'set local role authenticated';
begin
 perform public.reward_ad_scan();
 raise exception 'Expected permission denial: service JWT claim cannot override authenticated SQL role for reward_ad_scan';
exception when sqlstate '42501' then
 v_passed := v_passed || jsonb_build_array('service JWT claim cannot override authenticated SQL role for reward_ad_scan');
end;
begin
 perform public.claim_rewarded_ad_scan(gen_random_uuid());
 raise exception 'Expected permission denial: service JWT claim cannot override authenticated SQL role for claim_rewarded_ad_scan';
exception when sqlstate '42501' then
 v_passed := v_passed || jsonb_build_array('service JWT claim cannot override authenticated SQL role for claim_rewarded_ad_scan');
end;
execute 'reset role';
if (not has_function_privilege('authenticated','public.reward_ad_scan()','EXECUTE') and not has_function_privilege('anon','public.reward_ad_scan()','EXECUTE') and not has_function_privilege('authenticated','public.claim_rewarded_ad_scan(uuid)','EXECUTE') and not has_function_privilege('anon','public.claim_rewarded_ad_scan(uuid)','EXECUTE') and has_function_privilege('service_role','public.reward_ad_scan()','EXECUTE') and has_function_privilege('service_role','public.claim_rewarded_ad_scan(uuid)','EXECUTE')) is not true then raise exception 'Failed: legacy client execution absent and service-role execution retained'; end if;
v_passed := v_passed || jsonb_build_array('legacy client execution absent and service-role execution retained');
execute 'set local role service_role';
v_result := to_jsonb(public.reward_ad_scan());
if (v_result='11'::jsonb) is not true then raise exception 'Failed: trusted service legacy reward call still works'; end if;
v_passed := v_passed || jsonb_build_array('trusted service legacy reward call still works');
v_bad_tx := gen_random_uuid()::text;
v_result := public.claim_rewarded_ad_scan(v_bad_tx::uuid);
if ((v_result->>'granted')::boolean and (v_result->>'available_scan_credits')::integer=12) is not true then raise exception 'Failed: trusted service legacy claim still works'; end if;
v_passed := v_passed || jsonb_build_array('trusted service legacy claim still works');
v_result := public.claim_rewarded_ad_scan(v_bad_tx::uuid);
if (not (v_result->>'granted')::boolean and (v_result->>'duplicate')::boolean) is not true then raise exception 'Failed: trusted service legacy duplicate remains idempotent'; end if;
v_passed := v_passed || jsonb_build_array('trusted service legacy duplicate remains idempotent');
begin
 perform public.claim_rewarded_ad_scan(gen_random_uuid());
 raise exception 'Expected legacy cooldown';
exception when sqlstate '23514' then
 v_passed := v_passed || jsonb_build_array('trusted service legacy cooldown preserved');
end;
execute 'reset role';
select to_jsonb(e)-'available_scan_credits'-'version'-'updated_at' into v_after from public.account_entitlements e where user_id=v_user;
if (v_before=v_after) is not true then raise exception 'Failed: legacy restriction and service calls leave Premium RevenueCat fields unchanged'; end if;
v_passed := v_passed || jsonb_build_array('legacy restriction and service calls leave Premium RevenueCat fields unchanged');
perform set_config('worthit.staging_test_results',v_passed::text,true);
end;
$test$;
select current_setting('worthit.staging_test_results')::jsonb as passed_tests;
rollback;
