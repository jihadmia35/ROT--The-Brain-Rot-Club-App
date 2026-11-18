import { PersistedAppState } from '../constants/types';
import { CloudProfile } from './authHelpers';
import {
  calculateTotalXp,
  createInitialPersistedState,
  DEFAULT_BASE_XP,
  evaluateStreakState,
  getLocalDateKey,
  getXpLedgerEntries,
  syncWeeklyQuestsState,
} from './domainLogic';

export const GUEST_STORAGE_KEY = '@rot_executive_demo_state_v1';
export const CLOUD_USER_STATE_KEY_PREFIX = '@rot_cloud_user_state_v1_';

export type AppStateStorageAdapter = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
};

export function getOwnerStateStorageKey(userId: string | null | undefined): string {
  const cleanId = typeof userId === 'string' ? userId.trim() : '';
  if (!cleanId) {
    return GUEST_STORAGE_KEY;
  }
  return `${CLOUD_USER_STATE_KEY_PREFIX}${cleanId.replace(/[^A-Za-z0-9._-]/g, '_')}`;
}

/**
 * Builds an isolated starting state for an authenticated Cloud Club account.
 * Never inherits Guest `baseXp` (284), Guest `claimedXpEvents`, or Guest `customDisplayName`,
 * while preserving device-level permissions/settings so the user is not re-prompted.
 */
export function createInitialCloudUserPersistedState(
  dateKey: string = getLocalDateKey(),
  templateState?: PersistedAppState | null
): PersistedAppState {
  const base = createInitialPersistedState(
    dateKey,
    templateState?.profile?.deviceDefaultName ?? null
  );

  return {
    ...base,
    baseXp: 0,
    claimedXpEvents: {},
    xpLedger: [],
    consentStatus: templateState?.consentStatus ?? base.consentStatus,
    consentUpdatedAt: templateState?.consentUpdatedAt ?? base.consentUpdatedAt,
    trackingEnabled: templateState?.trackingEnabled ?? base.trackingEnabled,
    dailyLimitMinutes: templateState?.dailyLimitMinutes ?? base.dailyLimitMinutes,
    settings: templateState?.settings
      ? { ...base.settings, ...templateState.settings }
      : base.settings,
    cachedUsageSummary:
      templateState?.cachedUsageSummary ?? base.cachedUsageSummary,
    profile: {
      customDisplayName: null,
      deviceDefaultName:
        templateState?.profile?.deviceDefaultName ?? base.profile.deviceDefaultName,
    },
  };
}

/**
 * Ensures an authenticated user's local Brain Bank balance reflects server-verified
 * `profiles.cloud_xp` (for example, XP earned on another device or prior to storage
 * separation) without ever inflating server XP or touching Guest state.
 */
export function reconcileCloudUserXpWithProfile(
  state: PersistedAppState,
  cloudProfile: CloudProfile | null | undefined
): { nextState: PersistedAppState; changed: boolean } {
  if (
    !cloudProfile ||
    typeof cloudProfile.cloud_xp !== 'number' ||
    !Number.isFinite(cloudProfile.cloud_xp) ||
    cloudProfile.cloud_xp < 0
  ) {
    return { nextState: state, changed: false };
  }

  const localTotal = calculateTotalXp(state);
  if (cloudProfile.cloud_xp <= localTotal) {
    return { nextState: state, changed: false };
  }

  const delta = cloudProfile.cloud_xp - localTotal;
  return {
    nextState: {
      ...state,
      baseXp: state.baseXp + delta,
    },
    changed: true,
  };
}

export async function loadPersistedStateForOwner(
  adapter: AppStateStorageAdapter,
  userId: string | null,
  dateKey: string = getLocalDateKey(),
  options?: {
    templateState?: PersistedAppState | null;
    cloudProfile?: CloudProfile | null;
  }
): Promise<PersistedAppState> {
  const isAuthenticatedOwner = Boolean(userId && userId.trim().length > 0);
  const key = getOwnerStateStorageKey(userId);
  const fallback = isAuthenticatedOwner
    ? createInitialCloudUserPersistedState(dateKey, options?.templateState)
    : createInitialPersistedState(
        dateKey,
        options?.templateState?.profile?.deviceDefaultName ?? null
      );

  try {
    const raw = await adapter.getItem(key);
    let merged: PersistedAppState;

    if (!raw) {
      merged = fallback;
    } else {
      const parsed = JSON.parse(raw) as Partial<PersistedAppState>;
      const resolvedBaseXp =
        typeof parsed.baseXp === 'number' && Number.isFinite(parsed.baseXp)
          ? parsed.baseXp
          : isAuthenticatedOwner
          ? 0
          : DEFAULT_BASE_XP;

      merged = {
        ...fallback,
        ...parsed,
        baseXp: resolvedBaseXp,
        schemaVersion: 3,
        profile: {
          ...fallback.profile,
          ...(parsed.profile ?? {}),
        },
        settings: {
          ...fallback.settings,
          ...(parsed.settings ?? {}),
        },
        claimedXpEvents: {
          ...(parsed.claimedXpEvents ?? {}),
        },
        missionsByDate: {
          ...fallback.missionsByDate,
          ...(parsed.missionsByDate ?? {}),
        },
        dailyChestByDate: {
          ...(parsed.dailyChestByDate ?? {}),
        },
        unlockedBadges: {
          ...fallback.unlockedBadges,
          ...(parsed.unlockedBadges ?? {}),
        },
        streak: {
          ...fallback.streak,
          ...(parsed.streak ?? {}),
          historyByDate: {
            ...fallback.streak.historyByDate,
            ...(parsed.streak?.historyByDate ?? {}),
          },
        },
        weeklyQuestsByWeek: {
          ...fallback.weeklyQuestsByWeek,
          ...(parsed.weeklyQuestsByWeek ?? {}),
        },
        moodLogsByDate: {
          ...(parsed.moodLogsByDate ?? {}),
        },
        xpLedger: Array.isArray(parsed.xpLedger) ? parsed.xpLedger : [],
        sentNotificationsByDate: {
          ...(parsed.sentNotificationsByDate ?? {}),
        },
      };
    }

    const fullLedger = getXpLedgerEntries(merged).filter(
      (e) => e.category !== 'baseline'
    );
    merged = {
      ...merged,
      xpLedger: fullLedger,
    };
    merged = evaluateStreakState(merged, dateKey);
    merged = syncWeeklyQuestsState(merged, dateKey);

    if (isAuthenticatedOwner && options?.cloudProfile) {
      merged = reconcileCloudUserXpWithProfile(merged, options.cloudProfile).nextState;
    }

    return merged;
  } catch {
    if (isAuthenticatedOwner && options?.cloudProfile) {
      return reconcileCloudUserXpWithProfile(fallback, options.cloudProfile).nextState;
    }
    return fallback;
  }
}

export async function savePersistedStateForOwner(
  adapter: AppStateStorageAdapter,
  userId: string | null,
  state: PersistedAppState
): Promise<void> {
  const key = getOwnerStateStorageKey(userId);
  try {
    await adapter.setItem(key, JSON.stringify(state));
  } catch {
    // Non-fatal local storage write error
  }
}
