import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { COLORS, RADIUS } from '../constants/theme';
import { LeaderboardTab } from '../constants/types';
import { rankings } from '../constants/data';
import { AbuseReportCategory } from '../types/database.types';
import { CloudAccountIdentity, CloudAuthStatus } from '../utils/authHelpers';
import {
  ABUSE_REPORT_CATEGORIES,
  formatStatusBandForRoster,
  getMemberInitials,
  SquadWorkspaceSnapshot,
  validateInviteeUserId,
} from '../utils/cloudSquadsCore';
import {
  acceptCloudSquadInvitation,
  blockCloudUser,
  createCloudSquad,
  createCloudSquadInvitation,
  declineCloudSquadInvitation,
  deleteCloudSquad,
  fetchSquadWorkspaceForUser,
  leaveCloudSquad,
  removeCloudSquadMember,
  revokeCloudSquadInvitation,
  submitCloudAbuseReport,
  transferCloudSquadOwnership,
  unblockCloudUser,
} from '../utils/cloudSquads';
import {
  TextInputRefTarget,
  useKeyboardAwareScroll,
} from '../utils/useKeyboardAwareScroll';
import Icon from '../components/Icon';

type Props = {
  displayName: string;
  userHandle: string;
  userInitials: string;
  totalXp: number;
  earnedTodayXp: number;
  cloudAuthStatus: CloudAuthStatus;
  cloudIdentity: CloudAccountIdentity | null;
  authBusy: boolean;
  onSignInWithGoogle: () => void;
  onToast: (message: string) => void;
  requestedTab?: LeaderboardTab;
  requestedTabSeq?: number;
};

export default function LeaderboardScreen({
  displayName,
  userHandle,
  userInitials,
  totalXp,
  earnedTodayXp,
  cloudAuthStatus,
  cloudIdentity,
  authBusy,
  onSignInWithGoogle,
  onToast,
  requestedTab,
  requestedTabSeq = 0,
}: Props) {
  const [tab, setTab] = useState<LeaderboardTab>(requestedTab ?? 'Friends');

  useEffect(() => {
    if (requestedTabSeq > 0 && requestedTab) {
      setTab(requestedTab);
    }
  }, [requestedTab, requestedTabSeq]);

  // Cloud Squad workspace state (strictly active when authenticated on Squad tab)
  const [workspace, setWorkspace] = useState<SquadWorkspaceSnapshot | null>(null);
  const [selectedSquadId, setSelectedSquadId] = useState<string | null>(null);
  const [squadLoading, setSquadLoading] = useState(false);
  const [squadBusy, setSquadBusy] = useState(false);
  const [squadError, setSquadError] = useState<string | null>(null);

  const [newSquadName, setNewSquadName] = useState('');
  const [inviteCodeInput, setInviteCodeInput] = useState('');
  const [targetInviteeId, setTargetInviteeId] = useState('');
  const [expandedMemberId, setExpandedMemberId] = useState<string | null>(null);
  const [reportingMemberId, setReportingMemberId] = useState<string | null>(null);
  const [reportCategory, setReportCategory] =
    useState<AbuseReportCategory>('harassment');
  const [reportDetails, setReportDetails] = useState('');
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [confirmTransferId, setConfirmTransferId] = useState<string | null>(null);
  const [confirmBlockId, setConfirmBlockId] = useState<string | null>(null);
  const [confirmLeaveSquad, setConfirmLeaveSquad] = useState(false);
  const [confirmDeleteSquad, setConfirmDeleteSquad] = useState(false);
  const [showBlockedList, setShowBlockedList] = useState(false);

  const {
    scrollRef,
    bottomSpacer,
    handleScroll,
    handleScrollLayout,
    focusInput,
  } = useKeyboardAwareScroll();
  const targetInviteeInputRef = useRef<TextInputRefTarget>(null);
  const reportDetailsInputRef = useRef<TextInputRefTarget>(null);
  const newSquadNameInputRef = useRef<TextInputRefTarget>(null);
  const inviteCodeInputRef = useRef<TextInputRefTarget>(null);

  const cloudUserId = cloudIdentity?.userId ?? null;
  const cloudXp = cloudIdentity?.cloudXp ?? 0;

  const reloadSquadWorkspace = useCallback(
    async (preferredId?: string | null) => {
      if (cloudAuthStatus !== 'authenticated' || !cloudUserId) {
        setWorkspace(null);
        setSquadError(null);
        return;
      }
      setSquadLoading(true);
      setSquadError(null);
      const res = await fetchSquadWorkspaceForUser(
        cloudUserId,
        preferredId ?? selectedSquadId
      );
      setSquadLoading(false);
      if (res.ok) {
        setWorkspace(res.data);
        setSelectedSquadId(res.data.activeSquadId);
      } else {
        setSquadError(res.error);
      }
    },
    [cloudAuthStatus, cloudUserId, selectedSquadId]
  );

  useEffect(() => {
    setExpandedMemberId(null);
    setReportingMemberId(null);
    setConfirmRemoveId(null);
    setConfirmTransferId(null);
    setConfirmBlockId(null);
    setConfirmLeaveSquad(false);
    setConfirmDeleteSquad(false);
    setTargetInviteeId('');
    setInviteCodeInput('');
    setNewSquadName('');
  }, [cloudUserId]);

  useEffect(() => {
    if (tab === 'Squad' && cloudAuthStatus === 'authenticated' && cloudUserId) {
      void reloadSquadWorkspace();
    } else if (cloudAuthStatus !== 'authenticated') {
      setWorkspace(null);
      setSelectedSquadId(null);
      setSquadError(null);
    }
  }, [tab, cloudAuthStatus, cloudUserId, cloudXp, reloadSquadWorkspace]);

  // Local Demo Preview rows for Friends & Campus
  const demoTab: 'Friends' | 'Campus' = tab === 'Campus' ? 'Campus' : 'Friends';
  const demoRows = rankings[demoTab]
    .map((r) =>
      r.current
        ? {
            ...r,
            name: displayName,
            handle: demoTab === 'Campus' ? r.handle : userHandle,
            initials: userInitials,
            xp: totalXp,
            change: `+${earnedTodayXp} XP`,
          }
        : r
    )
    .sort((a, b) => b.xp - a.xp);
  const demoRank = demoRows.findIndex((r) => r.current) + 1;

  const activeSquad =
    workspace?.squads.find((s) => s.id === workspace.activeSquadId) ?? null;
  const roster = workspace?.roster ?? [];
  const mySquadRank =
    cloudUserId && roster.length > 0
      ? roster.findIndex((m) => m.user_id === cloudUserId) + 1
      : 0;

  async function handleCreateSquad() {
    if (squadBusy) return;
    setSquadBusy(true);
    const res = await createCloudSquad(newSquadName);
    setSquadBusy(false);
    if (!res.ok) {
      onToast(res.error);
      return;
    }
    setNewSquadName('');
    onToast(`Created squad “${res.data.name}”.`);
    await reloadSquadWorkspace(res.data.id);
  }

  async function handleJoinByCode(codeToUse?: string) {
    if (squadBusy) return;
    setSquadBusy(true);
    const res = await acceptCloudSquadInvitation(codeToUse ?? inviteCodeInput);
    setSquadBusy(false);
    if (!res.ok) {
      onToast(res.error);
      return;
    }
    if (!codeToUse) {
      setInviteCodeInput('');
    }
    onToast(`Joined squad “${res.data.squad_name}”.`);
    await reloadSquadWorkspace(res.data.squad_id);
  }

  async function handleDeclineIncomingInvite(invitationId: string) {
    if (squadBusy) return;
    setSquadBusy(true);
    const res = await declineCloudSquadInvitation(invitationId);
    setSquadBusy(false);
    if (!res.ok) {
      onToast(res.error);
      return;
    }
    onToast('Invitation declined.');
    await reloadSquadWorkspace();
  }

  async function handleGenerateInviteCode() {
    if (!activeSquad || squadBusy) return;
    setSquadBusy(true);
    const res = await createCloudSquadInvitation(activeSquad.id, null, 168);
    setSquadBusy(false);
    if (!res.ok) {
      onToast(res.error);
      return;
    }
    onToast(`Invite code created: ${res.data.invite_code}`);
    await reloadSquadWorkspace(activeSquad.id);
  }

  async function handleSendTargetedInvite() {
    if (!activeSquad || squadBusy) return;
    const check = validateInviteeUserId(targetInviteeId);
    if (!check.valid) {
      onToast(check.error || 'Enter a valid ROT Member ID.');
      return;
    }
    setSquadBusy(true);
    const res = await createCloudSquadInvitation(
      activeSquad.id,
      check.cleanId,
      168
    );
    setSquadBusy(false);
    if (!res.ok) {
      onToast(res.error);
      return;
    }
    setTargetInviteeId('');
    onToast(`Targeted invitation sent (${res.data.invite_code}).`);
    await reloadSquadWorkspace(activeSquad.id);
  }

  async function handleShareInviteCode(code: string) {
    if (!activeSquad) return;
    try {
      await Share.share({
        title: `Join my ROT Squad: ${activeSquad.name}`,
        message: `Join my ROT Brainrot Club squad "${activeSquad.name}" using invite code: ${code}`,
      });
    } catch {
      onToast(`Invite code: ${code}`);
    }
  }

  async function handleRevokeInvite(invitationId: string) {
    if (!activeSquad || squadBusy) return;
    setSquadBusy(true);
    const res = await revokeCloudSquadInvitation(invitationId);
    setSquadBusy(false);
    if (!res.ok) {
      onToast(res.error);
      return;
    }
    onToast('Invitation revoked.');
    await reloadSquadWorkspace(activeSquad.id);
  }

  async function handleTransferOwnership(newOwnerId: string, memberName: string) {
    if (!activeSquad || squadBusy) return;
    setSquadBusy(true);
    const res = await transferCloudSquadOwnership(activeSquad.id, newOwnerId);
    setSquadBusy(false);
    setConfirmTransferId(null);
    setExpandedMemberId(null);
    if (!res.ok) {
      onToast(res.error);
      return;
    }
    onToast(`Transferred ownership of ${activeSquad.name} to ${memberName}.`);
    await reloadSquadWorkspace(activeSquad.id);
  }

  async function handleRemoveMember(targetUserId: string, memberName: string) {
    if (!activeSquad || squadBusy) return;
    setSquadBusy(true);
    const res = await removeCloudSquadMember(activeSquad.id, targetUserId);
    setSquadBusy(false);
    setConfirmRemoveId(null);
    setExpandedMemberId(null);
    if (!res.ok) {
      onToast(res.error);
      return;
    }
    onToast(`Removed ${memberName} from ${activeSquad.name}.`);
    await reloadSquadWorkspace(activeSquad.id);
  }

  async function handleBlockMember(targetUserId: string, memberName: string) {
    if (!cloudUserId || squadBusy) return;
    setSquadBusy(true);
    const res = await blockCloudUser(cloudUserId, targetUserId);
    setSquadBusy(false);
    setConfirmBlockId(null);
    setExpandedMemberId(null);
    if (!res.ok) {
      onToast(res.error);
      return;
    }
    onToast(`Blocked ${memberName}. They are hidden from your squad roster.`);
    await reloadSquadWorkspace();
  }

  async function handleUnblockMember(blockedId: string) {
    if (!cloudUserId || squadBusy) return;
    setSquadBusy(true);
    const res = await unblockCloudUser(cloudUserId, blockedId);
    setSquadBusy(false);
    if (!res.ok) {
      onToast(res.error);
      return;
    }
    onToast('User unblocked.');
    await reloadSquadWorkspace();
  }

  async function handleSubmitReport(targetUserId: string, memberName: string) {
    if (squadBusy) return;
    setSquadBusy(true);
    const res = await submitCloudAbuseReport({
      reportedUserId: targetUserId,
      category: reportCategory,
      details: reportDetails,
      squadId: activeSquad?.id ?? null,
    });
    setSquadBusy(false);
    setReportingMemberId(null);
    setReportDetails('');
    setExpandedMemberId(null);
    if (!res.ok) {
      onToast(res.error);
      return;
    }
    onToast(`Safety report submitted for ${memberName}.`);
  }

  async function handleLeaveSquad() {
    if (!activeSquad || squadBusy) return;
    setSquadBusy(true);
    const res = await leaveCloudSquad(activeSquad.id);
    setSquadBusy(false);
    setConfirmLeaveSquad(false);
    if (!res.ok) {
      onToast(res.error);
      return;
    }
    onToast(
      res.data.squad_deleted
        ? `Left and closed solo squad “${activeSquad.name}”.`
        : `Left squad “${activeSquad.name}”.`
    );
    setSelectedSquadId(null);
    await reloadSquadWorkspace(null);
  }

  async function handleDeleteSquad() {
    if (!activeSquad || squadBusy) return;
    setSquadBusy(true);
    const res = await deleteCloudSquad(activeSquad.id);
    setSquadBusy(false);
    setConfirmDeleteSquad(false);
    if (!res.ok) {
      onToast(res.error);
      return;
    }
    onToast(`Deleted squad “${activeSquad.name}”.`);
    setSelectedSquadId(null);
    await reloadSquadWorkspace(null);
  }

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.scroll}
      contentContainerStyle={[
        styles.content,
        { paddingBottom: 40 + bottomSpacer },
      ]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      scrollEventThrottle={16}
      onScroll={(e) => handleScroll(e.nativeEvent.contentOffset.y)}
      onLayout={handleScrollLayout}
    >
        {/* Header */}
        <Text style={styles.eyebrow}>FRIENDLY COMPETITION</Text>
        <Text style={styles.heading}>
          Climb gently, together<Text style={styles.dot}>.</Text>
        </Text>
        <Text style={styles.subtitle}>
          A little XP, a lot of encouragement. No shame-based rankings here.
        </Text>

        {/* Rank summary */}
        <View style={styles.rankSummaryRow}>
          <View style={styles.rankSummary}>
            <View style={styles.rankIcon}>
              <Icon name="trophy" size={17} color={COLORS.purple} />
            </View>
            <View>
              <Text style={styles.rankValue}>
                {tab === 'Squad'
                  ? cloudAuthStatus === 'authenticated'
                    ? mySquadRank > 0
                      ? `#${mySquadRank}`
                      : '—'
                    : 'Guest'
                  : `#${demoRank}`}
              </Text>
              <Text style={styles.rankLabel}>
                {tab === 'Squad'
                  ? activeSquad
                    ? `in ${activeSquad.name}`
                    : 'cloud squad spot'
                  : 'local preview spot'}
              </Text>
            </View>
          </View>

          {tab === 'Squad' && cloudAuthStatus === 'authenticated' && (
            <View style={styles.rankSummary}>
              <View style={styles.rankIcon}>
                <Icon name="zap" size={17} color={COLORS.pink} />
              </View>
              <View>
                <Text style={styles.rankValue}>{cloudXp} XP</Text>
                <Text style={styles.rankLabel}>your Cloud XP</Text>
              </View>
            </View>
          )}
        </View>

        {/* Tabs */}
        <View style={styles.tabs}>
          {(['Friends', 'Squad', 'Campus'] as LeaderboardTab[]).map((t) => (
            <TouchableOpacity
              key={t}
              style={[styles.tab, tab === t && styles.tabActive]}
              onPress={() => setTab(t)}
            >
              <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
                {t}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {tab === 'Squad' ? (
          cloudAuthStatus !== 'authenticated' || !cloudIdentity ? (
            <View style={styles.cloudAuthCard}>
              <View style={styles.cloudAuthHeader}>
                <View style={styles.cloudAuthIcon}>
                  <Icon name="users" size={19} color={COLORS.purple} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cloudAuthTitle}>
                    Invite-Only Cloud Squads
                  </Text>
                  <Text style={styles.cloudAuthDesc}>
                    Sign in with Google to create or join invite-only squads (up to 12 members). Only your Cloud XP (starting at 0 XP) and optional status band are shared — your local {totalXp} Guest XP stays private on this device.
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                style={[
                  styles.primaryBtn,
                  (authBusy || cloudAuthStatus === 'unconfigured') && {
                    opacity: 0.6,
                  },
                ]}
                onPress={onSignInWithGoogle}
                disabled={authBusy || cloudAuthStatus === 'unconfigured'}
                activeOpacity={0.8}
              >
                <Icon name="user" size={14} color={COLORS.white} />
                <Text style={styles.primaryBtnText}>
                  {authBusy
                    ? 'Signing in...'
                    : cloudAuthStatus === 'unconfigured'
                    ? 'Cloud Env Required'
                    : 'Continue with Google'}
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.squadContainer}>
              {/* Live Cloud Banner */}
              <View style={styles.cloudLiveBanner}>
                <View style={styles.cloudLiveDot} />
                <Text style={styles.cloudLiveText}>
                  LIVE CLOUD SQUAD · {cloudIdentity.displayName} ({cloudXp} Cloud XP)
                </Text>
                <TouchableOpacity
                  style={styles.refreshChip}
                  onPress={() => void reloadSquadWorkspace()}
                  disabled={squadLoading || squadBusy}
                  activeOpacity={0.75}
                >
                  <Icon name="refresh" size={12} color={COLORS.purple} />
                  <Text style={styles.refreshChipText}>Refresh</Text>
                </TouchableOpacity>
              </View>

              {squadError ? (
                <View style={styles.errorBanner}>
                  <Icon name="alert-circle" size={14} color={COLORS.pink} />
                  <Text style={styles.errorBannerText}>{squadError}</Text>
                </View>
              ) : null}

              {/* Incoming targeted invitations */}
              {(workspace?.incomingInvites.length ?? 0) > 0 && (
                <View style={styles.card}>
                  <Text style={styles.eyebrow}>INCOMING SQUAD INVITES</Text>
                  {workspace!.incomingInvites.map((inv) => (
                    <View key={inv.id} style={styles.inviteItemRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.inviteCodeLabel}>
                          Code: {inv.invite_code}
                        </Text>
                        <Text style={styles.inviteSub}>
                          Expires {new Date(inv.expires_at).toLocaleDateString()}
                        </Text>
                      </View>
                      <TouchableOpacity
                        style={styles.smallPrimaryBtn}
                        onPress={() => void handleJoinByCode(inv.invite_code)}
                        disabled={squadBusy}
                      >
                        <Text style={styles.smallPrimaryBtnText}>Accept</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.smallSecondaryBtn}
                        onPress={() => void handleDeclineIncomingInvite(inv.id)}
                        disabled={squadBusy}
                      >
                        <Text style={styles.smallSecondaryBtnText}>Decline</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}

              {/* Squad Switcher */}
              {(workspace?.squads.length ?? 0) > 0 && (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.squadSelectorRow}
                >
                  {workspace!.squads.map((sq) => {
                    const selected = sq.id === activeSquad?.id;
                    return (
                      <TouchableOpacity
                        key={sq.id}
                        style={[
                          styles.squadPill,
                          selected && styles.squadPillActive,
                        ]}
                        onPress={() => {
                          setSelectedSquadId(sq.id);
                          setExpandedMemberId(null);
                          setConfirmLeaveSquad(false);
                          setConfirmDeleteSquad(false);
                          void reloadSquadWorkspace(sq.id);
                        }}
                        activeOpacity={0.8}
                      >
                        <Text
                          style={[
                            styles.squadPillText,
                            selected && styles.squadPillTextActive,
                          ]}
                        >
                          {sq.name} · {sq.myRole === 'owner' ? 'Owner' : 'Member'}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              )}

              {/* Active Squad Card & Roster */}
              {squadLoading && !workspace ? (
                <View style={styles.loadingCard}>
                  <ActivityIndicator color={COLORS.purple} />
                  <Text style={styles.loadingText}>Loading your Cloud Squad...</Text>
                </View>
              ) : activeSquad ? (
                <>
                  <View style={styles.card}>
                    <View style={styles.squadHeaderRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.eyebrow}>
                          {activeSquad.myRole === 'owner'
                            ? 'YOUR SQUAD · OWNER'
                            : 'YOUR SQUAD · MEMBER'}
                        </Text>
                        <Text style={styles.squadTitle}>{activeSquad.name}</Text>
                        <Text style={styles.squadMeta}>
                          {roster.length} / {activeSquad.max_members} members · Ranked by Cloud XP
                        </Text>
                      </View>
                      {activeSquad.myRole === 'owner' && (
                        <TouchableOpacity
                          style={styles.smallPrimaryBtn}
                          onPress={() => void handleGenerateInviteCode()}
                          disabled={squadBusy}
                          activeOpacity={0.8}
                        >
                          <Icon name="plus" size={12} color={COLORS.white} />
                          <Text style={styles.smallPrimaryBtnText}>Invite code</Text>
                        </TouchableOpacity>
                      )}
                    </View>

                    {/* Pending outgoing invites & targeted invite input for Owner */}
                    {activeSquad.myRole === 'owner' && (
                      <View style={styles.outgoingInvitesBox}>
                        <Text style={styles.subEyebrow}>
                          SEND TARGETED INVITATION BY MEMBER ID
                        </Text>
                        <View style={styles.inputRow}>
                          <TextInput
                            ref={targetInviteeInputRef}
                            style={styles.textInput}
                            value={targetInviteeId}
                            onChangeText={setTargetInviteeId}
                            placeholder="Paste member ID (UUID from Settings)"
                            placeholderTextColor="#a395b2"
                            autoCapitalize="none"
                            autoCorrect={false}
                            maxLength={64}
                            returnKeyType="send"
                            onFocus={() =>
                              focusInput(targetInviteeInputRef.current, 32)
                            }
                            onSubmitEditing={() =>
                              void handleSendTargetedInvite()
                            }
                          />
                          <TouchableOpacity
                            style={styles.smallPrimaryBtn}
                            onPress={() => void handleSendTargetedInvite()}
                            disabled={squadBusy}
                          >
                            <Text style={styles.smallPrimaryBtnText}>Send</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    )}

                    {activeSquad.myRole === 'owner' &&
                      (workspace?.outgoingInvites.length ?? 0) > 0 && (
                        <View style={styles.outgoingInvitesBox}>
                          <Text style={styles.subEyebrow}>
                            ACTIVE INVITE CODES ({workspace!.outgoingInvites.length})
                          </Text>
                          {workspace!.outgoingInvites.map((inv) => (
                            <View key={inv.id} style={styles.inviteItemRow}>
                              <Text style={styles.inviteCodeMono} selectable>
                                {inv.invite_code}
                              </Text>
                              <TouchableOpacity
                                style={styles.smallSecondaryBtn}
                                onPress={() =>
                                  void handleShareInviteCode(inv.invite_code)
                                }
                              >
                                <Icon name="share" size={11} color={COLORS.purple} />
                                <Text style={styles.smallSecondaryBtnText}>
                                  Share
                                </Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={styles.smallDangerBtn}
                                onPress={() => void handleRevokeInvite(inv.id)}
                                disabled={squadBusy}
                              >
                                <Text style={styles.smallDangerBtnText}>
                                  Revoke
                                </Text>
                              </TouchableOpacity>
                            </View>
                          ))}
                        </View>
                      )}

                    {/* Roster Rows */}
                    <View style={styles.rankingList}>
                      {roster.map((member, index) => {
                        const isSelf = member.user_id === cloudUserId;
                        const band = formatStatusBandForRoster(
                          member.status_band,
                          member.share_squad_status
                        );
                        const isExpanded = expandedMemberId === member.user_id;
                        const isReporting = reportingMemberId === member.user_id;

                        return (
                          <View
                            key={member.user_id}
                            style={[
                              styles.rankingRowWrap,
                              isSelf && styles.rankingRowCurrent,
                            ]}
                          >
                            <View style={styles.rankingRowInner}>
                              <Text style={styles.rankNum}>{index + 1}</Text>
                              <View style={styles.rankAvatar}>
                                <Text style={styles.rankAvatarText}>
                                  {getMemberInitials(member.display_name)}
                                </Text>
                              </View>
                              <View style={styles.rankCopy}>
                                <Text style={styles.rankName}>
                                  {member.display_name}
                                  {isSelf ? ' · You' : ''}
                                </Text>
                                <View style={styles.memberBadgesRow}>
                                  <Text style={styles.rankHandle}>
                                    {member.role === 'owner' ? 'Owner' : 'Member'}
                                  </Text>
                                  <View
                                    style={[
                                      styles.bandChip,
                                      band.tone === 'green' && styles.bandGreen,
                                      band.tone === 'pink' && styles.bandPink,
                                      band.tone === 'orange' && styles.bandOrange,
                                    ]}
                                  >
                                    <Text style={styles.bandChipText}>
                                      {band.label}
                                    </Text>
                                  </View>
                                </View>
                              </View>
                              <View style={styles.rankXpWrap}>
                                <Icon name="zap" size={12} color={COLORS.pink} />
                                <Text style={styles.rankXp}>{member.cloud_xp}</Text>
                              </View>
                              <TouchableOpacity
                                style={styles.rankAction}
                                onPress={() => {
                                  if (isSelf) {
                                    onToast('Keep choosing balance with your squad!');
                                    return;
                                  }
                                  setConfirmRemoveId(null);
                                  setConfirmTransferId(null);
                                  setConfirmBlockId(null);
                                  setReportingMemberId(null);
                                  setExpandedMemberId(
                                    isExpanded ? null : member.user_id
                                  );
                                }}
                              >
                                <Text style={styles.rankActionText}>
                                  {isSelf ? 'Streak' : isExpanded ? 'Close' : 'Manage'}
                                </Text>
                              </TouchableOpacity>
                            </View>

                            {!isSelf && isExpanded && (
                              <View style={styles.memberActionsTray}>
                                <View style={styles.memberActionsRow}>
                                  <TouchableOpacity
                                    style={styles.smallSecondaryBtn}
                                    onPress={() =>
                                      onToast(
                                        `Sent ${member.display_name} a friendly high-five.`
                                      )
                                    }
                                  >
                                    <Text style={styles.smallSecondaryBtnText}>
                                      High-five
                                    </Text>
                                  </TouchableOpacity>

                                  {activeSquad.myRole === 'owner' && (
                                    <>
                                      <TouchableOpacity
                                        style={styles.smallSecondaryBtn}
                                        onPress={() => {
                                          if (confirmTransferId === member.user_id) {
                                            void handleTransferOwnership(
                                              member.user_id,
                                              member.display_name
                                            );
                                          } else {
                                            setConfirmTransferId(member.user_id);
                                          }
                                        }}
                                        disabled={squadBusy}
                                      >
                                        <Text style={styles.smallSecondaryBtnText}>
                                          {confirmTransferId === member.user_id
                                            ? 'Confirm make owner'
                                            : 'Make owner'}
                                        </Text>
                                      </TouchableOpacity>

                                      <TouchableOpacity
                                        style={styles.smallDangerBtn}
                                        onPress={() => {
                                          if (confirmRemoveId === member.user_id) {
                                            void handleRemoveMember(
                                              member.user_id,
                                              member.display_name
                                            );
                                          } else {
                                            setConfirmRemoveId(member.user_id);
                                          }
                                        }}
                                        disabled={squadBusy}
                                      >
                                        <Text style={styles.smallDangerBtnText}>
                                          {confirmRemoveId === member.user_id
                                            ? 'Confirm remove'
                                            : 'Remove'}
                                        </Text>
                                      </TouchableOpacity>
                                    </>
                                  )}

                                  <TouchableOpacity
                                    style={styles.smallDangerBtn}
                                    onPress={() => {
                                      if (confirmBlockId === member.user_id) {
                                        void handleBlockMember(
                                          member.user_id,
                                          member.display_name
                                        );
                                      } else {
                                        setConfirmBlockId(member.user_id);
                                      }
                                    }}
                                    disabled={squadBusy}
                                  >
                                    <Text style={styles.smallDangerBtnText}>
                                      {confirmBlockId === member.user_id
                                        ? 'Confirm block'
                                        : 'Block'}
                                    </Text>
                                  </TouchableOpacity>

                                  <TouchableOpacity
                                    style={styles.smallSecondaryBtn}
                                    onPress={() =>
                                      setReportingMemberId(
                                        isReporting ? null : member.user_id
                                      )
                                    }
                                  >
                                    <Text style={styles.smallSecondaryBtnText}>
                                      Report
                                    </Text>
                                  </TouchableOpacity>
                                </View>

                                {isReporting && (
                                  <View style={styles.reportBox}>
                                    <Text style={styles.subEyebrow}>
                                      SUBMIT SAFETY REPORT
                                    </Text>
                                    <View style={styles.reportCatsRow}>
                                      {ABUSE_REPORT_CATEGORIES.map((cat) => (
                                        <TouchableOpacity
                                          key={cat.id}
                                          style={[
                                            styles.catChip,
                                            reportCategory === cat.id &&
                                              styles.catChipActive,
                                          ]}
                                          onPress={() => setReportCategory(cat.id)}
                                        >
                                          <Text
                                            style={[
                                              styles.catChipText,
                                              reportCategory === cat.id &&
                                                styles.catChipTextActive,
                                            ]}
                                          >
                                            {cat.label}
                                          </Text>
                                        </TouchableOpacity>
                                      ))}
                                    </View>
                                    <TextInput
                                      ref={reportDetailsInputRef}
                                      style={[
                                        styles.textInput,
                                        styles.textInputMultiline,
                                      ]}
                                      value={reportDetails}
                                      onChangeText={setReportDetails}
                                      placeholder="Optional details (max 1000 chars)"
                                      placeholderTextColor="#a395b2"
                                      maxLength={1000}
                                      multiline
                                      onFocus={() =>
                                        focusInput(
                                          reportDetailsInputRef.current,
                                          64
                                        )
                                      }
                                    />
                                    <TouchableOpacity
                                      style={styles.smallPrimaryBtn}
                                      onPress={() =>
                                        void handleSubmitReport(
                                          member.user_id,
                                          member.display_name
                                        )
                                      }
                                      disabled={squadBusy}
                                    >
                                      <Text style={styles.smallPrimaryBtnText}>
                                        Submit report
                                      </Text>
                                    </TouchableOpacity>
                                  </View>
                                )}
                              </View>
                            )}
                          </View>
                        );
                      })}
                    </View>

                    {/* Leave or Delete Squad Controls */}
                    <View style={styles.squadDangerRow}>
                      {(activeSquad.myRole === 'member' || roster.length <= 1) && (
                        <TouchableOpacity
                          style={styles.smallDangerBtn}
                          onPress={() => {
                            if (!confirmLeaveSquad) {
                              setConfirmLeaveSquad(true);
                              return;
                            }
                            void handleLeaveSquad();
                          }}
                          disabled={squadBusy}
                        >
                          <Text style={styles.smallDangerBtnText}>
                            {confirmLeaveSquad ? 'Tap again to leave squad' : 'Leave squad'}
                          </Text>
                        </TouchableOpacity>
                      )}

                      {activeSquad.myRole === 'owner' && (
                        <TouchableOpacity
                          style={styles.smallDangerBtn}
                          onPress={() => {
                            if (!confirmDeleteSquad) {
                              setConfirmDeleteSquad(true);
                              return;
                            }
                            void handleDeleteSquad();
                          }}
                          disabled={squadBusy}
                        >
                          <Icon name="trash" size={11} color={COLORS.pink} />
                          <Text style={styles.smallDangerBtnText}>
                            {confirmDeleteSquad
                              ? 'Tap again to delete squad'
                              : 'Delete squad'}
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                </>
              ) : (
                <View style={styles.card}>
                  <Text style={styles.eyebrow}>NO SQUAD YET</Text>
                  <Text style={styles.squadTitle}>
                    Create or join your first Squad
                  </Text>
                  <Text style={styles.inviteSub}>
                    Start a private group for friends or enter an invite code below.
                  </Text>
                </View>
              )}

              {/* Create & Join Forms */}
              <View style={styles.card}>
                <Text style={styles.eyebrow}>CREATE A SQUAD</Text>
                <View style={styles.inputRow}>
                  <TextInput
                    ref={newSquadNameInputRef}
                    style={styles.textInput}
                    value={newSquadName}
                    onChangeText={setNewSquadName}
                    placeholder="Squad name (2–40 chars)"
                    placeholderTextColor="#a395b2"
                    maxLength={40}
                    returnKeyType="done"
                    onFocus={() => focusInput(newSquadNameInputRef.current, 48)}
                    onSubmitEditing={() => void handleCreateSquad()}
                  />
                  <TouchableOpacity
                    style={styles.smallPrimaryBtn}
                    onPress={() => void handleCreateSquad()}
                    disabled={squadBusy}
                  >
                    <Text style={styles.smallPrimaryBtnText}>Create</Text>
                  </TouchableOpacity>
                </View>

                <Text style={[styles.eyebrow, { marginTop: 12 }]}>
                  JOIN WITH INVITE CODE
                </Text>
                <View style={styles.inputRow}>
                  <TextInput
                    ref={inviteCodeInputRef}
                    style={styles.textInput}
                    value={inviteCodeInput}
                    onChangeText={setInviteCodeInput}
                    placeholder="Enter 16-character invite code"
                    placeholderTextColor="#a395b2"
                    autoCapitalize="characters"
                    maxLength={64}
                    returnKeyType="go"
                    onFocus={() => focusInput(inviteCodeInputRef.current, 48)}
                    onSubmitEditing={() => void handleJoinByCode()}
                  />
                  <TouchableOpacity
                    style={styles.smallPrimaryBtn}
                    onPress={() => void handleJoinByCode()}
                    disabled={squadBusy}
                  >
                    <Text style={styles.smallPrimaryBtnText}>Join</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Blocked Users Management */}
              {(workspace?.blocks.length ?? 0) > 0 && (
                <View style={styles.card}>
                  <TouchableOpacity
                    style={styles.squadHeaderRow}
                    onPress={() => setShowBlockedList((prev) => !prev)}
                  >
                    <Text style={styles.eyebrow}>
                      BLOCKED USERS ({workspace!.blocks.length})
                    </Text>
                    <Text style={styles.refreshChipText}>
                      {showBlockedList ? 'Hide' : 'Show'}
                    </Text>
                  </TouchableOpacity>
                  {showBlockedList &&
                    workspace!.blocks.map((blk) => (
                      <View key={blk.blocked_id} style={styles.inviteItemRow}>
                        <Text style={styles.inviteSub} numberOfLines={1}>
                          User {blk.blocked_id.slice(0, 8)}…
                        </Text>
                        <TouchableOpacity
                          style={styles.smallSecondaryBtn}
                          onPress={() => void handleUnblockMember(blk.blocked_id)}
                          disabled={squadBusy}
                        >
                          <Text style={styles.smallSecondaryBtnText}>
                            Unblock
                          </Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                </View>
              )}

              <View style={styles.lbFooter}>
                <Icon name="shield-check" size={14} color="#44a878" />
                <Text style={styles.lbFooterText}>
                  Only Cloud XP and optional target bands are visible in your squad. Raw Instagram minutes are never uploaded or shared.
                </Text>
              </View>
            </View>
          )
        ) : (
          <>
            {/* Clearly labelled Local Demo Preview for Friends & Campus */}
            <View style={styles.demoPreviewBanner}>
              <Icon name="info" size={14} color={COLORS.purple} />
              <View style={{ flex: 1 }}>
                <Text style={styles.demoPreviewTitle}>
                  LOCAL DEMO PREVIEW ({demoTab})
                </Text>
                <Text style={styles.demoPreviewDesc}>
                  Sample club members stored locally alongside your {totalXp} local XP. Switch to Squad for live cloud groups.
                </Text>
              </View>
            </View>

            {/* League Card */}
            <View style={styles.leagueCard}>
              <Text style={styles.leagueEyebrow}>
                LOCAL DEMO LEAGUE · WEEK 03
              </Text>
              <Text style={styles.leagueTitle}>Gold-ish league</Text>
              <Text style={styles.leagueSub}>
                Keep making healthy choices to stay in the sunny zone. This preview merges your local XP with sample members.
              </Text>

              <View style={styles.leagueRange}>
                <Text style={styles.rangeLabel}>{totalXp} XP</Text>
                <View style={styles.rangeTrack}>
                  <View
                    style={[
                      styles.rangeFill,
                      {
                        width: `${Math.min(
                          100,
                          Math.round((totalXp / 450) * 100)
                        )}%` as any,
                      },
                    ]}
                  />
                </View>
                <Text style={styles.rangeLabel}>450 XP</Text>
              </View>

              <View style={styles.tierBadge}>
                <View style={styles.tierIcon}>
                  <Icon name="crown" size={26} color={COLORS.purple} />
                </View>
                <Text style={styles.tierName}>GOLD-ISH (DEMO)</Text>
                <Text style={styles.tierRank}>
                  Rank {demoRank} of {demoRows.length}
                </Text>
              </View>
            </View>

            {/* Rankings */}
            <View style={styles.rankingHeader}>
              <View>
                <Text style={styles.eyebrow}>
                  {demoTab.toUpperCase()} LOCAL DEMO RANKINGS
                </Text>
                <Text style={styles.rankingTitle}>Who is making space today?</Text>
              </View>
              <Text style={styles.rankingMeta}>
                Local demo preview · {demoRows.length} members
              </Text>
            </View>

            <View style={styles.rankingList}>
              {demoRows.map((row, index) => (
                <View
                  key={`${demoTab}-${row.name}-${row.handle}`}
                  style={[styles.rankingRow, row.current && styles.rankingRowCurrent]}
                >
                  <Text
                    style={[
                      styles.rankNum,
                      index === 0 && { color: '#d7981f' },
                      index === 1 && { color: '#8c83a4' },
                      index === 2 && { color: '#b9784e' },
                    ]}
                  >
                    {index + 1}
                  </Text>
                  <View
                    style={[
                      styles.rankAvatar,
                      index === 1 && { backgroundColor: '#ffe0ed' },
                      index === 2 && { backgroundColor: '#fff0d1' },
                    ]}
                  >
                    <Text
                      style={[
                        styles.rankAvatarText,
                        index === 1 && { color: COLORS.pink },
                        index === 2 && { color: '#b8791b' },
                      ]}
                    >
                      {row.initials}
                    </Text>
                  </View>
                  <View style={styles.rankCopy}>
                    <Text style={styles.rankName}>
                      {row.name}
                      {row.current && ' · That is you'}
                    </Text>
                    <Text style={styles.rankHandle}>{row.handle}</Text>
                  </View>
                  <View style={styles.rankXpWrap}>
                    <Icon name="zap" size={12} color={COLORS.pink} />
                    <Text style={styles.rankXp}>{row.xp}</Text>
                    <Text style={styles.rankChange}>XP · {row.change}</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.rankAction}
                    onPress={() =>
                      onToast(
                        row.current
                          ? 'Keep going. Your future offline self is cheering.'
                          : `Sent ${row.name} a friendly high-five (local demo).`
                      )
                    }
                  >
                    <Text style={styles.rankActionText}>
                      {row.current ? 'Streak' : 'High-five'}
                    </Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>

            {/* Footer */}
            <View style={styles.lbFooter}>
              <Icon name="shield-check" size={14} color="#44a878" />
              <Text style={styles.lbFooterText}>
                Local Demo Preview only. Switch to Squad to connect with real members via invite codes.
              </Text>
            </View>
          </>
        )}
      </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 40 },
  eyebrow: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    color: COLORS.pink,
  },
  subEyebrow: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.6,
    color: COLORS.purple,
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
    marginBottom: 16,
    lineHeight: 20,
  },
  rankSummaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 16,
  },
  rankSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: RADIUS.lg,
    alignSelf: 'flex-start',
    shadowColor: '#eadceb',
    shadowOpacity: 0.5,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  rankIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: COLORS.lavender,
    justifyContent: 'center',
    alignItems: 'center',
  },
  rankValue: { fontSize: 19, fontWeight: '700', color: COLORS.purple },
  rankLabel: { fontSize: 10, color: COLORS.muted, marginTop: 1 },

  tabs: {
    flexDirection: 'row',
    gap: 6,
    paddingVertical: 5,
    paddingHorizontal: 5,
    backgroundColor: COLORS.paleLavender,
    borderRadius: RADIUS.md,
    alignSelf: 'flex-start',
    marginBottom: 16,
  },
  tab: {
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 9,
  },
  tabActive: {
    backgroundColor: COLORS.white,
    shadowColor: '#e1d5eb',
    shadowOpacity: 0.5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  tabText: { fontSize: 11, fontWeight: '700', color: COLORS.muted },
  tabTextActive: { color: COLORS.purple },

  // Local Demo Preview Banner
  demoPreviewBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    borderRadius: RADIUS.lg,
    backgroundColor: '#f5effd',
    borderWidth: 1,
    borderColor: '#dfd3eb',
    marginBottom: 14,
  },
  demoPreviewTitle: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
    color: COLORS.purple,
  },
  demoPreviewDesc: {
    fontSize: 11,
    color: COLORS.muted,
    marginTop: 2,
    lineHeight: 16,
  },

  // Cloud Squad UI
  squadContainer: {
    gap: 14,
  },
  cloudAuthCard: {
    padding: 18,
    borderRadius: RADIUS.xl,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.line,
    gap: 14,
  },
  cloudAuthHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  cloudAuthIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: COLORS.lavender,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cloudAuthTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: COLORS.ink,
  },
  cloudAuthDesc: {
    fontSize: 12,
    color: COLORS.muted,
    lineHeight: 17,
    marginTop: 4,
  },
  cloudLiveBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: RADIUS.md,
    backgroundColor: '#f1faf5',
    borderWidth: 1,
    borderColor: '#cdecd9',
  },
  cloudLiveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.green,
  },
  cloudLiveText: {
    flex: 1,
    fontSize: 10,
    fontWeight: '800',
    color: '#1e7e4e',
  },
  refreshChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 5,
    paddingHorizontal: 9,
    borderRadius: 8,
    backgroundColor: COLORS.lavender,
  },
  refreshChipText: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.purple,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 11,
    borderRadius: RADIUS.md,
    backgroundColor: '#fff1f6',
    borderWidth: 1,
    borderColor: '#f8cce0',
  },
  errorBannerText: {
    flex: 1,
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.pink,
  },
  squadSelectorRow: {
    gap: 8,
  },
  squadPill: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: COLORS.paleLavender,
  },
  squadPillActive: {
    backgroundColor: COLORS.purple,
  },
  squadPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.purple,
  },
  squadPillTextActive: {
    color: COLORS.white,
  },
  loadingCard: {
    padding: 24,
    borderRadius: RADIUS.xl,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.line,
    alignItems: 'center',
    gap: 10,
  },
  loadingText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.muted,
  },
  card: {
    padding: 16,
    borderRadius: RADIUS.xl,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.line,
    gap: 12,
  },
  squadHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  squadTitle: {
    fontSize: 19,
    fontWeight: '800',
    color: COLORS.ink,
    marginTop: 2,
  },
  squadMeta: {
    fontSize: 11,
    color: COLORS.muted,
    marginTop: 2,
  },
  outgoingInvitesBox: {
    padding: 12,
    borderRadius: RADIUS.md,
    backgroundColor: '#faf6fe',
    borderWidth: 1,
    borderColor: '#ebe0f5',
    gap: 8,
  },
  inviteItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  inviteCodeMono: {
    flex: 1,
    fontSize: 12,
    fontWeight: '800',
    color: COLORS.purple,
    letterSpacing: 0.8,
  },
  inviteCodeLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: COLORS.ink,
  },
  inviteSub: {
    fontSize: 11,
    color: COLORS.muted,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  textInput: {
    flex: 1,
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
  textInputMultiline: {
    minHeight: 54,
    maxHeight: 110,
    textAlignVertical: 'top',
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: COLORS.purple,
  },
  primaryBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.white,
  },
  smallPrimaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 9,
    backgroundColor: COLORS.purple,
  },
  smallPrimaryBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.white,
  },
  smallSecondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 9,
    backgroundColor: COLORS.lavender,
  },
  smallSecondaryBtnText: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.purple,
  },
  smallDangerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 9,
    backgroundColor: '#ffe8f2',
  },
  smallDangerBtnText: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.pink,
  },
  rankingRowWrap: {
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: '#eee4f1',
    paddingVertical: 11,
    paddingHorizontal: 12,
    gap: 10,
  },
  rankingRowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  memberBadgesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
    flexWrap: 'wrap',
  },
  bandChip: {
    paddingVertical: 2,
    paddingHorizontal: 7,
    borderRadius: 8,
    backgroundColor: '#f2edf9',
  },
  bandGreen: { backgroundColor: '#e4f8ee' },
  bandPink: { backgroundColor: '#ffe4ef' },
  bandOrange: { backgroundColor: '#fff1d8' },
  bandChipText: {
    fontSize: 9,
    fontWeight: '700',
    color: COLORS.ink,
  },
  memberActionsTray: {
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#f0e8f0',
    gap: 10,
  },
  memberActionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  reportBox: {
    padding: 10,
    borderRadius: RADIUS.md,
    backgroundColor: '#faf6fe',
    gap: 8,
  },
  reportCatsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  catChip: {
    paddingVertical: 5,
    paddingHorizontal: 9,
    borderRadius: 8,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: '#dfd3eb',
  },
  catChipActive: {
    backgroundColor: COLORS.purple,
    borderColor: COLORS.purple,
  },
  catChipText: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.purple,
  },
  catChipTextActive: {
    color: COLORS.white,
  },
  squadDangerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingTop: 4,
  },

  // League (Demo Preview)
  leagueCard: {
    backgroundColor: COLORS.purple,
    borderRadius: RADIUS.xl,
    padding: 22,
    marginBottom: 18,
    shadowColor: '#e6bbdb',
    shadowOpacity: 0.6,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  leagueEyebrow: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    color: '#f7d755',
  },
  leagueTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.white,
    marginTop: 6,
    letterSpacing: -0.5,
  },
  leagueSub: {
    fontSize: 12,
    color: '#d8cde9',
    marginTop: 6,
    lineHeight: 18,
  },
  leagueRange: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 22,
  },
  rangeLabel: { fontSize: 10, color: '#d8cde9' },
  rangeTrack: {
    flex: 1,
    height: 8,
    borderRadius: 10,
    backgroundColor: '#3d216d',
    overflow: 'hidden',
  },
  rangeFill: {
    width: '64%',
    height: '100%',
    borderRadius: 10,
    backgroundColor: COLORS.pink,
  },
  tierBadge: { alignItems: 'center', marginTop: 18 },
  tierIcon: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: COLORS.yellow,
    borderWidth: 3,
    borderColor: '#f8e9a1',
    justifyContent: 'center',
    alignItems: 'center',
    transform: [{ rotate: '8deg' }],
    shadowColor: '#35175e',
    shadowOpacity: 0.5,
    shadowOffset: { width: 4, height: 5 },
    elevation: 4,
  },
  tierName: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.yellow,
    marginTop: 8,
  },
  tierRank: { fontSize: 9, color: '#d8cde9', marginTop: 2 },

  // Rankings (Demo Preview)
  rankingHeader: {
    marginBottom: 14,
  },
  rankingTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.ink,
    marginTop: 4,
    letterSpacing: -0.3,
  },
  rankingMeta: { fontSize: 11, color: COLORS.muted, marginTop: 4 },
  rankingList: { gap: 10 },
  rankingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: '#eee4f1',
    shadowColor: '#eee5f0',
    shadowOpacity: 0.5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  rankingRowCurrent: {
    borderWidth: 2,
    borderColor: COLORS.pink,
    backgroundColor: '#fff2f7',
    shadowColor: '#f5bed6',
    shadowOpacity: 0.5,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  rankNum: {
    width: 20,
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.muted,
    textAlign: 'center',
  },
  rankAvatar: {
    width: 34,
    height: 34,
    borderRadius: RADIUS.md,
    backgroundColor: '#e8dcfb',
    justifyContent: 'center',
    alignItems: 'center',
  },
  rankAvatarText: { fontWeight: '700', color: COLORS.purple, fontSize: 13 },
  rankCopy: { flex: 1 },
  rankName: { fontSize: 12, fontWeight: '700', color: COLORS.ink },
  rankHandle: { fontSize: 10, color: COLORS.muted, marginTop: 2 },
  rankXpWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  rankXp: { fontSize: 12, fontWeight: '700', color: COLORS.pink },
  rankChange: { fontSize: 9, color: COLORS.muted },
  rankAction: {
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: COLORS.lavender,
  },
  rankActionText: { fontSize: 10, fontWeight: '700', color: COLORS.purple },

  lbFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
  },
  lbFooterText: { fontSize: 10, color: COLORS.muted, flex: 1 },
});
