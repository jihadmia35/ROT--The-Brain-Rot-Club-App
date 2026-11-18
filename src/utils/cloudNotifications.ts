import {
  NotificationPreferencesRow,
  SocialNotificationRow,
  SquadInvitationRow,
} from '../types/database.types';
import {
  DEFAULT_CLOUD_NOTIFICATION_PREFS,
  DefaultNotificationPreferences,
} from './cloudNotificationsCore';
import { getSupabaseClient } from './supabase';

export async function fetchCloudNotificationsFeed(userId: string): Promise<{
  notifications: SocialNotificationRow[];
  pendingInvites: SquadInvitationRow[];
  error: string | null;
}> {
  const client = getSupabaseClient();
  if (!client || !userId) {
    return { notifications: [], pendingInvites: [], error: null };
  }

  try {
    const [notifRes, inviteRes] = await Promise.all([
      client
        .from('notifications')
        .select('*')
        .eq('recipient_user_id', userId)
        .order('created_at', { ascending: false })
        .limit(50),
      client
        .from('squad_invitations')
        .select('*')
        .eq('invitee_id', userId)
        .eq('status', 'pending')
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false }),
    ]);

    if (notifRes.error) {
      return {
        notifications: [],
        pendingInvites: [],
        error: notifRes.error.message,
      };
    }

    return {
      notifications: (notifRes.data ?? []) as SocialNotificationRow[],
      pendingInvites: (inviteRes.data ?? []) as SquadInvitationRow[],
      error: null,
    };
  } catch (err) {
    return {
      notifications: [],
      pendingInvites: [],
      error: err instanceof Error ? err.message : 'Failed to load cloud notifications.',
    };
  }
}

export async function fetchCloudNotificationPreferences(
  userId: string
): Promise<DefaultNotificationPreferences> {
  const client = getSupabaseClient();
  if (!client || !userId) {
    return { ...DEFAULT_CLOUD_NOTIFICATION_PREFS };
  }

  const { data, error } = await client
    .from('notification_preferences')
    .select('user_id, squad_invites_enabled, squad_activity_enabled, updated_at')
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !data) {
    return { ...DEFAULT_CLOUD_NOTIFICATION_PREFS };
  }

  const row = data as NotificationPreferencesRow;
  return {
    squad_invites_enabled: row.squad_invites_enabled,
    squad_activity_enabled: row.squad_activity_enabled,
  };
}

export async function updateCloudNotificationPreferences(
  userId: string,
  patch: Partial<DefaultNotificationPreferences>
): Promise<{
  ok: boolean;
  prefs: DefaultNotificationPreferences;
  error: string | null;
}> {
  const client = getSupabaseClient();
  if (!client || !userId) {
    return {
      ok: false,
      prefs: { ...DEFAULT_CLOUD_NOTIFICATION_PREFS },
      error: 'Authentication required.',
    };
  }

  const { data: updated, error: updateErr } = await client
    .from('notification_preferences')
    .update(patch)
    .eq('user_id', userId)
    .select('squad_invites_enabled, squad_activity_enabled')
    .maybeSingle();

  if (!updateErr && updated) {
    return {
      ok: true,
      prefs: updated as DefaultNotificationPreferences,
      error: null,
    };
  }

  // Fallback insert if notification_preferences row did not exist
  const merged: DefaultNotificationPreferences = {
    ...DEFAULT_CLOUD_NOTIFICATION_PREFS,
    ...patch,
  };
  const { data: inserted, error: insertErr } = await client
    .from('notification_preferences')
    .insert({ user_id: userId, ...merged })
    .select('squad_invites_enabled, squad_activity_enabled')
    .single();

  if (insertErr || !inserted) {
    return {
      ok: false,
      prefs: merged,
      error: insertErr?.message || updateErr?.message || 'Could not save preferences.',
    };
  }

  return {
    ok: true,
    prefs: inserted as DefaultNotificationPreferences,
    error: null,
  };
}

export async function markCloudNotificationsReadOnServer(
  notificationIds: string[] | null = null
): Promise<number> {
  const client = getSupabaseClient();
  if (!client) return 0;

  const { data, error } = await client.rpc('mark_notifications_read', {
    p_notification_ids: notificationIds,
  });
  if (error || typeof data !== 'number') {
    return 0;
  }
  return data;
}

export function subscribeToCloudNotifications(
  userId: string,
  handlers: {
    onInsert: (row: SocialNotificationRow) => void;
    onUpdate: (row: SocialNotificationRow) => void;
  }
): () => void {
  const client = getSupabaseClient();
  if (!client || !userId) {
    return () => {};
  }

  const channel = client
    .channel(`rot_notifications_${userId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `recipient_user_id=eq.${userId}`,
      },
      (payload) => {
        if (payload.new) {
          handlers.onInsert(payload.new as SocialNotificationRow);
        }
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'notifications',
        filter: `recipient_user_id=eq.${userId}`,
      },
      (payload) => {
        if (payload.new) {
          handlers.onUpdate(payload.new as SocialNotificationRow);
        }
      }
    )
    .subscribe();

  return () => {
    void client.removeChannel(channel);
  };
}
