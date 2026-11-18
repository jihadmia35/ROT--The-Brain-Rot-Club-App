import {
  NotificationPreferencesRow,
  SocialNotificationRow,
  SocialNotificationType,
  SquadInvitationRow,
} from '../types/database.types';

export function countUnreadCloudNotifications(
  items: SocialNotificationRow[]
): number {
  let count = 0;
  for (const item of items) {
    if (!item.is_read) {
      count++;
    }
  }
  return count;
}

export function computeCombinedUnreadNotificationCount(
  localUnreadCount: number,
  cloudItems: SocialNotificationRow[]
): number {
  return Math.max(0, localUnreadCount) + countUnreadCloudNotifications(cloudItems);
}

export function upsertCloudNotificationInList(
  existing: SocialNotificationRow[],
  incoming: SocialNotificationRow,
  maxItems = 60
): SocialNotificationRow[] {
  const filtered = existing.filter((item) => item.id !== incoming.id);
  const next = [incoming, ...filtered].sort((a, b) =>
    b.created_at.localeCompare(a.created_at)
  );
  return next.slice(0, maxItems);
}

export function markCloudNotificationsLocallyRead(
  existing: SocialNotificationRow[],
  targetIds?: string[] | null,
  readAtIso: string = new Date().toISOString()
): SocialNotificationRow[] {
  const idSet = targetIds ? new Set(targetIds) : null;
  return existing.map((item) => {
    if (item.is_read) return item;
    if (idSet && !idSet.has(item.id)) return item;
    return {
      ...item,
      is_read: true,
      read_at: item.read_at ?? readAtIso,
    };
  });
}

export function formatCloudNotificationCategoryLabel(
  type: SocialNotificationType
): string {
  switch (type) {
    case 'squad_invite_received':
      return 'SQUAD INVITE';
    case 'squad_invite_accepted':
      return 'INVITE ACCEPTED';
    case 'squad_member_joined':
      return 'NEW MEMBER';
    case 'squad_ownership_transferred':
      return 'OWNERSHIP';
    case 'squad_member_removed':
      return 'SQUAD UPDATE';
    case 'squad_deleted':
      return 'SQUAD CLOSED';
    default:
      return 'CLUB UPDATE';
  }
}

export function buildPendingInviteMap(
  invitations: SquadInvitationRow[]
): Record<string, SquadInvitationRow> {
  const map: Record<string, SquadInvitationRow> = {};
  for (const inv of invitations) {
    if (inv.status === 'pending') {
      map[inv.id] = inv;
    }
  }
  return map;
}

export type DefaultNotificationPreferences = Pick<
  NotificationPreferencesRow,
  'squad_invites_enabled' | 'squad_activity_enabled'
>;

export const DEFAULT_CLOUD_NOTIFICATION_PREFS: DefaultNotificationPreferences = {
  squad_invites_enabled: true,
  squad_activity_enabled: true,
};
