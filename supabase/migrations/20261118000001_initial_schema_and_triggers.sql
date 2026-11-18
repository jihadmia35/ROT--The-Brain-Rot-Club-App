-- ROT. The Brainrot Club — Stage 2 Migration 001
-- Initial schema, constraints, indexes, and integrity/onboarding triggers.
-- All timestamps are stored in UTC (timestamptz).

-- ============================================================================
-- 1. TABLES
-- ============================================================================

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL DEFAULT 'ROT Member'
    CONSTRAINT chk_profiles_display_name_len CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 28),
  avatar_url text NULL
    CONSTRAINT chk_profiles_avatar_url_len CHECK (avatar_url IS NULL OR char_length(avatar_url) <= 500),
  share_squad_status boolean NOT NULL DEFAULT false,
  status_band text NOT NULL DEFAULT 'hidden'
    CONSTRAINT chk_profiles_status_band CHECK (status_band IN ('under_target', 'over_target', 'incomplete', 'hidden')),
  timezone text NOT NULL DEFAULT 'UTC'
    CONSTRAINT chk_profiles_timezone_len CHECK (char_length(btrim(timezone)) BETWEEN 1 AND 64),
  cloud_xp integer NOT NULL DEFAULT 0
    CONSTRAINT chk_profiles_cloud_xp_nonneg CHECK (cloud_xp >= 0),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE public.xp_sync_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL
    CONSTRAINT chk_xp_events_idempotency_len CHECK (char_length(btrim(idempotency_key)) BETWEEN 3 AND 128),
  event_type text NOT NULL
    CONSTRAINT chk_xp_events_type CHECK (event_type IN ('mission', 'chest', 'focus_break', 'weekly_quest', 'streak_recovery')),
  event_ref text NOT NULL
    CONSTRAINT chk_xp_events_ref_len CHECK (char_length(btrim(event_ref)) BETWEEN 1 AND 64),
  xp_amount integer NOT NULL
    CONSTRAINT chk_xp_events_amount_range CHECK (xp_amount > 0 AND xp_amount <= 150),
  local_date_key date NOT NULL,
  timezone text NOT NULL
    CONSTRAINT chk_xp_events_timezone_len CHECK (char_length(btrim(timezone)) BETWEEN 1 AND 64),
  client_occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT uq_xp_sync_user_idempotency UNIQUE (user_id, idempotency_key)
);

CREATE TABLE public.squads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL
    CONSTRAINT chk_squads_name_len CHECK (char_length(btrim(name)) BETWEEN 2 AND 40),
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  max_members integer NOT NULL DEFAULT 12
    CONSTRAINT chk_squads_max_members CHECK (max_members BETWEEN 2 AND 25),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE public.squad_members (
  squad_id uuid NOT NULL REFERENCES public.squads(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member'
    CONSTRAINT chk_squad_members_role CHECK (role IN ('owner', 'member')),
  joined_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (squad_id, user_id)
);

CREATE TABLE public.squad_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  squad_id uuid NOT NULL REFERENCES public.squads(id) ON DELETE CASCADE,
  inviter_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  invitee_id uuid NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  invite_code text NOT NULL UNIQUE
    CONSTRAINT chk_squad_invitations_code_len CHECK (char_length(btrim(invite_code)) BETWEEN 8 AND 64),
  status text NOT NULL DEFAULT 'pending'
    CONSTRAINT chk_squad_invitations_status CHECK (status IN ('pending', 'accepted', 'declined', 'revoked', 'expired')),
  expires_at timestamptz NOT NULL DEFAULT (timezone('utc', now()) + interval '7 days'),
  accepted_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  responded_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE public.user_blocks (
  blocker_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (blocker_id, blocked_id),
  CONSTRAINT chk_user_blocks_no_self CHECK (blocker_id <> blocked_id)
);

CREATE TABLE public.abuse_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reported_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  squad_id uuid NULL REFERENCES public.squads(id) ON DELETE SET NULL,
  category text NOT NULL
    CONSTRAINT chk_abuse_reports_category CHECK (category IN ('harassment', 'spam', 'impersonation', 'inappropriate_name', 'other')),
  details text NOT NULL DEFAULT ''
    CONSTRAINT chk_abuse_reports_details_len CHECK (char_length(details) <= 1000),
  status text NOT NULL DEFAULT 'open'
    CONSTRAINT chk_abuse_reports_status CHECK (status IN ('open', 'reviewed', 'resolved', 'dismissed')),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT chk_abuse_reports_no_self CHECK (reporter_id <> reported_user_id)
);

CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  actor_user_id uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  notification_type text NOT NULL
    CONSTRAINT chk_notifications_type CHECK (
      notification_type IN (
        'squad_invite_received',
        'squad_invite_accepted',
        'squad_member_joined',
        'squad_ownership_transferred',
        'squad_member_removed',
        'squad_deleted'
      )
    ),
  title text NOT NULL
    CONSTRAINT chk_notifications_title_len CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
  body text NOT NULL
    CONSTRAINT chk_notifications_body_len CHECK (char_length(btrim(body)) BETWEEN 1 AND 500),
  related_entity_id uuid NULL,
  related_entity_type text NULL
    CONSTRAINT chk_notifications_entity_type CHECK (
      related_entity_type IS NULL OR related_entity_type IN ('squad', 'squad_invitation', 'profile')
    ),
  is_read boolean NOT NULL DEFAULT false,
  read_at timestamptz NULL,
  dedup_key text NULL
    CONSTRAINT chk_notifications_dedup_len CHECK (dedup_key IS NULL OR char_length(btrim(dedup_key)) BETWEEN 1 AND 160),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE public.notification_preferences (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  squad_invites_enabled boolean NOT NULL DEFAULT true,
  squad_activity_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

-- ============================================================================
-- 2. INDEXES
-- ============================================================================

CREATE INDEX idx_xp_sync_events_user_date
  ON public.xp_sync_events (user_id, local_date_key DESC, created_at DESC);

CREATE INDEX idx_xp_sync_events_user_rule_date
  ON public.xp_sync_events (user_id, event_type, event_ref, local_date_key);

CREATE INDEX idx_squads_owner_id
  ON public.squads (owner_id);

CREATE INDEX idx_squad_members_user_id
  ON public.squad_members (user_id);

CREATE UNIQUE INDEX uq_squad_single_owner
  ON public.squad_members (squad_id)
  WHERE role = 'owner';

CREATE INDEX idx_squad_invitations_squad_status
  ON public.squad_invitations (squad_id, status, expires_at);

CREATE INDEX idx_squad_invitations_invitee_status
  ON public.squad_invitations (invitee_id, status)
  WHERE invitee_id IS NOT NULL;

CREATE INDEX idx_user_blocks_blocked_id
  ON public.user_blocks (blocked_id);

CREATE INDEX idx_abuse_reports_reporter_created
  ON public.abuse_reports (reporter_id, created_at DESC);

CREATE INDEX idx_notifications_recipient_created
  ON public.notifications (recipient_user_id, created_at DESC);

CREATE INDEX idx_notifications_recipient_unread
  ON public.notifications (recipient_user_id, is_read)
  WHERE is_read = false;

CREATE UNIQUE INDEX uq_notifications_recipient_dedup
  ON public.notifications (recipient_user_id, dedup_key)
  WHERE dedup_key IS NOT NULL;

-- ============================================================================
-- 3. TRIGGER FUNCTIONS & TRIGGERS
-- ============================================================================

CREATE OR REPLACE FUNCTION public.set_utc_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  NEW.updated_at := timezone('utc', now());
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_profiles_set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_utc_updated_at();

CREATE TRIGGER trg_squads_set_updated_at
  BEFORE UPDATE ON public.squads
  FOR EACH ROW
  EXECUTE FUNCTION public.set_utc_updated_at();

CREATE TRIGGER trg_notification_preferences_set_updated_at
  BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW
  EXECUTE FUNCTION public.set_utc_updated_at();

-- Prevent authenticated/anon clients from directly mutating server-managed profile fields (cloud_xp, id, created_at)
CREATE OR REPLACE FUNCTION public.protect_profile_server_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    IF NEW.id IS DISTINCT FROM OLD.id THEN
      RAISE EXCEPTION 'Profile ID is immutable' USING ERRCODE = '42501';
    END IF;
    IF NEW.cloud_xp IS DISTINCT FROM OLD.cloud_xp THEN
      RAISE EXCEPTION 'Direct modification of cloud_xp is not permitted' USING ERRCODE = '42501';
    END IF;
    IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Profile created_at is immutable' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_profiles_protect_server_fields
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_profile_server_fields();

-- Prevent clients from mutating anything other than is_read / read_at on notifications
CREATE OR REPLACE FUNCTION public.protect_notification_immutable_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.recipient_user_id IS DISTINCT FROM OLD.recipient_user_id
       OR NEW.actor_user_id IS DISTINCT FROM OLD.actor_user_id
       OR NEW.notification_type IS DISTINCT FROM OLD.notification_type
       OR NEW.title IS DISTINCT FROM OLD.title
       OR NEW.body IS DISTINCT FROM OLD.body
       OR NEW.related_entity_id IS DISTINCT FROM OLD.related_entity_id
       OR NEW.related_entity_type IS DISTINCT FROM OLD.related_entity_type
       OR NEW.dedup_key IS DISTINCT FROM OLD.dedup_key
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Only notification read state may be updated by clients' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.is_read = true AND OLD.is_read = false AND NEW.read_at IS NULL THEN
    NEW.read_at := timezone('utc', now());
  ELSIF NEW.is_read = false THEN
    NEW.read_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notifications_protect_fields
  BEFORE UPDATE ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_notification_immutable_fields();

-- Force initial status='open' when clients submit abuse reports
CREATE OR REPLACE FUNCTION public.enforce_abuse_report_defaults()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    NEW.status := 'open';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_abuse_reports_enforce_defaults
  BEFORE INSERT ON public.abuse_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_abuse_report_defaults();

-- Auto-provision profile (0 cloud_xp, privacy sharing OFF) and notification preferences on new auth.users row
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
  v_raw_name := NULLIF(
    btrim(
      COALESCE(
        NEW.raw_user_meta_data ->> 'full_name',
        NEW.raw_user_meta_data ->> 'name',
        split_part(COALESCE(NEW.email, ''), '@', 1),
        ''
      )
    ),
    ''
  );

  IF v_raw_name IS NULL THEN
    v_display_name := 'ROT Member';
  ELSE
    v_display_name := left(btrim(regexp_replace(v_raw_name, '\s+', ' ', 'g')), 28);
    IF char_length(v_display_name) = 0 THEN
      v_display_name := 'ROT Member';
    END IF;
  END IF;

  v_avatar_url := NULLIF(
    btrim(
      COALESCE(
        NEW.raw_user_meta_data ->> 'avatar_url',
        NEW.raw_user_meta_data ->> 'picture',
        ''
      )
    ),
    ''
  );
  IF v_avatar_url IS NOT NULL AND char_length(v_avatar_url) > 500 THEN
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

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_auth_user();
