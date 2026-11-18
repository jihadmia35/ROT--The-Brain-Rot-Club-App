import AsyncStorage from '@react-native-async-storage/async-storage';
import { CloudProfile } from './authHelpers';
import { normalizeDeviceTimezone } from './cloudProfileCore';
import { updateCloudProfile } from './cloudProfile';
import {
  AwardCloudXpRpcResponse,
  enqueueUserXpEvents,
  FlushXpQueueResult,
  PendingCloudXpEvent,
  performFlushCloudXpQueue,
  readUserXpQueue,
  XpQueueStorageAdapter,
} from './cloudXpSyncCore';
import { getSupabaseClient } from './supabase';

const asyncStorageAdapter: XpQueueStorageAdapter = {
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
  removeItem: (key) => AsyncStorage.removeItem(key),
};

const flushLocks = new Map<string, Promise<FlushXpQueueResult>>();

export async function getPendingCloudXpCount(userId: string): Promise<number> {
  const queue = await readUserXpQueue(asyncStorageAdapter, userId);
  return queue.length;
}

export async function enqueueCloudXpEventsForUser(
  userId: string,
  events: PendingCloudXpEvent[]
): Promise<PendingCloudXpEvent[]> {
  return enqueueUserXpEvents(asyncStorageAdapter, userId, events);
}

export async function flushCloudXpQueueForUser(
  userId: string,
  currentProfile: CloudProfile | null
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

  const existingLock = flushLocks.get(userId);
  if (existingLock) {
    return existingLock;
  }

  const runPromise = (async () => {
    const client = getSupabaseClient();
    if (!client) {
      return {
        syncedCount: 0,
        duplicateCount: 0,
        droppedCount: 0,
        remainingCount: await getPendingCloudXpCount(userId),
        latestCloudXp: null,
        pausedForAuth: true,
        lastError: 'Cloud client not configured.',
      };
    }

    let knownTimezone = currentProfile?.timezone ?? null;

    return performFlushCloudXpQueue(
      {
        storage: asyncStorageAdapter,
        ensureProfileTimezone: async (uid, targetTimezone) => {
          const desired = normalizeDeviceTimezone(targetTimezone);
          if (knownTimezone === desired) {
            return { ok: true, effectiveTimezone: desired };
          }
          const res = await updateCloudProfile(uid, { timezone: desired });
          if (res.ok && res.profile) {
            knownTimezone = res.profile.timezone;
            return { ok: true, effectiveTimezone: res.profile.timezone };
          }
          return { ok: false, effectiveTimezone: desired };
        },
        awardCloudXp: async (event) => {
          const { data, error } = await client.rpc('award_cloud_xp', {
            p_idempotency_key: event.idempotencyKey,
            p_event_type: event.eventType,
            p_event_ref: event.eventRef,
            p_local_date_key: event.localDateKey,
            p_timezone: event.timezone,
            p_client_occurred_at: event.clientOccurredAt,
          });
          return {
            data: (data as AwardCloudXpRpcResponse | null) ?? null,
            error,
          };
        },
      },
      userId
    );
  })().finally(() => {
    flushLocks.delete(userId);
  });

  flushLocks.set(userId, runPromise);
  return runPromise;
}
