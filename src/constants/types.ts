export type View = 'Today' | 'Missions' | 'Badges' | 'Leaderboard' | 'Card' | 'Settings';

export type MissionId =
  | 'touch-grass'
  | 'set-scroll-limit'
  | 'brain-check-in'
  | 'stay-under-target';

export type Mission = {
  id: MissionId;
  title: string;
  detail: string;
  reward: number;
  iconName: string;
  iconColor: string;
  iconBg: string;
  done: boolean;
  usageLinked?: boolean;
  autoVerified?: boolean;
  progressLabel?: string;
  statusHint?: string;
};

export type BadgeId =
  | 'first-flight'
  | 'limit-setter'
  | 'grass-toucher'
  | 'brain-check'
  | 'soft-launcher'
  | 'offline-icon';

export type Badge = {
  id: BadgeId;
  name: string;
  description: string;
  requirement: string;
  iconName: string;
  color: string;
  unlocked: boolean;
  unlockedAt?: string;
};

export type Celebration = {
  title: string;
  detail: string;
  reward: string;
  iconName: string;
  kind: 'mission' | 'badge' | 'chest';
};

export type DailyChest = {
  claimed: boolean;
  item: string;
};

export type LeaderboardTab = 'Friends' | 'Squad' | 'Campus';

export type Ranking = {
  name: string;
  handle: string;
  initials: string;
  xp: number;
  change: string;
  current?: boolean;
};

export type ConsentStatus = 'pending' | 'accepted' | 'declined';

export type UsageDataStatus =
  | 'ok'
  | 'zero_usage'
  | 'permission_required'
  | 'tracking_paused'
  | 'not_installed'
  | 'no_os_record'
  | 'query_failed'
  | 'stale'
  | 'incomplete'
  | 'unavailable'
  | 'tracking_disabled';

export type DailyUsagePoint = {
  date: string;
  dayLabel: string;
  foregroundMs: number;
  sessionCount: number;
  hasOsCoverage: boolean;
  source: 'usage_events' | 'daily_aggregate' | 'zero_or_empty';
};

export type InstagramUsageSummary = {
  status: UsageDataStatus;
  statusReason: string;
  permissionGranted: boolean;
  instagramInstalled: boolean;
  todayForegroundMs: number | null;
  todaySessionCount?: number;
  queriedAtMs: number;
  dailyBreakdown: DailyUsagePoint[];
  aggregationSource?: string;
  isComplete?: boolean | 'unknown';
  errorCode?: string;
  deviceName?: string;
  manufacturer?: string;
  model?: string;
  sdkInt?: number;
};

export type UsageQueryResult = {
  status: UsageDataStatus;
  estimatedMinutes: number | null;
  lastUpdatedAt: number | null;
  source: string;
  isComplete: boolean | 'unknown';
  errorCode?: string;
};

export type UserProfile = {
  customDisplayName: string | null;
  deviceDefaultName: string | null;
};

export type UserSettings = {
  dailyGentleNudge: boolean;
  privateMode: boolean;
  weekendBreathingRoom: boolean;
  missionReminders: boolean;
  streakReminders: boolean;
  achievementNotifications?: boolean;
  eveningReminderHour?: number;
  eveningReminderMinute?: number;
  streakReminderHour?: number;
  streakReminderMinute?: number;
  quietHoursEnabled?: boolean;
  quietStartHour?: number;
  quietEndHour?: number;
};

export type CardType = 'archetype' | 'weekly';
export type CardExportFormat = 'feed' | 'story';

export type NotificationStatusSnapshot = {
  runtimePermissionGranted: boolean;
  appNotificationsEnabled: boolean;
  nudgesChannelEnabled: boolean;
  remindersChannelEnabled: boolean;
  squadsChannelEnabled?: boolean;
  ignoringBatteryOptimizations?: boolean;
  deviceManufacturer?: string;
  statusCode: 'allowed' | 'permission_required' | 'notifications_off' | 'channel_disabled';
  quietHoursActiveNow: boolean;
  sentKeysToday: string[];
};

export type NotificationInboxItem = {
  id: string;
  notificationId: number;
  channelId: string;
  title: string;
  body: string;
  createdAtMs: number;
  dateKey: string;
  read: boolean;
};

export type NotificationInboxSnapshot = {
  unreadCount: number;
  items: NotificationInboxItem[];
};

export type PlayerLevelInfo = {
  level: number;
  title: string;
  currentLevelFloorXp: number;
  nextLevelXp: number;
  progressPercent: number;
};

export type WeeklyAchievementSummary = {
  weekKey: string;
  weekLabel: string;
  hasAnyProgress: boolean;
  weeklyXpEarned: number;
  missionsCompletedThisWeek: number;
  weeklyQuestsCompleted: number;
  weeklyQuestsTotal: number;
  currentStreak: number;
  unlockedBadgeNames: string[];
  unlockedBadgesCount: number;
  totalBadgesCount: number;
  headline: string;
  tagline: string;
  heroMetricLabel: string;
  heroMetricValue: string;
};

export type StreakDayStatus = 'completed' | 'grace_used' | 'missed' | 'pending';

export type StreakState = {
  currentStreak: number;
  longestStreak: number;
  lastEvaluatedDate: string | null;
  graceDaysRemaining: number;
  maxGraceDaysPerWeek: number;
  graceWeekKey: string;
  historyByDate: Record<string, StreakDayStatus>;
  recoveryNeeded: boolean;
  previousStreakBeforeBreak: number;
  recoveredThisWeek: boolean;
};

export type WeeklyQuestId =
  | 'balanced-week'
  | 'focus-master'
  | 'under-target-week';

export type WeeklyQuest = {
  id: WeeklyQuestId;
  title: string;
  detail: string;
  target: number;
  progress: number;
  rewardXp: number;
  completed: boolean;
  claimed: boolean;
  iconName: string;
};

export type WeeklyQuestState = {
  weekKey: string;
  quests: WeeklyQuest[];
};

export type MoodId = 'balanced' | 'curious' | 'cooked' | 'offline_reset';

export type MoodOption = {
  id: MoodId;
  emoji: string;
  label: string;
  shortLabel: string;
};

export type MoodLogEntry = {
  dateKey: string;
  moodId: MoodId;
  emoji: string;
  label: string;
  note: string;
  loggedAt: string;
};

export type BrainrotBreakdown = {
  baseScore: number;
  usageRatioPercent: number | null;
  missionBonus: number;
  focusBreakBonus: number;
  finalScore: number | null;
  summaryText: string;
};

export type XpLedgerCategory =
  | 'baseline'
  | 'mission'
  | 'chest'
  | 'focus_break'
  | 'weekly_quest'
  | 'streak';

export type XpLedgerEntry = {
  id: string;
  eventKey: string;
  title: string;
  amount: number;
  category: XpLedgerCategory;
  dateKey: string;
  timestamp: string;
};

export type PendingLocalNotification = {
  id: number;
  key: string;
  title: string;
  body: string;
  category: 'limit_80' | 'limit_100' | 'mission_reminder' | 'streak_reminder' | 'achievement';
};

export type UserDataExportPayload = {
  format: 'rot-user-data-export-v1';
  exportedAt: string;
  schemaVersion: number;
  profile: {
    effectiveDisplayName: string;
    source: 'custom' | 'device' | 'fallback';
    customDisplayName: string | null;
    deviceDefaultName: string | null;
  };
  settings: UserSettings;
  dailyLimitMinutes: number;
  streak: StreakState;
  xpSummary: {
    totalXp: number;
    baseXp: number;
    earnedXp: number;
    ledgerConsistent: boolean;
    ledger: XpLedgerEntry[];
  };
  missionsByDate: Record<string, Record<string, boolean>>;
  weeklyQuestsByWeek: Record<string, WeeklyQuestState>;
  moodLogsByDate: Record<string, MoodLogEntry>;
  usageSummary: {
    consentStatus: ConsentStatus;
    trackingEnabled: boolean;
    cachedUsageSummary: InstagramUsageSummary | null;
  };
};

export type PersistedAppState = {
  schemaVersion: number;
  consentStatus: ConsentStatus;
  consentUpdatedAt: string | null;
  trackingEnabled: boolean;
  dailyLimitMinutes: number;
  profile: UserProfile;
  settings: UserSettings;
  baseXp: number;
  claimedXpEvents: Record<string, number>;
  missionsByDate: Record<string, Record<string, boolean>>;
  dailyChestByDate: Record<string, DailyChest>;
  unlockedBadges: Record<string, string>;
  completedFocusBreaks: number;
  lastFocusBreakAt: string | null;
  cachedUsageSummary: InstagramUsageSummary | null;
  streak: StreakState;
  weeklyQuestsByWeek: Record<string, WeeklyQuestState>;
  moodLogsByDate: Record<string, MoodLogEntry>;
  xpLedger: XpLedgerEntry[];
  sentNotificationsByDate: Record<string, string[]>;
  selectedCardType?: CardType;
  selectedCardFormat?: CardExportFormat;
};
