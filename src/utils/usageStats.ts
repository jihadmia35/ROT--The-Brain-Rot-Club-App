import {
  DeviceEventEmitter,
  NativeModules,
  PermissionsAndroid,
  Platform,
} from 'react-native';
import {
  InstagramUsageSummary,
  NotificationInboxSnapshot,
  NotificationStatusSnapshot,
} from '../constants/types';

export type DeviceProfileInfo = {
  deviceName: string;
  manufacturer: string;
  model: string;
  sdkInt: number;
};

export type NotificationSyncPayload = {
  dailyGentleNudge: boolean;
  missionReminders: boolean;
  streakReminders: boolean;
  weekendBreathingRoom: boolean;
  consentAccepted: boolean;
  trackingEnabled: boolean;
  dailyLimitMinutes: number;
  eveningReminderHour: number;
  eveningReminderMinute: number;
  streakReminderHour: number;
  streakReminderMinute: number;
  quietHoursEnabled: boolean;
  quietStartHour: number;
  quietEndHour: number;
  currentStreak: number;
  syncedDateKey: string;
  anyNonLimitMissionDoneToday: boolean;
  streakActiveToday: boolean;
  sentKeysToday: string[];
};

export type PreparedCardPngResult = {
  filePath: string;
  filename: string;
  width: number;
  height: number;
  byteSize: number;
};

export type GallerySaveResult = {
  status: 'saved' | 'already_saved';
  contentUri: string;
  filename: string;
  album: string;
};

export type NativeShareResult = {
  status: 'shared' | 'closed' | 'opened' | 'no_app' | 'superseded';
  contentUri?: string;
};

type RotUsageStatsNativeModule = {
  hasUsageAccess(): Promise<boolean>;
  isInstagramInstalled(): Promise<boolean>;
  openUsageAccessSettings(): Promise<boolean>;
  getDeviceProfileInfo(): Promise<DeviceProfileInfo>;
  getInstagramUsageSummary(daysBack: number): Promise<InstagramUsageSummary>;
  areNotificationsEnabled?(): Promise<boolean>;
  getNotificationStatus?(): Promise<NotificationStatusSnapshot>;
  openNotificationSettings?(channelId: string | null): Promise<boolean>;
  openBatteryOptimizationSettings?(): Promise<boolean>;
  syncNotificationConfig?(config: NotificationSyncPayload): Promise<boolean>;
  triggerBackgroundUsageCheckNow?(): Promise<boolean>;
  postLocalNotification?(
    notificationId: number,
    title: string,
    body: string
  ): Promise<boolean>;
  postCloudMirrorNotification?(
    dedupKey: string,
    title: string,
    body: string,
    targetRoute: string | null
  ): Promise<boolean>;
  getInitialNotificationRoute?(): Promise<string | null>;
  getNotificationInbox?(): Promise<NotificationInboxSnapshot>;
  markAllNotificationsRead?(): Promise<NotificationInboxSnapshot>;
  clearNotificationHistory?(): Promise<NotificationInboxSnapshot>;
};

type RotCardMediaNativeModule = {
  prepareAndVerifyCardPng(
    sourceUri: string,
    targetWidth: number,
    targetHeight: number,
    filename: string
  ): Promise<PreparedCardPngResult>;
  saveCardToGallery(
    filePath: string,
    filename: string,
    dedupKey: string
  ): Promise<GallerySaveResult>;
  shareCardPng(
    filePath: string,
    filename: string,
    shareText: string,
    includeMetadata: boolean
  ): Promise<NativeShareResult>;
};

const NativeRotUsageStats: RotUsageStatsNativeModule | undefined =
  Platform.OS === 'android' ? NativeModules.RotUsageStats : undefined;

const NativeRotCardMedia: RotCardMediaNativeModule | undefined =
  Platform.OS === 'android' ? NativeModules.RotCardMedia : undefined;

const QUERY_TIMEOUT_MS = 6000;

export async function checkHasUsageAccess(): Promise<boolean> {
  if (!NativeRotUsageStats) return false;
  try {
    return await NativeRotUsageStats.hasUsageAccess();
  } catch {
    return false;
  }
}

export async function checkIsInstagramInstalled(): Promise<boolean> {
  if (!NativeRotUsageStats) return false;
  try {
    return await NativeRotUsageStats.isInstagramInstalled();
  } catch {
    return false;
  }
}

export async function openAndroidUsageAccessSettings(): Promise<boolean> {
  if (!NativeRotUsageStats) return false;
  try {
    return await NativeRotUsageStats.openUsageAccessSettings();
  } catch {
    return false;
  }
}

export async function fetchNotificationStatus(): Promise<NotificationStatusSnapshot> {
  if (Platform.OS !== 'android' || !NativeRotUsageStats?.getNotificationStatus) {
    return {
      runtimePermissionGranted: false,
      appNotificationsEnabled: false,
      nudgesChannelEnabled: false,
      remindersChannelEnabled: false,
      squadsChannelEnabled: false,
      ignoringBatteryOptimizations: false,
      statusCode: 'notifications_off',
      quietHoursActiveNow: false,
      sentKeysToday: [],
    };
  }
  try {
    return await NativeRotUsageStats.getNotificationStatus();
  } catch {
    return {
      runtimePermissionGranted: false,
      appNotificationsEnabled: false,
      nudgesChannelEnabled: false,
      remindersChannelEnabled: false,
      squadsChannelEnabled: false,
      ignoringBatteryOptimizations: false,
      statusCode: 'notifications_off',
      quietHoursActiveNow: false,
      sentKeysToday: [],
    };
  }
}

export async function openAndroidNotificationSettings(
  channelId: string | null = null
): Promise<boolean> {
  if (Platform.OS !== 'android' || !NativeRotUsageStats?.openNotificationSettings) {
    return false;
  }
  try {
    return await NativeRotUsageStats.openNotificationSettings(channelId);
  } catch {
    return false;
  }
}

export async function openAndroidBatteryOptimizationSettings(): Promise<boolean> {
  if (
    Platform.OS !== 'android' ||
    !NativeRotUsageStats?.openBatteryOptimizationSettings
  ) {
    return false;
  }
  try {
    return await NativeRotUsageStats.openBatteryOptimizationSettings();
  } catch {
    return false;
  }
}

export async function syncNativeNotificationConfig(
  payload: NotificationSyncPayload
): Promise<boolean> {
  if (Platform.OS !== 'android' || !NativeRotUsageStats?.syncNotificationConfig) {
    return false;
  }
  try {
    return await NativeRotUsageStats.syncNotificationConfig(payload);
  } catch {
    return false;
  }
}

export async function triggerNativeBackgroundUsageCheck(): Promise<boolean> {
  if (
    Platform.OS !== 'android' ||
    !NativeRotUsageStats?.triggerBackgroundUsageCheckNow
  ) {
    return false;
  }
  try {
    return await NativeRotUsageStats.triggerBackgroundUsageCheckNow();
  } catch {
    return false;
  }
}

export async function checkAndRequestNotificationPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  try {
    if (typeof Platform.Version === 'number' && Platform.Version >= 33) {
      const permission = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
      if (permission) {
        const alreadyGranted = await PermissionsAndroid.check(permission);
        if (!alreadyGranted) {
          const status = await PermissionsAndroid.request(permission);
          if (status !== PermissionsAndroid.RESULTS.GRANTED) {
            return false;
          }
        }
      }
    }
    if (NativeRotUsageStats?.areNotificationsEnabled) {
      return await NativeRotUsageStats.areNotificationsEnabled();
    }
    return true;
  } catch {
    return false;
  }
}

export async function hasNotificationPermissionSilent(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  try {
    if (typeof Platform.Version === 'number' && Platform.Version >= 33) {
      const permission = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
      if (permission) {
        const granted = await PermissionsAndroid.check(permission);
        if (!granted) return false;
      }
    }
    if (NativeRotUsageStats?.areNotificationsEnabled) {
      return await NativeRotUsageStats.areNotificationsEnabled();
    }
    return true;
  } catch {
    return false;
  }
}

export async function sendLocalNotification(
  notificationId: number,
  title: string,
  body: string
): Promise<boolean> {
  if (Platform.OS !== 'android' || !NativeRotUsageStats?.postLocalNotification) {
    return false;
  }
  try {
    return await NativeRotUsageStats.postLocalNotification(
      notificationId,
      title,
      body
    );
  } catch {
    return false;
  }
}

export async function postCloudMirrorOsNotification(
  dedupKey: string,
  title: string,
  body: string,
  targetRoute: string | null = null
): Promise<boolean> {
  if (
    Platform.OS !== 'android' ||
    !NativeRotUsageStats?.postCloudMirrorNotification
  ) {
    return false;
  }
  try {
    return await NativeRotUsageStats.postCloudMirrorNotification(
      dedupKey,
      title,
      body,
      targetRoute
    );
  } catch {
    return false;
  }
}

export async function getInitialNotificationRoute(): Promise<string | null> {
  if (
    Platform.OS !== 'android' ||
    !NativeRotUsageStats?.getInitialNotificationRoute
  ) {
    return null;
  }
  try {
    return await NativeRotUsageStats.getInitialNotificationRoute();
  } catch {
    return null;
  }
}

export function subscribeToNotificationOpens(
  listener: (route: string) => void
): () => void {
  if (Platform.OS !== 'android') {
    return () => {};
  }
  const sub = DeviceEventEmitter.addListener(
    'RotNotificationOpened',
    (route: unknown) => {
      if (typeof route === 'string' && route.trim().length > 0) {
        listener(route);
      }
    }
  );
  return () => sub.remove();
}

export async function fetchNotificationInbox(): Promise<NotificationInboxSnapshot> {
  if (Platform.OS !== 'android' || !NativeRotUsageStats?.getNotificationInbox) {
    return { unreadCount: 0, items: [] };
  }
  try {
    const res = await NativeRotUsageStats.getNotificationInbox();
    return {
      unreadCount: typeof res?.unreadCount === 'number' ? res.unreadCount : 0,
      items: Array.isArray(res?.items) ? res.items : [],
    };
  } catch {
    return { unreadCount: 0, items: [] };
  }
}

export async function markAllNativeNotificationsRead(): Promise<NotificationInboxSnapshot> {
  if (Platform.OS !== 'android' || !NativeRotUsageStats?.markAllNotificationsRead) {
    return { unreadCount: 0, items: [] };
  }
  try {
    const res = await NativeRotUsageStats.markAllNotificationsRead();
    return {
      unreadCount: typeof res?.unreadCount === 'number' ? res.unreadCount : 0,
      items: Array.isArray(res?.items) ? res.items : [],
    };
  } catch {
    return { unreadCount: 0, items: [] };
  }
}

export async function clearNativeNotificationHistory(): Promise<NotificationInboxSnapshot> {
  if (Platform.OS !== 'android' || !NativeRotUsageStats?.clearNotificationHistory) {
    return { unreadCount: 0, items: [] };
  }
  try {
    const res = await NativeRotUsageStats.clearNotificationHistory();
    return {
      unreadCount: typeof res?.unreadCount === 'number' ? res.unreadCount : 0,
      items: Array.isArray(res?.items) ? res.items : [],
    };
  } catch {
    return { unreadCount: 0, items: [] };
  }
}

export function subscribeToNativeNotificationUpdates(
  listener: () => void
): () => void {
  if (Platform.OS !== 'android') {
    return () => {};
  }
  const sub = DeviceEventEmitter.addListener('RotNotificationsUpdated', listener);
  return () => sub.remove();
}

export async function prepareAndVerifyCardPng(
  sourceUri: string,
  targetWidth: number,
  targetHeight: number,
  filename: string
): Promise<PreparedCardPngResult> {
  if (Platform.OS !== 'android' || !NativeRotCardMedia) {
    throw new Error('Native card media module is unavailable on this platform.');
  }
  return await NativeRotCardMedia.prepareAndVerifyCardPng(
    sourceUri,
    targetWidth,
    targetHeight,
    filename
  );
}

export async function saveCardPngToGallery(
  filePath: string,
  filename: string,
  dedupKey: string
): Promise<GallerySaveResult> {
  if (Platform.OS !== 'android' || !NativeRotCardMedia) {
    throw new Error('Native card media module is unavailable on this platform.');
  }
  if (typeof Platform.Version === 'number' && Platform.Version < 29) {
    const perm = PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE;
    if (perm) {
      const granted = await PermissionsAndroid.check(perm);
      if (!granted) {
        const res = await PermissionsAndroid.request(perm);
        if (res !== PermissionsAndroid.RESULTS.GRANTED) {
          const err = new Error('Storage permission denied');
          (err as any).code = 'STORAGE_PERMISSION_DENIED';
          throw err;
        }
      }
    }
  }
  return await NativeRotCardMedia.saveCardToGallery(filePath, filename, dedupKey);
}

export async function shareCardPngNative(
  filePath: string,
  filename: string,
  shareText: string,
  includeMetadata: boolean
): Promise<NativeShareResult> {
  if (Platform.OS !== 'android' || !NativeRotCardMedia) {
    throw new Error('Native card media module is unavailable on this platform.');
  }
  return await NativeRotCardMedia.shareCardPng(
    filePath,
    filename,
    shareText,
    includeMetadata
  );
}

export async function queryDeviceProfileInfo(): Promise<DeviceProfileInfo> {
  if (Platform.OS !== 'android' || !NativeRotUsageStats?.getDeviceProfileInfo) {
    return {
      deviceName: 'ROT User',
      manufacturer: 'unknown',
      model: 'unknown',
      sdkInt: 0,
    };
  }
  try {
    const raw = await NativeRotUsageStats.getDeviceProfileInfo();
    return {
      deviceName:
        typeof raw?.deviceName === 'string' && raw.deviceName.trim().length > 0
          ? raw.deviceName.trim()
          : 'ROT User',
      manufacturer: raw?.manufacturer ?? 'unknown',
      model: raw?.model ?? 'unknown',
      sdkInt: typeof raw?.sdkInt === 'number' ? raw.sdkInt : 0,
    };
  } catch {
    return {
      deviceName: 'ROT User',
      manufacturer: 'unknown',
      model: 'unknown',
      sdkInt: 0,
    };
  }
}

export async function queryInstagramUsageSummary(
  daysBack = 7
): Promise<InstagramUsageSummary> {
  const now = Date.now();
  if (Platform.OS !== 'android' || !NativeRotUsageStats) {
    return {
      status: 'query_failed',
      statusReason:
        "We couldn't retrieve your usage data. Your previous saved data hasn't been deleted.",
      permissionGranted: false,
      instagramInstalled: false,
      todayForegroundMs: null,
      queriedAtMs: now,
      dailyBreakdown: [],
      isComplete: false,
      errorCode: 'NATIVE_MODULE_UNAVAILABLE',
    };
  }

  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        const err = new Error('UsageStats query timed out');
        (err as any).code = 'QUERY_TIMEOUT';
        reject(err);
      }, QUERY_TIMEOUT_MS);
    });

    const raw = await Promise.race([
      NativeRotUsageStats.getInstagramUsageSummary(daysBack),
      timeoutPromise,
    ]);

    return {
      status: raw.status ?? 'query_failed',
      statusReason: raw.statusReason ?? '',
      permissionGranted: Boolean(raw.permissionGranted),
      instagramInstalled: Boolean(raw.instagramInstalled),
      todayForegroundMs:
        typeof raw.todayForegroundMs === 'number' ? raw.todayForegroundMs : null,
      todaySessionCount: raw.todaySessionCount ?? 0,
      queriedAtMs: typeof raw.queriedAtMs === 'number' ? raw.queriedAtMs : now,
      dailyBreakdown: Array.isArray(raw.dailyBreakdown) ? raw.dailyBreakdown : [],
      aggregationSource: raw.aggregationSource,
      isComplete:
        typeof raw.isComplete === 'boolean' ? raw.isComplete : 'unknown',
      errorCode: raw.errorCode,
      deviceName: raw.deviceName,
      manufacturer: raw.manufacturer,
      model: raw.model,
      sdkInt: raw.sdkInt,
    };
  } catch (err: any) {
    return {
      status: 'query_failed',
      statusReason:
        "We couldn't retrieve your usage data. Your previous saved data hasn't been deleted.",
      permissionGranted: true,
      instagramInstalled: true,
      todayForegroundMs: null,
      queriedAtMs: now,
      dailyBreakdown: [],
      isComplete: false,
      errorCode: err?.code || 'USAGE_QUERY_ERROR',
    };
  }
}
