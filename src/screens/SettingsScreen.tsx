import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { COLORS, RADIUS } from '../constants/theme';
import { DAILY_LIMIT_OPTIONS } from '../constants/data';
import {
  ConsentStatus,
  InstagramUsageSummary,
  NotificationStatusSnapshot,
  UserSettings,
} from '../constants/types';
import {
  DAILY_LIMIT_STEP_MINUTES,
  formatMinutesAsHoursAndMinutes,
  MAX_DAILY_LIMIT_MINUTES,
  MAX_DISPLAY_NAME_LENGTH,
  MIN_DAILY_LIMIT_MINUTES,
  parseCustomDailyLimitInput,
  stepDailyLimitMinutes,
  UsageDisplayState,
} from '../utils/domainLogic';
import { CloudAccountIdentity, CloudAuthStatus } from '../utils/authHelpers';
import Icon from '../components/Icon';

type Props = {
  displayName: string;
  customDisplayName: string | null;
  deviceDefaultName: string | null;
  onSaveDisplayName: (rawName: string | null, alsoSyncToCloud?: boolean) => void;
  consentStatus: ConsentStatus;
  trackingEnabled: boolean;
  dailyLimitMinutes: number;
  settings: UserSettings;
  usageSummary: InstagramUsageSummary | null;
  usageDisplay: UsageDisplayState;
  notificationStatus: NotificationStatusSnapshot;
  testNotificationFeedback: string | null;
  onToggleTracking: (nextEnabled: boolean) => void;
  onOpenUsageSetup: () => void;
  onOpenSystemUsageSettings: () => void;
  onOpenNotificationSettings: (channelId?: string | null) => void;
  onRefreshNotificationStatus: () => void;
  onChangeDailyLimit: (minutes: number) => void;
  onToggleSetting: (key: keyof UserSettings) => void;
  onUpdateSettingsPatch: (patch: Partial<UserSettings>) => void;
  onClearLocalHistory: () => void;
  onRefreshUsage: () => void;
  onExportUserData: () => void;
  exportJsonPreview: string;
  onSendTestNotification: () => void;
  cloudAuthStatus: CloudAuthStatus;
  cloudIdentity: CloudAccountIdentity | null;
  cloudProfile: {
    share_squad_status: boolean;
    status_band: string;
    timezone: string;
  } | null;
  cloudSyncBusy?: boolean;
  pendingCloudXpCount?: number;
  cloudNotifPrefs: {
    squad_invites_enabled: boolean;
    squad_activity_enabled: boolean;
  };
  authBusy: boolean;
  authError: string | null;
  onSignInWithGoogle: () => void;
  onSignOutCloud: () => void;
  onToggleShareSquadStatus: () => void;
  onToggleCloudNotifPref: (
    key: 'squad_invites_enabled' | 'squad_activity_enabled'
  ) => void;
  onSyncLocalNameToCloud: () => void;
  onFlushCloudXp?: () => void;
};

function SettingRow({
  iconName,
  title,
  detail,
  checked,
  onChange,
}: {
  iconName: string;
  title: string;
  detail: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <View style={styles.settingRow}>
      <View style={styles.settingIcon}>
        <Icon name={iconName} size={18} color={COLORS.purple} />
      </View>
      <View style={styles.settingCopy}>
        <Text style={styles.settingTitle}>{title}</Text>
        <Text style={styles.settingDetail}>{detail}</Text>
      </View>
      <TouchableOpacity
        style={[styles.toggle, checked && styles.toggleOn]}
        onPress={onChange}
        activeOpacity={0.7}
      >
        <View style={[styles.toggleKnob, checked && styles.toggleKnobOn]} />
      </TouchableOpacity>
    </View>
  );
}

export default function SettingsScreen({
  displayName,
  customDisplayName,
  deviceDefaultName,
  onSaveDisplayName,
  consentStatus,
  trackingEnabled,
  dailyLimitMinutes,
  settings,
  usageSummary,
  usageDisplay,
  notificationStatus,
  testNotificationFeedback,
  onToggleTracking,
  onOpenUsageSetup,
  onOpenSystemUsageSettings,
  onOpenNotificationSettings,
  onRefreshNotificationStatus,
  onChangeDailyLimit,
  onToggleSetting,
  onUpdateSettingsPatch,
  onClearLocalHistory,
  onRefreshUsage,
  onExportUserData,
  exportJsonPreview,
  onSendTestNotification,
  cloudAuthStatus,
  cloudIdentity,
  cloudProfile,
  cloudSyncBusy = false,
  pendingCloudXpCount = 0,
  cloudNotifPrefs,
  authBusy,
  authError,
  onSignInWithGoogle,
  onSignOutCloud,
  onToggleShareSquadStatus,
  onToggleCloudNotifPref,
  onSyncLocalNameToCloud,
  onFlushCloudXp,
}: Props) {
  const [confirmClear, setConfirmClear] = useState(false);
  const [draftName, setDraftName] = useState(customDisplayName ?? displayName);
  const [syncNameToCloud, setSyncNameToCloud] = useState(false);
  const [customLimitInput, setCustomLimitInput] = useState(
    String(dailyLimitMinutes)
  );
  const [customLimitError, setCustomLimitError] = useState<string | null>(null);
  const [showExportPreview, setShowExportPreview] = useState(false);
  const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const limitCardYRef = useRef(0);

  useEffect(() => {
    setDraftName(customDisplayName ?? displayName);
  }, [customDisplayName, displayName]);

  useEffect(() => {
    setCustomLimitInput(String(dailyLimitMinutes));
    setCustomLimitError(null);
  }, [dailyLimitMinutes]);

  const permissionGranted = Boolean(usageSummary?.permissionGranted);
  const instagramInstalled = Boolean(usageSummary?.instagramInstalled);
  const trackingActive =
    consentStatus === 'accepted' && trackingEnabled && permissionGranted;

  const notifBadgeLabel =
    notificationStatus.statusCode === 'allowed'
      ? 'Allowed'
      : notificationStatus.statusCode === 'permission_required'
      ? 'Permission Required'
      : notificationStatus.statusCode === 'channel_disabled'
      ? 'Channel Disabled'
      : 'Off';

  const notifBadgeHealthy = notificationStatus.statusCode === 'allowed';

  const formatHour = (h: number) => {
    const safe = ((h % 24) + 24) % 24;
    const suffix = safe >= 12 ? 'PM' : 'AM';
    const hour12 = safe % 12 === 0 ? 12 : safe % 12;
    return `${hour12}:00 ${suffix}`;
  };

  const eveningHour = settings.eveningReminderHour ?? 19;
  const streakHour = settings.streakReminderHour ?? 21;
  const quietEnabled = settings.quietHoursEnabled !== false;
  const quietStart = settings.quietStartHour ?? 22;
  const quietEnd = settings.quietEndHour ?? 8;

  function handleApplyCustomLimit() {
    const parsed = parseCustomDailyLimitInput(customLimitInput);
    if (!parsed.valid || parsed.minutes === null) {
      setCustomLimitError(parsed.error);
      return;
    }
    setCustomLimitError(null);
    onChangeDailyLimit(parsed.minutes);
  }

  return (
    <KeyboardAvoidingView
      style={styles.scroll}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'android' ? 80 : 0}
    >
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: 60 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
      {/* Header */}
      <Text style={styles.eyebrow}>CONTROL CENTER</Text>
      <Text style={styles.heading}>
        Your rules, your reset<Text style={styles.dot}>.</Text>
      </Text>
      <Text style={styles.subtitle}>
        ROT works around your life. Never the other way around.
      </Text>

      {/* ROT Club Cloud Account (Google Sign-In) */}
      <Text style={styles.sectionEyebrow}>ROT CLUB ACCOUNT</Text>
      <View style={styles.profileCard}>
        <View style={styles.limitHeader}>
          <View style={styles.settingIcon}>
            <Icon name="users" size={18} color={COLORS.purple} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.settingTitle}>
              {cloudAuthStatus === 'authenticated' && cloudIdentity
                ? cloudIdentity.displayName
                : cloudAuthStatus === 'unconfigured'
                ? 'Guest Mode (Cloud not configured)'
                : cloudAuthStatus === 'loading'
                ? 'Checking Club session...'
                : 'Guest Mode (Local only)'}
            </Text>
            <Text style={styles.settingDetail}>
              {cloudAuthStatus === 'authenticated' && cloudIdentity
                ? `${cloudIdentity.emailLabel} · Cloud XP: ${cloudIdentity.cloudXp} XP`
                : cloudAuthStatus === 'unconfigured'
                ? 'Add EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY, and EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID to enable Google Sign-In.'
                : 'Sign in with Google to connect your encrypted Club session. Local guest XP stays separate on this device.'}
            </Text>
            {cloudAuthStatus === 'authenticated' && cloudIdentity ? (
              <Text style={styles.cloudMetaSmall} selectable>
                Member ID: {cloudIdentity.userId}
              </Text>
            ) : null}
          </View>
        </View>

        <View style={styles.statusBadgesRow}>
          <View style={styles.statusBadge}>
            <View
              style={[
                styles.statusDot,
                {
                  backgroundColor:
                    cloudAuthStatus === 'authenticated'
                      ? COLORS.green
                      : cloudAuthStatus === 'unconfigured'
                      ? COLORS.orange
                      : COLORS.purple,
                },
              ]}
            />
            <Text style={styles.statusBadgeText}>
              {cloudAuthStatus === 'authenticated'
                ? 'Signed in via Google'
                : cloudAuthStatus === 'unconfigured'
                ? 'Env config required'
                : cloudAuthStatus === 'loading'
                ? 'Restoring session'
                : 'Guest Mode'}
            </Text>
          </View>
          {cloudAuthStatus === 'authenticated' && cloudIdentity ? (
            <View style={styles.statusBadge}>
              <Text style={styles.statusBadgeText}>
                Cloud XP: {cloudIdentity.cloudXp}
              </Text>
            </View>
          ) : null}
          {cloudAuthStatus === 'authenticated' && pendingCloudXpCount > 0 ? (
            <View style={styles.statusBadge}>
              <View
                style={[styles.statusDot, { backgroundColor: COLORS.orange }]}
              />
              <Text style={styles.statusBadgeText}>
                Queued XP sync: {pendingCloudXpCount}
              </Text>
            </View>
          ) : null}
        </View>

        {authError ? (
          <View style={styles.feedbackBanner}>
            <Icon name="alert-circle" size={14} color={COLORS.pink} />
            <Text style={styles.feedbackBannerText}>{authError}</Text>
          </View>
        ) : null}

        {cloudAuthStatus === 'authenticated' && cloudIdentity ? (
          <>
            <View style={styles.cloudPrivacyBox}>
              <View style={styles.cloudPrivacyCopy}>
                <Text style={styles.settingTitle}>
                  Share daily target band with Squad
                </Text>
                <Text style={styles.settingDetail}>
                  Off by default. Shares only Under target, Over target, or Hidden — never your exact Instagram minutes.
                </Text>
                <Text style={styles.cloudMetaSmall}>
                  Current band:{' '}
                  {cloudProfile?.share_squad_status
                    ? cloudProfile.status_band.replace('_', ' ')
                    : 'hidden'}{' '}
                  · Timezone: {cloudProfile?.timezone ?? 'UTC'}
                </Text>
              </View>
              <TouchableOpacity
                style={[
                  styles.toggle,
                  cloudProfile?.share_squad_status && styles.toggleOn,
                ]}
                onPress={onToggleShareSquadStatus}
                disabled={cloudSyncBusy}
                activeOpacity={0.7}
              >
                <View
                  style={[
                    styles.toggleKnob,
                    cloudProfile?.share_squad_status && styles.toggleKnobOn,
                  ]}
                />
              </TouchableOpacity>
            </View>

            <View style={styles.cloudPrivacyBox}>
              <View style={styles.cloudPrivacyCopy}>
                <Text style={styles.settingTitle}>Squad invite alerts</Text>
                <Text style={styles.settingDetail}>
                  Notify in ROT Notification Center when someone invites you to a Squad.
                </Text>
              </View>
              <TouchableOpacity
                style={[
                  styles.toggle,
                  cloudNotifPrefs.squad_invites_enabled && styles.toggleOn,
                ]}
                onPress={() => onToggleCloudNotifPref('squad_invites_enabled')}
                disabled={cloudSyncBusy}
                activeOpacity={0.7}
              >
                <View
                  style={[
                    styles.toggleKnob,
                    cloudNotifPrefs.squad_invites_enabled && styles.toggleKnobOn,
                  ]}
                />
              </TouchableOpacity>
            </View>

            <View style={styles.cloudPrivacyBox}>
              <View style={styles.cloudPrivacyCopy}>
                <Text style={styles.settingTitle}>Squad activity alerts</Text>
                <Text style={styles.settingDetail}>
                  Notify when members join, leave, or transfer squad ownership.
                </Text>
              </View>
              <TouchableOpacity
                style={[
                  styles.toggle,
                  cloudNotifPrefs.squad_activity_enabled && styles.toggleOn,
                ]}
                onPress={() => onToggleCloudNotifPref('squad_activity_enabled')}
                disabled={cloudSyncBusy}
                activeOpacity={0.7}
              >
                <View
                  style={[
                    styles.toggleKnob,
                    cloudNotifPrefs.squad_activity_enabled && styles.toggleKnobOn,
                  ]}
                />
              </TouchableOpacity>
            </View>

            {displayName !== cloudIdentity.displayName ? (
              <TouchableOpacity
                style={styles.actionBtnSecondary}
                onPress={onSyncLocalNameToCloud}
                disabled={cloudSyncBusy}
                activeOpacity={0.8}
              >
                <Icon name="arrow-up-right" size={13} color={COLORS.purple} />
                <Text style={styles.actionBtnSecondaryText}>
                  Use “{displayName}” as Cloud Squad name
                </Text>
              </TouchableOpacity>
            ) : null}

            {pendingCloudXpCount > 0 && onFlushCloudXp ? (
              <TouchableOpacity
                style={styles.actionBtnSecondary}
                onPress={onFlushCloudXp}
                disabled={cloudSyncBusy}
                activeOpacity={0.8}
              >
                <Icon name="refresh" size={13} color={COLORS.purple} />
                <Text style={styles.actionBtnSecondaryText}>
                  Retry pending Cloud XP sync ({pendingCloudXpCount})
                </Text>
              </TouchableOpacity>
            ) : null}

            <TouchableOpacity
              style={styles.actionBtnSecondary}
              onPress={onSignOutCloud}
              disabled={authBusy}
              activeOpacity={0.8}
            >
              <Icon name="x" size={13} color={COLORS.purple} />
              <Text style={styles.actionBtnSecondaryText}>
                {authBusy ? 'Signing out...' : 'Sign out of Cloud Account'}
              </Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity
            style={[
              styles.actionBtnPrimary,
              (authBusy || cloudAuthStatus === 'unconfigured') && {
                opacity: 0.6,
              },
            ]}
            onPress={onSignInWithGoogle}
            disabled={authBusy || cloudAuthStatus === 'unconfigured'}
            activeOpacity={0.8}
          >
            <Icon name="user" size={13} color={COLORS.white} />
            <Text style={styles.actionBtnPrimaryText}>
              {authBusy
                ? 'Signing in...'
                : cloudAuthStatus === 'unconfigured'
                ? 'Google Sign-In Unavailable'
                : 'Sign in with Google'}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Profile & Display Name Section */}
      <Text style={[styles.sectionEyebrow, { marginTop: 22 }]}>
        PROFILE & DISPLAY NAME
      </Text>
      <View style={styles.profileCard}>
        <View style={styles.limitHeader}>
          <View style={styles.settingIcon}>
            <Icon name="user" size={18} color={COLORS.purple} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.settingTitle}>Display name: {displayName}</Text>
            <Text style={styles.settingDetail}>
              {customDisplayName
                ? `Custom name active · Device fallback: ${deviceDefaultName || 'ROT User'}`
                : `Using Android device default (${deviceDefaultName || 'ROT User'})`}
            </Text>
          </View>
        </View>
        <View style={styles.nameInputRow}>
          <TextInput
            style={styles.nameInput}
            value={draftName}
            onChangeText={setDraftName}
            maxLength={MAX_DISPLAY_NAME_LENGTH}
            placeholder={deviceDefaultName || 'ROT User'}
            placeholderTextColor="#a395b2"
            autoCapitalize="words"
            returnKeyType="done"
            onSubmitEditing={() => onSaveDisplayName(draftName, syncNameToCloud)}
          />
          {draftName.length > 0 && (
            <TouchableOpacity
              style={styles.nameClearBtn}
              onPress={() => setDraftName('')}
              activeOpacity={0.75}
              accessibilityLabel="Clear display name input"
            >
              <Icon name="x" size={14} color={COLORS.muted} />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.nameSaveBtn}
            onPress={() => onSaveDisplayName(draftName, syncNameToCloud)}
            activeOpacity={0.8}
          >
            <Text style={styles.nameSaveBtnText}>Save</Text>
          </TouchableOpacity>
        </View>
        {cloudAuthStatus === 'authenticated' && cloudIdentity ? (
          <TouchableOpacity
            style={styles.cloudSyncChoiceRow}
            onPress={() => setSyncNameToCloud((prev) => !prev)}
            activeOpacity={0.75}
          >
            <View
              style={[
                styles.cloudSyncCheckbox,
                syncNameToCloud && styles.cloudSyncCheckboxActive,
              ]}
            >
              {syncNameToCloud ? (
                <Icon name="check" size={10} color={COLORS.white} />
              ) : null}
            </View>
            <Text style={styles.cloudSyncChoiceText}>
              Also update Cloud Squad name when saving (currently “{cloudIdentity.displayName}”)
            </Text>
          </TouchableOpacity>
        ) : null}
        {customDisplayName && (
          <TouchableOpacity
            style={styles.nameResetBtn}
            onPress={() => {
              setDraftName(deviceDefaultName || 'ROT User');
              onSaveDisplayName(null, syncNameToCloud);
            }}
            activeOpacity={0.8}
          >
            <Text style={styles.nameResetBtnText}>
              Revert to device name ({deviceDefaultName || 'ROT User'})
            </Text>
          </TouchableOpacity>
        )}
        <Text style={styles.profileHint}>
          Stored locally on this device by default. Cloud Squad sync only happens if you choose it.
        </Text>
      </View>

      {/* Usage Access & Consent Section */}
      <Text style={[styles.sectionEyebrow, { marginTop: 22 }]}>
        INSTAGRAM USAGE TRACKING
      </Text>
      <View style={styles.settingsList}>
        <SettingRow
          iconName="bar-chart"
          title="Enable Instagram foreground tracking"
          detail={
            consentStatus !== 'accepted'
              ? 'ROT needs Usage Access to estimate your Instagram screen time.'
              : !trackingEnabled
              ? 'Tracking is paused. Your previous saved progress is preserved.'
              : permissionGranted
              ? 'Active · Reading estimated foreground time via Android UsageStats'
              : 'ROT needs Usage Access to estimate your Instagram screen time.'
          }
          checked={consentStatus === 'accepted' && trackingEnabled}
          onChange={() => {
            if (consentStatus !== 'accepted') {
              onOpenUsageSetup();
            } else {
              onToggleTracking(!trackingEnabled);
            }
          }}
        />

        <View style={styles.permissionStatusBlock}>
          <View style={styles.statusBadgesRow}>
            <View style={styles.statusBadge}>
              <View
                style={[
                  styles.statusDot,
                  {
                    backgroundColor:
                      consentStatus === 'accepted' ? COLORS.green : COLORS.orange,
                  },
                ]}
              />
              <Text style={styles.statusBadgeText}>
                Consent: {consentStatus === 'accepted' ? 'Accepted' : 'Not granted'}
              </Text>
            </View>
            <View style={styles.statusBadge}>
              <View
                style={[
                  styles.statusDot,
                  { backgroundColor: permissionGranted ? COLORS.green : COLORS.orange },
                ]}
              />
              <Text style={styles.statusBadgeText}>
                Usage Access: {permissionGranted ? 'Allowed' : 'Denied'}
              </Text>
            </View>
            <View style={styles.statusBadge}>
              <View
                style={[
                  styles.statusDot,
                  {
                    backgroundColor: instagramInstalled ? COLORS.green : COLORS.orange,
                  },
                ]}
              />
              <Text style={styles.statusBadgeText}>
                Instagram: {instagramInstalled ? 'Installed' : 'Missing'}
              </Text>
            </View>
          </View>

          <View style={styles.actionBtnRow}>
            <TouchableOpacity
              style={styles.actionBtnPrimary}
              onPress={
                consentStatus !== 'accepted'
                  ? onOpenUsageSetup
                  : onOpenSystemUsageSettings
              }
              activeOpacity={0.8}
            >
              <Icon name="external-link" size={13} color={COLORS.white} />
              <Text style={styles.actionBtnPrimaryText}>
                {consentStatus !== 'accepted'
                  ? 'Grant permission'
                  : permissionGranted
                  ? 'System Usage Access Settings'
                  : 'Grant permission'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionBtnSecondary}
              onPress={onRefreshUsage}
              activeOpacity={0.8}
            >
              <Icon name="refresh" size={13} color={COLORS.purple} />
              <Text style={styles.actionBtnSecondaryText}>Sync</Text>
            </TouchableOpacity>
          </View>

          {trackingActive && usageSummary?.todayForegroundMs !== null ? (
            <Text style={styles.syncMetaText}>
              Today’s verified estimate:{' '}
              {
                formatMinutesAsHoursAndMinutes(
                  Math.round((usageSummary?.todayForegroundMs ?? 0) / 60000)
                ).compact
              }{' '}
              ({usageSummary?.aggregationSource || 'usage_events'} · status: {usageDisplay.status})
            </Text>
          ) : (
            <Text style={styles.syncMetaText}>
              Status: {usageDisplay.subtitleText}
            </Text>
          )}
        </View>
      </View>

      {/* Daily Limit Selector & Custom Target */}
      <Text style={[styles.sectionEyebrow, { marginTop: 22 }]}>
        DAILY SCROLL TARGET
      </Text>
      <View
        style={styles.limitCard}
        onLayout={(e) => {
          limitCardYRef.current = e.nativeEvent.layout.y;
        }}
      >
        <View style={styles.limitHeader}>
          <View style={styles.settingIcon}>
            <Icon name="sliders" size={18} color={COLORS.purple} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.settingTitle}>Daily Instagram target</Text>
            <Text style={styles.settingDetail}>
              Currently set to{' '}
              {formatMinutesAsHoursAndMinutes(dailyLimitMinutes).compact} (
              {dailyLimitMinutes} min) per day
            </Text>
          </View>
        </View>

        {/* Preset pills */}
        <View style={styles.limitOptionsRow}>
          {DAILY_LIMIT_OPTIONS.map((opt) => {
            const active = dailyLimitMinutes === opt.minutes;
            return (
              <TouchableOpacity
                key={opt.minutes}
                style={[styles.limitPill, active && styles.limitPillActive]}
                onPress={() => onChangeDailyLimit(opt.minutes)}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    styles.limitPillText,
                    active && styles.limitPillTextActive,
                  ]}
                >
                  {opt.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Fine-grained Stepper + Custom Minute Input */}
        <View style={styles.customTargetRow}>
          <TouchableOpacity
            style={styles.stepperBtn}
            onPress={() =>
              onChangeDailyLimit(
                stepDailyLimitMinutes(dailyLimitMinutes, -DAILY_LIMIT_STEP_MINUTES)
              )
            }
            activeOpacity={0.75}
            accessibilityLabel="Decrease target by 5 minutes"
          >
            <Icon name="minus" size={13} color={COLORS.purple} />
            <Text style={styles.stepperBtnText}>5m</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.stepperBtn}
            onPress={() =>
              onChangeDailyLimit(
                stepDailyLimitMinutes(dailyLimitMinutes, DAILY_LIMIT_STEP_MINUTES)
              )
            }
            activeOpacity={0.75}
            accessibilityLabel="Increase target by 5 minutes"
          >
            <Icon name="plus" size={13} color={COLORS.purple} />
            <Text style={styles.stepperBtnText}>5m</Text>
          </TouchableOpacity>

          <TextInput
            style={styles.customLimitInput}
            value={customLimitInput}
            onChangeText={(val) => {
              setCustomLimitInput(val);
              if (customLimitError) setCustomLimitError(null);
            }}
            keyboardType="number-pad"
            maxLength={3}
            placeholder="Minutes"
            placeholderTextColor="#a395b2"
            returnKeyType="done"
            onFocus={() => {
              setTimeout(() => {
                scrollRef.current?.scrollTo({
                  y: Math.max(0, limitCardYRef.current - 24),
                  animated: true,
                });
              }, 160);
            }}
            onSubmitEditing={handleApplyCustomLimit}
          />
          <TouchableOpacity
            style={styles.customLimitApplyBtn}
            onPress={handleApplyCustomLimit}
            activeOpacity={0.8}
          >
            <Text style={styles.customLimitApplyText}>Set min</Text>
          </TouchableOpacity>
        </View>

        {customLimitError ? (
          <Text style={styles.customLimitErrorText}>{customLimitError}</Text>
        ) : (
          <Text style={styles.profileHint}>
            Choose a preset or enter any custom target between {MIN_DAILY_LIMIT_MINUTES}m and{' '}
            {MAX_DAILY_LIMIT_MINUTES}m.
          </Text>
        )}
      </View>

      {/* Preferences & Local Notifications */}
      <Text style={[styles.sectionEyebrow, { marginTop: 22 }]}>
        BOUNDARIES, REMINDERS & PRIVACY
      </Text>
      <View style={styles.settingsList}>
        <SettingRow
          iconName="bell"
          title="Daily gentle nudge"
          detail="Background WorkManager + foreground alert at 80% or 100% of your limit"
          checked={settings.dailyGentleNudge}
          onChange={() => onToggleSetting('dailyGentleNudge')}
        />
        <SettingRow
          iconName="star"
          title="Mission reminders"
          detail={`Scheduled daily check-in at ${formatHour(eveningHour)} if missions are open`}
          checked={settings.missionReminders}
          onChange={() => onToggleSetting('missionReminders')}
        />
        <SettingRow
          iconName="flame"
          title="Streak & grace-day reminders"
          detail={`Scheduled protection alert at ${formatHour(streakHour)} before midnight`}
          checked={settings.streakReminders}
          onChange={() => onToggleSetting('streakReminders')}
        />
        <SettingRow
          iconName="trophy"
          title="Achievement notifications"
          detail="Celebrate newly unlocked badges and milestone streaks locally"
          checked={settings.achievementNotifications !== false}
          onChange={() => onToggleSetting('achievementNotifications')}
        />
        <SettingRow
          iconName="moon"
          title="Quiet hours"
          detail={
            quietEnabled
              ? `Suppress nudges & reminders between ${formatHour(quietStart)} and ${formatHour(quietEnd)}`
              : 'Quiet hours disabled · reminders can fire anytime'
          }
          checked={quietEnabled}
          onChange={() =>
            onUpdateSettingsPatch({ quietHoursEnabled: !quietEnabled })
          }
        />

        {/* Configurable Schedule Times & Quiet Window */}
        <View style={styles.scheduleGrid}>
          {settings.missionReminders && (
            <View style={styles.scheduleRow}>
              <Text style={styles.scheduleLabel}>Evening reminder</Text>
              <View style={styles.scheduleStepperGroup}>
                <TouchableOpacity
                  style={styles.miniStepBtn}
                  onPress={() =>
                    onUpdateSettingsPatch({
                      eveningReminderHour: (eveningHour + 23) % 24,
                    })
                  }
                >
                  <Text style={styles.miniStepText}>-1h</Text>
                </TouchableOpacity>
                <Text style={styles.scheduleValue}>{formatHour(eveningHour)}</Text>
                <TouchableOpacity
                  style={styles.miniStepBtn}
                  onPress={() =>
                    onUpdateSettingsPatch({
                      eveningReminderHour: (eveningHour + 1) % 24,
                    })
                  }
                >
                  <Text style={styles.miniStepText}>+1h</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {settings.streakReminders && (
            <View style={styles.scheduleRow}>
              <Text style={styles.scheduleLabel}>Streak reminder</Text>
              <View style={styles.scheduleStepperGroup}>
                <TouchableOpacity
                  style={styles.miniStepBtn}
                  onPress={() =>
                    onUpdateSettingsPatch({
                      streakReminderHour: (streakHour + 23) % 24,
                    })
                  }
                >
                  <Text style={styles.miniStepText}>-1h</Text>
                </TouchableOpacity>
                <Text style={styles.scheduleValue}>{formatHour(streakHour)}</Text>
                <TouchableOpacity
                  style={styles.miniStepBtn}
                  onPress={() =>
                    onUpdateSettingsPatch({
                      streakReminderHour: (streakHour + 1) % 24,
                    })
                  }
                >
                  <Text style={styles.miniStepText}>+1h</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {quietEnabled && (
            <View style={styles.scheduleRow}>
              <Text style={styles.scheduleLabel}>Quiet window</Text>
              <View style={styles.scheduleStepperGroup}>
                <TouchableOpacity
                  style={styles.miniStepBtn}
                  onPress={() =>
                    onUpdateSettingsPatch({
                      quietStartHour: (quietStart + 1) % 24,
                    })
                  }
                >
                  <Text style={styles.miniStepText}>Start {formatHour(quietStart)}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.miniStepBtn}
                  onPress={() =>
                    onUpdateSettingsPatch({
                      quietEndHour: (quietEnd + 1) % 24,
                    })
                  }
                >
                  <Text style={styles.miniStepText}>End {formatHour(quietEnd)}</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>

        <SettingRow
          iconName="shield-check"
          title="Private mode"
          detail="Keep your progress and cards local-only unless you choose to share"
          checked={settings.privateMode}
          onChange={() => onToggleSetting('privateMode')}
        />
        <SettingRow
          iconName="clock"
          title="Weekend breathing room"
          detail="Add +30m to your daily target on Saturdays and Sundays"
          checked={settings.weekendBreathingRoom}
          onChange={() => onToggleSetting('weekendBreathingRoom')}
        />

        {/* Notification Diagnostics & Test Nudge */}
        <View style={styles.permissionStatusBlock}>
          <View style={styles.statusBadgesRow}>
            <View style={styles.statusBadge}>
              <View
                style={[
                  styles.statusDot,
                  {
                    backgroundColor: notifBadgeHealthy
                      ? COLORS.green
                      : COLORS.orange,
                  },
                ]}
              />
              <Text style={styles.statusBadgeText}>
                Notifications: {notifBadgeLabel}
              </Text>
            </View>

            <View style={styles.statusBadge}>
              <View
                style={[
                  styles.statusDot,
                  {
                    backgroundColor: notificationStatus.nudgesChannelEnabled
                      ? COLORS.green
                      : COLORS.orange,
                  },
                ]}
              />
              <Text style={styles.statusBadgeText}>
                Nudge channel: {notificationStatus.nudgesChannelEnabled ? 'On' : 'Blocked'}
              </Text>
            </View>

            <View style={styles.statusBadge}>
              <View
                style={[
                  styles.statusDot,
                  {
                    backgroundColor: notificationStatus.quietHoursActiveNow
                      ? COLORS.purple
                      : COLORS.green,
                  },
                ]}
              />
              <Text style={styles.statusBadgeText}>
                {notificationStatus.quietHoursActiveNow
                  ? 'Quiet hours active'
                  : 'Alerts active'}
              </Text>
            </View>
          </View>

          <View style={styles.actionBtnRow}>
            <TouchableOpacity
              style={styles.actionBtnSecondary}
              onPress={onSendTestNotification}
              activeOpacity={0.8}
            >
              <Icon name="bell" size={13} color={COLORS.purple} />
              <Text style={styles.actionBtnSecondaryText}>Send test nudge</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionBtnSecondary}
              onPress={onRefreshNotificationStatus}
              activeOpacity={0.8}
            >
              <Icon name="refresh" size={13} color={COLORS.purple} />
              <Text style={styles.actionBtnSecondaryText}>Check status</Text>
            </TouchableOpacity>
          </View>

          {!notifBadgeHealthy && (
            <TouchableOpacity
              style={styles.actionBtnPrimary}
              onPress={() =>
                onOpenNotificationSettings(
                  notificationStatus.statusCode === 'channel_disabled'
                    ? !notificationStatus.nudgesChannelEnabled
                      ? 'rot_wellbeing_nudges'
                      : 'rot_scheduled_reminders'
                    : null
                )
              }
              activeOpacity={0.8}
            >
              <Icon name="external-link" size={13} color={COLORS.white} />
              <Text style={styles.actionBtnPrimaryText}>
                Open Android Notification Settings
              </Text>
            </TouchableOpacity>
          )}

          {testNotificationFeedback ? (
            <View style={styles.feedbackBanner}>
              <Icon
                name={notifBadgeHealthy ? 'check' : 'alert-circle'}
                size={13}
                color={notifBadgeHealthy ? '#2d9364' : COLORS.orange}
              />
              <Text style={styles.feedbackBannerText}>
                {testNotificationFeedback}
              </Text>
            </View>
          ) : (
            <Text style={styles.syncMetaText}>
              Scheduled reminders survive app close & reboot via Android AlarmManager + WorkManager (15m periodic usage checks). Force-stop pauses Android background jobs until reopened.
            </Text>
          )}
        </View>
      </View>

      {/* Local Data Export & Deletion */}
      <Text style={[styles.sectionEyebrow, { marginTop: 22 }]}>
        LOCAL DATA, EXPORT & HISTORY
      </Text>
      <View style={styles.exportCard}>
        <View style={{ flex: 1 }}>
          <Text style={styles.settingTitle}>Export user data (JSON)</Text>
          <Text style={styles.settingDetail}>
            Export your structured local usage summaries, missions, streaks, weekly quests,
            mood logs, and XP ledger as valid JSON.
          </Text>
        </View>
        <View style={styles.exportBtnRow}>
          <TouchableOpacity
            style={styles.actionBtnPrimary}
            onPress={onExportUserData}
            activeOpacity={0.8}
          >
            <Icon name="share" size={13} color={COLORS.white} />
            <Text style={styles.actionBtnPrimaryText}>Export / Share JSON</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionBtnSecondary}
            onPress={() => setShowExportPreview((prev) => !prev)}
            activeOpacity={0.8}
          >
            <Icon name="file-text" size={13} color={COLORS.purple} />
            <Text style={styles.actionBtnSecondaryText}>
              {showExportPreview ? 'Hide JSON' : 'Preview JSON'}
            </Text>
          </TouchableOpacity>
        </View>
        {showExportPreview && (
          <View style={styles.jsonPreviewBox}>
            <Text style={styles.jsonPreviewText} selectable>
              {exportJsonPreview}
            </Text>
          </View>
        )}
      </View>

      <View style={[styles.dangerCard, { marginTop: 12 }]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.settingTitle}>Delete local usage & mission history</Text>
          <Text style={styles.settingDetail}>
            Clears cached usage summaries, completed missions, chests, streaks, mood logs,
            and earned badges stored on this device.
          </Text>
        </View>
        <TouchableOpacity
          style={[
            styles.deleteBtn,
            confirmClear && styles.deleteBtnConfirm,
          ]}
          onPress={() => {
            if (!confirmClear) {
              setConfirmClear(true);
              return;
            }
            setConfirmClear(false);
            onClearLocalHistory();
          }}
          activeOpacity={0.8}
        >
          <Icon
            name="trash"
            size={14}
            color={confirmClear ? COLORS.white : COLORS.pink}
          />
          <Text
            style={[
              styles.deleteBtnText,
              confirmClear && styles.deleteBtnTextConfirm,
            ]}
          >
            {confirmClear ? 'Tap again to confirm' : 'Clear local history'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Note */}
      <View style={styles.note}>
        <Icon name="lock" size={18} color={COLORS.purple} />
        <View style={{ flex: 1 }}>
          <Text style={styles.noteTitle}>
            We do not need your Instagram password.
          </Text>
          <Text style={styles.noteDesc}>
            ROT uses estimated Android UsageStats foreground signals—not your account,
            messages, or exact Reel counts.
          </Text>
        </View>
      </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 30 },
  eyebrow: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    color: COLORS.pink,
  },
  sectionEyebrow: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    color: COLORS.purple,
    marginBottom: 8,
  },
  heading: {
    fontSize: 30,
    fontWeight: '700',
    color: COLORS.ink,
    letterSpacing: -1,
    marginTop: 8,
    lineHeight: 34,
  },
  dot: { color: COLORS.pink },
  subtitle: {
    fontSize: 14,
    color: COLORS.muted,
    marginTop: 6,
    marginBottom: 20,
    lineHeight: 20,
  },

  // Profile Card
  profileCard: {
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: RADIUS.xl,
    backgroundColor: COLORS.white,
    padding: 18,
    gap: 12,
  },
  nameInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  nameInput: {
    flex: 1,
    minWidth: 140,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#dfd3eb',
    backgroundColor: '#faf6fe',
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.ink,
  },
  nameClearBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#f1eaf9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameSaveBtn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: COLORS.purple,
  },
  nameSaveBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.white,
  },
  nameResetBtn: {
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#ffe8f2',
    alignSelf: 'flex-start',
  },
  nameResetBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.pink,
  },
  profileHint: {
    fontSize: 10,
    color: COLORS.muted,
    lineHeight: 15,
  },
  cloudPrivacyBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#f0e8f0',
  },
  cloudPrivacyCopy: {
    flex: 1,
  },
  cloudMetaSmall: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.purple,
    marginTop: 4,
  },
  cloudSyncChoiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cloudSyncCheckbox: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: COLORS.purple,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.white,
  },
  cloudSyncCheckboxActive: {
    backgroundColor: COLORS.purple,
  },
  cloudSyncChoiceText: {
    flex: 1,
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.ink,
  },

  // Settings List
  settingsList: {
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: RADIUS.xl,
    backgroundColor: COLORS.white,
    overflow: 'hidden',
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderBottomWidth: 1,
    borderBottomColor: '#f0e8f0',
  },
  settingIcon: {
    width: 38,
    height: 38,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.lavender,
    justifyContent: 'center',
    alignItems: 'center',
  },
  settingCopy: { flex: 1 },
  settingTitle: { fontSize: 13, fontWeight: '700', color: COLORS.ink },
  settingDetail: { fontSize: 11, color: COLORS.muted, marginTop: 3, lineHeight: 16 },

  // Permission block
  permissionStatusBlock: {
    padding: 16,
    backgroundColor: '#faf6fe',
    gap: 12,
  },
  notificationTestFooter: {
    padding: 14,
    backgroundColor: '#faf6fe',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  statusBadgesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 5,
    paddingHorizontal: 9,
    borderRadius: 14,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: '#e8dff1',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.ink,
  },
  actionBtnRow: {
    flexDirection: 'row',
    gap: 8,
  },
  actionBtnPrimary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: COLORS.purple,
  },
  actionBtnPrimaryText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.white,
  },
  actionBtnSecondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: '#ece3f8',
  },
  actionBtnSecondaryText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.purple,
  },
  syncMetaText: {
    flex: 1,
    fontSize: 10,
    color: COLORS.muted,
    fontWeight: '600',
  },

  // Limit Card
  limitCard: {
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: RADIUS.xl,
    backgroundColor: COLORS.white,
    padding: 18,
    gap: 14,
  },
  limitHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  limitOptionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  limitPill: {
    paddingVertical: 8,
    paddingHorizontal: 13,
    borderRadius: 20,
    backgroundColor: '#f1eaf9',
  },
  limitPillActive: {
    backgroundColor: COLORS.pink,
  },
  limitPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.purple,
  },
  limitPillTextActive: {
    color: COLORS.white,
  },
  customTargetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  stepperBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingVertical: 9,
    paddingHorizontal: 11,
    borderRadius: 10,
    backgroundColor: '#ece3f8',
  },
  stepperBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.purple,
  },
  customLimitInput: {
    flex: 1,
    minWidth: 80,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#dfd3eb',
    backgroundColor: '#faf6fe',
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.ink,
  },
  customLimitApplyBtn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: COLORS.purple,
  },
  customLimitApplyText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.white,
  },
  customLimitErrorText: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.pink,
  },

  // Export Card
  exportCard: {
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: RADIUS.xl,
    backgroundColor: COLORS.white,
    padding: 18,
    gap: 12,
  },
  exportBtnRow: {
    flexDirection: 'row',
    gap: 8,
  },
  jsonPreviewBox: {
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#f8f2fa',
    borderWidth: 1,
    borderColor: '#e8dcf0',
    maxHeight: 200,
  },
  jsonPreviewText: {
    fontSize: 9,
    fontFamily: 'monospace',
    color: COLORS.ink,
    lineHeight: 14,
  },

  // Danger / History
  dangerCard: {
    borderWidth: 1,
    borderColor: '#f3d4e3',
    borderRadius: RADIUS.xl,
    backgroundColor: COLORS.white,
    padding: 18,
    gap: 12,
  },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: '#fff0f6',
    borderWidth: 1,
    borderColor: '#f8c3dc',
    alignSelf: 'flex-start',
  },
  deleteBtnConfirm: {
    backgroundColor: COLORS.pink,
    borderColor: COLORS.pink,
  },
  deleteBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.pink,
  },
  deleteBtnTextConfirm: {
    color: COLORS.white,
  },

  // Toggle
  toggle: {
    width: 44,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#d9cedf',
    padding: 3,
    justifyContent: 'center',
  },
  toggleOn: {
    backgroundColor: COLORS.pink,
  },
  toggleKnob: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: COLORS.white,
  },
  toggleKnobOn: {
    transform: [{ translateX: 18 }],
  },

  // Note
  note: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
    padding: 18,
    backgroundColor: COLORS.lavender,
    borderRadius: RADIUS.lg,
  },
  noteTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.purple,
  },
  noteDesc: {
    fontSize: 11,
    color: COLORS.muted,
    marginTop: 4,
    lineHeight: 16,
  },
  scheduleGrid: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fcf9ff',
    borderBottomWidth: 1,
    borderBottomColor: '#f0e8f0',
    gap: 10,
  },
  scheduleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  scheduleLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.ink,
  },
  scheduleStepperGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  scheduleValue: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.purple,
    minWidth: 62,
    textAlign: 'center',
  },
  miniStepBtn: {
    paddingVertical: 5,
    paddingHorizontal: 9,
    borderRadius: 8,
    backgroundColor: '#ece3f8',
  },
  miniStepText: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.purple,
  },
  feedbackBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderRadius: 10,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: '#e4d6f4',
  },
  feedbackBannerText: {
    flex: 1,
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.ink,
    lineHeight: 15,
  },
});
