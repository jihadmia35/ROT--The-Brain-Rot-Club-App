-- ROT. The Brainrot Club — Stage 2 Migration 002
-- Helper predicates, privilege lockdown, Row Level Security (RLS) policies, and Realtime publication.

-- ============================================================================
-- 1. NON-RECURSIVE SECURITY DEFINER MEMBERSHIP / BLOCK HELPERS
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_squad_member(
  p_squad_id uuid,
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT CASE
    WHEN p_squad_id IS NULL OR p_user_id IS NULL THEN false
    ELSE EXISTS (
      SELECT 1
      FROM public.squad_members sm
      WHERE sm.squad_id = p_squad_id
        AND sm.user_id = p_user_id
    )
  END;
$$;

CREATE OR REPLACE FUNCTION public.is_squad_owner(
  p_squad_id uuid,
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT CASE
    WHEN p_squad_id IS NULL OR p_user_id IS NULL THEN false
    ELSE EXISTS (
      SELECT 1
      FROM public.squads s
      WHERE s.id = p_squad_id
        AND s.owner_id = p_user_id
    )
  END;
$$;

CREATE OR REPLACE FUNCTION public.are_users_blocked(
  p_user_a uuid,
  p_user_b uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT CASE
    WHEN p_user_a IS NULL OR p_user_b IS NULL THEN false
    ELSE EXISTS (
      SELECT 1
      FROM public.user_blocks ub
      WHERE (ub.blocker_id = p_user_a AND ub.blocked_id = p_user_b)
         OR (ub.blocker_id = p_user_b AND ub.blocked_id = p_user_a)
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.is_squad_member(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_squad_owner(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.are_users_blocked(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_squad_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_squad_owner(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.are_users_blocked(uuid, uuid) TO authenticated;

-- ============================================================================
-- 2. ENABLE ROW LEVEL SECURITY ON ALL EXPOSED TABLES
-- ============================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.xp_sync_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.squads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.squad_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.squad_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.abuse_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 3. LEAST-PRIVILEGE TABLE & COLUMN GRANTS
-- ============================================================================

REVOKE ALL ON public.profiles FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.xp_sync_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.squads FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.squad_members FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.squad_invitations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.user_blocks FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.abuse_reports FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.notifications FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.notification_preferences FROM PUBLIC, anon, authenticated;

-- profiles: own read, own update on non-privileged columns only (never cloud_xp)
GRANT SELECT ON public.profiles TO authenticated;
GRANT UPDATE (display_name, avatar_url, share_squad_status, status_band, timezone)
  ON public.profiles TO authenticated;

-- xp_sync_events: read-only for owner; writes strictly through award_cloud_xp RPC
GRANT SELECT ON public.xp_sync_events TO authenticated;

-- squads, squad_members, squad_invitations: read-only under RLS; writes strictly through RPCs
GRANT SELECT ON public.squads TO authenticated;
GRANT SELECT ON public.squad_members TO authenticated;
GRANT SELECT ON public.squad_invitations TO authenticated;

-- user_blocks: own blocklist management
GRANT SELECT, INSERT, DELETE ON public.user_blocks TO authenticated;

-- abuse_reports: submit own reports and read own submitted reports only
GRANT SELECT ON public.abuse_reports TO authenticated;
GRANT INSERT (reporter_id, reported_user_id, squad_id, category, details)
  ON public.abuse_reports TO authenticated;

-- notifications: recipient read + read-state update only; inserts strictly server-side
GRANT SELECT ON public.notifications TO authenticated;
GRANT UPDATE (is_read, read_at) ON public.notifications TO authenticated;

-- notification_preferences: own preference reads & updates
GRANT SELECT ON public.notification_preferences TO authenticated;
GRANT INSERT (user_id, squad_invites_enabled, squad_activity_enabled)
  ON public.notification_preferences TO authenticated;
GRANT UPDATE (squad_invites_enabled, squad_activity_enabled)
  ON public.notification_preferences TO authenticated;

-- ============================================================================
-- 4. EXPLICIT RLS POLICIES
-- ============================================================================

-- profiles
CREATE POLICY profiles_select_own
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (id = auth.uid());

CREATE POLICY profiles_update_own
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- xp_sync_events
CREATE POLICY xp_sync_events_select_own
  ON public.xp_sync_events
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- squads
CREATE POLICY squads_select_member
  ON public.squads
  FOR SELECT
  TO authenticated
  USING (public.is_squad_member(id, auth.uid()));

-- squad_members
CREATE POLICY squad_members_select_member
  ON public.squad_members
  FOR SELECT
  TO authenticated
  USING (public.is_squad_member(squad_id, auth.uid()));

-- squad_invitations
CREATE POLICY squad_invitations_select_authorized
  ON public.squad_invitations
  FOR SELECT
  TO authenticated
  USING (
    invitee_id = auth.uid()
    OR inviter_id = auth.uid()
    OR public.is_squad_owner(squad_id, auth.uid())
  );

-- user_blocks
CREATE POLICY user_blocks_select_own
  ON public.user_blocks
  FOR SELECT
  TO authenticated
  USING (blocker_id = auth.uid());

CREATE POLICY user_blocks_insert_own
  ON public.user_blocks
  FOR INSERT
  TO authenticated
  WITH CHECK (blocker_id = auth.uid() AND blocked_id <> auth.uid());

CREATE POLICY user_blocks_delete_own
  ON public.user_blocks
  FOR DELETE
  TO authenticated
  USING (blocker_id = auth.uid());

-- abuse_reports
CREATE POLICY abuse_reports_select_own
  ON public.abuse_reports
  FOR SELECT
  TO authenticated
  USING (reporter_id = auth.uid());

CREATE POLICY abuse_reports_insert_own
  ON public.abuse_reports
  FOR INSERT
  TO authenticated
  WITH CHECK (reporter_id = auth.uid() AND reported_user_id <> auth.uid());

-- notifications
CREATE POLICY notifications_select_recipient
  ON public.notifications
  FOR SELECT
  TO authenticated
  USING (recipient_user_id = auth.uid());

CREATE POLICY notifications_update_recipient
  ON public.notifications
  FOR UPDATE
  TO authenticated
  USING (recipient_user_id = auth.uid())
  WITH CHECK (recipient_user_id = auth.uid());

-- notification_preferences
CREATE POLICY notification_preferences_select_own
  ON public.notification_preferences
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY notification_preferences_insert_own
  ON public.notification_preferences
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY notification_preferences_update_own
  ON public.notification_preferences
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ============================================================================
-- 5. SUPABASE REALTIME PUBLICATION FOR IN-APP NOTIFICATIONS
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'notifications'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
    END IF;
  END IF;
END;
$$;
