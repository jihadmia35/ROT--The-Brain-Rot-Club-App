-- ROT. The Brainrot Club — Stage 2 Migration 003
-- Transaction-safe SECURITY DEFINER RPC functions with explicit search_path,
-- strict auth.uid() checks, input validation, and row-level locking.

-- ============================================================================
-- 1. INTERNAL SOCIAL NOTIFICATION HELPER (NOT CALLABLE BY CLIENTS)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_social_notification(
  p_recipient_user_id uuid,
  p_actor_user_id uuid,
  p_notification_type text,
  p_title text,
  p_body text,
  p_related_entity_id uuid DEFAULT NULL,
  p_related_entity_type text DEFAULT NULL,
  p_dedup_key text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_invites_enabled boolean := true;
  v_activity_enabled boolean := true;
  v_notif_id uuid;
BEGIN
  IF p_recipient_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF p_actor_user_id IS NOT NULL AND p_recipient_user_id = p_actor_user_id THEN
    RETURN NULL;
  END IF;

  IF p_actor_user_id IS NOT NULL AND public.are_users_blocked(p_recipient_user_id, p_actor_user_id) THEN
    RETURN NULL;
  END IF;

  SELECT
    COALESCE(np.squad_invites_enabled, true),
    COALESCE(np.squad_activity_enabled, true)
  INTO v_invites_enabled, v_activity_enabled
  FROM public.notification_preferences np
  WHERE np.user_id = p_recipient_user_id;

  IF p_notification_type = 'squad_invite_received' AND NOT COALESCE(v_invites_enabled, true) THEN
    RETURN NULL;
  END IF;

  IF p_notification_type <> 'squad_invite_received' AND NOT COALESCE(v_activity_enabled, true) THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.notifications (
    recipient_user_id,
    actor_user_id,
    notification_type,
    title,
    body,
    related_entity_id,
    related_entity_type,
    dedup_key
  )
  VALUES (
    p_recipient_user_id,
    p_actor_user_id,
    p_notification_type,
    left(btrim(p_title), 120),
    left(btrim(p_body), 500),
    p_related_entity_id,
    p_related_entity_type,
    p_dedup_key
  )
  ON CONFLICT (recipient_user_id, dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING
  RETURNING id INTO v_notif_id;

  RETURN v_notif_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_social_notification(uuid, uuid, text, text, text, uuid, text, text) FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- 2. XP SYNCHRONIZATION RPC (AUTHORITATIVE SERVER ALLOWLIST + DAILY CAPS)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.award_cloud_xp(
  p_idempotency_key text,
  p_event_type text,
  p_event_ref text,
  p_local_date_key date,
  p_timezone text,
  p_client_occurred_at timestamptz DEFAULT timezone('utc', now())
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_catalog
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_clean_key text;
  v_clean_type text;
  v_clean_ref text;
  v_clean_tz text;
  v_now_utc timestamptz := timezone('utc', now());
  v_server_local_date date;
  v_current_xp integer;
  v_new_xp integer;
  v_xp_amount integer;
  v_existing_id uuid;
  v_week_start date;
  v_focus_count integer;
  v_daily_total integer;
  v_event_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  v_clean_key := btrim(COALESCE(p_idempotency_key, ''));
  v_clean_type := btrim(COALESCE(p_event_type, ''));
  v_clean_ref := btrim(COALESCE(p_event_ref, ''));
  v_clean_tz := btrim(COALESCE(p_timezone, ''));

  IF char_length(v_clean_key) < 3 OR char_length(v_clean_key) > 128 THEN
    RAISE EXCEPTION 'Invalid idempotency_key length' USING ERRCODE = '22023';
  END IF;

  IF p_local_date_key IS NULL THEN
    RAISE EXCEPTION 'local_date_key is required' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = v_clean_tz) THEN
    RAISE EXCEPTION 'Invalid IANA timezone: %', v_clean_tz USING ERRCODE = '22023';
  END IF;

  IF p_client_occurred_at IS NULL
     OR p_client_occurred_at > v_now_utc + interval '5 minutes'
     OR p_client_occurred_at < v_now_utc - interval '36 hours' THEN
    RAISE EXCEPTION 'client_occurred_at is outside allowed sync window' USING ERRCODE = '22023';
  END IF;

  v_server_local_date := (timezone(v_clean_tz, v_now_utc))::date;
  IF p_local_date_key > v_server_local_date OR p_local_date_key < (v_server_local_date - 1) THEN
    RAISE EXCEPTION 'local_date_key % is outside allowed local date window (%)', p_local_date_key, v_server_local_date
      USING ERRCODE = '22023';
  END IF;

  -- Lock user profile row to serialize concurrent XP awards
  SELECT cloud_xp
  INTO v_current_xp
  FROM public.profiles
  WHERE id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found' USING ERRCODE = 'P0002';
  END IF;

  -- Idempotency check before rule cap checks so safe retries return cleanly
  SELECT id
  INTO v_existing_id
  FROM public.xp_sync_events
  WHERE user_id = v_uid
    AND idempotency_key = v_clean_key;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'awarded', false,
      'duplicate', true,
      'xp_awarded', 0,
      'new_cloud_xp', v_current_xp,
      'event_id', v_existing_id,
      'local_date_key', p_local_date_key
    );
  END IF;

  -- Authoritative server-side XP rule allowlist (client never picks XP amount)
  v_xp_amount := CASE
    WHEN v_clean_type = 'mission' AND v_clean_ref = 'touch-grass' THEN 40
    WHEN v_clean_type = 'mission' AND v_clean_ref = 'set-scroll-limit' THEN 35
    WHEN v_clean_type = 'mission' AND v_clean_ref = 'brain-check-in' THEN 25
    WHEN v_clean_type = 'mission' AND v_clean_ref = 'stay-under-target' THEN 45
    WHEN v_clean_type = 'chest' AND v_clean_ref = 'daily-chest' THEN 50
    WHEN v_clean_type = 'focus_break' AND v_clean_ref = 'focus-break' THEN 30
    WHEN v_clean_type = 'weekly_quest' AND v_clean_ref = 'balanced-week' THEN 90
    WHEN v_clean_type = 'weekly_quest' AND v_clean_ref = 'focus-master' THEN 80
    WHEN v_clean_type = 'weekly_quest' AND v_clean_ref = 'under-target-week' THEN 110
    WHEN v_clean_type = 'streak_recovery' AND v_clean_ref = 'streak-recovery' THEN 25
    ELSE NULL
  END;

  IF v_xp_amount IS NULL THEN
    RAISE EXCEPTION 'Unsupported XP event type or reference' USING ERRCODE = '22023';
  END IF;

  -- Per-rule frequency limits
  IF v_clean_type IN ('mission', 'chest') THEN
    IF EXISTS (
      SELECT 1
      FROM public.xp_sync_events
      WHERE user_id = v_uid
        AND event_type = v_clean_type
        AND event_ref = v_clean_ref
        AND local_date_key = p_local_date_key
    ) THEN
      RAISE EXCEPTION 'Daily reward already claimed for % on %', v_clean_ref, p_local_date_key
        USING ERRCODE = '22023';
    END IF;
  ELSIF v_clean_type = 'focus_break' THEN
    SELECT COUNT(*)
    INTO v_focus_count
    FROM public.xp_sync_events
    WHERE user_id = v_uid
      AND event_type = 'focus_break'
      AND local_date_key = p_local_date_key;

    IF v_focus_count >= 3 THEN
      RAISE EXCEPTION 'Daily focus break XP cap reached (max 3 per day)' USING ERRCODE = '22023';
    END IF;
  ELSIF v_clean_type IN ('weekly_quest', 'streak_recovery') THEN
    v_week_start := (date_trunc('week', p_local_date_key::timestamp))::date;
    IF EXISTS (
      SELECT 1
      FROM public.xp_sync_events
      WHERE user_id = v_uid
        AND event_type = v_clean_type
        AND event_ref = v_clean_ref
        AND (date_trunc('week', local_date_key::timestamp))::date = v_week_start
    ) THEN
      RAISE EXCEPTION 'Weekly reward already claimed for % in week of %', v_clean_ref, v_week_start
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Hard daily XP cap per user per local date
  SELECT COALESCE(SUM(xp_amount), 0)
  INTO v_daily_total
  FROM public.xp_sync_events
  WHERE user_id = v_uid
    AND local_date_key = p_local_date_key;

  IF v_daily_total + v_xp_amount > 500 THEN
    RAISE EXCEPTION 'Daily cloud XP cap (500 XP) reached' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.xp_sync_events (
    user_id,
    idempotency_key,
    event_type,
    event_ref,
    xp_amount,
    local_date_key,
    timezone,
    client_occurred_at
  )
  VALUES (
    v_uid,
    v_clean_key,
    v_clean_type,
    v_clean_ref,
    v_xp_amount,
    p_local_date_key,
    v_clean_tz,
    p_client_occurred_at
  )
  RETURNING id INTO v_event_id;

  UPDATE public.profiles
  SET cloud_xp = cloud_xp + v_xp_amount
  WHERE id = v_uid
  RETURNING cloud_xp INTO v_new_xp;

  RETURN jsonb_build_object(
    'awarded', true,
    'duplicate', false,
    'xp_awarded', v_xp_amount,
    'new_cloud_xp', v_new_xp,
    'event_id', v_event_id,
    'local_date_key', p_local_date_key
  );
END;
$$;

REVOKE ALL ON FUNCTION public.award_cloud_xp(text, text, text, date, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.award_cloud_xp(text, text, text, date, text, timestamptz) TO authenticated;

-- ============================================================================
-- 3. SQUAD & INVITATION RPCS
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_squad(
  p_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_catalog
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_clean_name text;
  v_squad_count integer;
  v_squad public.squads%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  v_clean_name := btrim(regexp_replace(COALESCE(p_name, ''), '\s+', ' ', 'g'));
  IF char_length(v_clean_name) < 2 OR char_length(v_clean_name) > 40 THEN
    RAISE EXCEPTION 'Squad name must be 2 to 40 characters' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid) THEN
    RAISE EXCEPTION 'Profile not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT COUNT(*)
  INTO v_squad_count
  FROM public.squad_members
  WHERE user_id = v_uid;

  IF v_squad_count >= 10 THEN
    RAISE EXCEPTION 'Maximum squad membership limit (10) reached' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.squads (name, owner_id)
  VALUES (v_clean_name, v_uid)
  RETURNING * INTO v_squad;

  INSERT INTO public.squad_members (squad_id, user_id, role)
  VALUES (v_squad.id, v_uid, 'owner');

  RETURN jsonb_build_object(
    'id', v_squad.id,
    'name', v_squad.name,
    'owner_id', v_squad.owner_id,
    'max_members', v_squad.max_members,
    'created_at', v_squad.created_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_squad(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_squad(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_squad_invitation(
  p_squad_id uuid,
  p_invitee_id uuid DEFAULT NULL,
  p_expires_in_hours integer DEFAULT 168
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_catalog
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_squad public.squads%ROWTYPE;
  v_member_count integer;
  v_code text;
  v_expires_at timestamptz;
  v_inv public.squad_invitations%ROWTYPE;
  v_actor_name text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF p_squad_id IS NULL THEN
    RAISE EXCEPTION 'squad_id is required' USING ERRCODE = '22023';
  END IF;

  IF p_expires_in_hours IS NULL OR p_expires_in_hours < 1 OR p_expires_in_hours > 720 THEN
    RAISE EXCEPTION 'expires_in_hours must be between 1 and 720' USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_squad
  FROM public.squads
  WHERE id = p_squad_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Squad not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_squad.owner_id <> v_uid THEN
    RAISE EXCEPTION 'Only the squad owner can create invitations' USING ERRCODE = '42501';
  END IF;

  SELECT COUNT(*)
  INTO v_member_count
  FROM public.squad_members
  WHERE squad_id = p_squad_id;

  IF v_member_count >= v_squad.max_members THEN
    RAISE EXCEPTION 'Squad is already full' USING ERRCODE = '22023';
  END IF;

  IF p_invitee_id IS NOT NULL THEN
    IF p_invitee_id = v_uid THEN
      RAISE EXCEPTION 'Cannot invite yourself' USING ERRCODE = '22023';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_invitee_id) THEN
      RAISE EXCEPTION 'Invitee profile does not exist' USING ERRCODE = 'P0002';
    END IF;

    IF public.are_users_blocked(v_uid, p_invitee_id) THEN
      RAISE EXCEPTION 'Cannot invite a blocked user' USING ERRCODE = '42501';
    END IF;

    IF public.is_squad_member(p_squad_id, p_invitee_id) THEN
      RAISE EXCEPTION 'User is already a member of this squad' USING ERRCODE = '22023';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.squad_invitations
      WHERE squad_id = p_squad_id
        AND invitee_id = p_invitee_id
        AND status = 'pending'
        AND expires_at > timezone('utc', now())
    ) THEN
      RAISE EXCEPTION 'An active invitation already exists for this user' USING ERRCODE = '23505';
    END IF;
  END IF;

  v_expires_at := timezone('utc', now()) + make_interval(hours => p_expires_in_hours);
  v_code := upper(left(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 16));

  INSERT INTO public.squad_invitations (
    squad_id,
    inviter_id,
    invitee_id,
    invite_code,
    status,
    expires_at
  )
  VALUES (
    p_squad_id,
    v_uid,
    p_invitee_id,
    v_code,
    'pending',
    v_expires_at
  )
  RETURNING * INTO v_inv;

  IF p_invitee_id IS NOT NULL THEN
    SELECT display_name INTO v_actor_name FROM public.profiles WHERE id = v_uid;
    PERFORM public.create_social_notification(
      p_recipient_user_id => p_invitee_id,
      p_actor_user_id => v_uid,
      p_notification_type => 'squad_invite_received',
      p_title => 'Squad invitation',
      p_body => COALESCE(v_actor_name, 'A club member') || ' invited you to join "' || v_squad.name || '".',
      p_related_entity_id => v_inv.id,
      p_related_entity_type => 'squad_invitation',
      p_dedup_key => 'invite:' || v_inv.id::text
    );
  END IF;

  RETURN jsonb_build_object(
    'id', v_inv.id,
    'squad_id', v_inv.squad_id,
    'invitee_id', v_inv.invitee_id,
    'invite_code', v_inv.invite_code,
    'status', v_inv.status,
    'expires_at', v_inv.expires_at,
    'created_at', v_inv.created_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_squad_invitation(uuid, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_squad_invitation(uuid, uuid, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.accept_squad_invitation(
  p_invite_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_catalog
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_clean_code text;
  v_inv public.squad_invitations%ROWTYPE;
  v_squad public.squads%ROWTYPE;
  v_member_count integer;
  v_user_squad_count integer;
  v_joiner_name text;
  v_other_member record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  v_clean_code := upper(btrim(COALESCE(p_invite_code, '')));
  IF char_length(v_clean_code) < 8 OR char_length(v_clean_code) > 64 THEN
    RAISE EXCEPTION 'Invalid invitation code' USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_inv
  FROM public.squad_invitations
  WHERE upper(invite_code) = v_clean_code
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_inv.status <> 'pending' THEN
    RAISE EXCEPTION 'Invitation is no longer pending' USING ERRCODE = '22023';
  END IF;

  IF v_inv.expires_at <= timezone('utc', now()) THEN
    UPDATE public.squad_invitations
    SET status = 'expired', responded_at = timezone('utc', now())
    WHERE id = v_inv.id;
    RAISE EXCEPTION 'Invitation has expired' USING ERRCODE = '22023';
  END IF;

  IF v_inv.invitee_id IS NOT NULL AND v_inv.invitee_id <> v_uid THEN
    RAISE EXCEPTION 'You are not authorized to accept this invitation' USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_squad
  FROM public.squads
  WHERE id = v_inv.squad_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Squad no longer exists' USING ERRCODE = 'P0002';
  END IF;

  IF public.are_users_blocked(v_uid, v_inv.inviter_id)
     OR public.are_users_blocked(v_uid, v_squad.owner_id) THEN
    RAISE EXCEPTION 'Cannot join this squad due to user block settings' USING ERRCODE = '42501';
  END IF;

  IF public.is_squad_member(v_squad.id, v_uid) THEN
    RAISE EXCEPTION 'You are already a member of this squad' USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*)
  INTO v_member_count
  FROM public.squad_members
  WHERE squad_id = v_squad.id;

  IF v_member_count >= v_squad.max_members THEN
    RAISE EXCEPTION 'Squad is full' USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*)
  INTO v_user_squad_count
  FROM public.squad_members
  WHERE user_id = v_uid;

  IF v_user_squad_count >= 10 THEN
    RAISE EXCEPTION 'Maximum squad membership limit (10) reached' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.squad_members (squad_id, user_id, role)
  VALUES (v_squad.id, v_uid, 'member');

  UPDATE public.squad_invitations
  SET
    status = 'accepted',
    accepted_by = v_uid,
    responded_at = timezone('utc', now())
  WHERE id = v_inv.id;

  SELECT display_name INTO v_joiner_name FROM public.profiles WHERE id = v_uid;

  -- Notify inviter of acceptance
  PERFORM public.create_social_notification(
    p_recipient_user_id => v_inv.inviter_id,
    p_actor_user_id => v_uid,
    p_notification_type => 'squad_invite_accepted',
    p_title => 'Squad invite accepted',
    p_body => COALESCE(v_joiner_name, 'A member') || ' accepted your invite to "' || v_squad.name || '".',
    p_related_entity_id => v_squad.id,
    p_related_entity_type => 'squad',
    p_dedup_key => 'invite_accepted:' || v_inv.id::text || ':' || v_inv.inviter_id::text
  );

  -- Notify other squad members of new member joining
  FOR v_other_member IN
    SELECT sm.user_id
    FROM public.squad_members sm
    WHERE sm.squad_id = v_squad.id
      AND sm.user_id <> v_uid
      AND sm.user_id <> v_inv.inviter_id
  LOOP
    PERFORM public.create_social_notification(
      p_recipient_user_id => v_other_member.user_id,
      p_actor_user_id => v_uid,
      p_notification_type => 'squad_member_joined',
      p_title => 'New squad member',
      p_body => COALESCE(v_joiner_name, 'A member') || ' joined "' || v_squad.name || '".',
      p_related_entity_id => v_squad.id,
      p_related_entity_type => 'squad',
      p_dedup_key => 'member_joined:' || v_inv.id::text || ':' || v_other_member.user_id::text
    );
  END LOOP;

  RETURN jsonb_build_object(
    'squad_id', v_squad.id,
    'squad_name', v_squad.name,
    'role', 'member',
    'invitation_id', v_inv.id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.accept_squad_invitation(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_squad_invitation(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.decline_squad_invitation(
  p_invitation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_catalog
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_inv public.squad_invitations%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_inv
  FROM public.squad_invitations
  WHERE id = p_invitation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_inv.invitee_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'Not authorized to decline this invitation' USING ERRCODE = '42501';
  END IF;

  IF v_inv.status <> 'pending' THEN
    RAISE EXCEPTION 'Invitation is not pending' USING ERRCODE = '22023';
  END IF;

  UPDATE public.squad_invitations
  SET status = 'declined', responded_at = timezone('utc', now())
  WHERE id = v_inv.id;

  RETURN jsonb_build_object('id', v_inv.id, 'status', 'declined');
END;
$$;

REVOKE ALL ON FUNCTION public.decline_squad_invitation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decline_squad_invitation(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.revoke_squad_invitation(
  p_invitation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_catalog
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_inv public.squad_invitations%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_inv
  FROM public.squad_invitations
  WHERE id = p_invitation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.is_squad_owner(v_inv.squad_id, v_uid) AND v_inv.inviter_id <> v_uid THEN
    RAISE EXCEPTION 'Not authorized to revoke this invitation' USING ERRCODE = '42501';
  END IF;

  IF v_inv.status <> 'pending' THEN
    RAISE EXCEPTION 'Only pending invitations can be revoked' USING ERRCODE = '22023';
  END IF;

  UPDATE public.squad_invitations
  SET status = 'revoked', responded_at = timezone('utc', now())
  WHERE id = v_inv.id;

  RETURN jsonb_build_object('id', v_inv.id, 'status', 'revoked');
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_squad_invitation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_squad_invitation(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.leave_squad(
  p_squad_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_catalog
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_squad public.squads%ROWTYPE;
  v_member_count integer;
  v_leaver_name text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_squad
  FROM public.squads
  WHERE id = p_squad_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Squad not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.is_squad_member(p_squad_id, v_uid) THEN
    RAISE EXCEPTION 'You are not a member of this squad' USING ERRCODE = '42501';
  END IF;

  SELECT COUNT(*)
  INTO v_member_count
  FROM public.squad_members
  WHERE squad_id = p_squad_id;

  IF v_squad.owner_id = v_uid THEN
    IF v_member_count > 1 THEN
      RAISE EXCEPTION 'Transfer squad ownership before leaving or delete the squad' USING ERRCODE = '22023';
    END IF;

    DELETE FROM public.squads WHERE id = p_squad_id;
    RETURN jsonb_build_object('left', true, 'squad_deleted', true, 'squad_id', p_squad_id);
  END IF;

  DELETE FROM public.squad_members
  WHERE squad_id = p_squad_id
    AND user_id = v_uid;

  SELECT display_name INTO v_leaver_name FROM public.profiles WHERE id = v_uid;

  PERFORM public.create_social_notification(
    p_recipient_user_id => v_squad.owner_id,
    p_actor_user_id => v_uid,
    p_notification_type => 'squad_member_removed',
    p_title => 'Member left squad',
    p_body => COALESCE(v_leaver_name, 'A member') || ' left "' || v_squad.name || '".',
    p_related_entity_id => v_squad.id,
    p_related_entity_type => 'squad'
  );

  RETURN jsonb_build_object('left', true, 'squad_deleted', false, 'squad_id', p_squad_id);
END;
$$;

REVOKE ALL ON FUNCTION public.leave_squad(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leave_squad(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.transfer_squad_ownership(
  p_squad_id uuid,
  p_new_owner_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_catalog
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_squad public.squads%ROWTYPE;
  v_prev_owner_name text;
  v_new_owner_name text;
  v_other_member record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF p_squad_id IS NULL OR p_new_owner_id IS NULL THEN
    RAISE EXCEPTION 'squad_id and new_owner_id are required' USING ERRCODE = '22023';
  END IF;

  IF p_new_owner_id = v_uid THEN
    RAISE EXCEPTION 'New owner must be a different squad member' USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_squad
  FROM public.squads
  WHERE id = p_squad_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Squad not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_squad.owner_id <> v_uid THEN
    RAISE EXCEPTION 'Only the current owner can transfer ownership' USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_squad_member(p_squad_id, p_new_owner_id) THEN
    RAISE EXCEPTION 'Target user is not a member of this squad' USING ERRCODE = '22023';
  END IF;

  IF public.are_users_blocked(v_uid, p_new_owner_id) THEN
    RAISE EXCEPTION 'Cannot transfer ownership to a blocked user' USING ERRCODE = '42501';
  END IF;

  -- Demote old owner before promoting new owner to satisfy uq_squad_single_owner
  UPDATE public.squad_members
  SET role = 'member'
  WHERE squad_id = p_squad_id AND user_id = v_uid;

  UPDATE public.squad_members
  SET role = 'owner'
  WHERE squad_id = p_squad_id AND user_id = p_new_owner_id;

  UPDATE public.squads
  SET owner_id = p_new_owner_id
  WHERE id = p_squad_id;

  SELECT display_name INTO v_prev_owner_name FROM public.profiles WHERE id = v_uid;
  SELECT display_name INTO v_new_owner_name FROM public.profiles WHERE id = p_new_owner_id;

  PERFORM public.create_social_notification(
    p_recipient_user_id => p_new_owner_id,
    p_actor_user_id => v_uid,
    p_notification_type => 'squad_ownership_transferred',
    p_title => 'You are now squad owner',
    p_body => COALESCE(v_prev_owner_name, 'The previous owner') || ' transferred ownership of "' || v_squad.name || '" to you.',
    p_related_entity_id => p_squad_id,
    p_related_entity_type => 'squad'
  );

  FOR v_other_member IN
    SELECT sm.user_id
    FROM public.squad_members sm
    WHERE sm.squad_id = p_squad_id
      AND sm.user_id <> v_uid
      AND sm.user_id <> p_new_owner_id
  LOOP
    PERFORM public.create_social_notification(
      p_recipient_user_id => v_other_member.user_id,
      p_actor_user_id => v_uid,
      p_notification_type => 'squad_ownership_transferred',
      p_title => 'Squad ownership updated',
      p_body => COALESCE(v_new_owner_name, 'A member') || ' is now the owner of "' || v_squad.name || '".',
      p_related_entity_id => p_squad_id,
      p_related_entity_type => 'squad'
    );
  END LOOP;

  RETURN jsonb_build_object(
    'squad_id', p_squad_id,
    'previous_owner_id', v_uid,
    'new_owner_id', p_new_owner_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.transfer_squad_ownership(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_squad_ownership(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.remove_squad_member(
  p_squad_id uuid,
  p_target_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_catalog
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_squad public.squads%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF p_target_user_id IS NULL OR p_target_user_id = v_uid THEN
    RAISE EXCEPTION 'Invalid target member' USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_squad
  FROM public.squads
  WHERE id = p_squad_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Squad not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_squad.owner_id <> v_uid THEN
    RAISE EXCEPTION 'Only the squad owner can remove members' USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_squad_member(p_squad_id, p_target_user_id) THEN
    RAISE EXCEPTION 'Target user is not a member of this squad' USING ERRCODE = 'P0002';
  END IF;

  DELETE FROM public.squad_members
  WHERE squad_id = p_squad_id
    AND user_id = p_target_user_id;

  PERFORM public.create_social_notification(
    p_recipient_user_id => p_target_user_id,
    p_actor_user_id => v_uid,
    p_notification_type => 'squad_member_removed',
    p_title => 'Removed from squad',
    p_body => 'You were removed from "' || v_squad.name || '".',
    p_related_entity_id => NULL,
    p_related_entity_type => NULL
  );

  RETURN jsonb_build_object(
    'squad_id', p_squad_id,
    'removed_user_id', p_target_user_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.remove_squad_member(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_squad_member(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_squad(
  p_squad_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_catalog
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_squad public.squads%ROWTYPE;
  v_member_ids uuid[];
  v_mid uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_squad
  FROM public.squads
  WHERE id = p_squad_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Squad not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_squad.owner_id <> v_uid THEN
    RAISE EXCEPTION 'Only the squad owner can delete this squad' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(array_agg(sm.user_id), ARRAY[]::uuid[])
  INTO v_member_ids
  FROM public.squad_members sm
  WHERE sm.squad_id = p_squad_id
    AND sm.user_id <> v_uid;

  DELETE FROM public.squads WHERE id = p_squad_id;

  FOREACH v_mid IN ARRAY v_member_ids LOOP
    PERFORM public.create_social_notification(
      p_recipient_user_id => v_mid,
      p_actor_user_id => v_uid,
      p_notification_type => 'squad_deleted',
      p_title => 'Squad closed',
      p_body => 'The squad "' || v_squad.name || '" was deleted by its owner.',
      p_related_entity_id => NULL,
      p_related_entity_type => NULL
    );
  END LOOP;

  RETURN jsonb_build_object(
    'deleted', true,
    'squad_id', p_squad_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.delete_squad(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_squad(uuid) TO authenticated;

-- Safe column- & block-filtered squad roster query (never exposes timezone or unconsented status bands)
CREATE OR REPLACE FUNCTION public.get_squad_roster(
  p_squad_id uuid
)
RETURNS TABLE (
  user_id uuid,
  display_name text,
  avatar_url text,
  role text,
  cloud_xp integer,
  status_band text,
  share_squad_status boolean,
  joined_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_catalog
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_squad_member(p_squad_id, v_uid) THEN
    RAISE EXCEPTION 'Not authorized to view this squad roster' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    p.id AS user_id,
    p.display_name,
    p.avatar_url,
    sm.role,
    p.cloud_xp,
    CASE
      WHEN p.id = v_uid OR p.share_squad_status = true THEN p.status_band
      ELSE 'hidden'::text
    END AS status_band,
    p.share_squad_status,
    sm.joined_at
  FROM public.squad_members sm
  JOIN public.profiles p ON p.id = sm.user_id
  WHERE sm.squad_id = p_squad_id
    AND (
      p.id = v_uid
      OR NOT public.are_users_blocked(v_uid, p.id)
    )
  ORDER BY p.cloud_xp DESC, sm.joined_at ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_squad_roster(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_squad_roster(uuid) TO authenticated;

-- ============================================================================
-- 4. NOTIFICATION & ACCOUNT LIFECYCLE RPCS
-- ============================================================================

CREATE OR REPLACE FUNCTION public.mark_notifications_read(
  p_notification_ids uuid[] DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_catalog
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_updated integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF p_notification_ids IS NULL THEN
    UPDATE public.notifications
    SET is_read = true, read_at = COALESCE(read_at, timezone('utc', now()))
    WHERE recipient_user_id = v_uid
      AND is_read = false;
  ELSE
    UPDATE public.notifications
    SET is_read = true, read_at = COALESCE(read_at, timezone('utc', now()))
    WHERE recipient_user_id = v_uid
      AND is_read = false
      AND id = ANY(p_notification_ids);
  END IF;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_notifications_read(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_notifications_read(uuid[]) TO authenticated;

-- Cleans up owned squads (transfers to earliest remaining member or deletes solo squad)
-- and user-owned cloud records prior to auth.users deletion.
CREATE OR REPLACE FUNCTION public.cleanup_cloud_account_before_delete()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_catalog
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_owned_squad record;
  v_successor_id uuid;
  v_transferred_count integer := 0;
  v_deleted_count integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  FOR v_owned_squad IN
    SELECT id, name
    FROM public.squads
    WHERE owner_id = v_uid
    FOR UPDATE
  LOOP
    SELECT sm.user_id
    INTO v_successor_id
    FROM public.squad_members sm
    WHERE sm.squad_id = v_owned_squad.id
      AND sm.user_id <> v_uid
    ORDER BY public.are_users_blocked(v_uid, sm.user_id) ASC, sm.joined_at ASC
    LIMIT 1;

    IF v_successor_id IS NOT NULL THEN
      UPDATE public.squad_members
      SET role = 'member'
      WHERE squad_id = v_owned_squad.id AND user_id = v_uid;

      UPDATE public.squad_members
      SET role = 'owner'
      WHERE squad_id = v_owned_squad.id AND user_id = v_successor_id;

      UPDATE public.squads
      SET owner_id = v_successor_id
      WHERE id = v_owned_squad.id;

      DELETE FROM public.squad_members
      WHERE squad_id = v_owned_squad.id AND user_id = v_uid;

      PERFORM public.create_social_notification(
        p_recipient_user_id => v_successor_id,
        p_actor_user_id => NULL,
        p_notification_type => 'squad_ownership_transferred',
        p_title => 'You are now squad owner',
        p_body => 'Ownership of "' || v_owned_squad.name || '" was transferred to you after the previous owner closed their account.',
        p_related_entity_id => v_owned_squad.id,
        p_related_entity_type => 'squad'
      );

      v_transferred_count := v_transferred_count + 1;
    ELSE
      DELETE FROM public.squads WHERE id = v_owned_squad.id;
      v_deleted_count := v_deleted_count + 1;
    END IF;
  END LOOP;

  DELETE FROM public.squad_members WHERE user_id = v_uid;
  DELETE FROM public.squad_invitations WHERE inviter_id = v_uid OR invitee_id = v_uid;
  DELETE FROM public.notifications WHERE recipient_user_id = v_uid;
  DELETE FROM public.xp_sync_events WHERE user_id = v_uid;
  DELETE FROM public.user_blocks WHERE blocker_id = v_uid OR blocked_id = v_uid;
  DELETE FROM public.abuse_reports WHERE reporter_id = v_uid;
  DELETE FROM public.notification_preferences WHERE user_id = v_uid;
  DELETE FROM public.profiles WHERE id = v_uid;

  RETURN jsonb_build_object(
    'cleaned_up', true,
    'transferred_squads', v_transferred_count,
    'deleted_squads', v_deleted_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_cloud_account_before_delete() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cleanup_cloud_account_before_delete() TO authenticated;
