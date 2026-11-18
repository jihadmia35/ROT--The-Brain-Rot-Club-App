import { LeaderboardTab, View } from '../constants/types';
import {
  SocialNotificationRow,
  SocialNotificationType,
} from '../types/database.types';
import { DefaultNotificationPreferences } from './cloudNotificationsCore';

export type NotificationTargetRoute =
  | 'Today'
  | 'Missions'
  | 'Badges'
  | 'Leaderboard'
  | 'Leaderboard:Squad'
  | 'Card'
  | 'Settings'
  | 'NotificationCenter';

export type ParsedNotificationRoute = {
  view?: View;
  leaderboardTab?: LeaderboardTab;
  openNotificationCenter?: boolean;
};

export type CloudOsMirrorSpec = {
  dedupKey: string;
  title: string;
  body: string;
  targetRoute: NotificationTargetRoute;
};

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const UUID_RE =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const BEARER_TOKEN_RE = /\bBearer\s+[A-Za-z0-9._-]{10,}\b/gi;
const JWT_RE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;

export function sanitizeNotificationText(
  raw: string | null | undefined,
  maxLength: number
): string {
  if (!raw) return '';
  const cleaned = raw
    .replace(BEARER_TOKEN_RE, '[redacted]')
    .replace(JWT_RE, '[redacted]')
    .replace(EMAIL_RE, 'a member')
    .replace(UUID_RE, '[id]')
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned.length <= maxLength) {
    return cleaned;
  }
  return `${cleaned.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function isCloudNotificationTypeEnabled(
  type: SocialNotificationType,
  prefs: DefaultNotificationPreferences
): boolean {
  if (type === 'squad_invite_received') {
    return prefs.squad_invites_enabled;
  }
  return prefs.squad_activity_enabled;
}

function fallbackCopyForType(type: SocialNotificationType): {
  title: string;
  body: string;
} {
  switch (type) {
    case 'squad_invite_received':
      return {
        title: 'New ROT Squad invite',
        body: 'You received a squad invitation. Tap to review and join.',
      };
    case 'squad_invite_accepted':
      return {
        title: 'Squad invite accepted',
        body: 'Someone accepted your squad invitation.',
      };
    case 'squad_member_joined':
      return {
        title: 'New squad member',
        body: 'A member joined your ROT Squad.',
      };
    case 'squad_ownership_transferred':
      return {
        title: 'Squad ownership updated',
        body: 'Leadership changed in your ROT Squad.',
      };
    case 'squad_member_removed':
      return {
        title: 'Squad roster update',
        body: 'Your ROT Squad membership was updated.',
      };
    case 'squad_deleted':
      return {
        title: 'Squad closed',
        body: 'A ROT Squad you belonged to was closed.',
      };
  }
}

export function targetRouteForCloudNotification(
  type: SocialNotificationType
): NotificationTargetRoute {
  switch (type) {
    case 'squad_invite_received':
    case 'squad_invite_accepted':
    case 'squad_member_joined':
    case 'squad_ownership_transferred':
    case 'squad_member_removed':
    case 'squad_deleted':
      return 'Leaderboard:Squad';
  }
}

export function buildCloudNotificationMirrorSpec(
  row: SocialNotificationRow,
  userId: string,
  prefs: DefaultNotificationPreferences
): CloudOsMirrorSpec | null {
  if (!userId || !row || row.recipient_user_id !== userId) {
    return null;
  }
  if (row.is_read) {
    return null;
  }
  if (!isCloudNotificationTypeEnabled(row.notification_type, prefs)) {
    return null;
  }

  const fallback = fallbackCopyForType(row.notification_type);
  const title = sanitizeNotificationText(row.title, 90) || fallback.title;
  const body = sanitizeNotificationText(row.body, 220) || fallback.body;
  const dedupBase = row.dedup_key?.trim() || row.id;

  return {
    dedupKey: `cloud_${userId}_${dedupBase}`,
    title,
    body,
    targetRoute: targetRouteForCloudNotification(row.notification_type),
  };
}

export function selectCloudNotificationsToMirror(
  rows: SocialNotificationRow[],
  userId: string,
  prefs: DefaultNotificationPreferences,
  sessionMirroredKeys: Set<string>,
  options?: { maxBatch?: number }
): CloudOsMirrorSpec[] {
  if (!userId || rows.length === 0) return [];
  const maxBatch = Math.max(1, options?.maxBatch ?? 5);

  const ordered = [...rows].sort((a, b) =>
    a.created_at.localeCompare(b.created_at)
  );
  const specs: CloudOsMirrorSpec[] = [];

  for (const row of ordered) {
    const spec = buildCloudNotificationMirrorSpec(row, userId, prefs);
    if (!spec) continue;
    if (sessionMirroredKeys.has(spec.dedupKey)) continue;
    specs.push(spec);
  }

  if (specs.length <= maxBatch) {
    return specs;
  }
  return specs.slice(specs.length - maxBatch);
}

export function parseNotificationTargetRoute(
  rawRoute: string | null | undefined
): ParsedNotificationRoute | null {
  const trimmed = rawRoute?.trim();
  if (!trimmed) return null;

  switch (trimmed) {
    case 'Today':
      return { view: 'Today' };
    case 'Missions':
      return { view: 'Missions' };
    case 'Badges':
      return { view: 'Badges' };
    case 'Leaderboard':
      return { view: 'Leaderboard' };
    case 'Leaderboard:Squad':
      return { view: 'Leaderboard', leaderboardTab: 'Squad' };
    case 'Card':
      return { view: 'Card' };
    case 'Settings':
      return { view: 'Settings' };
    case 'NotificationCenter':
      return { openNotificationCenter: true };
    default:
      return null;
  }
}
