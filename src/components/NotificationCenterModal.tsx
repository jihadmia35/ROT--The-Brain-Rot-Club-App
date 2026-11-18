import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { COLORS, RADIUS } from '../constants/theme';
import {
  NotificationInboxItem,
  NotificationStatusSnapshot,
} from '../constants/types';
import {
  SocialNotificationRow,
  SquadInvitationRow,
} from '../types/database.types';
import { CloudAuthStatus } from '../utils/authHelpers';
import { formatCloudNotificationCategoryLabel } from '../utils/cloudNotificationsCore';
import { getLocalDateKey } from '../utils/domainLogic';
import { computeScrollbarMetrics } from '../utils/notificationScrollbarCore';
import { useReducedMotion } from '../utils/useReducedMotion';
import Icon from './Icon';

type Props = {
  visible: boolean;
  items: NotificationInboxItem[];
  highlightedUnreadIds: string[];
  notificationStatus: NotificationStatusSnapshot;
  cloudAuthStatus: CloudAuthStatus;
  cloudNotifications: SocialNotificationRow[];
  highlightedCloudUnreadIds: string[];
  pendingInvitesById: Record<string, SquadInvitationRow>;
  inviteActionBusy?: boolean;
  onAcceptSquadInvite: (inviteCode: string) => void;
  onDeclineSquadInvite: (invitationId: string) => void;
  onClearAll: () => void;
  onOpenSettings: () => void;
  onClose: () => void;
};

type PopupRow =
  | { kind: 'header'; key: string; title: string; marginTop?: number }
  | {
      kind: 'cloud';
      key: string;
      notification: SocialNotificationRow;
      isJustRead: boolean;
      pendingInvite?: SquadInvitationRow;
    }
  | {
      kind: 'local';
      key: string;
      item: NotificationInboxItem;
      isJustRead: boolean;
    };

function formatCloudIsoTime(iso: string): string {
  const dateObj = new Date(iso);
  if (Number.isNaN(dateObj.getTime())) return 'Recent';
  const todayKey = getLocalDateKey();
  const isoDay = dateObj.toISOString().slice(0, 10);
  const timeText = dateObj.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
  return isoDay === todayKey ? `Today · ${timeText}` : `${isoDay} · ${timeText}`;
}

function formatNotificationTime(item: NotificationInboxItem): string {
  const todayKey = getLocalDateKey();
  const dateObj = new Date(item.createdAtMs);
  const timeText = Number.isNaN(dateObj.getTime())
    ? ''
    : dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dayLabel = item.dateKey === todayKey ? 'Today' : item.dateKey || 'Recent';
  return timeText ? `${dayLabel} · ${timeText}` : dayLabel;
}

function getCategoryLabel(item: NotificationInboxItem): string {
  if (item.notificationId === 1999) return 'TEST NUDGE';
  if (item.notificationId === 1006) return 'ACHIEVEMENT';
  if (item.channelId === 'rot_scheduled_reminders') return 'REMINDER';
  return 'GENTLE NUDGE';
}

export default function NotificationCenterModal({
  visible,
  items,
  highlightedUnreadIds,
  notificationStatus,
  cloudAuthStatus,
  cloudNotifications,
  highlightedCloudUnreadIds,
  pendingInvitesById,
  inviteActionBusy = false,
  onAcceptSquadInvite,
  onDeclineSquadInvite,
  onClearAll,
  onOpenSettings,
  onClose,
}: Props) {
  const listRef = useRef<FlatList<PopupRow>>(null);
  const reducedMotion = useReducedMotion();
  const sheetScale = useRef(new Animated.Value(0.95)).current;
  const sheetTranslateY = useRef(new Animated.Value(12)).current;
  const [viewportHeight, setViewportHeight] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);

  const hasPermissionIssue = notificationStatus.statusCode !== 'allowed';
  const showCloudSection =
    cloudAuthStatus === 'authenticated' && cloudNotifications.length > 0;
  const totalItemsCount =
    items.length + (cloudAuthStatus === 'authenticated' ? cloudNotifications.length : 0);

  const rows = useMemo<PopupRow[]>(() => {
    const highlightedSet = new Set(highlightedUnreadIds);
    const highlightedCloudSet = new Set(highlightedCloudUnreadIds);
    const out: PopupRow[] = [];

    if (showCloudSection) {
      out.push({
        kind: 'header',
        key: 'header-cloud',
        title: 'ROT CLUB · CLOUD UPDATES',
      });
      for (const cn of cloudNotifications) {
        const pendingInv =
          cn.notification_type === 'squad_invite_received' && cn.related_entity_id
            ? pendingInvitesById[cn.related_entity_id]
            : undefined;
        out.push({
          kind: 'cloud',
          key: `cloud-${cn.id}`,
          notification: cn,
          isJustRead: highlightedCloudSet.has(cn.id),
          pendingInvite: pendingInv,
        });
      }
    }

    if (items.length > 0) {
      if (showCloudSection) {
        out.push({
          kind: 'header',
          key: 'header-local',
          title: 'THIS DEVICE · LOCAL REMINDERS',
          marginTop: 4,
        });
      }
      for (const item of items) {
        out.push({
          kind: 'local',
          key: item.id,
          item,
          isJustRead: highlightedSet.has(item.id),
        });
      }
    }

    return out;
  }, [
    showCloudSection,
    cloudNotifications,
    highlightedCloudUnreadIds,
    pendingInvitesById,
    items,
    highlightedUnreadIds,
  ]);

  useEffect(() => {
    if (visible) {
      setScrollOffset(0);
      listRef.current?.scrollToOffset({ offset: 0, animated: false });
      if (reducedMotion) {
        sheetScale.setValue(1);
        sheetTranslateY.setValue(0);
      } else {
        sheetScale.setValue(0.95);
        sheetTranslateY.setValue(12);
        Animated.parallel([
          Animated.spring(sheetScale, {
            toValue: 1,
            tension: 165,
            friction: 14,
            useNativeDriver: true,
          }),
          Animated.timing(sheetTranslateY, {
            toValue: 0,
            duration: 180,
            useNativeDriver: true,
          }),
        ]).start();
      }
    } else {
      setViewportHeight(0);
      setContentHeight(0);
      setScrollOffset(0);
    }
  }, [visible, reducedMotion, sheetScale, sheetTranslateY]);

  const scrollbar = useMemo(
    () =>
      computeScrollbarMetrics({
        viewportHeight,
        contentHeight,
        scrollOffset,
        minThumbHeight: 30,
        trackPadding: 4,
      }),
    [viewportHeight, contentHeight, scrollOffset]
  );

  return (
    <Modal
      transparent
      animationType="fade"
      visible={visible}
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <Animated.View
          style={[
            styles.sheet,
            {
              transform: [
                { translateY: sheetTranslateY },
                { scale: sheetScale },
              ],
            },
          ]}
        >
          {/* Fixed Header */}
          <View style={styles.headerRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.eyebrow}>NOTIFICATION CENTER</Text>
              <Text style={styles.title}>Your ROT updates</Text>
            </View>
            {items.length > 0 && (
              <TouchableOpacity
                style={styles.clearBtn}
                onPress={onClearAll}
                activeOpacity={0.75}
                accessibilityLabel="Clear notification history"
              >
                <Text style={styles.clearBtnText}>Clear all</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.closeBtn}
              onPress={onClose}
              activeOpacity={0.75}
              accessibilityLabel="Close notification center"
            >
              <Icon name="x" size={18} color={COLORS.muted} />
            </TouchableOpacity>
          </View>

          {hasPermissionIssue && (
            <View style={styles.warningCard}>
              <Icon name="alert-circle" size={15} color={COLORS.orange} />
              <Text style={styles.warningText}>
                {notificationStatus.statusCode === 'permission_required'
                  ? 'Android notification permission is off.'
                  : notificationStatus.statusCode === 'channel_disabled'
                  ? 'A ROT notification channel is muted in Android settings.'
                  : 'ROT notifications are disabled in Android settings.'}
              </Text>
              <TouchableOpacity
                style={styles.settingsChip}
                onPress={() => {
                  onClose();
                  onOpenSettings();
                }}
                activeOpacity={0.8}
              >
                <Text style={styles.settingsChipText}>Settings</Text>
              </TouchableOpacity>
            </View>
          )}

          {totalItemsCount === 0 || rows.length === 0 ? (
            <View style={styles.emptyBox}>
              <View style={styles.emptyIconWrap}>
                <Icon name="bell" size={22} color={COLORS.purple} />
              </View>
              <Text style={styles.emptyTitle}>All caught up</Text>
              <Text style={styles.emptySub}>
                Gentle scroll nudges, daily reminders, and Cloud Squad updates will appear here.
              </Text>
            </View>
          ) : (
            <View style={styles.listViewport}>
              <FlatList
                ref={listRef}
                data={rows}
                keyExtractor={(row) => row.key}
                style={styles.listScroll}
                contentContainerStyle={[
                  styles.listContent,
                  scrollbar.visible && styles.listContentWithScrollbar,
                ]}
                showsVerticalScrollIndicator={false}
                nestedScrollEnabled
                initialNumToRender={16}
                maxToRenderPerBatch={20}
                windowSize={7}
                scrollEventThrottle={16}
                onLayout={(e) => {
                  setViewportHeight(e.nativeEvent.layout.height);
                }}
                onContentSizeChange={(_w, h) => {
                  setContentHeight(h);
                }}
                onScroll={(e) => {
                  setScrollOffset(e.nativeEvent.contentOffset.y);
                }}
                renderItem={({ item: row }) => {
                  if (row.kind === 'header') {
                    return (
                      <Text
                        style={[
                          styles.groupEyebrow,
                          row.marginTop ? { marginTop: row.marginTop } : null,
                        ]}
                      >
                        {row.title}
                      </Text>
                    );
                  }

                  if (row.kind === 'cloud') {
                    const cn = row.notification;
                    const pendingInv = row.pendingInvite;
                    return (
                      <View
                        style={[
                          styles.itemCard,
                          styles.cloudItemCard,
                          row.isJustRead && styles.itemCardUnread,
                        ]}
                      >
                        <View style={styles.itemMetaRow}>
                          <View style={styles.cloudCategoryChip}>
                            <Text style={styles.cloudCategoryChipText}>
                              {formatCloudNotificationCategoryLabel(
                                cn.notification_type
                              )}
                            </Text>
                          </View>
                          {row.isJustRead && (
                            <View style={styles.newChip}>
                              <Text style={styles.newChipText}>NEW</Text>
                            </View>
                          )}
                          <Text style={styles.timeText}>
                            {formatCloudIsoTime(cn.created_at)}
                          </Text>
                        </View>
                        <Text style={styles.itemTitle}>{cn.title}</Text>
                        <Text style={styles.itemBody}>{cn.body}</Text>
                        {pendingInv ? (
                          <View style={styles.inviteActionRow}>
                            <TouchableOpacity
                              style={styles.acceptBtn}
                              onPress={() =>
                                onAcceptSquadInvite(pendingInv.invite_code)
                              }
                              disabled={inviteActionBusy}
                            >
                              <Text style={styles.acceptBtnText}>
                                Accept invite
                              </Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={styles.declineBtn}
                              onPress={() => onDeclineSquadInvite(pendingInv.id)}
                              disabled={inviteActionBusy}
                            >
                              <Text style={styles.declineBtnText}>Decline</Text>
                            </TouchableOpacity>
                          </View>
                        ) : null}
                      </View>
                    );
                  }

                  const item = row.item;
                  return (
                    <View
                      style={[
                        styles.itemCard,
                        row.isJustRead && styles.itemCardUnread,
                      ]}
                    >
                      <View style={styles.itemMetaRow}>
                        <View style={styles.categoryChip}>
                          <Text style={styles.categoryChipText}>
                            {getCategoryLabel(item)}
                          </Text>
                        </View>
                        {row.isJustRead && (
                          <View style={styles.newChip}>
                            <Text style={styles.newChipText}>NEW</Text>
                          </View>
                        )}
                        <Text style={styles.timeText}>
                          {formatNotificationTime(item)}
                        </Text>
                      </View>
                      <Text style={styles.itemTitle}>{item.title}</Text>
                      <Text style={styles.itemBody}>{item.body}</Text>
                    </View>
                  );
                }}
              />

              {scrollbar.visible && (
                <View pointerEvents="none" style={styles.scrollbarTrack}>
                  <View
                    style={[
                      styles.scrollbarThumb,
                      {
                        height: scrollbar.thumbHeight,
                        transform: [{ translateY: scrollbar.thumbTop - 4 }],
                      },
                    ]}
                  />
                </View>
              )}
            </View>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(28,10,54,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 18,
  },
  sheet: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '82%',
    backgroundColor: COLORS.cream,
    borderRadius: RADIUS.xxl,
    borderWidth: 2,
    borderColor: COLORS.darkPurple,
    padding: 20,
    shadowColor: '#29104c',
    shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  eyebrow: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
    color: COLORS.pink,
  },
  title: {
    fontSize: 21,
    fontWeight: '800',
    color: COLORS.ink,
    marginTop: 2,
    letterSpacing: -0.4,
  },
  clearBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: '#eee7fa',
  },
  clearBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.purple,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#eee7fa',
    justifyContent: 'center',
    alignItems: 'center',
  },
  warningCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderRadius: 12,
    backgroundColor: '#fff4e5',
    borderWidth: 1,
    borderColor: '#ffd8a8',
    marginBottom: 12,
  },
  warningText: {
    flex: 1,
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.ink,
  },
  settingsChip: {
    paddingVertical: 5,
    paddingHorizontal: 9,
    borderRadius: 8,
    backgroundColor: COLORS.purple,
  },
  settingsChipText: {
    fontSize: 10,
    fontWeight: '800',
    color: COLORS.white,
  },
  emptyBox: {
    alignItems: 'center',
    paddingVertical: 30,
    paddingHorizontal: 16,
  },
  emptyIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#eee7fa',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.ink,
  },
  emptySub: {
    fontSize: 12,
    color: COLORS.muted,
    textAlign: 'center',
    lineHeight: 18,
    marginTop: 6,
  },
  listViewport: {
    position: 'relative',
    maxHeight: 410,
  },
  listScroll: {
    maxHeight: 410,
  },
  listContent: {
    gap: 10,
    paddingBottom: 4,
  },
  listContentWithScrollbar: {
    paddingRight: 13,
  },
  scrollbarTrack: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    right: 1,
    width: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(65, 29, 108, 0.12)',
    overflow: 'hidden',
  },
  scrollbarThumb: {
    width: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(243, 44, 135, 0.62)',
  },
  itemCard: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.line,
    padding: 13,
  },
  itemCardUnread: {
    borderColor: COLORS.pink,
    backgroundColor: '#fff7fb',
  },
  itemMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  categoryChip: {
    paddingVertical: 3,
    paddingHorizontal: 7,
    borderRadius: 6,
    backgroundColor: '#eee7fa',
  },
  categoryChipText: {
    fontSize: 9,
    fontWeight: '800',
    color: COLORS.purple,
    letterSpacing: 0.5,
  },
  newChip: {
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderRadius: 6,
    backgroundColor: COLORS.pink,
  },
  newChipText: {
    fontSize: 9,
    fontWeight: '800',
    color: COLORS.white,
    letterSpacing: 0.4,
  },
  timeText: {
    marginLeft: 'auto',
    fontSize: 10,
    fontWeight: '600',
    color: COLORS.muted,
  },
  itemTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: COLORS.ink,
  },
  itemBody: {
    fontSize: 12,
    color: COLORS.muted,
    lineHeight: 17,
    marginTop: 3,
  },
  groupEyebrow: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.7,
    color: COLORS.purple,
  },
  cloudItemCard: {
    borderColor: '#dfd3eb',
    backgroundColor: '#fcfaff',
  },
  cloudCategoryChip: {
    paddingVertical: 3,
    paddingHorizontal: 7,
    borderRadius: 6,
    backgroundColor: '#e4f8ee',
  },
  cloudCategoryChipText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#1e7e4e',
    letterSpacing: 0.5,
  },
  inviteActionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  acceptBtn: {
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: COLORS.purple,
  },
  acceptBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.white,
  },
  declineBtn: {
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#ffe8f2',
  },
  declineBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.pink,
  },
});
