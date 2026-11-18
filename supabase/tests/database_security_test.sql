-- ROT. The Brainrot Club — Stage 2 / 2.2 Database Security & RLS Verification Suite
-- Run inside a transaction against a Postgres/Supabase database where migrations 001..004 are applied.
-- Uses simulated authenticated JWT contexts (auth.uid()) and SET LOCAL ROLE authenticated.

BEGIN;

-- ============================================================================
-- 0. SEED TEST AUTH USERS (SIMULATING SUPABASE AUTH)
-- ============================================================================

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  (
    '11111111-1111-4111-8111-111111111111',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'alice@example.test', '',
    now(), '{"provider":"google"}'::jsonb, '{"full_name":"Alice Test"}'::jsonb, now(), now()
  ),
  (
    '22222222-2222-4222-8222-222222222222',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'bob@example.test', '',
    now(), '{"provider":"google"}'::jsonb, '{"full_name":"Bob Test"}'::jsonb, now(), now()
  ),
  (
    '33333333-3333-4333-8333-333333333333',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', NULL, '',
    now(), '{"provider":"google"}'::jsonb, '{"name":"NoEmail Charlie"}'::jsonb, now(), now()
  ),
  (
    '44444444-4444-4444-8444-444444444444',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'dana@example.test', '',
    now(), '{"provider":"google"}'::jsonb, '{"full_name":"   ","name":"Dana Fallback","picture":"http://insecure.example/a.png"}'::jsonb, now(), now()
  )
ON CONFLICT (id) DO NOTHING;

-- Verify onboarding trigger defaults, no-email handling, whitespace fallback, and HTTPS avatar check
DO $$
DECLARE
  v_alice public.profiles%ROWTYPE;
  v_charlie public.profiles%ROWTYPE;
  v_dana public.profiles%ROWTYPE;
BEGIN
  SELECT * INTO v_alice FROM public.profiles WHERE id = '11111111-1111-4111-8111-111111111111';
  ASSERT v_alice.cloud_xp = 0, 'Alice cloud_xp must start at 0';
  ASSERT v_alice.share_squad_status = false, 'Alice share_squad_status must default to false';
  ASSERT v_alice.status_band = 'hidden', 'Alice status_band must default to hidden';
  ASSERT v_alice.timezone = 'UTC', 'Alice timezone must default to UTC';

  SELECT * INTO v_charlie FROM public.profiles WHERE id = '33333333-3333-4333-8333-333333333333';
  ASSERT v_charlie.cloud_xp = 0, 'Charlie (no-email) cloud_xp must start at 0';
  ASSERT v_charlie.display_name = 'NoEmail Charlie', 'Charlie display_name should resolve from metadata';

  SELECT * INTO v_dana FROM public.profiles WHERE id = '44444444-4444-4444-8444-444444444444';
  ASSERT v_dana.display_name = 'Dana Fallback', 'Whitespace full_name must fall back to name';
  ASSERT v_dana.avatar_url IS NULL, 'Non-HTTPS avatar URL must be stripped during onboarding';
END;
$$;

-- Verify squad max_members constraint enforces 2..12 cap
DO $$
DECLARE
  v_failed boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.squads (name, owner_id, max_members)
    VALUES ('Too Big Squad', '11111111-1111-4111-8111-111111111111', 13);
  EXCEPTION WHEN check_violation THEN
    v_failed := true;
  END;
  ASSERT v_failed, 'squads.max_members > 12 must violate chk_squads_max_members';
END;
$$;

-- ============================================================================
-- 1. HELPER TO SWITCH SIMULATED JWT USER
-- ============================================================================

CREATE OR REPLACE FUNCTION pg_temp.act_as(p_uid uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_uid::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', p_uid::text, 'role', 'authenticated')::text,
    true
  );
END;
$$;

-- ============================================================================
-- 2. TEST CROSS-USER ISOLATION, REVOKED HELPER RPCS, & DIRECT XP TAMPERING
-- ============================================================================

SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_count integer;
  v_failed boolean := false;
BEGIN
  PERFORM pg_temp.act_as('22222222-2222-4222-8222-222222222222');

  -- Bob cannot read or update Alice's profile directly
  SELECT COUNT(*) INTO v_count FROM public.profiles WHERE id = '11111111-1111-4111-8111-111111111111';
  ASSERT v_count = 0, 'Bob must not see Alice profile directly';

  UPDATE public.profiles SET display_name = 'Hacked' WHERE id = '11111111-1111-4111-8111-111111111111';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  ASSERT v_count = 0, 'Bob must not update Alice profile';

  -- Bob cannot directly modify his own cloud_xp
  BEGIN
    UPDATE public.profiles SET cloud_xp = 9999 WHERE id = '22222222-2222-4222-8222-222222222222';
  EXCEPTION WHEN insufficient_privilege OR SQLSTATE '42501' THEN
    v_failed := true;
  END;
  ASSERT v_failed, 'Direct update to profiles.cloud_xp must fail';

  -- Bob cannot set non-HTTPS avatar URL or invalid timezone on his own profile
  v_failed := false;
  BEGIN
    UPDATE public.profiles SET avatar_url = 'http://insecure.example/avatar.png' WHERE id = '22222222-2222-4222-8222-222222222222';
  EXCEPTION WHEN check_violation THEN
    v_failed := true;
  END;
  ASSERT v_failed, 'Non-HTTPS avatar_url update must fail';

  v_failed := false;
  BEGIN
    UPDATE public.profiles SET timezone = 'Mars/Olympus' WHERE id = '22222222-2222-4222-8222-222222222222';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_failed := true;
  END;
  ASSERT v_failed, 'Invalid IANA timezone update on profile must fail';

  -- Bob cannot directly insert into xp_sync_events
  v_failed := false;
  BEGIN
    INSERT INTO public.xp_sync_events (
      user_id, idempotency_key, event_type, event_ref, xp_amount, local_date_key, timezone, client_occurred_at
    ) VALUES (
      '22222222-2222-4222-8222-222222222222', 'forged-1', 'mission', 'touch-grass', 40, current_date, 'UTC', now()
    );
  EXCEPTION WHEN insufficient_privilege OR SQLSTATE '42501' THEN
    v_failed := true;
  END;
  ASSERT v_failed, 'Direct insert into xp_sync_events must fail';

  -- Bob cannot call arbitrary-user helper RPCs or internal notification helper
  v_failed := false;
  BEGIN
    PERFORM public.are_users_blocked('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333');
  EXCEPTION WHEN insufficient_privilege OR SQLSTATE '42501' THEN
    v_failed := true;
  END;
  ASSERT v_failed, 'Authenticated users must not execute are_users_blocked';

  v_failed := false;
  BEGIN
    PERFORM public.is_squad_member('00000000-0000-0000-0000-000000000001', '11111111-1111-4111-8111-111111111111');
  EXCEPTION WHEN insufficient_privilege OR SQLSTATE '42501' THEN
    v_failed := true;
  END;
  ASSERT v_failed, 'Authenticated users must not execute is_squad_member';

  v_failed := false;
  BEGIN
    PERFORM public.is_squad_owner('00000000-0000-0000-0000-000000000001', '11111111-1111-4111-8111-111111111111');
  EXCEPTION WHEN insufficient_privilege OR SQLSTATE '42501' THEN
    v_failed := true;
  END;
  ASSERT v_failed, 'Authenticated users must not execute is_squad_owner';

  v_failed := false;
  BEGIN
    PERFORM public.create_social_notification(
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      'squad_invite_received', 'Fake', 'Fake body'
    );
  EXCEPTION WHEN insufficient_privilege OR SQLSTATE '42501' THEN
    v_failed := true;
  END;
  ASSERT v_failed, 'Authenticated users must not execute create_social_notification';

  -- Ordinary authenticated users cannot call account cleanup RPC
  v_failed := false;
  BEGIN
    PERFORM public.cleanup_cloud_account_before_delete('22222222-2222-4222-8222-222222222222');
  EXCEPTION WHEN insufficient_privilege OR SQLSTATE '42501' THEN
    v_failed := true;
  END;
  ASSERT v_failed, 'Ordinary authenticated users must not execute cleanup_cloud_account_before_delete';
END;
$$;

-- ============================================================================
-- 3. TEST XP TIMEZONE LOCKING, IDEMPOTENCY, & 600 XP DAILY CAP
-- ============================================================================

DO $$
DECLARE
  v_res jsonb;
  v_today date;
  v_failed boolean := false;
BEGIN
  PERFORM pg_temp.act_as('11111111-1111-4111-8111-111111111111');

  -- Mismatched per-request timezone while profile timezone is UTC must be rejected
  v_today := (timezone('Asia/Dhaka', now()))::date;
  BEGIN
    PERFORM public.award_cloud_xp('m-tz-spoof', 'mission', 'touch-grass', v_today, 'Asia/Dhaka', now());
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_failed := true;
  END;
  ASSERT v_failed, 'award_cloud_xp must reject request timezone mismatching saved profile timezone';

  -- Alice saves her legitimate profile timezone
  UPDATE public.profiles SET timezone = 'Asia/Dhaka' WHERE id = '11111111-1111-4111-8111-111111111111';

  -- Award mission XP once under saved profile timezone
  v_res := public.award_cloud_xp('m-touch-1', 'mission', 'touch-grass', v_today, 'Asia/Dhaka', now());
  ASSERT (v_res ->> 'awarded')::boolean = true, 'First XP award should succeed';
  ASSERT (v_res ->> 'xp_awarded')::integer = 40, 'Server must award exact 40 XP for touch-grass';
  ASSERT (v_res ->> 'new_cloud_xp')::integer = 40, 'Alice cloud_xp should now be 40';

  -- Replay same idempotency key (even with an old timestamp > 36h) -> duplicate=true, 0 extra XP
  v_res := public.award_cloud_xp('m-touch-1', 'mission', 'touch-grass', v_today, 'Asia/Dhaka', now() - interval '72 hours');
  ASSERT (v_res ->> 'duplicate')::boolean = true, 'Late duplicate replay must still return duplicate=true';
  ASSERT (v_res ->> 'new_cloud_xp')::integer = 40, 'Duplicate replay must not add XP';

  -- Different idempotency key for same daily mission on same date -> rejected
  v_failed := false;
  BEGIN
    PERFORM public.award_cloud_xp('m-touch-2', 'mission', 'touch-grass', v_today, 'Asia/Dhaka', now());
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_failed := true;
  END;
  ASSERT v_failed, 'Second touch-grass award on same day must be rejected';

  -- Timezone-hopping attempt with Pacific/Kiritimati -> rejected
  v_failed := false;
  BEGIN
    PERFORM public.award_cloud_xp('m-hop', 'mission', 'brain-check-in', (timezone('Pacific/Kiritimati', now()))::date, 'Pacific/Kiritimati', now());
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_failed := true;
  END;
  ASSERT v_failed, 'Per-request timezone hopping must be rejected';

  -- Future/backdated date manipulation -> rejected
  v_failed := false;
  BEGIN
    PERFORM public.award_cloud_xp('m-backdate', 'mission', 'brain-check-in', v_today - 5, 'Asia/Dhaka', now());
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_failed := true;
  END;
  ASSERT v_failed, 'Backdated local_date_key must be rejected';

  -- Complete full legitimate daily + weekly + streak recovery combination (total 590 XP <= 600 XP cap)
  PERFORM public.award_cloud_xp('m-limit-1', 'mission', 'set-scroll-limit', v_today, 'Asia/Dhaka', now());
  PERFORM public.award_cloud_xp('m-checkin-1', 'mission', 'brain-check-in', v_today, 'Asia/Dhaka', now());
  PERFORM public.award_cloud_xp('m-under-1', 'mission', 'stay-under-target', v_today, 'Asia/Dhaka', now());
  PERFORM public.award_cloud_xp('chest-1', 'chest', 'daily-chest', v_today, 'Asia/Dhaka', now());
  PERFORM public.award_cloud_xp('brk-1', 'focus_break', 'focus-break', v_today, 'Asia/Dhaka', now());
  PERFORM public.award_cloud_xp('brk-2', 'focus_break', 'focus-break', v_today, 'Asia/Dhaka', now());
  PERFORM public.award_cloud_xp('brk-3', 'focus_break', 'focus-break', v_today, 'Asia/Dhaka', now());
  PERFORM public.award_cloud_xp('wk-1', 'weekly_quest', 'balanced-week', v_today, 'Asia/Dhaka', now());
  PERFORM public.award_cloud_xp('wk-2', 'weekly_quest', 'focus-master', v_today, 'Asia/Dhaka', now());
  PERFORM public.award_cloud_xp('wk-3', 'weekly_quest', 'under-target-week', v_today, 'Asia/Dhaka', now());
  v_res := public.award_cloud_xp('rec-1', 'streak_recovery', 'streak-recovery', v_today, 'Asia/Dhaka', now());
  ASSERT (v_res ->> 'new_cloud_xp')::integer = 590, 'Full daily+weekly combo (590 XP) must succeed under 600 XP cap';

  -- 4th focus_break on same local date -> rejected
  v_failed := false;
  BEGIN
    PERFORM public.award_cloud_xp('brk-4', 'focus_break', 'focus-break', v_today, 'Asia/Dhaka', now());
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_failed := true;
  END;
  ASSERT v_failed, '4th focus_break on same local date must be rejected';
END;
$$;

-- ============================================================================
-- 4. TEST SQUADS, INVITATION COOLDOWNS/CAPS, OWNERSHIP HANDOFF, & EX-OWNER ACCESS
-- ============================================================================

DO $$
DECLARE
  v_squad jsonb;
  v_squad_id uuid;
  v_inv jsonb;
  v_inv_id uuid;
  v_inv_code text;
  v_open_inv jsonb;
  v_open_inv_id uuid;
  v_cnt integer;
  v_i integer;
  v_failed boolean := false;
BEGIN
  -- Alice creates squad (max_members must default to 12)
  PERFORM pg_temp.act_as('11111111-1111-4111-8111-111111111111');
  v_squad := public.create_squad('Offline Club');
  v_squad_id := (v_squad ->> 'id')::uuid;
  ASSERT (v_squad ->> 'max_members')::integer = 12, 'create_squad max_members must default to 12';

  -- Alice creates targeted invite for Bob and an open invite
  v_inv := public.create_squad_invitation(v_squad_id, '22222222-2222-4222-8222-222222222222', 24);
  v_inv_id := (v_inv ->> 'id')::uuid;
  v_inv_code := v_inv ->> 'invite_code';

  v_open_inv := public.create_squad_invitation(v_squad_id, NULL, 24);
  v_open_inv_id := (v_open_inv ->> 'id')::uuid;

  -- Charlie cannot see squad, roster, invitation, or Bob's invite notification
  PERFORM pg_temp.act_as('33333333-3333-4333-8333-333333333333');
  SELECT COUNT(*) INTO v_cnt FROM public.squads WHERE id = v_squad_id;
  ASSERT v_cnt = 0, 'Non-member Charlie must not see squad';

  SELECT COUNT(*) INTO v_cnt FROM public.squad_invitations WHERE id = v_inv_id;
  ASSERT v_cnt = 0, 'Charlie must not see Bob invitation';

  SELECT COUNT(*) INTO v_cnt FROM public.notifications WHERE recipient_user_id = '22222222-2222-4222-8222-222222222222';
  ASSERT v_cnt = 0, 'Charlie must not see Bob notifications';

  v_failed := false;
  BEGIN
    PERFORM * FROM public.get_squad_roster(v_squad_id);
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_failed := true;
  END;
  ASSERT v_failed, 'Non-member Charlie must be denied get_squad_roster';

  v_failed := false;
  BEGIN
    PERFORM public.accept_squad_invitation(v_inv_code);
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_failed := true;
  END;
  ASSERT v_failed, 'Charlie must not accept invitation addressed to Bob';

  -- Bob sees his notification and accepts targeted invite
  PERFORM pg_temp.act_as('22222222-2222-4222-8222-222222222222');
  SELECT COUNT(*) INTO v_cnt
  FROM public.notifications
  WHERE recipient_user_id = '22222222-2222-4222-8222-222222222222'
    AND notification_type = 'squad_invite_received'
    AND is_read = false;
  ASSERT v_cnt = 1, 'Bob should receive 1 unread squad_invite_received notification';

  PERFORM public.accept_squad_invitation(v_inv_code);

  -- Bob verifies squad roster masks Alice's unconsented status_band ('hidden')
  SELECT COUNT(*) INTO v_cnt
  FROM public.get_squad_roster(v_squad_id)
  WHERE user_id = '11111111-1111-4111-8111-111111111111'
    AND status_band = 'hidden';
  ASSERT v_cnt = 1, 'Squad roster must mask status_band to hidden when share_squad_status is false';

  -- Alice transfers ownership to Bob -> outgoing open invitation must be revoked
  PERFORM pg_temp.act_as('11111111-1111-4111-8111-111111111111');
  PERFORM public.transfer_squad_ownership(v_squad_id, '22222222-2222-4222-8222-222222222222');

  SELECT COUNT(*) INTO v_cnt
  FROM public.squad_invitations
  WHERE id = v_open_inv_id AND status = 'revoked';
  ASSERT v_cnt = 1, 'Outgoing owner open invite must be revoked on ownership transfer';

  -- Alice creates a targeted invite test? No, Bob is now owner and invites Charlie
  PERFORM pg_temp.act_as('22222222-2222-4222-8222-222222222222');
  v_inv := public.create_squad_invitation(v_squad_id, '33333333-3333-4333-8333-333333333333', 24);
  v_inv_id := (v_inv ->> 'id')::uuid;

  -- Former owner Alice (still a member) cannot revoke Bob's invitation or view Bob's new invitation
  PERFORM pg_temp.act_as('11111111-1111-4111-8111-111111111111');
  SELECT COUNT(*) INTO v_cnt FROM public.squad_invitations WHERE id = v_inv_id;
  ASSERT v_cnt = 0, 'Non-owner Alice must not see Bob new invitation';

  v_failed := false;
  BEGIN
    PERFORM public.revoke_squad_invitation(v_inv_id);
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_failed := true;
  END;
  ASSERT v_failed, 'Former owner must not revoke squad invitations';

  -- Alice leaves squad and loses visibility even on invitations she originally created
  PERFORM public.leave_squad(v_squad_id);
  SELECT COUNT(*) INTO v_cnt
  FROM public.squad_invitations
  WHERE squad_id = v_squad_id AND inviter_id = '11111111-1111-4111-8111-111111111111';
  ASSERT v_cnt = 0, 'Former member/owner must not retain SELECT access to old squad invitations';

  -- Charlie declines Bob's invite -> 24h re-invite cooldown enforced
  PERFORM pg_temp.act_as('33333333-3333-4333-8333-333333333333');
  PERFORM public.decline_squad_invitation(v_inv_id);

  PERFORM pg_temp.act_as('22222222-2222-4222-8222-222222222222');
  v_failed := false;
  BEGIN
    PERFORM public.create_squad_invitation(v_squad_id, '33333333-3333-4333-8333-333333333333', 24);
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_failed := true;
  END;
  ASSERT v_failed, '24h re-invite cooldown must block immediate re-invite after decline';

  -- Active pending invitation cap (max 10 per squad)
  FOR v_i IN 1..10 LOOP
    PERFORM public.create_squad_invitation(v_squad_id, NULL, 24);
  END LOOP;

  v_failed := false;
  BEGIN
    PERFORM public.create_squad_invitation(v_squad_id, NULL, 24);
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_failed := true;
  END;
  ASSERT v_failed, '11th active pending invitation for the same squad must be rejected';

  -- 10-squad membership limit check for Dana
  PERFORM pg_temp.act_as('44444444-4444-4444-8444-444444444444');
  FOR v_i IN 1..10 LOOP
    PERFORM public.create_squad('Dana Squad ' || v_i::text);
  END LOOP;

  v_failed := false;
  BEGIN
    PERFORM public.create_squad('Dana Squad 11');
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_failed := true;
  END;
  ASSERT v_failed, '11th squad creation must be blocked by 10-squad limit';
END;
$$;

-- ============================================================================
-- 5. TEST BLOCKING, ABUSE REPORT RPC, PREFERENCE ISOLATION, & TRUSTED CLEANUP
-- ============================================================================

DO $$
DECLARE
  v_squad_id uuid;
  v_inv jsonb;
  v_cnt integer;
  v_failed boolean := false;
BEGIN
  -- Alice creates a squad, invites Dana (who joins), and blocks Charlie
  PERFORM pg_temp.act_as('11111111-1111-4111-8111-111111111111');
  v_squad_id := ((public.create_squad('Block Test Squad')) ->> 'id')::uuid;
  v_inv := public.create_squad_invitation(v_squad_id, '44444444-4444-4444-8444-444444444444', 24);

  INSERT INTO public.user_blocks (blocker_id, blocked_id)
  VALUES ('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333');

  -- Alice cannot invite blocked user Charlie
  v_failed := false;
  BEGIN
    PERFORM public.create_squad_invitation(v_squad_id, '33333333-3333-4333-8333-333333333333', 24);
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_failed := true;
  END;
  ASSERT v_failed, 'Blocked user cannot be invited to squad';

  -- Direct client INSERT into abuse_reports must fail
  v_failed := false;
  BEGIN
    INSERT INTO public.abuse_reports (reporter_id, reported_user_id, squad_id, category, details)
    VALUES ('11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444444', v_squad_id, 'spam', 'Direct insert');
  EXCEPTION WHEN insufficient_privilege OR SQLSTATE '42501' THEN
    v_failed := true;
  END;
  ASSERT v_failed, 'Direct client INSERT on abuse_reports must be denied';

  -- submit_abuse_report rejects reporting unrelated/non-member UUIDs without leaking existence
  v_failed := false;
  BEGIN
    PERFORM public.submit_abuse_report('33333333-3333-4333-8333-333333333333', 'spam', 'No shared squad', v_squad_id);
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_failed := true;
  END;
  ASSERT v_failed, 'submit_abuse_report must reject target not in specified squad';

  -- Legitimate report against invited user Dana succeeds with status=open
  PERFORM public.submit_abuse_report('44444444-4444-4444-8444-444444444444', 'spam', 'Invited member spam');

  SELECT COUNT(*) INTO v_cnt
  FROM public.abuse_reports
  WHERE reporter_id = '11111111-1111-4111-8111-111111111111' AND status = 'open';
  ASSERT v_cnt = 1, 'submit_abuse_report must create open report';

  -- Duplicate open report against same target is rejected
  v_failed := false;
  BEGIN
    PERFORM public.submit_abuse_report('44444444-4444-4444-8444-444444444444', 'harassment', 'Duplicate open');
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_failed := true;
  END;
  ASSERT v_failed, 'Duplicate open abuse report against same user must be rejected';

  -- Charlie cannot read Alice's abuse report, delete Alice's block, or read Alice's notification preferences
  PERFORM pg_temp.act_as('33333333-3333-4333-8333-333333333333');
  SELECT COUNT(*) INTO v_cnt FROM public.abuse_reports;
  ASSERT v_cnt = 0, 'Charlie must not see Alice abuse reports';

  DELETE FROM public.user_blocks WHERE blocker_id = '11111111-1111-4111-8111-111111111111';
  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  ASSERT v_cnt = 0, 'Charlie must not delete Alice block entry';

  SELECT COUNT(*) INTO v_cnt
  FROM public.notification_preferences
  WHERE user_id = '11111111-1111-4111-8111-111111111111';
  ASSERT v_cnt = 0, 'Charlie must not see Alice notification preferences';

  -- Notification immutability check: Bob cannot edit notification title
  PERFORM pg_temp.act_as('22222222-2222-4222-8222-222222222222');
  v_failed := false;
  BEGIN
    UPDATE public.notifications SET title = 'Tampered' WHERE recipient_user_id = '22222222-2222-4222-8222-222222222222';
  EXCEPTION WHEN insufficient_privilege OR SQLSTATE '42501' THEN
    v_failed := true;
  END;
  ASSERT v_failed, 'Clients must not mutate notification title';
END;
$$;

-- Server-side trusted workflow executes account cleanup cleanly (including multi-squad ownership transfer)
RESET ROLE;

DO $$
DECLARE
  v_cnt integer;
BEGIN
  PERFORM public.cleanup_cloud_account_before_delete('11111111-1111-4111-8111-111111111111');
  SELECT COUNT(*) INTO v_cnt FROM public.profiles WHERE id = '11111111-1111-4111-8111-111111111111';
  ASSERT v_cnt = 0, 'Trusted server cleanup must remove target profile and owned solo squads';
END;
$$;

ROLLBACK;
