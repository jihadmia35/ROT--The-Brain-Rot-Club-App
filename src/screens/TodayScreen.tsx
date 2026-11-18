import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
} from 'react-native';
import { COLORS, RADIUS } from '../constants/theme';
import { MOOD_OPTIONS } from '../constants/data';
import {
  DailyChest,
  InstagramUsageSummary,
  Mission,
  MoodId,
  MoodLogEntry,
  StreakState,
} from '../constants/types';
import {
  BrainrotIndexSummary,
  formatMinutesAsHoursAndMinutes,
  formatReadableDateHeader,
  getGreetingForHour,
  LimitProgressSummary,
  MAX_DISPLAY_NAME_LENGTH,
  MAX_MOOD_NOTE_LENGTH,
  UsageDisplayState,
} from '../utils/domainLogic';
import { CloudAccountIdentity, CloudAuthStatus } from '../utils/authHelpers';
import {
  TextInputRefTarget,
  useKeyboardAwareScroll,
} from '../utils/useKeyboardAwareScroll';
import MissionRow from '../components/MissionRow';
import DailyChestCard from '../components/DailyChestCard';
import Icon from '../components/Icon';

type Props = {
  displayName: string;
  customDisplayName: string | null;
  deviceDefaultName: string | null;
  onSaveDisplayName: (rawName: string | null, alsoSyncToCloud?: boolean) => void;
  completedMissions: number;
  earnedXp: number;
  missions: Mission[];
  onMissionClick: (index: number) => void;
  onBreak: () => void;
  onViewMissions: () => void;
  onOpenSettings: () => void;
  chest: DailyChest;
  onClaimChest: () => void;
  usageSummary: InstagramUsageSummary | null;
  usageDisplay: UsageDisplayState;
  limitProgress: LimitProgressSummary;
  brainrotIndex: BrainrotIndexSummary;
  effectiveLimitMinutes: number;
  showGentleNudge: boolean;
  onUsageAction: () => void;
  onRefreshUsage: () => void;
  streak: StreakState;
  onRecoverStreak: () => void;
  todayMoodLog: MoodLogEntry | null;
  recentMoodLogs: MoodLogEntry[];
  onLogMood: (moodId: MoodId, note: string) => void;
  cloudAuthStatus: CloudAuthStatus;
  cloudIdentity: CloudAccountIdentity | null;
  authBusy: boolean;
  authError: string | null;
  showSignInPrompt: boolean;
  onSignInWithGoogle: () => void;
  onDismissSignInPrompt: () => void;
};

export default function TodayScreen({
  displayName,
  customDisplayName,
  deviceDefaultName,
  onSaveDisplayName,
  earnedXp,
  missions,
  onMissionClick,
  onBreak,
  onViewMissions,
  onOpenSettings,
  chest,
  onClaimChest,
  usageSummary,
  usageDisplay,
  limitProgress,
  brainrotIndex,
  effectiveLimitMinutes,
  showGentleNudge,
  onUsageAction,
  onRefreshUsage,
  streak,
  onRecoverStreak,
  todayMoodLog,
  recentMoodLogs,
  onLogMood,
  cloudAuthStatus,
  cloudIdentity,
  authBusy,
  authError,
  showSignInPrompt,
  onSignInWithGoogle,
  onDismissSignInPrompt,
}: Props) {
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(customDisplayName ?? displayName);
  const [syncNameToCloud, setSyncNameToCloud] = useState(false);
  const [moodDrawerOpen, setMoodDrawerOpen] = useState(false);
  const [selectedMoodId, setSelectedMoodId] = useState<MoodId>(
    todayMoodLog?.moodId ?? 'balanced'
  );
  const [moodNote, setMoodNote] = useState(todayMoodLog?.note ?? '');
  const [showBreakdown, setShowBreakdown] = useState(false);
  const {
    scrollRef,
    bottomSpacer,
    handleScroll,
    handleScrollLayout,
    focusInput,
  } = useKeyboardAwareScroll();
  const draftNameInputRef = useRef<TextInputRefTarget>(null);
  const moodNoteInputRef = useRef<TextInputRefTarget>(null);

  useEffect(() => {
    if (!editingName) {
      setDraftName(customDisplayName ?? displayName);
    }
  }, [customDisplayName, displayName, editingName]);

  useEffect(() => {
    if (todayMoodLog) {
      setSelectedMoodId(todayMoodLog.moodId);
      setMoodNote(todayMoodLog.note);
    }
  }, [todayMoodLog]);

  const dateHeader = formatReadableDateHeader();
  const greeting = getGreetingForHour();

  const breakdown = usageSummary?.dailyBreakdown ?? [];
  const hasRealBreakdown =
    (usageDisplay.hasVerifiedEstimate || usageDisplay.isShowingCachedFallback) &&
    breakdown.length > 0;
  const maxChartMinutes = Math.max(120, effectiveLimitMinutes);
  const topAxisLabel = formatMinutesAsHoursAndMinutes(maxChartMinutes).compact;
  const midAxisLabel = formatMinutesAsHoursAndMinutes(Math.round(maxChartMinutes / 2)).compact;

  const chartDays = hasRealBreakdown
    ? breakdown.slice(-7).map((pt, idx, arr) => {
        const mins = Math.round(pt.foregroundMs / 60000);
        const pct =
          mins === 0
            ? 8
            : Math.max(12, Math.min(100, Math.round((mins / maxChartMinutes) * 100)));
        return {
          key: `${pt.date}-${idx}`,
          heightPct: pct,
          label: pt.dayLabel || 'D',
          isToday: idx === arr.length - 1,
          isOver: mins > effectiveLimitMinutes,
          minutes: mins,
        };
      })
    : ['W', 'T', 'F', 'S', 'S', 'M', 'T'].map((d, i) => ({
        key: `placeholder-${i}`,
        heightPct: 12,
        label: d,
        isToday: i === 6,
        isOver: false,
        minutes: null,
      }));

  const showNumericEstimate =
    (usageDisplay.hasVerifiedEstimate || usageDisplay.isShowingCachedFallback) &&
    usageDisplay.hours !== null &&
    usageDisplay.minutes !== null;

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.scroll}
      contentContainerStyle={[
        styles.content,
        { paddingBottom: 48 + bottomSpacer },
      ]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      scrollEventThrottle={16}
      onScroll={(e) => handleScroll(e.nativeEvent.contentOffset.y)}
      onLayout={handleScrollLayout}
    >
      {/* Welcome */}
      <View style={styles.welcomeRow}>
        <Text style={styles.eyebrow}>{dateHeader}</Text>
        <View style={styles.greetingRow}>
          <Text style={styles.heading}>
            {greeting}, {displayName}
            <Text style={styles.dot}>.</Text>
          </Text>
          <TouchableOpacity
            style={styles.editNameChip}
            onPress={() => {
              setDraftName(customDisplayName ?? displayName);
              setEditingName((prev) => !prev);
            }}
            activeOpacity={0.75}
            accessibilityLabel="Edit display name"
          >
            <Icon name="edit" size={12} color={COLORS.purple} />
            <Text style={styles.editNameChipText}>
              {editingName ? 'Close' : 'Edit'}
            </Text>
          </TouchableOpacity>
        </View>

        {editingName && (
          <View style={styles.nameEditorCard}>
            <Text style={styles.nameEditorTitle}>Display name</Text>
            <Text style={styles.nameEditorHint}>
              Saved on this device only (max {MAX_DISPLAY_NAME_LENGTH} characters). Leave blank or reset to use device name ({deviceDefaultName || 'ROT User'}).
            </Text>
            <View style={styles.nameInputRow}>
              <TextInput
                ref={draftNameInputRef}
                style={styles.nameInput}
                value={draftName}
                onChangeText={setDraftName}
                maxLength={MAX_DISPLAY_NAME_LENGTH}
                placeholder={deviceDefaultName || 'ROT User'}
                placeholderTextColor="#a395b2"
                autoCapitalize="words"
                returnKeyType="done"
                onFocus={() => focusInput(draftNameInputRef.current, 64)}
                onSubmitEditing={() => {
                  onSaveDisplayName(draftName, syncNameToCloud);
                  setEditingName(false);
                }}
              />
              {draftName.length > 0 && (
                <TouchableOpacity
                  style={styles.nameClearBtn}
                  onPress={() => setDraftName('')}
                  activeOpacity={0.75}
                  accessibilityLabel="Clear display name input"
                >
                  <Icon name="x" size={13} color={COLORS.muted} />
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={styles.nameSaveBtn}
                onPress={() => {
                  onSaveDisplayName(draftName, syncNameToCloud);
                  setEditingName(false);
                }}
                activeOpacity={0.8}
              >
                <Text style={styles.nameSaveBtnText}>Save</Text>
              </TouchableOpacity>
              {customDisplayName && (
                <TouchableOpacity
                  style={styles.nameResetBtn}
                  onPress={() => {
                    onSaveDisplayName(null, syncNameToCloud);
                    setEditingName(false);
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={styles.nameResetBtnText}>Reset</Text>
                </TouchableOpacity>
              )}
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
                  Also update Cloud Squad display name ({cloudIdentity.displayName})
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        )}

        <Text style={styles.subtitle}>
          Your scroll has a personality. Today, it is choosing balance.
        </Text>
      </View>

      {/* Club Account / Google Sign-In Entry Card */}
      {cloudAuthStatus === 'authenticated' && cloudIdentity ? (
        <TouchableOpacity
          style={styles.clubAccountPill}
          onPress={onOpenSettings}
          activeOpacity={0.8}
        >
          <View style={styles.clubAccountDot} />
          <View style={{ flex: 1 }}>
            <Text style={styles.clubAccountPillTitle} numberOfLines={1}>
              Club Account · {cloudIdentity.displayName}
            </Text>
            <Text style={styles.clubAccountPillSub} numberOfLines={1}>
              {cloudIdentity.emailLabel} · {cloudIdentity.cloudXp} Cloud XP
            </Text>
          </View>
          <View style={styles.signedInPillBadge}>
            <Text style={styles.signedInPillBadgeText}>Signed in</Text>
          </View>
          <Text style={styles.clubAccountManageText}>Manage</Text>
          <Icon name="chevron-right" size={14} color={COLORS.purple} />
        </TouchableOpacity>
      ) : showSignInPrompt ? (
        <View style={styles.authEntryCard}>
          <View style={styles.authEntryTopRow}>
            <View style={styles.authEntryIcon}>
              <Icon name="users" size={17} color={COLORS.purple} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.authEntryTitle}>
                Join ROT Club with Google
              </Text>
              <Text style={styles.authEntryDesc}>
                Sign in to create your Cloud Club profile (starts at 0 Cloud XP).
                Your local guest progress stays private on this device.
              </Text>
            </View>
          </View>
          {authError ? (
            <Text style={styles.authEntryError}>{authError}</Text>
          ) : null}
          <View style={styles.authEntryBtnRow}>
            <TouchableOpacity
              style={[
                styles.authGoogleBtn,
                (authBusy || cloudAuthStatus === 'unconfigured') &&
                  styles.authGoogleBtnDisabled,
              ]}
              onPress={onSignInWithGoogle}
              disabled={authBusy || cloudAuthStatus === 'unconfigured'}
              activeOpacity={0.8}
            >
              <Icon name="user" size={13} color={COLORS.white} />
              <Text style={styles.authGoogleBtnText}>
                {authBusy
                  ? 'Signing in...'
                  : cloudAuthStatus === 'unconfigured'
                  ? 'Cloud Env Needed'
                  : 'Continue with Google'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.authGuestBtn}
              onPress={onDismissSignInPrompt}
              activeOpacity={0.8}
            >
              <Text style={styles.authGuestBtnText}>Continue as Guest</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {/* Streak & Grace-Day Card */}
      <View style={styles.streakCard}>
        <View style={styles.streakIconWrap}>
          <Icon name="flame" size={18} color={COLORS.pink} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.streakTopRow}>
            <Text style={styles.streakTitle}>
              {streak.currentStreak} day{streak.currentStreak === 1 ? '' : 's'} streak
            </Text>
            <View style={styles.gracePill}>
              <Icon name="shield-check" size={11} color="#2d9364" />
              <Text style={styles.gracePillText}>
                {streak.graceDaysRemaining}/{streak.maxGraceDaysPerWeek} grace day left
              </Text>
            </View>
          </View>
          <Text style={styles.streakSub}>
            Best: {streak.longestStreak}d · Missing Usage Access never breaks your streak
          </Text>
          {streak.recoveryNeeded && streak.previousStreakBeforeBreak > 0 && (
            <TouchableOpacity
              style={styles.recoverStreakBtn}
              onPress={onRecoverStreak}
              activeOpacity={0.8}
            >
              <Icon name="refresh" size={12} color={COLORS.white} />
              <Text style={styles.recoverStreakBtnText}>
                Recover {streak.previousStreakBeforeBreak}-day streak (+25 XP)
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Mood Badge & Interactive Mood Logger */}
      <View style={styles.moodContainer}>
        <View style={styles.moodBadgeRow}>
          <View style={styles.moodFace}>
            <Text style={styles.moodEmoji}>{brainrotIndex.moodEmoji}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.moodLabel}>
              Brain mood {todayMoodLog ? '· Checked in today' : ''}
            </Text>
            <Text style={styles.moodValue}>{brainrotIndex.moodValue}</Text>
            {todayMoodLog?.note ? (
              <Text style={styles.moodSavedNote}>“{todayMoodLog.note}”</Text>
            ) : null}
          </View>
          <TouchableOpacity
            style={styles.logMoodChip}
            onPress={() => setMoodDrawerOpen((prev) => !prev)}
            activeOpacity={0.75}
          >
            <Text style={styles.logMoodChipText}>
              {moodDrawerOpen ? 'Close' : todayMoodLog ? 'Update' : 'Check in'}
            </Text>
          </TouchableOpacity>
        </View>

        {moodDrawerOpen && (
          <View style={styles.moodDrawer}>
            <Text style={styles.moodDrawerTitle}>How is your brain feeling today?</Text>
            <View style={styles.moodOptionsRow}>
              {MOOD_OPTIONS.map((opt) => {
                const active = selectedMoodId === opt.id;
                return (
                  <TouchableOpacity
                    key={opt.id}
                    style={[
                      styles.moodOptionPill,
                      active && styles.moodOptionPillActive,
                    ]}
                    onPress={() => setSelectedMoodId(opt.id)}
                    activeOpacity={0.8}
                  >
                    <Text
                      style={[
                        styles.moodOptionEmoji,
                        active && { color: COLORS.white },
                      ]}
                    >
                      {opt.emoji}
                    </Text>
                    <Text
                      style={[
                        styles.moodOptionText,
                        active && styles.moodOptionTextActive,
                      ]}
                    >
                      {opt.shortLabel}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <TextInput
              ref={moodNoteInputRef}
              style={styles.moodNoteInput}
              value={moodNote}
              onChangeText={setMoodNote}
              maxLength={MAX_MOOD_NOTE_LENGTH}
              placeholder="One thing you want to make time for today (optional)..."
              placeholderTextColor="#a395b2"
              returnKeyType="done"
              onFocus={() => focusInput(moodNoteInputRef.current, 68)}
            />
            <View style={styles.moodDrawerFooter}>
              <Text style={styles.moodDrawerHint}>
                Completes “Do the brain check-in” (+25 XP)
              </Text>
              <TouchableOpacity
                style={styles.moodSaveBtn}
                onPress={() => {
                  onLogMood(selectedMoodId, moodNote);
                  setMoodDrawerOpen(false);
                }}
                activeOpacity={0.8}
              >
                <Text style={styles.moodSaveBtnText}>Save mood</Text>
              </TouchableOpacity>
            </View>

            {recentMoodLogs.length > 0 && (
              <View style={styles.moodHistoryWrap}>
                <Text style={styles.moodHistoryTitle}>Recent mood check-ins</Text>
                {recentMoodLogs.slice(0, 3).map((entry) => (
                  <View key={entry.dateKey} style={styles.moodHistoryItem}>
                    <Text style={styles.moodHistoryDate}>{entry.dateKey}</Text>
                    <Text style={styles.moodHistoryValue}>
                      {entry.emoji} {entry.label}
                      {entry.note ? ` — “${entry.note}”` : ''}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}
      </View>

      {/* Usage Card */}
      <View style={styles.usageCard}>
        <View style={styles.usageTop}>
          <Text style={styles.eyebrowLight}>TODAY'S ESTIMATE</Text>
          <TouchableOpacity
            style={styles.statusDot}
            onPress={onRefreshUsage}
            activeOpacity={0.75}
          >
            <View
              style={[
                styles.greenDot,
                { backgroundColor: usageDisplay.badgeDotColor },
              ]}
            />
            <Text style={styles.statusText}>{usageDisplay.freshnessText}</Text>
            <Icon name="refresh" size={11} color="#d9c9ed" />
          </TouchableOpacity>
        </View>

        <View style={styles.usageMain}>
          <View style={styles.usageCopyCol}>
            {showNumericEstimate ? (
              <Text style={styles.usageNumber}>
                {usageDisplay.hours}
                <Text style={styles.usageUnit}>h</Text>{' '}
                {String(usageDisplay.minutes ?? 0).padStart(2, '0')}
                <Text style={styles.usageUnit}>m</Text>
              </Text>
            ) : (
              <Text style={styles.usageStatusHeadline}>
                {usageDisplay.headlineText}
              </Text>
            )}
            <Text style={styles.usageLabel}>{usageDisplay.subtitleText}</Text>

            {usageDisplay.staleOrIncompleteWarning && (
              <View style={styles.warningPill}>
                <Icon name="alert-circle" size={11} color={COLORS.yellow} />
                <Text style={styles.warningPillText}>
                  {usageDisplay.staleOrIncompleteWarning}
                </Text>
              </View>
            )}

            {usageDisplay.hasVerifiedEstimate && (
              <View style={styles.sourcePill}>
                <Icon name="info" size={10} color="#f7d755" />
                <Text style={styles.sourcePillText}>
                  Android UsageStats ·{' '}
                  {usageSummary?.todaySessionCount
                    ? `${usageSummary.todaySessionCount} intervals today`
                    : 'App-level foreground time'}
                </Text>
              </View>
            )}
          </View>

          {/* Brain mascot */}
          <View style={styles.mascot}>
            <View style={styles.eyeLeft} />
            <View style={styles.eyeRight} />
            <View style={styles.mouth} />
          </View>
        </View>

        {!usageDisplay.hasVerifiedEstimate && usageDisplay.actionLabel && (
          <TouchableOpacity
            style={styles.usageActionBtn}
            onPress={onUsageAction}
            activeOpacity={0.85}
          >
            <Icon
              name={
                usageDisplay.actionKind === 'permission' ||
                usageDisplay.actionKind === 'consent'
                  ? 'shield-check'
                  : 'refresh'
              }
              size={14}
              color={COLORS.purple}
            />
            <Text style={styles.usageActionBtnText}>{usageDisplay.actionLabel}</Text>
          </TouchableOpacity>
        )}

        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              {
                width: `${limitProgress.progressPercent}%` as any,
                backgroundColor: limitProgress.isOverLimit
                  ? COLORS.pink
                  : COLORS.yellow,
              },
            ]}
          />
        </View>

        <View style={styles.usageFooter}>
          <TouchableOpacity onPress={onOpenSettings} activeOpacity={0.7}>
            <Text style={styles.footerText}>
              Daily limit{' '}
              <Text style={styles.footerBold}>{limitProgress.limitFormatted}</Text>{' '}
              (edit)
            </Text>
          </TouchableOpacity>
          <Text
            style={[
              styles.footerRemaining,
              limitProgress.isOverLimit && { color: '#ffb5d5' },
            ]}
          >
            {limitProgress.remainingFormatted}
          </Text>
        </View>
      </View>

      {/* Gentle Nudge Banner when near/over limit */}
      {showGentleNudge && limitProgress.nudgeMessage && (
        <View style={styles.nudgeBanner}>
          <View style={styles.nudgeIcon}>
            <Icon name="bell" size={15} color={COLORS.purple} />
          </View>
          <Text style={styles.nudgeText}>{limitProgress.nudgeMessage}</Text>
        </View>
      )}

      {/* Brainrot Index & Score Breakdown */}
      <View style={styles.indexCard}>
        <View style={styles.indexTop}>
          <Text style={styles.eyebrow}>BRAINROT INDEX</Text>
          <View style={styles.indexTopRight}>
            <View style={styles.trendBadge}>
              <Icon name="bar-chart" size={14} color={COLORS.green} />
              <Text style={styles.trendText}>{brainrotIndex.trendText}</Text>
            </View>
            <TouchableOpacity
              style={styles.breakdownToggleBtn}
              onPress={() => setShowBreakdown((prev) => !prev)}
              activeOpacity={0.75}
            >
              <Text style={styles.breakdownToggleText}>
                {showBreakdown ? 'Hide details' : 'Breakdown'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
        <Text style={styles.indexScore}>
          {brainrotIndex.score !== null ? brainrotIndex.score : '—'}
          <Text style={styles.indexMax}>/100</Text>
        </Text>
        <Text style={styles.indexLabel}>{brainrotIndex.label}</Text>
        <View style={styles.scaleRow}>
          {['#dfd2f0', '#c1a5ea', '#ffd640', '#f58ab6', '#f32c87'].map((color, i) => (
            <View key={i} style={[styles.scaleBar, { backgroundColor: color }]} />
          ))}
        </View>
        <View style={styles.scaleLabels}>
          <Text style={styles.scaleText}>More scroll</Text>
          <Text style={styles.scaleText}>More soul</Text>
        </View>

        {showBreakdown && (
          <View style={styles.breakdownPanel}>
            <View style={styles.breakdownRow}>
              <Text style={styles.breakdownKey}>Scroll vs. target base</Text>
              <Text style={styles.breakdownVal}>
                {brainrotIndex.breakdown.usageRatioPercent !== null
                  ? `${brainrotIndex.breakdown.baseScore} pts (${brainrotIndex.breakdown.usageRatioPercent}% of target)`
                  : 'Needs Usage Access'}
              </Text>
            </View>
            <View style={styles.breakdownRow}>
              <Text style={styles.breakdownKey}>Daily mission bonus</Text>
              <Text style={styles.breakdownVal}>
                +{brainrotIndex.breakdown.missionBonus} pts
              </Text>
            </View>
            <View style={styles.breakdownRow}>
              <Text style={styles.breakdownKey}>Focus break bonus</Text>
              <Text style={styles.breakdownVal}>
                +{brainrotIndex.breakdown.focusBreakBonus} pts
              </Text>
            </View>
            <Text style={styles.breakdownSummary}>
              {brainrotIndex.breakdown.summaryText}
            </Text>
          </View>
        )}
      </View>

      {/* Daily Chest */}
      <DailyChestCard chest={chest} onClaim={onClaimChest} />

      {/* Today's Missions */}
      <View style={styles.sectionHeader}>
        <View>
          <Text style={styles.eyebrow}>A LITTLE GOES A LONG WAY</Text>
          <Text style={styles.sectionTitle}>Today's missions</Text>
        </View>
        <TouchableOpacity onPress={onViewMissions} style={styles.viewAll}>
          <Text style={styles.viewAllText}>View all</Text>
          <Icon name="chevron-right" size={14} color={COLORS.purple} />
        </TouchableOpacity>
      </View>
      <View style={styles.missionList}>
        {missions.map((mission, index) => (
          <MissionRow
            key={mission.id}
            mission={mission}
            onPress={() => onMissionClick(index)}
          />
        ))}
      </View>

      {/* Habit Chart */}
      <View style={styles.sectionHeader}>
        <View>
          <Text style={styles.eyebrow}>YOUR PROGRESS</Text>
          <Text style={styles.sectionTitle}>Healthy habits (7-day window)</Text>
        </View>
      </View>
      <View style={styles.chartContainer}>
        <View style={styles.chartLabels}>
          <Text style={styles.chartLabel}>{topAxisLabel}</Text>
          <Text style={styles.chartLabel}>{midAxisLabel}</Text>
          <Text style={styles.chartLabel}>0</Text>
        </View>
        <View style={styles.chartBars}>
          {chartDays.map((item) => (
            <View key={item.key} style={styles.barWrap}>
              <View
                style={[
                  styles.bar,
                  { height: `${item.heightPct}%` as any },
                  item.isOver ? styles.barPink : null,
                  item.isToday ? styles.barToday : null,
                ]}
              />
              <Text style={[styles.barLabel, item.isToday && styles.barLabelToday]}>
                {item.label}
              </Text>
            </View>
          ))}
        </View>
      </View>

      {/* Callout */}
      <View style={styles.callout}>
        <View style={styles.calloutIcon}>
          <Icon name="leaf" size={16} color="#49a878" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.calloutBold}>
            {usageDisplay.hasVerifiedEstimate && limitProgress.remainingMinutes !== null
              ? limitProgress.isOverLimit
                ? 'Time for a gentle reset'
                : `${limitProgress.remainingFormatted} inside today's target`
              : 'Honest local-first tracking'}
          </Text>
          <Text style={styles.calloutSub}>
            {usageDisplay.hasVerifiedEstimate
              ? `Compared against your ${limitProgress.limitFormatted} daily target`
              : 'Enable Usage Access to populate your 7-day Instagram foreground trend'}
          </Text>
        </View>
        <Text style={styles.sparkle}>✦</Text>
      </View>

      {/* Focus Break */}
      <TouchableOpacity style={styles.breakCard} onPress={onBreak} activeOpacity={0.7}>
        <View style={styles.breakIcon}>
          <Icon name="clock" size={18} color={COLORS.purple} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.breakTitle}>Take a focus break</Text>
          <Text style={styles.breakSub}>10 minutes offline · +30 XP</Text>
        </View>
        <Icon name="chevron-right" size={16} color={COLORS.muted} />
      </TouchableOpacity>

      {/* Privacy Banner */}
      <View style={styles.banner}>
        <View style={styles.bannerIcon}>
          <Icon name="shield-check" size={18} color="#43a879" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.bannerBold}>Private by default.</Text>
          <Text style={styles.bannerSub}>
            Your estimates stay on this device. ROT never asks for your Instagram login
            and never claims exact Reel counts.
          </Text>
        </View>
      </View>

      {/* Earned Note */}
      <View style={styles.earnedNote}>
        <Icon name="sparkles" size={14} color={COLORS.pink} />
        <Text style={styles.earnedText}>
          {earnedXp > 0
            ? `You have earned ${earnedXp} XP from healthy actions today.`
            : 'Complete a mission or focus break to grow your brain bank.'}
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 30 },
  welcomeRow: { marginBottom: 14 },
  eyebrow: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    color: COLORS.pink,
  },
  eyebrowLight: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    color: '#f7d755',
  },
  greetingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 8,
  },
  heading: {
    flex: 1,
    fontSize: 30,
    fontWeight: '700',
    color: COLORS.ink,
    letterSpacing: -1,
    lineHeight: 34,
  },
  dot: { color: COLORS.pink },
  editNameChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 16,
    backgroundColor: '#f1eaf9',
    borderWidth: 1,
    borderColor: '#e4d6f4',
  },
  editNameChipText: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.purple,
  },
  nameEditorCard: {
    marginTop: 10,
    padding: 14,
    borderRadius: RADIUS.lg,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.line,
    gap: 8,
  },
  nameEditorTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.ink,
  },
  nameEditorHint: {
    fontSize: 10,
    color: COLORS.muted,
    lineHeight: 15,
  },
  nameInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  nameInput: {
    flex: 1,
    paddingVertical: 8,
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
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: '#f1eaf9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameSaveBtn: {
    paddingVertical: 9,
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
    paddingHorizontal: 11,
    borderRadius: 10,
    backgroundColor: '#ffe8f2',
  },
  nameResetBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.pink,
  },
  cloudSyncChoiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 4,
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
  subtitle: {
    fontSize: 14,
    color: COLORS.muted,
    marginTop: 6,
    lineHeight: 20,
  },

  // Streak Card
  streakCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: RADIUS.lg,
    marginBottom: 12,
  },
  streakIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: COLORS.palePink,
    justifyContent: 'center',
    alignItems: 'center',
  },
  streakTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    flexWrap: 'wrap',
  },
  streakTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: COLORS.ink,
  },
  gracePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 12,
    backgroundColor: '#e4f8ee',
  },
  gracePillText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#2d9364',
  },
  streakSub: {
    fontSize: 10,
    color: COLORS.muted,
    marginTop: 3,
  },
  recoverStreakBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: COLORS.pink,
    alignSelf: 'flex-start',
  },
  recoverStreakBtnText: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.white,
  },

  // Mood Container
  moodContainer: {
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: RADIUS.lg,
    padding: 12,
    marginBottom: 16,
    shadowColor: '#eadceb',
    shadowOpacity: 0.5,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  moodBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  moodFace: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: '#e8dcfb',
    justifyContent: 'center',
    alignItems: 'center',
  },
  moodEmoji: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.purple,
  },
  moodLabel: { fontSize: 12, fontWeight: '700', color: COLORS.ink },
  moodValue: { fontSize: 10, color: COLORS.muted, marginTop: 2 },
  moodSavedNote: {
    fontSize: 10,
    fontStyle: 'italic',
    color: COLORS.purple,
    marginTop: 3,
  },
  logMoodChip: {
    paddingVertical: 6,
    paddingHorizontal: 11,
    borderRadius: 14,
    backgroundColor: '#f1eaf9',
  },
  logMoodChipText: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.purple,
  },
  moodDrawer: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#f0e8f0',
    gap: 10,
  },
  moodDrawerTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.ink,
  },
  moodOptionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  moodOptionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 7,
    paddingHorizontal: 11,
    borderRadius: 16,
    backgroundColor: '#f4edf9',
  },
  moodOptionPillActive: {
    backgroundColor: COLORS.purple,
  },
  moodOptionEmoji: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.purple,
  },
  moodOptionText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.purple,
  },
  moodOptionTextActive: {
    color: COLORS.white,
  },
  moodNoteInput: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#dfd3eb',
    backgroundColor: '#faf6fe',
    fontSize: 11,
    color: COLORS.ink,
  },
  moodDrawerFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  moodDrawerHint: {
    flex: 1,
    fontSize: 10,
    color: COLORS.muted,
  },
  moodSaveBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: COLORS.pink,
  },
  moodSaveBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.white,
  },
  moodHistoryWrap: {
    marginTop: 4,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#f3ecf6',
    gap: 4,
  },
  moodHistoryTitle: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.purple,
  },
  moodHistoryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  moodHistoryDate: {
    fontSize: 9,
    fontWeight: '700',
    color: COLORS.muted,
  },
  moodHistoryValue: {
    flex: 1,
    fontSize: 10,
    color: COLORS.ink,
  },

  // Usage Card
  usageCard: {
    padding: 22,
    borderRadius: RADIUS.xl,
    backgroundColor: COLORS.purple,
    marginBottom: 14,
    shadowColor: 'rgba(81,44,138,0.13)',
    shadowOpacity: 1,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
    overflow: 'hidden',
  },
  usageTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    zIndex: 1,
  },
  statusDot: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  greenDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#7ae7a7' },
  statusText: { fontSize: 10, color: '#d9c9ed' },
  usageMain: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
    marginBottom: 14,
    zIndex: 1,
    gap: 10,
  },
  usageCopyCol: {
    flex: 1,
  },
  usageNumber: {
    fontSize: 48,
    fontWeight: '700',
    color: COLORS.white,
    letterSpacing: -2.5,
  },
  usageStatusHeadline: {
    fontSize: 30,
    fontWeight: '800',
    color: COLORS.yellow,
    letterSpacing: -1,
  },
  usageUnit: { fontSize: 22, color: '#cbbce4', letterSpacing: -0.5 },
  usageLabel: {
    fontSize: 12,
    color: '#d6cbea',
    marginTop: 4,
    lineHeight: 17,
  },
  warningPill: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 5,
    marginTop: 8,
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(41,16,76,0.48)',
  },
  warningPillText: {
    flex: 1,
    fontSize: 10,
    color: '#ffe89c',
    fontWeight: '600',
    lineHeight: 14,
  },
  sourcePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 8,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(41,16,76,0.38)',
    alignSelf: 'flex-start',
  },
  sourcePillText: {
    fontSize: 10,
    color: '#e5daf5',
    fontWeight: '600',
  },
  usageActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: COLORS.yellow,
    marginBottom: 14,
  },
  usageActionBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.purple,
  },
  mascot: {
    width: 86,
    height: 74,
    borderRadius: 37,
    backgroundColor: COLORS.pink,
    borderWidth: 3,
    borderColor: COLORS.darkPurple,
    position: 'relative',
    transform: [{ rotate: '7deg' }],
    shadowColor: '#f56da9',
    shadowOpacity: 0.5,
    shadowOffset: { width: 4, height: 5 },
    elevation: 4,
  },
  eyeLeft: {
    position: 'absolute',
    top: 30,
    left: 17,
    width: 15,
    height: 10,
    borderTopWidth: 3,
    borderTopColor: COLORS.darkPurple,
    borderRadius: 8,
  },
  eyeRight: {
    position: 'absolute',
    top: 30,
    right: 17,
    width: 15,
    height: 10,
    borderTopWidth: 3,
    borderTopColor: COLORS.darkPurple,
    borderRadius: 8,
  },
  mouth: {
    position: 'absolute',
    bottom: 15,
    left: 29,
    width: 18,
    height: 9,
    borderBottomWidth: 3,
    borderBottomColor: COLORS.darkPurple,
    borderRadius: 8,
  },
  progressTrack: {
    height: 8,
    backgroundColor: '#3d216d',
    borderRadius: 10,
    overflow: 'hidden',
    zIndex: 1,
  },
  progressFill: {
    height: '100%',
    backgroundColor: COLORS.yellow,
    borderRadius: 10,
  },
  usageFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
    zIndex: 1,
  },
  footerText: { fontSize: 11, color: '#dacdf0' },
  footerBold: { fontWeight: '700', color: COLORS.white },
  footerRemaining: { fontSize: 11, fontWeight: '700', color: '#ffe577' },

  // Gentle Nudge Banner
  nudgeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: RADIUS.lg,
    backgroundColor: '#fff3d6',
    borderWidth: 1,
    borderColor: '#f5dca4',
    marginBottom: 14,
  },
  nudgeIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    backgroundColor: '#ffe49e',
    justifyContent: 'center',
    alignItems: 'center',
  },
  nudgeText: {
    flex: 1,
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.ink,
    lineHeight: 16,
  },

  // Brainrot Index
  indexCard: {
    padding: 18,
    borderRadius: RADIUS.lg,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.line,
    marginBottom: 18,
  },
  indexTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  indexTopRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  trendBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  trendText: { fontSize: 11, fontWeight: '700', color: COLORS.green },
  breakdownToggleBtn: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 10,
    backgroundColor: '#f1eaf9',
  },
  breakdownToggleText: {
    fontSize: 9,
    fontWeight: '700',
    color: COLORS.purple,
  },
  indexScore: {
    fontSize: 38,
    fontWeight: '700',
    color: COLORS.purple,
    letterSpacing: -2,
    marginTop: 8,
  },
  indexMax: { fontSize: 18, color: '#a595b6' },
  indexLabel: { fontSize: 11, color: COLORS.muted, marginTop: 4 },
  scaleRow: {
    flexDirection: 'row',
    gap: 5,
    marginTop: 12,
  },
  scaleBar: { flex: 1, height: 10, borderRadius: 10 },
  scaleLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 7,
  },
  scaleText: { fontSize: 10, color: COLORS.muted },
  breakdownPanel: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#f0e8f0',
    gap: 6,
  },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  breakdownKey: {
    fontSize: 11,
    color: COLORS.muted,
  },
  breakdownVal: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.ink,
  },
  breakdownSummary: {
    fontSize: 10,
    color: COLORS.purple,
    fontWeight: '600',
    marginTop: 4,
  },

  // Section header
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 18,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.ink,
    letterSpacing: -0.5,
  },
  viewAll: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  viewAllText: { fontSize: 11, fontWeight: '700', color: COLORS.purple },
  missionList: { gap: 11 },

  // Habit Chart
  chartContainer: {
    flexDirection: 'row',
    gap: 8,
    padding: 16,
    borderRadius: RADIUS.lg,
    backgroundColor: '#f8f2fa',
    borderWidth: 1,
    borderColor: '#eee3f3',
  },
  chartLabels: {
    justifyContent: 'space-between',
    paddingBottom: 22,
  },
  chartLabel: { fontSize: 9, color: '#9c8eab' },
  chartBars: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 9,
    height: 118,
  },
  barWrap: {
    flex: 1,
    alignItems: 'center',
    height: '100%',
    justifyContent: 'flex-end',
    gap: 7,
  },
  bar: {
    width: '100%',
    maxWidth: 26,
    borderTopLeftRadius: 11,
    borderTopRightRadius: 11,
    borderBottomLeftRadius: 5,
    borderBottomRightRadius: 5,
    backgroundColor: '#cdb7eb',
  },
  barPink: { backgroundColor: COLORS.pink },
  barToday: {
    backgroundColor: COLORS.yellow,
    borderWidth: 2,
    borderColor: COLORS.purple,
  },
  barLabel: { fontSize: 10, fontWeight: '700', color: COLORS.muted },
  barLabelToday: { color: COLORS.purple },

  // Callout
  callout: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: '#ede2ee',
  },
  calloutIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: COLORS.paleGreen,
    justifyContent: 'center',
    alignItems: 'center',
  },
  calloutBold: { fontSize: 12, fontWeight: '700', color: COLORS.ink },
  calloutSub: { fontSize: 10, color: COLORS.muted, marginTop: 1 },
  sparkle: { color: COLORS.pink, fontSize: 18 },

  // Break card
  breakCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 16,
    padding: 14,
    borderRadius: RADIUS.lg,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  breakIcon: {
    width: 40,
    height: 40,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.lavender,
    justifyContent: 'center',
    alignItems: 'center',
  },
  breakTitle: { fontSize: 13, fontWeight: '700', color: COLORS.ink },
  breakSub: { fontSize: 11, color: COLORS.muted, marginTop: 3 },

  // Privacy Banner
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 16,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: RADIUS.lg,
    backgroundColor: COLORS.paleGreen,
    borderWidth: 1,
    borderColor: '#cdecd9',
  },
  bannerIcon: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.white,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bannerBold: { fontSize: 12, fontWeight: '700', color: COLORS.ink },
  bannerSub: { fontSize: 11, color: '#537364', marginTop: 2 },

  // Earned note
  earnedNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: RADIUS.md,
    backgroundColor: '#f7eff8',
  },
  earnedText: { fontSize: 11, color: COLORS.purple, flex: 1 },

  // Cloud Account Entry / Status
  clubAccountPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: RADIUS.lg,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: '#dfd3eb',
    marginBottom: 12,
  },
  clubAccountDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.green,
  },
  clubAccountPillTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.ink,
  },
  clubAccountPillSub: {
    fontSize: 10,
    color: COLORS.muted,
    marginTop: 2,
  },
  clubAccountManageText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.purple,
  },
  signedInPillBadge: {
    paddingVertical: 3,
    paddingHorizontal: 7,
    borderRadius: 10,
    backgroundColor: '#e4f8ee',
  },
  signedInPillBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#1e7e4e',
  },
  authEntryCard: {
    padding: 15,
    borderRadius: RADIUS.lg,
    backgroundColor: '#fcf9ff',
    borderWidth: 1,
    borderColor: '#dfd3eb',
    marginBottom: 12,
    gap: 10,
  },
  authEntryTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 11,
  },
  authEntryIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: COLORS.lavender,
    alignItems: 'center',
    justifyContent: 'center',
  },
  authEntryTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: COLORS.ink,
  },
  authEntryDesc: {
    fontSize: 11,
    color: COLORS.muted,
    marginTop: 3,
    lineHeight: 16,
  },
  authEntryError: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.pink,
    lineHeight: 15,
  },
  authEntryBtnRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  authGoogleBtn: {
    flex: 1,
    minWidth: 150,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: COLORS.purple,
  },
  authGoogleBtnDisabled: {
    opacity: 0.6,
  },
  authGoogleBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.white,
  },
  authGuestBtn: {
    paddingVertical: 10,
    paddingHorizontal: 13,
    borderRadius: 10,
    backgroundColor: '#ece3f8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  authGuestBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.purple,
  },
});
