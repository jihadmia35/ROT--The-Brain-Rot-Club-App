import { XpEventType } from '../types/database.types';
import { getDeviceTimezone, normalizeDeviceTimezone } from './cloudProfileCore';

export const XP_QUEUE_KEY_PREFIX = '@rot_cloud_xp_queue_v1_';

export type PendingCloudXpEvent = {
  idempotencyKey: string;
  eventType: XpEventType;
  eventRef: string;
  localDateKey: string;
  timezone: string;
  clientOccurredAt: string;
  enqueuedAt: string;
  attempts: number;
};

export type AwardCloudXpRpcResponse = {
  awarded: boolean;
  duplicate: boolean;
  xp_awarded: number;
  new_cloud_xp: number;
  event_id?: string;
  local_date_key?: string;
};

export type XpQueueStorageAdapter = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

export type XpSyncErrorKind = 'auth' | 'permanent' | 'transient';

const ALLOWED_MISSION_REFS = new Set([
  'touch-grass',
  'set-scroll-limit',
  'brain-check-in',
  'stay-under-target',
]);

const ALLOWED_WEEKLY_QUEST_REFS = new Set([
  'balanced-week',
  'focus-master',
  'under-target-week',
]);

export function getUserXpQueueStorageKey(userId: string): string {
  const cleanId = userId.trim().replace(/[^A-Za-z0-9._-]/g, '_');
  return `${XP_QUEUE_KEY_PREFIX}${cleanId}`;
}

/**
 * Deterministically maps a newly earned local `claimedXpEvents` key into a strict
 * `award_cloud_xp` RPC payload, returning null for baseline or non-cloud keys.
 */
export function mapClaimedEventKeyToPendingXp(
  eventKey: string,
  claimDateKey: string,
  timezone: string = getDeviceTimezone(),
  occurredAtIso: string = new Date().toISOString()
): PendingCloudXpEvent | null {
  const cleanKey = eventKey.trim();
  if (!cleanKey || cleanKey === 'baseline') {
    return null;
  }

  const cleanTz = normalizeDeviceTimezone(timezone);

  // mission:<dateKey>:<missionId>
  if (cleanKey.startsWith('mission:')) {
    const parts = cleanKey.split(':');
    if (parts.length >= 3) {
      const datePart = parts[1];
      const missionRef = parts.slice(2).join(':');
      if (
        /^\d{4}-\d{2}-\d{2}$/.test(datePart) &&
        ALLOWED_MISSION_REFS.has(missionRef)
      ) {
        return {
          idempotencyKey: cleanKey,
          eventType: 'mission',
          eventRef: missionRef,
          localDateKey: datePart,
          timezone: cleanTz,
          clientOccurredAt: occurredAtIso,
          enqueuedAt: occurredAtIso,
          attempts: 0,
        };
      }
    }
    return null;
  }

  // chest:<dateKey>
  if (cleanKey.startsWith('chest:')) {
    const datePart = cleanKey.slice('chest:'.length);
    if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
      return {
        idempotencyKey: cleanKey,
        eventType: 'chest',
        eventRef: 'daily-chest',
        localDateKey: datePart,
        timezone: cleanTz,
        clientOccurredAt: occurredAtIso,
        enqueuedAt: occurredAtIso,
        attempts: 0,
      };
    }
    return null;
  }

  // break:<dateKey>:<sessionId>:dur<minutes>
  if (cleanKey.startsWith('break:')) {
    const parts = cleanKey.split(':');
    const datePart = parts[1] ?? '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
      return {
        idempotencyKey: cleanKey,
        eventType: 'focus_break',
        eventRef: 'focus-break',
        localDateKey: datePart,
        timezone: cleanTz,
        clientOccurredAt: occurredAtIso,
        enqueuedAt: occurredAtIso,
        attempts: 0,
      };
    }
    return null;
  }

  // weekly:<weekKey>:<questId> -> uses claimDateKey so it passes [server_local_date - 1, server_local_date]
  if (cleanKey.startsWith('weekly:')) {
    const parts = cleanKey.split(':');
    const questRef = parts.slice(2).join(':');
    if (
      /^\d{4}-\d{2}-\d{2}$/.test(claimDateKey) &&
      ALLOWED_WEEKLY_QUEST_REFS.has(questRef)
    ) {
      return {
        idempotencyKey: cleanKey,
        eventType: 'weekly_quest',
        eventRef: questRef,
        localDateKey: claimDateKey,
        timezone: cleanTz,
        clientOccurredAt: occurredAtIso,
        enqueuedAt: occurredAtIso,
        attempts: 0,
      };
    }
    return null;
  }

  // streak_recovery:<dateKey>:<graceWeekKey>
  if (cleanKey.startsWith('streak_recovery:')) {
    const parts = cleanKey.split(':');
    const datePart = parts[1] ?? '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
      return {
        idempotencyKey: cleanKey,
        eventType: 'streak_recovery',
        eventRef: 'streak-recovery',
        localDateKey: datePart,
        timezone: cleanTz,
        clientOccurredAt: occurredAtIso,
        enqueuedAt: occurredAtIso,
        attempts: 0,
      };
    }
    return null;
  }

  return null;
}

/**
 * Extracts only keys newly added in `nextClaimed` relative to `prevClaimed`.
 * Ensures pre-existing guest XP is never transferred into Cloud XP.
 */
export function collectNewlyEarnedCloudXpEvents(
  prevClaimed: Record<string, number>,
  nextClaimed: Record<string, number>,
  claimDateKey: string,
  timezone: string = getDeviceTimezone(),
  occurredAtIso: string = new Date().toISOString()
): PendingCloudXpEvent[] {
  const results: PendingCloudXpEvent[] = [];
  for (const key of Object.keys(nextClaimed)) {
    if (Object.prototype.hasOwnProperty.call(prevClaimed, key)) {
      continue;
    }
    const mapped = mapClaimedEventKeyToPendingXp(
      key,
      claimDateKey,
      timezone,
      occurredAtIso
    );
    if (mapped) {
      results.push(mapped);
    }
  }
  return results;
}

export function classifyXpSyncError(err: unknown): {
  kind: XpSyncErrorKind;
  message: string;
} {
  const code =
    err && typeof err === 'object' && 'code' in err
      ? String((err as { code?: unknown }).code ?? '')
      : '';
  const message =
    err && typeof err === 'object' && 'message' in err
      ? String((err as { message?: unknown }).message ?? '')
      : err instanceof Error
      ? err.message
      : String(err ?? 'Unknown XP sync error');
  const lower = message.toLowerCase();

  if (
    code === '42501' ||
    lower.includes('authentication required') ||
    lower.includes('jwt') ||
    lower.includes('not authenticated')
  ) {
    return { kind: 'auth', message };
  }

  if (
    code === '22023' ||
    code === 'P0002' ||
    lower.includes('already claimed') ||
    lower.includes('cap reached') ||
    lower.includes('outside allowed local date window') ||
    lower.includes('outside allowed sync window') ||
    lower.includes('unsupported xp event') ||
    lower.includes('invalid idempotency_key') ||
    lower.includes('does not match saved profile timezone')
  ) {
    return { kind: 'permanent', message };
  }

  return { kind: 'transient', message };
}

export async function readUserXpQueue(
  storage: XpQueueStorageAdapter,
  userId: string
): Promise<PendingCloudXpEvent[]> {
  if (!userId) return [];
  const raw = await storage.getItem(getUserXpQueueStorageKey(userId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is PendingCloudXpEvent =>
        Boolean(item) &&
        typeof item.idempotencyKey === 'string' &&
        typeof item.eventType === 'string' &&
        typeof item.eventRef === 'string' &&
        typeof item.localDateKey === 'string' &&
        typeof item.timezone === 'string'
    );
  } catch {
    return [];
  }
}

export async function writeUserXpQueue(
  storage: XpQueueStorageAdapter,
  userId: string,
  queue: PendingCloudXpEvent[]
): Promise<void> {
  if (!userId) return;
  const key = getUserXpQueueStorageKey(userId);
  if (queue.length === 0) {
    await storage.removeItem(key);
    return;
  }
  await storage.setItem(key, JSON.stringify(queue));
}

export async function enqueueUserXpEvents(
  storage: XpQueueStorageAdapter,
  userId: string,
  events: PendingCloudXpEvent[]
): Promise<PendingCloudXpEvent[]> {
  if (!userId || events.length === 0) {
    return readUserXpQueue(storage, userId);
  }
  const existing = await readUserXpQueue(storage, userId);
  const seen = new Set(existing.map((e) => e.idempotencyKey));
  const next = [...existing];
  for (const ev of events) {
    if (!seen.has(ev.idempotencyKey)) {
      seen.add(ev.idempotencyKey);
      next.push(ev);
    }
  }
  await writeUserXpQueue(storage, userId, next);
  return next;
}

export type FlushXpQueueDeps = {
  storage: XpQueueStorageAdapter;
  ensureProfileTimezone: (
    userId: string,
    targetTimezone: string
  ) => Promise<{ ok: boolean; effectiveTimezone: string }>;
  awardCloudXp: (
    event: PendingCloudXpEvent
  ) => Promise<{ data: AwardCloudXpRpcResponse | null; error: unknown | null }>;
};

export type FlushXpQueueResult = {
  syncedCount: number;
  duplicateCount: number;
  droppedCount: number;
  remainingCount: number;
  latestCloudXp: number | null;
  pausedForAuth: boolean;
  lastError: string | null;
};

export async function performFlushCloudXpQueue(
  deps: FlushXpQueueDeps,
  userId: string
): Promise<FlushXpQueueResult> {
  if (!userId) {
    return {
      syncedCount: 0,
      duplicateCount: 0,
      droppedCount: 0,
      remainingCount: 0,
      latestCloudXp: null,
      pausedForAuth: true,
      lastError: null,
    };
  }

  const queue = await readUserXpQueue(deps.storage, userId);
  if (queue.length === 0) {
    return {
      syncedCount: 0,
      duplicateCount: 0,
      droppedCount: 0,
      remainingCount: 0,
      latestCloudXp: null,
      pausedForAuth: false,
      lastError: null,
    };
  }

  let syncedCount = 0;
  let duplicateCount = 0;
  let droppedCount = 0;
  let latestCloudXp: number | null = null;
  let pausedForAuth = false;
  let lastError: string | null = null;

  const remaining: PendingCloudXpEvent[] = [];
  let ensuredTz: string | null = null;

  for (let i = 0; i < queue.length; i++) {
    const item = queue[i];
    let activeItem = item;

    if (ensuredTz !== item.timezone) {
      const tzRes = await deps.ensureProfileTimezone(userId, item.timezone);
      if (!tzRes.ok) {
        // Transient inability to verify/sync profile timezone: keep remainder queued
        remaining.push(...queue.slice(i));
        lastError = 'Could not verify profile timezone before XP sync.';
        break;
      }
      ensuredTz = tzRes.effectiveTimezone;
      if (ensuredTz !== item.timezone) {
        activeItem = { ...item, timezone: ensuredTz };
      }
    }

    const { data, error } = await deps.awardCloudXp(activeItem);
    if (!error && data) {
      if (typeof data.new_cloud_xp === 'number') {
        latestCloudXp = data.new_cloud_xp;
      }
      if (data.duplicate) {
        duplicateCount++;
      } else if (data.awarded) {
        syncedCount++;
      }
      continue;
    }

    const classified = classifyXpSyncError(error);
    lastError = classified.message;
    if (classified.kind === 'auth') {
      pausedForAuth = true;
      remaining.push(...queue.slice(i));
      break;
    }
    if (classified.kind === 'permanent') {
      droppedCount++;
      continue;
    }

    // Transient error: increment attempts for diagnostics and keep item + rest for retry
    remaining.push({ ...activeItem, attempts: activeItem.attempts + 1 });
    remaining.push(...queue.slice(i + 1));
    break;
  }

  await writeUserXpQueue(deps.storage, userId, remaining);

  return {
    syncedCount,
    duplicateCount,
    droppedCount,
    remainingCount: remaining.length,
    latestCloudXp,
    pausedForAuth,
    lastError,
  };
}
