/**
 * ROT. The Brainrot Club — Supabase Database TypeScript Types (Stage 2.3)
 *
 * Verified against live remote Supabase schema via `npx supabase gen types typescript --remote`
 * (`PostgrestVersion: "14.18"`) after applying migrations 001–004:
 * - supabase/migrations/20261118000001_initial_schema_and_triggers.sql
 * - supabase/migrations/20261118000002_rls_policies.sql
 * - supabase/migrations/20261118000003_security_definer_rpcs.sql
 * - supabase/migrations/20261118000004_stage2_2_security_fixes.sql
 *
 * Stage 2.2 narrowed Insert/Update types, strict union enums, and revoked-helper exclusions
 * are preserved so disallowed client writes/RPC calls fail at TypeScript compile time.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type ProfileStatusBand = 'under_target' | 'over_target' | 'incomplete' | 'hidden';
export type XpEventType = 'mission' | 'chest' | 'focus_break' | 'weekly_quest' | 'streak_recovery';
export type SquadRole = 'owner' | 'member';
export type SquadInvitationStatus = 'pending' | 'accepted' | 'declined' | 'revoked' | 'expired';
export type AbuseReportCategory =
  | 'harassment'
  | 'spam'
  | 'impersonation'
  | 'inappropriate_name'
  | 'other';
export type AbuseReportStatus = 'open' | 'reviewed' | 'resolved' | 'dismissed';
export type SocialNotificationType =
  | 'squad_invite_received'
  | 'squad_invite_accepted'
  | 'squad_member_joined'
  | 'squad_ownership_transferred'
  | 'squad_member_removed'
  | 'squad_deleted';
export type NotificationEntityType = 'squad' | 'squad_invitation' | 'profile';

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: '14.18';
  };
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          display_name: string;
          avatar_url: string | null;
          share_squad_status: boolean;
          status_band: ProfileStatusBand;
          timezone: string;
          cloud_xp: number;
          created_at: string;
          updated_at: string;
        };
        Insert: Record<string, never>;
        Update: {
          display_name?: string;
          avatar_url?: string | null;
          share_squad_status?: boolean;
          status_band?: ProfileStatusBand;
          timezone?: string;
        };
        Relationships: [];
      };
      xp_sync_events: {
        Row: {
          id: string;
          user_id: string;
          idempotency_key: string;
          event_type: XpEventType;
          event_ref: string;
          xp_amount: number;
          local_date_key: string;
          timezone: string;
          client_occurred_at: string;
          created_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [
          {
            foreignKeyName: 'xp_sync_events_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      squads: {
        Row: {
          id: string;
          name: string;
          owner_id: string;
          max_members: number;
          created_at: string;
          updated_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [
          {
            foreignKeyName: 'squads_owner_id_fkey';
            columns: ['owner_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      squad_members: {
        Row: {
          squad_id: string;
          user_id: string;
          role: SquadRole;
          joined_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [
          {
            foreignKeyName: 'squad_members_squad_id_fkey';
            columns: ['squad_id'];
            isOneToOne: false;
            referencedRelation: 'squads';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'squad_members_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      squad_invitations: {
        Row: {
          id: string;
          squad_id: string;
          inviter_id: string;
          invitee_id: string | null;
          invite_code: string;
          status: SquadInvitationStatus;
          expires_at: string;
          accepted_by: string | null;
          responded_at: string | null;
          created_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [
          {
            foreignKeyName: 'squad_invitations_squad_id_fkey';
            columns: ['squad_id'];
            isOneToOne: false;
            referencedRelation: 'squads';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'squad_invitations_inviter_id_fkey';
            columns: ['inviter_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'squad_invitations_invitee_id_fkey';
            columns: ['invitee_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'squad_invitations_accepted_by_fkey';
            columns: ['accepted_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      user_blocks: {
        Row: {
          blocker_id: string;
          blocked_id: string;
          created_at: string;
        };
        Insert: {
          blocker_id: string;
          blocked_id: string;
          created_at?: string;
        };
        Update: Record<string, never>;
        Relationships: [
          {
            foreignKeyName: 'user_blocks_blocker_id_fkey';
            columns: ['blocker_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'user_blocks_blocked_id_fkey';
            columns: ['blocked_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      abuse_reports: {
        Row: {
          id: string;
          reporter_id: string;
          reported_user_id: string;
          squad_id: string | null;
          category: AbuseReportCategory;
          details: string;
          status: AbuseReportStatus;
          created_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [
          {
            foreignKeyName: 'abuse_reports_reporter_id_fkey';
            columns: ['reporter_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'abuse_reports_reported_user_id_fkey';
            columns: ['reported_user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'abuse_reports_squad_id_fkey';
            columns: ['squad_id'];
            isOneToOne: false;
            referencedRelation: 'squads';
            referencedColumns: ['id'];
          },
        ];
      };
      notifications: {
        Row: {
          id: string;
          recipient_user_id: string;
          actor_user_id: string | null;
          notification_type: SocialNotificationType;
          title: string;
          body: string;
          related_entity_id: string | null;
          related_entity_type: NotificationEntityType | null;
          is_read: boolean;
          read_at: string | null;
          dedup_key: string | null;
          created_at: string;
        };
        Insert: Record<string, never>;
        Update: {
          is_read?: boolean;
          read_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'notifications_recipient_user_id_fkey';
            columns: ['recipient_user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'notifications_actor_user_id_fkey';
            columns: ['actor_user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      notification_preferences: {
        Row: {
          user_id: string;
          squad_invites_enabled: boolean;
          squad_activity_enabled: boolean;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          squad_invites_enabled?: boolean;
          squad_activity_enabled?: boolean;
        };
        Update: {
          squad_invites_enabled?: boolean;
          squad_activity_enabled?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: 'notification_preferences_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: true;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      accept_squad_invitation: {
        Args: {
          p_invite_code: string;
        };
        Returns: Json;
      };
      award_cloud_xp: {
        Args: {
          p_idempotency_key: string;
          p_event_type: XpEventType;
          p_event_ref: string;
          p_local_date_key: string;
          p_timezone: string;
          p_client_occurred_at?: string;
        };
        Returns: Json;
      };
      create_squad: {
        Args: {
          p_name: string;
        };
        Returns: Json;
      };
      create_squad_invitation: {
        Args: {
          p_squad_id: string;
          p_invitee_id?: string | null;
          p_expires_in_hours?: number;
        };
        Returns: Json;
      };
      decline_squad_invitation: {
        Args: {
          p_invitation_id: string;
        };
        Returns: Json;
      };
      delete_squad: {
        Args: {
          p_squad_id: string;
        };
        Returns: Json;
      };
      get_squad_roster: {
        Args: {
          p_squad_id: string;
        };
        Returns: {
          user_id: string;
          display_name: string;
          avatar_url: string | null;
          role: SquadRole;
          cloud_xp: number;
          status_band: ProfileStatusBand;
          share_squad_status: boolean;
          joined_at: string;
        }[];
      };
      is_my_squad_member: {
        Args: {
          p_squad_id: string;
        };
        Returns: boolean;
      };
      is_my_squad_owner: {
        Args: {
          p_squad_id: string;
        };
        Returns: boolean;
      };
      leave_squad: {
        Args: {
          p_squad_id: string;
        };
        Returns: Json;
      };
      mark_notifications_read: {
        Args: {
          p_notification_ids?: string[] | null;
        };
        Returns: number;
      };
      remove_squad_member: {
        Args: {
          p_squad_id: string;
          p_target_user_id: string;
        };
        Returns: Json;
      };
      revoke_squad_invitation: {
        Args: {
          p_invitation_id: string;
        };
        Returns: Json;
      };
      submit_abuse_report: {
        Args: {
          p_reported_user_id: string;
          p_category: AbuseReportCategory;
          p_details?: string;
          p_squad_id?: string | null;
        };
        Returns: Json;
      };
      transfer_squad_ownership: {
        Args: {
          p_squad_id: string;
          p_new_owner_id: string;
        };
        Returns: Json;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type PublicTables = Database['public']['Tables'];
export type ProfileRow = PublicTables['profiles']['Row'];
export type XpSyncEventRow = PublicTables['xp_sync_events']['Row'];
export type SquadRow = PublicTables['squads']['Row'];
export type SquadMemberRow = PublicTables['squad_members']['Row'];
export type SquadInvitationRow = PublicTables['squad_invitations']['Row'];
export type UserBlockRow = PublicTables['user_blocks']['Row'];
export type AbuseReportRow = PublicTables['abuse_reports']['Row'];
export type SocialNotificationRow = PublicTables['notifications']['Row'];
export type NotificationPreferencesRow = PublicTables['notification_preferences']['Row'];
export type SquadRosterMember = Database['public']['Functions']['get_squad_roster']['Returns'][number];
