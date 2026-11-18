import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  StatusBar,
  Platform,
  AppState,
  AppStateStatus,
  Share,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { COLORS } from './src/constants/theme';
import {
  Badge,
  CardExportFormat,
  CardType,
  Celebration,
  InstagramUsageSummary,
  MoodId,
  NotificationInboxSnapshot,
  NotificationStatusSnapshot,
  PersistedAppState,
  UserSettings,
  View as ViewType,
  WeeklyQuestId,
} from './src/constants/types';
import { getBadges } from './src/constants/data';
import {
  buildUsageDisplayState,
  buildWeeklyAchievementSummary,
  calculateBrainrotIndex,
  calculateEarnedXpForDate,
  calculateLimitProgress,
  calculatePlayerLevel,
  calculateTotalXp,
  claimDailyChestState,
  claimWeeklyQuestState,
  clampDailyLimitMinutes,
  clearLocalHistoryState,
  completeFocusBreakState,
  createInitialPersistedState,
  evaluatePendingNotifications,
  formatMinutesAsHoursAndMinutes,
  formatUnreadBadgeCount,
  getDailyChestForDate,
  getEffectiveDailyLimitMinutes,
  getLocalDateKey,
  getMissionsForDate,
  getWeeklyQuestState,
  getXpLedgerEntries,
  isDateActiveForStreak,
  logDailyMoodState,
  recoverStreakState,
  resolveEffectiveDisplayName,
  selectCachedSummaryToPersist,
  serializeUserDataExportJson,
  syncUsageLinkedMissionsState,
  toggleMissionState,
  updateCustomDisplayNameState,
  updateDeviceDefaultNameState,
  verifyXpLedgerConsistency,
} from './src/utils/domainLogic';
import { loadPersistedState, savePersistedState } from './src/utils/storage';
import {
  checkAndRequestNotificationPermission,
  clearNativeNotificationHistory,
  fetchNotificationInbox,
  fetchNotificationStatus,
  markAllNativeNotificationsRead,
  openAndroidNotificationSettings,
  openAndroidUsageAccessSettings,
  queryDeviceProfileInfo,
  queryInstagramUsageSummary,
  sendLocalNotification,
  subscribeToNativeNotificationUpdates,
  syncNativeNotificationConfig,
} from './src/utils/usageStats';
import {
  AuthSessionLike,
  CloudAuthStatus,
  CloudProfile,
  resolveCloudAccountIdentity,
} from './src/utils/authHelpers';
import { reconcileCloudUserXpWithProfile } from './src/utils/accountStorageCore';
import {
  buildProfileSyncPatch,
  deriveCloudStatusBand,
  formatSignInSuccessToast,
  getDeviceTimezone,
  ProfileUpdatePatch,
} from './src/utils/cloudProfileCore';
import { updateCloudProfile } from './src/utils/cloudProfile';
import {
  collectNewlyEarnedCloudXpEvents,
} from './src/utils/cloudXpSyncCore';
import {
  enqueueCloudXpEventsForUser,
  flushCloudXpQueueForUser,
  getPendingCloudXpCount,
} from './src/utils/cloudXpSync';
import {
  restoreCloudSession,
  signInWithGoogle,
  signOutFromCloud,
  subscribeToCloudAuthChanges,
} from './src/utils/auth';
import {
  fetchCloudProfile,
  startSupabaseAutoRefreshLifecycle,
} from './src/utils/supabase';
import {
  SocialNotificationRow,
  SquadInvitationRow,
} from './src/types/database.types';
import {
  buildPendingInviteMap,
  computeCombinedUnreadNotificationCount,
  DEFAULT_CLOUD_NOTIFICATION_PREFS,
  DefaultNotificationPreferences,
  markCloudNotificationsLocallyRead,
  upsertCloudNotificationInList,
} from './src/utils/cloudNotificationsCore';
import {
  fetchCloudNotificationPreferences,
  fetchCloudNotificationsFeed,
  markCloudNotificationsReadOnServer,
  subscribeToCloudNotifications,
  updateCloudNotificationPreferences,
} from './src/utils/cloudNotifications';
import {
  acceptCloudSquadInvitation,
  declineCloudSquadInvitation,
} from './src/utils/cloudSquads';
import TodayScreen from './src/screens/TodayScreen';
import MissionsScreen from './src/screens/MissionsScreen';
import BadgesScreen from './src/screens/BadgesScreen';
import LeaderboardScreen from './src/screens/LeaderboardScreen';
import BrainrotCardScreen from './src/screens/BrainrotCardScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import BreakModal from './src/components/BreakModal';
import CelebrationOverlay from './src/components/CelebrationOverlay';
import NotificationCenterModal from './src/components/NotificationCenterModal';
import UsagePermissionModal from './src/components/UsagePermissionModal';
import Icon from './src/components/Icon';

type TabItem = {
  key: ViewType;
  icon: string;
  label: string;
};

const tabs: TabItem[] = [
  { key: 'Today', icon: 'bar-chart-2', label: 'Today' },
  { key: 'Missions', icon: 'award', label: 'Missions' },
  { key: 'Badges', icon: 'award', label: 'Badges' },
  { key: 'Leaderboard', icon: 'users', label: 'Board' },
  { key: 'Card', icon: 'cpu', label: 'Card' },
  { key: 'Settings', icon: 'settings', label: 'Settings' },
];

export default function App() {
  const [activeView, setActiveView] = useState<ViewType>('Today');
  const [appState, setAppState] = useState<PersistedAppState>(() =>
    createInitialPersistedState()
  );
  const [hydrated, setHydrated] = useState(false);
  const [usageSummary, setUsageSummary] = useState<InstagramUsageSummary | null>(
    null
  );
  const [permissionModalOpen, setPermissionModalOpen] = useState(false);
  const [breakOpen, setBreakOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [celebration, setCelebration] = useState<Celebration | null>(null);
  const [notificationStatus, setNotificationStatus] =
    useState<NotificationStatusSnapshot>({
      runtimePermissionGranted: Platform.OS !== 'android',
      appNotificationsEnabled: false,
      nudgesChannelEnabled: false,
      remindersChannelEnabled: false,
      statusCode: 'notifications_off',
      quietHoursActiveNow: false,
      sentKeysToday: [],
    });
  const [testNotificationFeedback, setTestNotificationFeedback] = useState<
    string | null
  >(null);
  const [notificationInbox, setNotificationInbox] =
    useState<NotificationInboxSnapshot>({ unreadCount: 0, items: [] });
  const [notificationCenterOpen, setNotificationCenterOpen] = useState(false);
  const [highlightedUnreadIds, setHighlightedUnreadIds] = useState<string[]>([]);
  const [scrollToLedgerRequestId, setScrollToLedgerRequestId] = useState(0);
  const [cloudAuthStatus, setCloudAuthStatus] =
    useState<CloudAuthStatus>('loading');
  const [cloudSession, setCloudSession] = useState<AuthSessionLike | null>(null);
  const [cloudProfile, setCloudProfile] = useState<CloudProfile | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authBannerDismissed, setAuthBannerDismissed] = useState(false);
  const [cloudSyncBusy, setCloudSyncBusy] = useState(false);
  const [pendingCloudXpCount, setPendingCloudXpCount] = useState(0);
  const [cloudNotifications, setCloudNotifications] = useState<
    SocialNotificationRow[]
  >([]);
  const [cloudPendingInvites, setCloudPendingInvites] = useState<
    SquadInvitationRow[]
  >([]);
  const [cloudNotifPrefs, setCloudNotifPrefs] =
    useState<DefaultNotificationPreferences>({
      ...DEFAULT_CLOUD_NOTIFICATION_PREFS,
    });
  const [highlightedCloudUnreadIds, setHighlightedCloudUnreadIds] = useState<
    string[]
  >([]);
  const [inviteActionBusy, setInviteActionBusy] = useState(false);

  const appStateRef = useRef(appState);
  appStateRef.current = appState;
  const cloudAuthStatusRef = useRef(cloudAuthStatus);
  cloudAuthStatusRef.current = cloudAuthStatus;
  const cloudSessionRef = useRef(cloudSession);
  cloudSessionRef.current = cloudSession;
  const cloudProfileRef = useRef(cloudProfile);
  cloudProfileRef.current = cloudProfile;
  const loadedStateOwnerRef = useRef<string | null>(null);
  const ownerSwitchSeqRef = useRef(0);
  const deviceNameRef = useRef<string | null>(null);
  const lastAutoRefreshAtRef = useRef(0);
  const lastProfilePatchSigRef = useRef<string | null>(null);
  const profileSyncInFlightRef = useRef(false);

  const flushPendingCloudXp = useCallback(
    async (uidOverride?: string, profileOverride?: CloudProfile | null) => {
      const uid = uidOverride ?? cloudSessionRef.current?.user?.id;
      if (!uid || cloudAuthStatusRef.current !== 'authenticated') {
        return;
      }
      const res = await flushCloudXpQueueForUser(
        uid,
        profileOverride ?? cloudProfileRef.current
      );
      if (
        cloudAuthStatusRef.current !== 'authenticated' ||
        cloudSessionRef.current?.user?.id !== uid
      ) {
        return;
      }
      setPendingCloudXpCount(res.remainingCount);
      if (res.syncedCount > 0 || res.latestCloudXp !== null) {
        const fresh = await fetchCloudProfile(uid);
        if (
          cloudAuthStatusRef.current !== 'authenticated' ||
          cloudSessionRef.current?.user?.id !== uid
        ) {
          return;
        }
        if (fresh) {
          setCloudProfile(fresh);
          if (loadedStateOwnerRef.current === uid) {
            setAppState((prev) => {
              const reconciled = reconcileCloudUserXpWithProfile(prev, fresh);
              if (!reconciled.changed) return prev;
              void savePersistedState(reconciled.nextState, uid);
              return reconciled.nextState;
            });
          }
        } else if (res.latestCloudXp !== null) {
          const nextXp = res.latestCloudXp;
          setCloudProfile((prev) =>
            prev ? { ...prev, cloud_xp: nextXp } : prev
          );
        }
      }
    },
    []
  );

  const switchActiveOwnerState = useCallback(
    async (
      targetUserId: string | null,
      options?: { cloudProfile?: CloudProfile | null }
    ) => {
      const seq = ++ownerSwitchSeqRef.current;

      if (loadedStateOwnerRef.current === targetUserId && hydrated) {
        if (targetUserId && options?.cloudProfile) {
          setAppState((prev) => {
            const reconciled = reconcileCloudUserXpWithProfile(
              prev,
              options.cloudProfile
            );
            if (!reconciled.changed) return prev;
            void savePersistedState(reconciled.nextState, targetUserId);
            return reconciled.nextState;
          });
        }
        return;
      }

      const todayKey = getLocalDateKey();
      const template = appStateRef.current;
      let nextState = await loadPersistedState(todayKey, targetUserId, {
        templateState: template,
        cloudProfile: options?.cloudProfile,
      });

      if (seq !== ownerSwitchSeqRef.current) {
        return;
      }

      if (deviceNameRef.current) {
        nextState = updateDeviceDefaultNameState(
          nextState,
          deviceNameRef.current
        );
      }

      loadedStateOwnerRef.current = targetUserId;
      appStateRef.current = nextState;
      setAppState(nextState);
      if (nextState.cachedUsageSummary) {
        setUsageSummary(nextState.cachedUsageSummary);
      }
      await savePersistedState(nextState, targetUserId);
    },
    [hydrated]
  );

  const refreshCloudNotifications = useCallback(async (uidOverride?: string) => {
    const uid = uidOverride ?? cloudSessionRef.current?.user?.id;
    if (!uid || cloudAuthStatusRef.current !== 'authenticated') {
      return;
    }
    const [feed, prefs] = await Promise.all([
      fetchCloudNotificationsFeed(uid),
      fetchCloudNotificationPreferences(uid),
    ]);
    if (
      cloudAuthStatusRef.current !== 'authenticated' ||
      cloudSessionRef.current?.user?.id !== uid
    ) {
      return;
    }
    if (!feed.error) {
      setCloudNotifications(feed.notifications);
      setCloudPendingInvites(feed.pendingInvites);
    }
    setCloudNotifPrefs(prefs);
  }, []);

  const updateAndPersist = useCallback(
    (
      updater: (prev: PersistedAppState) => PersistedAppState,
      options?: { syncCloudXp?: boolean }
    ) => {
      const storageOwnerId = loadedStateOwnerRef.current;
      setAppState((prev) => {
        const prevClaimed = prev.claimedXpEvents;
        const next = updater(prev);
        void savePersistedState(next, storageOwnerId);

        if (
          options?.syncCloudXp &&
          cloudAuthStatusRef.current === 'authenticated' &&
          cloudSessionRef.current?.user?.id &&
          storageOwnerId === cloudSessionRef.current.user.id
        ) {
          const uid = cloudSessionRef.current.user.id;
          const profileSnapshot = cloudProfileRef.current;
          const newEvents = collectNewlyEarnedCloudXpEvents(
            prevClaimed,
            next.claimedXpEvents,
            getLocalDateKey(),
            getDeviceTimezone()
          );
          if (newEvents.length > 0) {
            queueMicrotask(() => {
              void enqueueCloudXpEventsForUser(uid, newEvents).then((queue) => {
                if (
                  cloudAuthStatusRef.current === 'authenticated' &&
                  cloudSessionRef.current?.user?.id === uid
                ) {
                  setPendingCloudXpCount(queue.length);
                  void flushPendingCloudXp(uid, profileSnapshot);
                }
              });
            });
          }
        }
        return next;
      });
    },
    [flushPendingCloudXp]
  );

  const refreshNotificationInbox = useCallback(async () => {
    const inbox = await fetchNotificationInbox();
    setNotificationInbox(inbox);
    return inbox;
  }, []);

  const refreshNotificationStatus = useCallback(async () => {
    const [status] = await Promise.all([
      fetchNotificationStatus(),
      refreshNotificationInbox(),
    ]);
    setNotificationStatus(status);
    if (status.sentKeysToday && status.sentKeysToday.length > 0) {
      const todayKey = getLocalDateKey();
      const existing = appStateRef.current.sentNotificationsByDate?.[todayKey] ?? [];
      const missing = status.sentKeysToday.filter((k) => !existing.includes(k));
      if (missing.length > 0) {
        updateAndPersist((prev) => {
          const prevKeys = prev.sentNotificationsByDate?.[todayKey] ?? [];
          const merged = Array.from(new Set([...prevKeys, ...status.sentKeysToday]));
          return {
            ...prev,
            sentNotificationsByDate: {
              ...(prev.sentNotificationsByDate ?? {}),
              [todayKey]: merged,
            },
          };
        });
      }
    }
    return status;
  }, [updateAndPersist, refreshNotificationInbox]);

  const syncUsageStats = useCallback(
    async (showFeedbackToast = false) => {
      lastAutoRefreshAtRef.current = Date.now();
      const summary = await queryInstagramUsageSummary(7);
      setUsageSummary(summary);
      const todayKey = getLocalDateKey();
      updateAndPersist((prev) => {
        let next = prev;
        if (summary.deviceName) {
          next = updateDeviceDefaultNameState(next, summary.deviceName);
        }
        const nextCached = selectCachedSummaryToPersist(
          next.cachedUsageSummary,
          summary,
          next.consentStatus,
          next.trackingEnabled
        );
        next = {
          ...next,
          cachedUsageSummary: nextCached,
        };
        const effLimit = getEffectiveDailyLimitMinutes(
          next.dailyLimitMinutes,
          next.settings.weekendBreathingRoom
        );
        const display = buildUsageDisplayState(
          summary,
          next.consentStatus,
          next.trackingEnabled,
          Date.now(),
          nextCached
        );
        const linkedRes = syncUsageLinkedMissionsState(
          next,
          display,
          effLimit,
          todayKey
        );
        return linkedRes.nextState;
      }, { syncCloudXp: true });
      if (showFeedbackToast) {
        if (!summary.permissionGranted) {
          setToast('ROT needs Usage Access to estimate your Instagram screen time.');
        } else if (
          (summary.status === 'ok' || summary.status === 'zero_usage') &&
          summary.todayForegroundMs !== null
        ) {
          const mins = Math.round(summary.todayForegroundMs / 60000);
          setToast(
            `Synced: ${formatMinutesAsHoursAndMinutes(mins).compact} estimated Instagram foreground time today.`
          );
        } else {
          setToast(summary.statusReason || 'Usage status refreshed.');
        }
      }
    },
    [updateAndPersist]
  );

  // Restore Supabase session FIRST, then hydrate the active owner's isolated local state
  useEffect(() => {
    let mounted = true;
    const stopAutoRefresh = startSupabaseAutoRefreshLifecycle();

    (async () => {
      const [sessionRes, deviceInfo, initialNotifStatus, initialInbox] =
        await Promise.all([
          restoreCloudSession(),
          queryDeviceProfileInfo(),
          fetchNotificationStatus(),
          fetchNotificationInbox(),
        ]);
      if (!mounted) return;

      deviceNameRef.current = deviceInfo.deviceName ?? null;
      const bootOwnerId =
        sessionRes.status === 'authenticated' && sessionRes.session?.user?.id
          ? sessionRes.session.user.id
          : null;

      setCloudAuthStatus(sessionRes.status);
      setCloudSession(sessionRes.session);
      setCloudProfile(sessionRes.profile);
      cloudAuthStatusRef.current = sessionRes.status;
      cloudSessionRef.current = sessionRes.session;
      cloudProfileRef.current = sessionRes.profile;

      if (sessionRes.status === 'guest' && sessionRes.error) {
        setAuthError(sessionRes.error);
      }

      const todayKeyOnBoot = getLocalDateKey();
      const guestTemplate = bootOwnerId
        ? await loadPersistedState(todayKeyOnBoot, null)
        : null;
      if (!mounted) return;

      const loaded = await loadPersistedState(todayKeyOnBoot, bootOwnerId, {
        templateState: guestTemplate,
        cloudProfile: sessionRes.profile,
      });
      if (!mounted) return;

      let hydratedState = updateDeviceDefaultNameState(
        loaded,
        deviceInfo.deviceName
      );
      if (initialNotifStatus.sentKeysToday.length > 0) {
        const prevKeys =
          hydratedState.sentNotificationsByDate?.[todayKeyOnBoot] ?? [];
        hydratedState = {
          ...hydratedState,
          sentNotificationsByDate: {
            ...(hydratedState.sentNotificationsByDate ?? {}),
            [todayKeyOnBoot]: Array.from(
              new Set([...prevKeys, ...initialNotifStatus.sentKeysToday])
            ),
          },
        };
      }

      loadedStateOwnerRef.current = bootOwnerId;
      appStateRef.current = hydratedState;
      setNotificationStatus(initialNotifStatus);
      setNotificationInbox(initialInbox);
      setAppState(hydratedState);
      if (hydratedState !== loaded || bootOwnerId !== null) {
        void savePersistedState(hydratedState, bootOwnerId);
      }
      if (hydratedState.cachedUsageSummary) {
        setUsageSummary(hydratedState.cachedUsageSummary);
      }
      setHydrated(true);

      if (bootOwnerId) {
        void getPendingCloudXpCount(bootOwnerId).then((count) => {
          if (mounted && cloudSessionRef.current?.user?.id === bootOwnerId) {
            setPendingCloudXpCount(count);
          }
        });
        void flushPendingCloudXp(bootOwnerId, sessionRes.profile);
      } else {
        setPendingCloudXpCount(0);
      }

      lastAutoRefreshAtRef.current = Date.now();
      const liveSummary = await queryInstagramUsageSummary(7);
      if (!mounted) return;
      if (liveSummary.deviceName) {
        deviceNameRef.current = liveSummary.deviceName;
      }
      setUsageSummary(liveSummary);
      const todayKey = getLocalDateKey();
      updateAndPersist((prev) => {
        const withDevice = liveSummary.deviceName
          ? updateDeviceDefaultNameState(prev, liveSummary.deviceName)
          : prev;
        const nextCached = selectCachedSummaryToPersist(
          withDevice.cachedUsageSummary,
          liveSummary,
          withDevice.consentStatus,
          withDevice.trackingEnabled
        );
        const withCache: PersistedAppState = {
          ...withDevice,
          cachedUsageSummary: nextCached,
        };
        const effLimit = getEffectiveDailyLimitMinutes(
          withCache.dailyLimitMinutes,
          withCache.settings.weekendBreathingRoom
        );
        const display = buildUsageDisplayState(
          liveSummary,
          withCache.consentStatus,
          withCache.trackingEnabled,
          Date.now(),
          nextCached
        );
        return syncUsageLinkedMissionsState(
          withCache,
          display,
          effLimit,
          todayKey
        ).nextState;
      });

      // Prompt consent modal on initial launch if still pending
      if (hydratedState.consentStatus === 'pending') {
        setPermissionModalOpen(true);
      }
      void refreshNotificationStatus();
    })();
    return () => {
      mounted = false;
      stopAutoRefresh();
    };
  }, [updateAndPersist, refreshNotificationStatus, flushPendingCloudXp]);

  // Listen for native Android notification deliveries in real time
  useEffect(() => {
    const unsubscribe = subscribeToNativeNotificationUpdates(() => {
      void refreshNotificationInbox();
    });
    return unsubscribe;
  }, [refreshNotificationInbox]);

  // Subscribe to cloud auth state changes and switch isolated local owner state safely
  useEffect(() => {
    let active = true;

    const unsubscribeAuth = subscribeToCloudAuthChanges(
      (_event, session, profile) => {
        if (!active) return;
        if (session) {
          setCloudSession(session);
          setCloudProfile(profile);
          setCloudAuthStatus('authenticated');
          setAuthError(null);
          cloudAuthStatusRef.current = 'authenticated';
          cloudSessionRef.current = session;
          cloudProfileRef.current = profile;
          void switchActiveOwnerState(session.user.id, {
            cloudProfile: profile,
          }).then(() => {
            if (!active || cloudSessionRef.current?.user?.id !== session.user.id) {
              return;
            }
            void getPendingCloudXpCount(session.user.id).then((count) => {
              if (active && cloudSessionRef.current?.user?.id === session.user.id) {
                setPendingCloudXpCount(count);
              }
            });
            void flushPendingCloudXp(session.user.id, profile);
          });
        } else {
          setCloudSession(null);
          setCloudProfile(null);
          setPendingCloudXpCount(0);
          cloudSessionRef.current = null;
          cloudProfileRef.current = null;
          setCloudAuthStatus((prev) => {
            const nextStatus = prev === 'unconfigured' ? 'unconfigured' : 'guest';
            cloudAuthStatusRef.current = nextStatus;
            return nextStatus;
          });
          if (loadedStateOwnerRef.current !== null) {
            void switchActiveOwnerState(null);
          }
        }
      }
    );

    return () => {
      active = false;
      unsubscribeAuth();
    };
  }, [flushPendingCloudXp, switchActiveOwnerState]);

  // Subscribe to Realtime Cloud Social Notifications while authenticated
  useEffect(() => {
    const uid = cloudSession?.user?.id;
    if (cloudAuthStatus !== 'authenticated' || !uid) {
      if (cloudAuthStatus !== 'loading') {
        setCloudNotifications([]);
        setCloudPendingInvites([]);
        setHighlightedCloudUnreadIds([]);
        setCloudNotifPrefs({ ...DEFAULT_CLOUD_NOTIFICATION_PREFS });
      }
      return;
    }

    void refreshCloudNotifications(uid);

    const unsubscribe = subscribeToCloudNotifications(uid, {
      onInsert: (row) => {
        setCloudNotifications((prev) => upsertCloudNotificationInList(prev, row));
        if (row.notification_type === 'squad_invite_received') {
          void refreshCloudNotifications(uid);
        }
        setToast(row.title);
      },
      onUpdate: (row) => {
        setCloudNotifications((prev) => upsertCloudNotificationInList(prev, row));
      },
    });

    return () => {
      unsubscribe();
    };
  }, [cloudAuthStatus, cloudSession?.user?.id, refreshCloudNotifications]);

  // Re-query UsageStats and Notification status automatically when returning from Android settings
  useEffect(() => {
    const sub = AppState.addEventListener(
      'change',
      (nextStatus: AppStateStatus) => {
        if (nextStatus === 'active' && hydrated) {
          const now = Date.now();
          if (now - lastAutoRefreshAtRef.current >= 2500) {
            void syncUsageStats(false);
          }
          void refreshNotificationStatus();
          if (
            cloudAuthStatusRef.current === 'authenticated' &&
            cloudSessionRef.current?.user?.id
          ) {
            void flushPendingCloudXp(
              cloudSessionRef.current.user.id,
              cloudProfileRef.current
            );
            void refreshCloudNotifications(cloudSessionRef.current.user.id);
          }
        }
      }
    );
    return () => sub.remove();
  }, [
    hydrated,
    syncUsageStats,
    refreshNotificationStatus,
    flushPendingCloudXp,
    refreshCloudNotifications,
  ]);

  // Toast animation
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastTranslateY = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    if (toast === '') return;
    Animated.parallel([
      Animated.timing(toastOpacity, {
        toValue: 1,
        duration: 250,
        useNativeDriver: true,
      }),
      Animated.timing(toastTranslateY, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      }),
    ]).start();

    const timer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(toastOpacity, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(toastTranslateY, {
          toValue: 20,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start(() => setToast(''));
    }, 2600);

    return () => clearTimeout(timer);
  }, [toast, toastOpacity, toastTranslateY]);

  const dateKey = getLocalDateKey();
  const effectiveLimitMinutes = getEffectiveDailyLimitMinutes(
    appState.dailyLimitMinutes,
    appState.settings.weekendBreathingRoom
  );

  const usageDisplay = buildUsageDisplayState(
    usageSummary,
    appState.consentStatus,
    appState.trackingEnabled,
    Date.now(),
    appState.cachedUsageSummary
  );

  const missions = getMissionsForDate(
    appState,
    dateKey,
    usageDisplay,
    effectiveLimitMinutes
  );
  const completedMissions = missions.filter((m) => m.done).length;
  const dailyChest = getDailyChestForDate(appState);
  const totalXp = calculateTotalXp(appState);
  const earnedTodayXp = calculateEarnedXpForDate(appState, dateKey);
  const badges = getBadges(
    missions,
    appState.completedFocusBreaks,
    appState.unlockedBadges
  );
  const weeklyQuestState = getWeeklyQuestState(appState, dateKey);
  const xpLedger = getXpLedgerEntries(appState);
  const ledgerConsistency = verifyXpLedgerConsistency(appState);

  const todayMoodLog = appState.moodLogsByDate?.[dateKey] ?? null;
  const recentMoodLogs = Object.values(appState.moodLogsByDate ?? {}).sort((a, b) =>
    b.dateKey.localeCompare(a.dateKey)
  );

  const identity = resolveEffectiveDisplayName(appState.profile);

  const limitProgress = calculateLimitProgress(
    usageSummary?.todayForegroundMs ?? null,
    effectiveLimitMinutes,
    usageDisplay.hasVerifiedEstimate
  );

  const brainrotIndex = calculateBrainrotIndex(
    usageSummary?.todayForegroundMs ?? null,
    effectiveLimitMinutes,
    usageDisplay.hasVerifiedEstimate,
    completedMissions,
    appState.completedFocusBreaks,
    todayMoodLog
  );
  const playerLevel = calculatePlayerLevel(totalXp);
  const badgesUnlockedCount = badges.filter((b) => b.unlocked).length;
  const weeklySummary = buildWeeklyAchievementSummary(appState, dateKey);

  // Sync notification configuration and schedules to native Android WorkManager + AlarmManager
  useEffect(() => {
    if (!hydrated) return;
    const anyNonLimitMissionDoneToday = missions.some(
      (m) => m.done && m.id !== 'set-scroll-limit'
    );
    const streakActiveToday = isDateActiveForStreak(appState, dateKey, usageDisplay);
    void syncNativeNotificationConfig({
      dailyGentleNudge: appState.settings.dailyGentleNudge,
      missionReminders: appState.settings.missionReminders,
      streakReminders: appState.settings.streakReminders,
      weekendBreathingRoom: appState.settings.weekendBreathingRoom,
      consentAccepted: appState.consentStatus === 'accepted',
      trackingEnabled: appState.trackingEnabled,
      dailyLimitMinutes: appState.dailyLimitMinutes,
      eveningReminderHour: appState.settings.eveningReminderHour ?? 19,
      eveningReminderMinute: appState.settings.eveningReminderMinute ?? 0,
      streakReminderHour: appState.settings.streakReminderHour ?? 21,
      streakReminderMinute: appState.settings.streakReminderMinute ?? 0,
      quietHoursEnabled: appState.settings.quietHoursEnabled !== false,
      quietStartHour: appState.settings.quietStartHour ?? 22,
      quietEndHour: appState.settings.quietEndHour ?? 8,
      currentStreak: appState.streak?.currentStreak ?? 0,
      syncedDateKey: dateKey,
      anyNonLimitMissionDoneToday,
      streakActiveToday,
      sentKeysToday: appState.sentNotificationsByDate?.[dateKey] ?? [],
    });
  }, [hydrated, appState, dateKey, missions, usageDisplay]);

  // Evaluate and fire pending local notifications once per day when thresholds are met
  useEffect(() => {
    if (!hydrated) return;
    const evalRes = evaluatePendingNotifications(
      appStateRef.current,
      usageDisplay,
      limitProgress,
      dateKey
    );
    if (evalRes.notifications.length > 0) {
      updateAndPersist(() => evalRes.nextState);
      void (async () => {
        const allowed = await checkAndRequestNotificationPermission();
        if (!allowed) return;
        for (const n of evalRes.notifications) {
          await sendLocalNotification(n.id, n.title, n.body);
        }
        await refreshNotificationStatus();
      })();
    }
  }, [
    hydrated,
    usageDisplay,
    limitProgress,
    dateKey,
    updateAndPersist,
    refreshNotificationStatus,
  ]);

  const syncCloudProfilePatch = useCallback(
    async (
      patch: ProfileUpdatePatch,
      options?: { silent?: boolean; successToast?: string }
    ) => {
      const uid = cloudSession?.user?.id;
      if (cloudAuthStatus !== 'authenticated' || !uid) {
        return false;
      }
      setCloudSyncBusy(true);
      const res = await updateCloudProfile(uid, patch);
      setCloudSyncBusy(false);

      if (res.ok && res.profile) {
        setCloudProfile(res.profile);
        if (options?.successToast) {
          setToast(options.successToast);
        }
        return true;
      }

      if (!options?.silent) {
        setToast(res.error || 'Could not update your Cloud Club profile.');
      }
      return false;
    },
    [cloudAuthStatus, cloudSession]
  );

  // Sync device IANA timezone and privacy-respecting status_band while authenticated
  useEffect(() => {
    const uid = cloudSession?.user?.id;
    if (
      cloudAuthStatus !== 'authenticated' ||
      !uid ||
      !cloudProfile ||
      !hydrated ||
      profileSyncInFlightRef.current
    ) {
      return;
    }

    const desiredTz = getDeviceTimezone();
    const desiredBand = deriveCloudStatusBand({
      shareSquadStatus: cloudProfile.share_squad_status,
      hasVerifiedEstimate: usageDisplay.hasVerifiedEstimate,
      usedMinutes: limitProgress.usedMinutes,
      limitMinutes: effectiveLimitMinutes,
      isOverLimit: limitProgress.isOverLimit,
    });

    const patch = buildProfileSyncPatch(cloudProfile, {
      timezone: desiredTz,
      statusBand: desiredBand,
    });

    if (!patch) {
      lastProfilePatchSigRef.current = null;
      return;
    }

    const sig = `${uid}:${JSON.stringify(patch)}`;
    if (lastProfilePatchSigRef.current === sig) {
      return;
    }

    lastProfilePatchSigRef.current = sig;
    profileSyncInFlightRef.current = true;
    void updateCloudProfile(uid, patch)
      .then((res) => {
        if (res.ok && res.profile) {
          setCloudProfile(res.profile);
        }
      })
      .finally(() => {
        profileSyncInFlightRef.current = false;
      });
  }, [
    cloudAuthStatus,
    cloudSession,
    cloudProfile,
    hydrated,
    usageDisplay.hasVerifiedEstimate,
    limitProgress.usedMinutes,
    limitProgress.isOverLimit,
    effectiveLimitMinutes,
  ]);

  async function handleSignInWithGoogle() {
    if (authBusy) return;
    setAuthBusy(true);
    setAuthError(null);
    const result = await signInWithGoogle();

    if (result.ok) {
      lastProfilePatchSigRef.current = null;
      setCloudSession(result.session);
      setCloudProfile(result.profile);
      setCloudAuthStatus('authenticated');
      cloudAuthStatusRef.current = 'authenticated';
      cloudSessionRef.current = result.session;
      cloudProfileRef.current = result.profile;
      await switchActiveOwnerState(result.session.user.id, {
        cloudProfile: result.profile,
      });
      const pendingCount = await getPendingCloudXpCount(result.session.user.id);
      if (cloudSessionRef.current?.user?.id === result.session.user.id) {
        setPendingCloudXpCount(pendingCount);
        void flushPendingCloudXp(result.session.user.id, result.profile);
      }
      setAuthBusy(false);
      const resolved = resolveCloudAccountIdentity(
        result.session.user,
        result.profile
      );
      setToast(formatSignInSuccessToast(resolved));
      return;
    }

    setAuthBusy(false);
    if (result.error.cancelled) {
      setToast(result.error.userMessage);
      return;
    }

    setAuthError(result.error.userMessage);
    setToast(result.error.userMessage);
  }

  async function handleSignOutCloud() {
    if (authBusy) return;
    setAuthBusy(true);
    const result = await signOutFromCloud();

    if (result.ok) {
      lastProfilePatchSigRef.current = null;
      cloudAuthStatusRef.current = 'guest';
      cloudSessionRef.current = null;
      cloudProfileRef.current = null;
      setCloudSession(null);
      setCloudProfile(null);
      setPendingCloudXpCount(0);
      setCloudAuthStatus('guest');
      setAuthError(null);
      await switchActiveOwnerState(null);
      setAuthBusy(false);
      setToast('Signed out of cloud account. Local guest progress is preserved.');
    } else {
      setAuthBusy(false);
      const msg = result.error || 'Could not sign out right now.';
      setAuthError(msg);
      setToast(msg);
    }
  }

  function handleToggleShareSquadStatus() {
    if (!cloudProfile) return;
    const nextShare = !cloudProfile.share_squad_status;
    const nextBand = deriveCloudStatusBand({
      shareSquadStatus: nextShare,
      hasVerifiedEstimate: usageDisplay.hasVerifiedEstimate,
      usedMinutes: limitProgress.usedMinutes,
      limitMinutes: effectiveLimitMinutes,
      isOverLimit: limitProgress.isOverLimit,
    });
    void syncCloudProfilePatch(
      {
        share_squad_status: nextShare,
        status_band: nextBand,
      },
      {
        successToast: nextShare
          ? 'Squad target band sharing enabled (never shares exact minutes).'
          : 'Squad target band hidden from other members.',
      }
    );
  }

  function handleSyncLocalNameToCloud() {
    void syncCloudProfilePatch(
      { display_name: identity.displayName },
      {
        successToast: `Cloud Squad display name updated to ${identity.displayName}.`,
      }
    );
  }

  async function handleToggleCloudNotifPref(
    key: 'squad_invites_enabled' | 'squad_activity_enabled'
  ) {
    const uid = cloudSession?.user?.id;
    if (cloudAuthStatus !== 'authenticated' || !uid) return;
    const nextValue = !cloudNotifPrefs[key];
    const prevPrefs = cloudNotifPrefs;
    setCloudNotifPrefs((prev) => ({ ...prev, [key]: nextValue }));
    setCloudSyncBusy(true);
    const res = await updateCloudNotificationPreferences(uid, {
      [key]: nextValue,
    });
    setCloudSyncBusy(false);
    if (res.ok) {
      setCloudNotifPrefs(res.prefs);
      setToast('Cloud notification preference saved.');
    } else {
      setCloudNotifPrefs(prevPrefs);
      setToast(res.error || 'Could not update cloud notification preference.');
    }
  }

  async function handleAcceptSquadInviteFromNotif(inviteCode: string) {
    if (inviteActionBusy) return;
    setInviteActionBusy(true);
    const res = await acceptCloudSquadInvitation(inviteCode);
    setInviteActionBusy(false);
    if (res.ok) {
      setToast(`Joined ${res.data.squad_name}!`);
      setNotificationCenterOpen(false);
      setActiveView('Leaderboard');
      if (cloudSessionRef.current?.user?.id) {
        void refreshCloudNotifications(cloudSessionRef.current.user.id);
      }
    } else {
      setToast(res.error);
    }
  }

  async function handleDeclineSquadInviteFromNotif(invitationId: string) {
    if (inviteActionBusy) return;
    setInviteActionBusy(true);
    const res = await declineCloudSquadInvitation(invitationId);
    setInviteActionBusy(false);
    if (res.ok) {
      setCloudPendingInvites((prev) =>
        prev.filter((inv) => inv.id !== invitationId)
      );
      setToast('Squad invitation declined.');
      if (cloudSessionRef.current?.user?.id) {
        void refreshCloudNotifications(cloudSessionRef.current.user.id);
      }
    } else {
      setToast(res.error);
    }
  }

  function handleSaveDisplayName(
    rawName: string | null,
    alsoSyncToCloud = false
  ) {
    const res = updateCustomDisplayNameState(appStateRef.current, rawName);
    updateAndPersist(() => res.nextState);

    if (
      alsoSyncToCloud &&
      cloudAuthStatus === 'authenticated' &&
      cloudSession?.user?.id
    ) {
      void syncCloudProfilePatch(
        { display_name: res.resolvedName },
        {
          successToast: res.revertedToDefault
            ? `Display name reset to ${res.resolvedName} (synced to Cloud).`
            : `Display name saved & synced to Cloud as ${res.resolvedName}.`,
        }
      );
      return;
    }

    if (res.revertedToDefault) {
      setToast(`Display name reset to ${res.resolvedName}.`);
    } else {
      setToast(`Display name saved as ${res.resolvedName}.`);
    }
  }

  function handleToggleMission(index: number) {
    const result = toggleMissionState(
      appStateRef.current,
      index,
      dateKey,
      false,
      usageDisplay,
      effectiveLimitMinutes
    );
    updateAndPersist(() => result.nextState, { syncCloudXp: true });
    if (result.celebration) {
      setCelebration(result.celebration);
    }
    if (result.toastMessage) {
      setToast(result.toastMessage);
    }
  }

  function handleClaimWeeklyQuest(questId: WeeklyQuestId) {
    const result = claimWeeklyQuestState(appStateRef.current, questId, dateKey);
    updateAndPersist(() => result.nextState, { syncCloudXp: true });
    if (result.celebration) {
      setCelebration(result.celebration);
    }
    if (result.toastMessage) {
      setToast(result.toastMessage);
    }
  }

  function handleRecoverStreak() {
    const result = recoverStreakState(appStateRef.current, dateKey);
    updateAndPersist(() => result.nextState, { syncCloudXp: true });
    if (result.celebration) {
      setCelebration(result.celebration);
    }
    if (result.toastMessage) {
      setToast(result.toastMessage);
    }
  }

  function handleLogMood(moodId: MoodId, note: string) {
    const result = logDailyMoodState(appStateRef.current, moodId, note, dateKey);
    updateAndPersist(() => result.nextState, { syncCloudXp: true });
    if (result.celebration) {
      setCelebration(result.celebration);
    }
    if (result.toastMessage) {
      setToast(result.toastMessage);
    }
  }

  function handleClaimDailyChest() {
    const result = claimDailyChestState(appStateRef.current);
    updateAndPersist(() => result.nextState, { syncCloudXp: true });
    if (result.celebration) {
      setCelebration(result.celebration);
    }
    if (result.toastMessage) {
      setToast(result.toastMessage);
    }
  }

  function handleCompleteFocusBreak(
    sessionId: string,
    durationMinutes: number = 10
  ) {
    setBreakOpen(false);
    const result = completeFocusBreakState(
      appStateRef.current,
      sessionId,
      dateKey,
      durationMinutes
    );
    updateAndPersist(() => result.nextState, { syncCloudXp: true });
    if (result.celebration) {
      setCelebration(result.celebration);
    }
    if (result.toastMessage) {
      setToast(result.toastMessage);
    }
  }

  function handleBadgePress(badge: Badge) {
    if (!badge.unlocked) {
      setToast(`Keep going: ${badge.requirement} to unlock ${badge.name}.`);
      return;
    }
    setCelebration({
      title: badge.name,
      detail: badge.description,
      reward: 'TROPHY CABINET HIGHLIGHT',
      iconName: badge.iconName,
      kind: 'badge',
    });
  }

  function handleUsageAction() {
    if (usageDisplay.actionKind === 'consent') {
      setPermissionModalOpen(true);
      return;
    }
    if (usageDisplay.actionKind === 'enable_tracking') {
      updateAndPersist((prev) => ({
        ...prev,
        trackingEnabled: true,
      }));
      void syncUsageStats(true);
      return;
    }
    if (usageDisplay.actionKind === 'permission') {
      setPermissionModalOpen(true);
      return;
    }
    void syncUsageStats(true);
  }

  async function handleAcceptAndOpenSettings() {
    const nowIso = new Date().toISOString();
    updateAndPersist((prev) => ({
      ...prev,
      consentStatus: 'accepted',
      consentUpdatedAt: nowIso,
      trackingEnabled: true,
    }));
    setPermissionModalOpen(false);
    const opened = await openAndroidUsageAccessSettings();
    if (!opened) {
      setToast('Open Android Settings > Apps > Special app access > Usage access.');
    } else {
      setToast('Enable Usage Access for ROT, then return to the app.');
    }
  }

  function handleAcceptWithoutSettings() {
    const nowIso = new Date().toISOString();
    updateAndPersist((prev) => ({
      ...prev,
      consentStatus: 'accepted',
      consentUpdatedAt: nowIso,
      trackingEnabled: true,
    }));
    setPermissionModalOpen(false);
    void syncUsageStats(true);
  }

  function handleDeclineOrLater() {
    const nowIso = new Date().toISOString();
    updateAndPersist((prev) => ({
      ...prev,
      consentStatus: prev.consentStatus === 'accepted' ? 'accepted' : 'declined',
      consentUpdatedAt: nowIso,
      trackingEnabled: false,
    }));
    setPermissionModalOpen(false);
    setToast('Continuing without Instagram tracking. Missions & breaks still work.');
  }

  function handleChangeDailyLimit(minutes: number) {
    const clamped = clampDailyLimitMinutes(minutes);
    updateAndPersist((prev) => {
      const currentMissions = getMissionsForDate(prev, dateKey);
      const limitIdx = currentMissions.findIndex(
        (m) => m.id === 'set-scroll-limit'
      );
      let next: PersistedAppState = {
        ...prev,
        dailyLimitMinutes: clamped,
      };
      if (limitIdx >= 0 && !currentMissions[limitIdx].done) {
        next = toggleMissionState(next, limitIdx, dateKey, true).nextState;
      }
      const effLimit = getEffectiveDailyLimitMinutes(
        clamped,
        next.settings.weekendBreathingRoom
      );
      next = syncUsageLinkedMissionsState(
        next,
        usageDisplay,
        effLimit,
        dateKey
      ).nextState;
      return next;
    }, { syncCloudXp: true });
    setToast(
      `Daily limit updated to ${formatMinutesAsHoursAndMinutes(clamped).compact}.`
    );
  }

  function handleToggleSetting(key: keyof UserSettings) {
    updateAndPersist((prev) => {
      const prevVal =
        key === 'achievementNotifications' || key === 'quietHoursEnabled'
          ? prev.settings[key] !== false
          : Boolean(prev.settings[key]);
      const nextSettings = {
        ...prev.settings,
        [key]: !prevVal,
      };
      return {
        ...prev,
        settings: nextSettings,
      };
    });
    setToast('Preference saved locally.');
  }

  function handleUpdateSettingsPatch(patch: Partial<UserSettings>) {
    updateAndPersist((prev) => ({
      ...prev,
      settings: {
        ...prev.settings,
        ...patch,
      },
    }));
    setToast('Schedule updated.');
  }

  function handleClearLocalHistory() {
    updateAndPersist((prev) => {
      const cleared = clearLocalHistoryState(prev, dateKey);
      if (loadedStateOwnerRef.current !== null) {
        const cloudReset: PersistedAppState = {
          ...cleared,
          baseXp: 0,
        };
        return reconcileCloudUserXpWithProfile(
          cloudReset,
          cloudProfileRef.current
        ).nextState;
      }
      return cleared;
    });
    void clearNativeNotificationHistory().then((emptyInbox) => {
      setNotificationInbox(emptyInbox);
    });
    setToast('Local usage cache and mission history cleared.');
  }

  async function handleExportUserData() {
    const exported = serializeUserDataExportJson(appStateRef.current);
    if (!exported.ok) {
      setToast(exported.error || 'Could not generate JSON export.');
      return;
    }
    try {
      await Share.share({
        title: exported.filename,
        message: exported.json,
      });
      setToast(`Exported ${exported.filename} (${exported.json.length} bytes).`);
    } catch {
      setToast('Export ready in preview—share sheet was closed.');
    }
  }

  async function handleSendTestNotification() {
    await checkAndRequestNotificationPermission();
    const status = await refreshNotificationStatus();
    if (status.statusCode === 'permission_required') {
      const msg =
        'Android notification permission is currently denied. Tap "Open Android Notification Settings" to allow ROT notifications.';
      setTestNotificationFeedback(msg);
      setToast('Notification permission required.');
      return;
    }
    if (status.statusCode === 'notifications_off') {
      const msg =
        'Notifications are turned off for ROT in Android system settings.';
      setTestNotificationFeedback(msg);
      setToast('App notifications are disabled in Android.');
      return;
    }
    if (status.statusCode === 'channel_disabled') {
      const msg =
        'The ROT Wellbeing Nudges channel is muted/disabled in Android settings.';
      setTestNotificationFeedback(msg);
      setToast('Wellbeing Nudges channel is disabled.');
      return;
    }

    const body =
      limitProgress.nudgeMessage ||
      `Your daily scroll target is ${limitProgress.limitFormatted}. Keep choosing balance!`;
    const sent = await sendLocalNotification(1999, 'ROT Gentle Nudge', body);
    if (sent) {
      await refreshNotificationInbox();
      const timeLabel = new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      });
      setTestNotificationFeedback(
        `Delivered to Android notification shade at ${timeLabel}.`
      );
      setToast('Test notification sent to your Android notification shade.');
    } else {
      setTestNotificationFeedback(
        'Could not post notification—verify Android notification channel settings.'
      );
      setToast('Notification blocked by Android settings.');
    }
  }

  const exportPreviewResult = serializeUserDataExportJson(appState);
  const cloudIdentity = cloudSession?.user
    ? resolveCloudAccountIdentity(cloudSession.user, cloudProfile)
    : null;

  function renderScreen() {
    switch (activeView) {
      case 'Today':
        return (
          <TodayScreen
            displayName={identity.displayName}
            customDisplayName={appState.profile.customDisplayName}
            deviceDefaultName={appState.profile.deviceDefaultName}
            onSaveDisplayName={handleSaveDisplayName}
            completedMissions={completedMissions}
            earnedXp={earnedTodayXp}
            missions={missions}
            onMissionClick={handleToggleMission}
            onBreak={() => setBreakOpen(true)}
            onViewMissions={() => setActiveView('Missions')}
            onOpenSettings={() => setActiveView('Settings')}
            chest={dailyChest}
            onClaimChest={handleClaimDailyChest}
            usageSummary={usageSummary}
            usageDisplay={usageDisplay}
            limitProgress={limitProgress}
            brainrotIndex={brainrotIndex}
            effectiveLimitMinutes={effectiveLimitMinutes}
            showGentleNudge={appState.settings.dailyGentleNudge}
            onUsageAction={handleUsageAction}
            onRefreshUsage={() => void syncUsageStats(true)}
            streak={appState.streak}
            onRecoverStreak={handleRecoverStreak}
            todayMoodLog={todayMoodLog}
            recentMoodLogs={recentMoodLogs}
            onLogMood={handleLogMood}
            cloudAuthStatus={cloudAuthStatus}
            cloudIdentity={cloudIdentity}
            authBusy={authBusy}
            authError={authError}
            showSignInPrompt={
              !authBannerDismissed &&
              cloudAuthStatus !== 'authenticated' &&
              cloudAuthStatus !== 'loading'
            }
            onSignInWithGoogle={() => void handleSignInWithGoogle()}
            onDismissSignInPrompt={() => setAuthBannerDismissed(true)}
          />
        );
      case 'Missions':
        return (
          <MissionsScreen
            missions={missions}
            onMissionClick={handleToggleMission}
            earnedXp={earnedTodayXp}
            totalXp={totalXp}
            weeklyQuestState={weeklyQuestState}
            onClaimWeeklyQuest={handleClaimWeeklyQuest}
            xpLedger={xpLedger}
            ledgerConsistent={ledgerConsistency.consistent}
            scrollToLedgerRequestId={scrollToLedgerRequestId}
          />
        );
      case 'Badges':
        return (
          <BadgesScreen
            badges={badges}
            onBadgePress={handleBadgePress}
          />
        );
      case 'Leaderboard':
        return (
          <LeaderboardScreen
            displayName={identity.displayName}
            userHandle={identity.handle}
            userInitials={identity.initials}
            totalXp={totalXp}
            earnedTodayXp={earnedTodayXp}
            cloudAuthStatus={cloudAuthStatus}
            cloudIdentity={cloudIdentity}
            authBusy={authBusy}
            onSignInWithGoogle={() => void handleSignInWithGoogle()}
            onToast={setToast}
          />
        );
      case 'Card':
        return (
          <BrainrotCardScreen
            displayName={identity.displayName}
            totalXp={totalXp}
            playerLevel={playerLevel}
            currentStreak={appState.streak.currentStreak}
            brainrotScore={brainrotIndex.score}
            archetypeTitle={brainrotIndex.archetypeTitle}
            archetypeDesc={brainrotIndex.archetypeDesc}
            badgesUnlockedCount={badgesUnlockedCount}
            weeklySummary={weeklySummary}
            privateMode={appState.settings.privateMode}
            selectedCardType={appState.selectedCardType ?? 'archetype'}
            selectedFormat={appState.selectedCardFormat ?? 'feed'}
            onSelectCardType={(cardType: CardType) =>
              updateAndPersist((prev) => ({ ...prev, selectedCardType: cardType }))
            }
            onSelectFormat={(format: CardExportFormat) =>
              updateAndPersist((prev) => ({ ...prev, selectedCardFormat: format }))
            }
            onEditName={() => setActiveView('Settings')}
            onToast={setToast}
          />
        );
      case 'Settings':
        return (
          <SettingsScreen
            displayName={identity.displayName}
            customDisplayName={appState.profile.customDisplayName}
            deviceDefaultName={appState.profile.deviceDefaultName}
            onSaveDisplayName={handleSaveDisplayName}
            consentStatus={appState.consentStatus}
            trackingEnabled={appState.trackingEnabled}
            dailyLimitMinutes={appState.dailyLimitMinutes}
            settings={appState.settings}
            usageSummary={usageSummary}
            usageDisplay={usageDisplay}
            notificationStatus={notificationStatus}
            testNotificationFeedback={testNotificationFeedback}
            onToggleTracking={(nextEnabled) => {
              updateAndPersist((prev) => ({
                ...prev,
                trackingEnabled: nextEnabled,
              }));
              setToast(
                nextEnabled
                  ? 'Instagram usage tracking resumed.'
                  : 'Tracking is paused. Your previous saved progress is preserved.'
              );
              if (nextEnabled) {
                void syncUsageStats(false);
              }
            }}
            onOpenUsageSetup={() => setPermissionModalOpen(true)}
            onOpenSystemUsageSettings={async () => {
              const opened = await openAndroidUsageAccessSettings();
              if (!opened) {
                setToast(
                  'Open Android Settings > Apps > Special app access > Usage access.'
                );
              }
            }}
            onOpenNotificationSettings={async (channelId) => {
              const opened = await openAndroidNotificationSettings(channelId ?? null);
              if (!opened) {
                setToast('Open Android Settings > Apps > ROT > Notifications.');
              }
            }}
            onRefreshNotificationStatus={() => {
              void refreshNotificationStatus().then(() => {
                setToast('Notification status refreshed.');
              });
            }}
            onChangeDailyLimit={handleChangeDailyLimit}
            onToggleSetting={handleToggleSetting}
            onUpdateSettingsPatch={handleUpdateSettingsPatch}
            onClearLocalHistory={handleClearLocalHistory}
            onRefreshUsage={() => void syncUsageStats(true)}
            onExportUserData={() => void handleExportUserData()}
            exportJsonPreview={exportPreviewResult.json}
            onSendTestNotification={() => void handleSendTestNotification()}
            cloudAuthStatus={cloudAuthStatus}
            cloudIdentity={cloudIdentity}
            cloudProfile={cloudProfile}
            cloudSyncBusy={cloudSyncBusy}
            pendingCloudXpCount={pendingCloudXpCount}
            cloudNotifPrefs={cloudNotifPrefs}
            authBusy={authBusy}
            authError={authError}
            onSignInWithGoogle={() => void handleSignInWithGoogle()}
            onSignOutCloud={() => void handleSignOutCloud()}
            onToggleShareSquadStatus={handleToggleShareSquadStatus}
            onToggleCloudNotifPref={(key) => void handleToggleCloudNotifPref(key)}
            onSyncLocalNameToCloud={handleSyncLocalNameToCloud}
            onFlushCloudXp={() => {
              void flushPendingCloudXp().then(() => {
                setToast('Cloud XP sync checked.');
              });
            }}
          />
        );
    }
  }

  function handleOpenNotificationCenter() {
    const unreadIds = notificationInbox.items
      .filter((item) => !item.read)
      .map((item) => item.id);
    const unreadCloudIds = cloudNotifications
      .filter((item) => !item.is_read)
      .map((item) => item.id);
    setHighlightedUnreadIds(unreadIds);
    setHighlightedCloudUnreadIds(unreadCloudIds);
    setNotificationCenterOpen(true);
    void markAllNativeNotificationsRead().then((updatedInbox) => {
      setNotificationInbox(updatedInbox);
    });
    if (cloudAuthStatus === 'authenticated' && unreadCloudIds.length > 0) {
      setCloudNotifications((prev) =>
        markCloudNotificationsLocallyRead(prev, unreadCloudIds)
      );
      void markCloudNotificationsReadOnServer(unreadCloudIds);
    }
  }

  function handleOpenXpLedger() {
    setActiveView('Missions');
    setScrollToLedgerRequestId((id) => id + 1);
  }

  const unreadBadgeText = formatUnreadBadgeCount(
    computeCombinedUnreadNotificationCount(
      notificationInbox.unreadCount,
      cloudNotifications
    )
  );

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
        <StatusBar barStyle="dark-content" />

        {/* Top Bar */}
        <View style={styles.topBar}>
          <View style={styles.brandLockup}>
            <View style={styles.brandMark}>
              <Icon name="brain" size={16} color={COLORS.white} />
            </View>
            <View>
              <Text style={styles.brandName}>ROT.</Text>
              <Text style={styles.brandCaption}>The Brainrot Club</Text>
            </View>
          </View>
          <View style={styles.topActions}>
            <TouchableOpacity
              style={styles.iconButton}
              onPress={handleOpenNotificationCenter}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel={
                unreadBadgeText
                  ? `Notifications (${unreadBadgeText} unread)`
                  : 'Notifications'
              }
            >
              <Feather name="bell" size={17} color={COLORS.purple} />
              {unreadBadgeText !== null && (
                <View style={styles.notifBadge}>
                  <Text style={styles.notifBadgeText}>{unreadBadgeText}</Text>
                </View>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.xpPill}
              onPress={handleOpenXpLedger}
              activeOpacity={0.72}
              accessibilityRole="button"
              accessibilityLabel={`Brain Bank XP: ${totalXp} XP. Tap to view XP Ledger`}
            >
              <Feather name="zap" size={13} color={COLORS.pink} />
              <Text style={styles.xpText}>
                <Text style={styles.xpBold}>{totalXp}</Text> XP
              </Text>
              <Feather name="chevron-right" size={11} color={COLORS.pink} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Screen Content */}
        <View style={styles.screenContainer}>{renderScreen()}</View>

        {/* Bottom Tab Bar */}
        <View style={styles.tabBar}>
          {tabs.map((tab) => {
            const isActive = activeView === tab.key;
            const pendingMissions = missions.length - completedMissions;
            return (
              <TouchableOpacity
                key={tab.key}
                style={styles.tabItem}
                onPress={() => setActiveView(tab.key)}
                activeOpacity={0.7}
              >
                <View style={[styles.tabIconWrap, isActive && styles.tabIconWrapActive]}>
                  <Feather
                    name={tab.icon as any}
                    size={18}
                    color={isActive ? COLORS.white : '#8d7e9c'}
                  />
                </View>
                <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>
                  {tab.label}
                </Text>
                {tab.key === 'Missions' && pendingMissions > 0 && (
                  <View style={[styles.tabBadge, isActive && styles.tabBadgeActive]}>
                    <Text style={[styles.tabBadgeText, isActive && styles.tabBadgeTextActive]}>
                      {pendingMissions}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Usage Access & Consent Modal */}
        <UsagePermissionModal
          visible={permissionModalOpen}
          consentStatus={appState.consentStatus}
          permissionGranted={Boolean(usageSummary?.permissionGranted)}
          instagramInstalled={Boolean(usageSummary?.instagramInstalled)}
          onAcceptAndOpenSettings={handleAcceptAndOpenSettings}
          onAcceptWithoutSettings={handleAcceptWithoutSettings}
          onDeclineOrLater={handleDeclineOrLater}
          onClose={() => setPermissionModalOpen(false)}
        />

        {/* Break Modal */}
        <BreakModal
          visible={breakOpen}
          completedBreaksCount={appState.completedFocusBreaks}
          onClose={() => setBreakOpen(false)}
          onCompleteBreak={handleCompleteFocusBreak}
        />

        {/* Celebration Overlay */}
        {celebration && (
          <CelebrationOverlay
            celebration={celebration}
            onClose={() => setCelebration(null)}
          />
        )}

        {/* Notification Center Modal */}
        <NotificationCenterModal
          visible={notificationCenterOpen}
          items={notificationInbox.items}
          highlightedUnreadIds={highlightedUnreadIds}
          notificationStatus={notificationStatus}
          cloudAuthStatus={cloudAuthStatus}
          cloudNotifications={cloudNotifications}
          highlightedCloudUnreadIds={highlightedCloudUnreadIds}
          pendingInvitesById={buildPendingInviteMap(cloudPendingInvites)}
          inviteActionBusy={inviteActionBusy}
          onAcceptSquadInvite={(code) =>
            void handleAcceptSquadInviteFromNotif(code)
          }
          onDeclineSquadInvite={(id) =>
            void handleDeclineSquadInviteFromNotif(id)
          }
          onClearAll={() => {
            void clearNativeNotificationHistory().then((emptyInbox) => {
              setNotificationInbox(emptyInbox);
              setHighlightedUnreadIds([]);
            });
            setToast('Notification history cleared.');
          }}
          onOpenSettings={() => setActiveView('Settings')}
          onClose={() => setNotificationCenterOpen(false)}
        />

        {/* Toast */}
        {toast !== '' && (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.toast,
              {
                opacity: toastOpacity,
                transform: [{ translateY: toastTranslateY }],
              },
            ]}
          >
            <Feather name="zap" size={14} color={COLORS.white} />
            <Text style={styles.toastText}>{toast}</Text>
          </Animated.View>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.cream,
  },

  // Top Bar
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 12,
    backgroundColor: 'rgba(255,251,241,0.95)',
    borderBottomWidth: 1,
    borderBottomColor: '#eee2d4',
  },
  brandLockup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  brandMark: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: COLORS.pink,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: COLORS.purple,
    shadowOpacity: 0.4,
    shadowOffset: { width: 3, height: 3 },
    elevation: 3,
    transform: [{ rotate: '-4deg' }],
  },
  brandName: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.ink,
    letterSpacing: -1,
  },
  brandCaption: {
    fontSize: 9,
    fontWeight: '700',
    color: COLORS.pink,
    marginTop: 1,
  },
  topActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: COLORS.white,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#553074',
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
    position: 'relative',
  },
  notifBadge: {
    position: 'absolute',
    top: -4,
    right: -5,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    backgroundColor: '#ef4444',
    borderWidth: 1.5,
    borderColor: COLORS.cream,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  notifBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: COLORS.white,
    includeFontPadding: false,
  },
  xpPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 7,
    paddingHorizontal: 11,
    borderRadius: 30,
    backgroundColor: COLORS.palePink,
    borderWidth: 1,
    borderColor: '#f4c0d8',
  },
  xpText: {
    fontSize: 11,
    color: COLORS.pink,
  },
  xpBold: {
    fontWeight: '800',
  },

  // Screen container
  screenContainer: {
    flex: 1,
  },

  // Bottom Tab Bar
  tabBar: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,251,241,0.97)',
    borderTopWidth: 1,
    borderTopColor: '#eee2d4',
    paddingBottom: Platform.OS === 'ios' ? 20 : 8,
    paddingTop: 6,
    paddingHorizontal: 2,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
    position: 'relative',
  },
  tabIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabIconWrapActive: {
    backgroundColor: COLORS.purple,
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#8d7e9c',
    marginTop: 2,
  },
  tabLabelActive: {
    color: COLORS.purple,
  },
  tabBadge: {
    position: 'absolute',
    top: 2,
    right: 10,
    minWidth: 15,
    height: 15,
    borderRadius: 8,
    backgroundColor: '#f1e4f3',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 3,
  },
  tabBadgeActive: {
    backgroundColor: COLORS.yellow,
  },
  tabBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: COLORS.purple,
  },
  tabBadgeTextActive: {
    color: COLORS.purple,
  },

  // Toast
  toast: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 98 : 88,
    left: 20,
    right: 20,
    backgroundColor: COLORS.ink,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    shadowColor: '#241434',
    shadowOpacity: 0.25,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  toastText: {
    flex: 1,
    color: COLORS.white,
    fontSize: 12,
    fontWeight: '600',
  },
});
