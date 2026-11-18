-- ROT. The Brainrot Club — Stage 2.2 Migration 004
-- Focused security, authorization, XP-limit, and data-integrity fixes
-- identified during Stage 2.1 pre-verification review.

-- ============================================================================
-- 1. SCHEMA CONSTRAINTS & PROFILE VALIDATION HARDENING
-- ============================================================================

-- Align squad maximum size strictly with Stage 0 small invite-only cap (2..12, default 12)
ALTER TABLE public.squads
  DROP CONSTRAINT IF EXISTS chk_squads_max_members,
  ADD CONSTRAINT chk_squads_max_members CHECK (max_members BETWEEN 2 AND 12);

-- Enforce HTTPS-only avatar URLs when provided
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS chk_profiles_avatar_url_https,
  ADD CONSTRAINT chk_profiles_avatar_url_https
    CHECK (avatar_url IS NULL OR avatar_url ~* '^https://[^[:space:]]+$');

-- Validate profiles.timezone against PostgreSQL IANA timezone catalog on insert/update
CREATE OR REPLACE FUNCTION public.validate_profile_timezone()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_clean_tz text;
BEGIN
  v_clean_tz := btrim(COALESCE(NEW.timezone, ''));
  IF char_length(v_clean_tz) = 0 OR NOT EXISTS (
    SELECT 1 FROM pg_timezone_names WHERE name = v_clean_tz
  ) THEN
    RAISE EXCEPTION 'Invalid IANA timezone: %', NEW.timezone USING ERRCODE = '22023';
  END IF;
  NEW.timezone := v_clean_tz;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_validate_timezone ON public.profiles;
CREATE TRIGGER trg_profiles_validate_timezone
  BEFORE INSERT OR UPDATE OF timezone ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_profile_timezone();

-- Fix empty/whitespace-only metadata fallback and enforce HTTPS avatar sanitization on auth onboarding
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_catalog
AS $$
DECLARE
  v_raw_name text;
  v_display_name text;
  v_avatar_url text;
BEGIN
  v_raw_name := COALESCE(
    NULLIF(btrim(COALESCE(NEW.raw_user_meta_data ->> 'full_name', '')), ''),
    NULLIF(btrim(COALESCE(NEW.raw_user_meta_data ->> 'name', '')), ''),
    NULLIF(btrim(split_part(COALESCE(NEW.email, ''), '@', 1)), '')
  );

  IF v_raw_name IS NULL THEN
    v_display_name := 'ROT Member';
  ELSE
    v_display_name := left(btrim(regexp_replace(v_raw_name, '\s+', ' ', 'g')), 28);
    IF char_length(v_display_name) = 0 THEN
      v_display_name := 'ROT Member';
    END IF;
  END IF;

  v_avatar_url := COALESCE(
    NULLIF(btrim(COALESCE(NEW.raw_user_meta_data ->> 'avatar_url', '')), ''),
    NULLIF(btrim(COALESCE(NEW.raw_user_meta_data ->> 'picture', '')), '')
  );
  IF v_avatar_url IS NOT NULL
     AND (char_length(v_avatar_url) > 500 OR v_avatar_url !~* '^https://[^[:space:]]+$') THEN
    v_avatar_url := NULL;
  END IF;

  INSERT INTO public.profiles (
    id,
    display_name,
    avatar_url,
    share_squad_status,
    status_band,
    timezone,
    cloud_xp
  )
  VALUES (
    NEW.id,
    v_display_name,
    v_avatar_url,
    false,
    'hidden',
    'UTC',
    0
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.notification_preferences (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- ============================================================================
-- 2. RESTRICT ARBITRARY-USER HELPER RPCS & ADD CALLER-SCOPED RLS HELPERS
-- ============================================================================

-- Revoke client RPC access to arbitrary-user predicates
REVOKE ALL ON FUNCTION public.is_squad_member(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_squad_owner(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.are_users_blocked(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Caller-scoped RLS helpers (always bind internally to auth.uid())
CREATE OR REPLACE FUNCTION public.is_my_squad_member(
  p_squad_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_catalog
AS $$
  SELECT CASE
    WHEN p_squad_id IS NULL OR auth.uid() IS NULL THEN false
    ELSE public.is_squad_member(p_squad_id, auth.uid())
  END;
$$;

CREATE OR REPLACE FUNCTION public.is_my_squad_owner(
  p_squad_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_catalog
AS $$
  SELECT CASE
    WHEN p_squad_id IS NULL OR auth.uid() IS NULL THEN false
    ELSE public.is_squad_owner(p_squad_id, auth.uid())
  END;
$$;

REVOKE ALL ON FUNCTION public.is_my_squad_member(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_my_squad_owner(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_my_squad_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_my_squad_owner(uuid) TO authenticated;

-- Update RLS policies to use caller-scoped helpers and restrict former-member invitation visibility
DROP POLICY IF EXISTS squads_select_member ON public.squads;
CREATE POLICY squads_select_member
  ON public.squads
  FOR SELECT
  TO authenticated
  USING (public.is_my_squad_member(id));

DROP POLICY IF EXISTS squad_members_select_member ON public.squad_members;
CREATE POLICY squad_members_select_member
  ON public.squad_members
  FOR SELECT
  TO authenticated
  USING (public.is_my_squad_member(squad_id));

DROP POLICY IF EXISTS squad_invitations_select_authorized ON public.squad_invitations;
CREATE POLICY squad_invitations_select_authorized
  ON public.squad_invitations
  FOR SELECT
  TO authenticated
  USING (
    invitee_id = auth.uid()
    OR public.is_my_squad_owner(squad_id)
    OR (inviter_id = auth.uid() AND public.is_my_squad_member(squad_id))
  );

-- ============================================================================
-- 3. HARDEN award_cloud_xp (AUTHORITATIVE PROFILE TIMEZONE, IDEMPOTENCY FIRST, 600 XP CAP)
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
  v_req_tz text;
  v_profile_tz text;
  v_now_utc timestamptz := timezone('utc', now());
  v_server_local_date date;
  v_current_xp integer;
  v_new_xp integer;
  v_xp_amount integer;
  v_existing_id uuid;
  v_existing_date date;
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
  v_req_tz := NULLIF(btrim(COALESCE(p_timezone, '')), '');

  IF char_length(v_clean_key) < 3 OR char_length(v_clean_key) > 128 THEN
    RAISE EXCEPTION 'Invalid idempotency_key length' USING ERRCODE = '22023';
  END IF;

  -- Lock user profile row first to serialize concurrent XP awards and read authoritative timezone
  SELECT cloud_xp, timezone
  INTO v_current_xp, v_profile_tz
  FROM public.profiles
  WHERE id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found' USING ERRCODE = 'P0002';
  END IF;

  -- Idempotency check BEFORE time-window validation so safe late retries always return duplicate=true
  SELECT id, local_date_key
  INTO v_existing_id, v_existing_date
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
      'local_date_key', v_existing_date
    );
  END IF;

  IF p_local_date_key IS NULL THEN
    RAISE EXCEPTION 'local_date_key is required' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = v_profile_tz) THEN
    RAISE EXCEPTION 'Saved profile timezone is invalid: %', v_profile_tz USING ERRCODE = '22023';
  END IF;

  -- Reject mismatched per-request timezone manipulation attempts
  IF v_req_tz IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = v_req_tz) THEN
      RAISE EXCEPTION 'Invalid IANA timezone: %', v_req_tz USING ERRCODE = '22023';
    END IF;
    IF v_req_tz IS DISTINCT FROM v_profile_tz THEN
      RAISE EXCEPTION 'Request timezone (%) does not match saved profile timezone (%)', v_req_tz, v_profile_tz
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_client_occurred_at IS NULL
     OR p_client_occurred_at > v_now_utc + interval '5 minutes'
     OR p_client_occurred_at < v_now_utc - interval '36 hours' THEN
    RAISE EXCEPTION 'client_occurred_at is outside allowed sync window' USING ERRCODE = '22023';
  END IF;

  -- Evaluate local date strictly against saved profiles.timezone
  v_server_local_date := (timezone(v_profile_tz, v_now_utc))::date;
  IF p_local_date_key > v_server_local_date OR p_local_date_key < (v_server_local_date - 1) THEN
    RAISE EXCEPTION 'local_date_key % is outside allowed local date window (%)', p_local_date_key, v_server_local_date
      USING ERRCODE = '22023';
  END IF;

  -- Authoritative server-side XP rule allowlist
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

  -- Combined daily XP cap raised from 500 to 600 so max daily (310) + weekly quests (280) = 590 succeeds
  SELECT COALESCE(SUM(xp_amount), 0)
  INTO v_daily_total
  FROM public.xp_sync_events
  WHERE user_id = v_uid
    AND local_date_key = p_local_date_key;

  IF v_daily_total + v_xp_amount > 600 THEN
    RAISE EXCEPTION 'Daily cloud XP cap (600 XP) reached' USING ERRCODE = '22023';
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
    v_profile_tz,
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

-- ============================================================================
-- 4. SQUAD CONCURRENCY, INVITATION SPAM/AUTH, & OWNERSHIP HANDOFF FIXES
-- ============================================================================

-- Lock caller profile row before checking 10-squad membership limit
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

  -- Serialize concurrent squad creations/joins per user
  PERFORM 1 FROM public.profiles WHERE id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT COUNT(*)
  INTO v_squad_count
  FROM public.squad_members
  WHERE user_id = v_uid;

  IF v_squad_count >= 10 THEN
    RAISE EXCEPTION 'Maximum squad membership limit (10) reached' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.squads (name, owner_id, max_members)
  VALUES (v_clean_name, v_uid, 12)
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

-- Cap active pending invites per squad (max 10) and enforce 24h cooldown after decline
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
  v_active_invite_count integer;
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

  IF v_member_count >= LEAST(v_squad.max_members, 12) THEN
    RAISE EXCEPTION 'Squad is already full' USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*)
  INTO v_active_invite_count
  FROM public.squad_invitations
  WHERE squad_id = p_squad_id
    AND status = 'pending'
    AND expires_at > timezone('utc', now());

  IF v_active_invite_count >= 10 THEN
    RAISE EXCEPTION 'Active pending invitation limit (10) reached for this squad' USING ERRCODE = '22023';
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

    IF EXISTS (
      SELECT 1
      FROM public.squad_invitations
      WHERE squad_id = p_squad_id
        AND invitee_id = p_invitee_id
        AND status = 'declined'
        AND COALESCE(responded_at, created_at) > timezone('utc', now()) - interval '24 hours'
    ) THEN
      RAISE EXCEPTION 'Please wait 24 hours before re-inviting a user who declined' USING ERRCODE = '22023';
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

-- Lock caller profile row in accept_squad_invitation before counting 10-squad limit
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

  -- Lock caller profile after squad lock to serialize concurrent multi-squad joins
  PERFORM 1 FROM public.profiles WHERE id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found' USING ERRCODE = 'P0002';
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

  IF v_member_count >= LEAST(v_squad.max_members, 12) THEN
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

-- Only current squad owner can revoke pending invitations
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

  IF NOT public.is_squad_owner(v_inv.squad_id, v_uid) THEN
    RAISE EXCEPTION 'Only the current squad owner can revoke invitations' USING ERRCODE = '42501';
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

-- Revoke outgoing open invitations when ownership transfers
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

  UPDATE public.squad_members
  SET role = 'member'
  WHERE squad_id = p_squad_id AND user_id = v_uid;

  UPDATE public.squad_members
  SET role = 'owner'
  WHERE squad_id = p_squad_id AND user_id = p_new_owner_id;

  UPDATE public.squads
  SET owner_id = p_new_owner_id
  WHERE id = p_squad_id;

  -- Invalidate outgoing owner's open invite codes so they cannot linger under old owner authority
  UPDATE public.squad_invitations
  SET status = 'revoked', responded_at = timezone('utc', now())
  WHERE squad_id = p_squad_id
    AND inviter_id = v_uid
    AND invitee_id IS NULL
    AND status = 'pending';

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

-- Revoke any lingering open invites created by a departing member as defensive hygiene
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

  UPDATE public.squad_invitations
  SET status = 'revoked', responded_at = timezone('utc', now())
  WHERE squad_id = p_squad_id
    AND inviter_id = v_uid
    AND invitee_id IS NULL
    AND status = 'pending';

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

-- ============================================================================
-- 5. SECURE ABUSE REPORTS VIA RPC & REMOVE DIRECT CLIENT INSERT
-- ============================================================================

REVOKE INSERT ON public.abuse_reports FROM authenticated;
DROP POLICY IF EXISTS abuse_reports_insert_own ON public.abuse_reports;

CREATE OR REPLACE FUNCTION public.submit_abuse_report(
  p_reported_user_id uuid,
  p_category text,
  p_details text DEFAULT '',
  p_squad_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_catalog
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_clean_category text;
  v_clean_details text;
  v_recent_count integer;
  v_can_report boolean := false;
  v_report public.abuse_reports%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  v_clean_category := btrim(COALESCE(p_category, ''));
  v_clean_details := btrim(COALESCE(p_details, ''));

  IF v_clean_category NOT IN ('harassment', 'spam', 'impersonation', 'inappropriate_name', 'other') THEN
    RAISE EXCEPTION 'Invalid report category' USING ERRCODE = '22023';
  END IF;

  IF char_length(v_clean_details) > 1000 THEN
    RAISE EXCEPTION 'Report details exceed 1000 characters' USING ERRCODE = '22023';
  END IF;

  IF p_reported_user_id IS NULL OR p_reported_user_id = v_uid THEN
    RAISE EXCEPTION 'Unable to submit report for the specified target' USING ERRCODE = '22023';
  END IF;

  -- Serialize reporter submissions to enforce per-day and duplicate limits
  PERFORM 1 FROM public.profiles WHERE id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found' USING ERRCODE = 'P0002';
  END IF;

  -- Validate relationship and target existence without revealing arbitrary UUID presence
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_reported_user_id) THEN
    RAISE EXCEPTION 'Unable to submit report for the specified target' USING ERRCODE = '22023';
  END IF;

  IF p_squad_id IS NOT NULL THEN
    v_can_report := public.is_squad_member(p_squad_id, v_uid)
      AND public.is_squad_member(p_squad_id, p_reported_user_id);
  ELSE
    v_can_report := EXISTS (
      SELECT 1
      FROM public.squad_members sm_self
      JOIN public.squad_members sm_other ON sm_other.squad_id = sm_self.squad_id
      WHERE sm_self.user_id = v_uid
        AND sm_other.user_id = p_reported_user_id
    ) OR EXISTS (
      SELECT 1
      FROM public.squad_invitations si
      WHERE (si.inviter_id = v_uid AND si.invitee_id = p_reported_user_id)
         OR (si.inviter_id = p_reported_user_id AND si.invitee_id = v_uid)
    );
  END IF;

  IF NOT v_can_report THEN
    RAISE EXCEPTION 'Unable to submit report for the specified target' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.abuse_reports
    WHERE reporter_id = v_uid
      AND reported_user_id = p_reported_user_id
      AND status = 'open'
  ) THEN
    RAISE EXCEPTION 'An open report for this user has already been submitted' USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*)
  INTO v_recent_count
  FROM public.abuse_reports
  WHERE reporter_id = v_uid
    AND created_at > timezone('utc', now()) - interval '24 hours';

  IF v_recent_count >= 5 THEN
    RAISE EXCEPTION 'Daily abuse report limit reached' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.abuse_reports (
    reporter_id,
    reported_user_id,
    squad_id,
    category,
    details,
    status
  )
  VALUES (
    v_uid,
    p_reported_user_id,
    p_squad_id,
    v_clean_category,
    v_clean_details,
    'open'
  )
  RETURNING * INTO v_report;

  RETURN jsonb_build_object(
    'id', v_report.id,
    'status', v_report.status,
    'created_at', v_report.created_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_abuse_report(uuid, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_abuse_report(uuid, text, text, uuid) TO authenticated;

-- ============================================================================
-- 6. RESTRICT ACCOUNT CLEANUP TO TRUSTED SERVER-SIDE EXECUTION + DETERMINISTIC LOCKING
-- ============================================================================

DROP FUNCTION IF EXISTS public.cleanup_cloud_account_before_delete();

CREATE OR REPLACE FUNCTION public.cleanup_cloud_account_before_delete(
  p_target_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_catalog
AS $$
DECLARE
  v_owned_squad record;
  v_successor_id uuid;
  v_transferred_count integer := 0;
  v_deleted_count integer := 0;
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION 'Account cleanup is restricted to server-side workflows' USING ERRCODE = '42501';
  END IF;

  IF p_target_user_id IS NULL THEN
    RAISE EXCEPTION 'target_user_id is required' USING ERRCODE = '22023';
  END IF;

  FOR v_owned_squad IN
    SELECT id, name
    FROM public.squads
    WHERE owner_id = p_target_user_id
    ORDER BY id ASC
    FOR UPDATE
  LOOP
    SELECT sm.user_id
    INTO v_successor_id
    FROM public.squad_members sm
    WHERE sm.squad_id = v_owned_squad.id
      AND sm.user_id <> p_target_user_id
    ORDER BY public.are_users_blocked(p_target_user_id, sm.user_id) ASC, sm.joined_at ASC
    LIMIT 1;

    IF v_successor_id IS NOT NULL THEN
      UPDATE public.squad_members
      SET role = 'member'
      WHERE squad_id = v_owned_squad.id AND user_id = p_target_user_id;

      UPDATE public.squad_members
      SET role = 'owner'
      WHERE squad_id = v_owned_squad.id AND user_id = v_successor_id;

      UPDATE public.squads
      SET owner_id = v_successor_id
      WHERE id = v_owned_squad.id;

      UPDATE public.squad_invitations
      SET status = 'revoked', responded_at = timezone('utc', now())
      WHERE squad_id = v_owned_squad.id
        AND inviter_id = p_target_user_id
        AND invitee_id IS NULL
        AND status = 'pending';

      DELETE FROM public.squad_members
      WHERE squad_id = v_owned_squad.id AND user_id = p_target_user_id;

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

  DELETE FROM public.squad_members WHERE user_id = p_target_user_id;
  DELETE FROM public.squad_invitations WHERE inviter_id = p_target_user_id OR invitee_id = p_target_user_id;
  DELETE FROM public.notifications WHERE recipient_user_id = p_target_user_id;
  DELETE FROM public.xp_sync_events WHERE user_id = p_target_user_id;
  DELETE FROM public.user_blocks WHERE blocker_id = p_target_user_id OR blocked_id = p_target_user_id;
  DELETE FROM public.abuse_reports WHERE reporter_id = p_target_user_id;
  DELETE FROM public.notification_preferences WHERE user_id = p_target_user_id;
  DELETE FROM public.profiles WHERE id = p_target_user_id;

  RETURN jsonb_build_object(
    'cleaned_up', true,
    'transferred_squads', v_transferred_count,
    'deleted_squads', v_deleted_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_cloud_account_before_delete(uuid) FROM PUBLIC, anon, authenticated;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.cleanup_cloud_account_before_delete(uuid) TO service_role;
  END IF;
END;
$$;
