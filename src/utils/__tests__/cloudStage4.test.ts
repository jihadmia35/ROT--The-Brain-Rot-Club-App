import { assert, describe, it } from '../testHarness';
import { CloudAccountIdentity, CloudProfile } from '../authHelpers';
import {
  buildProfileSyncPatch,
  deriveCloudStatusBand,
  formatSignInSuccessToast,
  normalizeDeviceTimezone,
  performSyncCloudProfile,
  sanitizeCloudDisplayName,
} from '../cloudProfileCore';
import {
  classifyXpSyncError,
  collectNewlyEarnedCloudXpEvents,
  enqueueUserXpEvents,
  getUserXpQueueStorageKey,
  mapClaimedEventKeyToPendingXp,
  performFlushCloudXpQueue,
  readUserXpQueue,
  XpQueueStorageAdapter,
} from '../cloudXpSyncCore';
import {
  formatStatusBandForRoster,
  getMemberInitials,
  loadSquadWorkspace,
  normalizeInviteCode,
  sortSquadRosterForLeaderboard,
  validateInviteeUserId,
  validateSquadName,
} from '../cloudSquadsCore';
import {
  buildPendingInviteMap,
  computeCombinedUnreadNotificationCount,
  countUnreadCloudNotifications,
  DEFAULT_CLOUD_NOTIFICATION_PREFS,
  formatCloudNotificationCategoryLabel,
  markCloudNotificationsLocallyRead,
  upsertCloudNotificationInList,
} from '../cloudNotificationsCore';
import { computeScrollbarMetrics } from '../notificationScrollbarCore';
import {
  buildCloudNotificationMirrorSpec,
  isCloudNotificationTypeEnabled,
  parseNotificationTargetRoute,
  sanitizeNotificationText,
  selectCloudNotificationsToMirror,
} from '../notificationMirrorsCore';
import {
  SocialNotificationRow,
  SquadInvitationRow,
} from '../../types/database.types';

function createMemoryQueueStorage(): {
  storage: XpQueueStorageAdapter;
  map: Map<string, string>;
} {
  const map = new Map<string, string>();
  return {
    map,
    storage: {
      async getItem(key: string) {
        return map.get(key) ?? null;
      },
      async setItem(key: string, value: string) {
        map.set(key, value);
      },
      async removeItem(key: string) {
        map.delete(key);
      },
    },
  };
}

function makeProfile(overrides: Partial<CloudProfile> = {}): CloudProfile {
  return {
    id: 'user-1',
    display_name: 'Pramit Dutta',
    avatar_url: null,
    share_squad_status: false,
    status_band: 'hidden',
    timezone: 'UTC',
    cloud_xp: 0,
    created_at: '2026-11-18T00:00:00Z',
    updated_at: '2026-11-18T00:00:00Z',
    ...overrides,
  };
}

describe('ROT Stage 4.1 — Cloud Profile, Timezone, Privacy Band & Display Name Choice', () => {
  it('Normalizes OS timezone aliases cleanly and falls back to UTC on invalid strings', () => {
    assert.equal(normalizeDeviceTimezone('Asia/Dhaka'), 'Asia/Dhaka');
    assert.equal(normalizeDeviceTimezone('Asia/Calcutta'), 'Asia/Kolkata');
    assert.equal(normalizeDeviceTimezone('Asia/Dacca'), 'Asia/Dhaka');
    assert.equal(normalizeDeviceTimezone('GMT'), 'UTC');
    assert.equal(normalizeDeviceTimezone(''), 'UTC');
    assert.equal(normalizeDeviceTimezone('not a valid zone!!!'), 'UTC');
  });

  it('Enforces BT-08 privacy invariant when deriving status_band', () => {
    // Sharing OFF always yields 'hidden' even with verified over-target data
    assert.equal(
      deriveCloudStatusBand({
        shareSquadStatus: false,
        hasVerifiedEstimate: true,
        usedMinutes: 180,
        limitMinutes: 90,
        isOverLimit: true,
      }),
      'hidden'
    );

    // Sharing ON without verified estimate yields 'incomplete'
    assert.equal(
      deriveCloudStatusBand({
        shareSquadStatus: true,
        hasVerifiedEstimate: false,
        usedMinutes: null,
        limitMinutes: 90,
      }),
      'incomplete'
    );

    // Sharing ON within target yields 'under_target'
    assert.equal(
      deriveCloudStatusBand({
        shareSquadStatus: true,
        hasVerifiedEstimate: true,
        usedMinutes: 45,
        limitMinutes: 90,
      }),
      'under_target'
    );

    // Sharing ON over target yields 'over_target'
    assert.equal(
      deriveCloudStatusBand({
        shareSquadStatus: true,
        hasVerifiedEstimate: true,
        usedMinutes: 95,
        limitMinutes: 90,
        isOverLimit: true,
      }),
      'over_target'
    );
  });

  it('Builds minimal profile update patches and sanitizes display names to 1..28 chars', () => {
    assert.equal(sanitizeCloudDisplayName('   '), null);
    assert.equal(
      sanitizeCloudDisplayName('  Pramit   Dutta  ExtraLongNameHere  '),
      'Pramit Dutta ExtraLongNameHe'
    );

    const current = makeProfile({
      timezone: 'Asia/Dhaka',
      share_squad_status: false,
      status_band: 'hidden',
      display_name: 'Pramit Dutta',
    });

    // No diff returns null
    assert.equal(
      buildProfileSyncPatch(current, {
        timezone: 'Asia/Dhaka',
        shareSquadStatus: false,
        statusBand: 'hidden',
        displayName: 'Pramit Dutta',
      }),
      null
    );

    // Opting in sets share_squad_status=true and updates status_band
    const patch = buildProfileSyncPatch(current, {
      shareSquadStatus: true,
      statusBand: 'under_target',
    });
    assert.deepEqual(patch, {
      share_squad_status: true,
      status_band: 'under_target',
    });
  });

  it('Syncs cloud profile with UTC fallback if server rejects timezone and formats sign-in toast', async () => {
    const identity: CloudAccountIdentity = {
      userId: 'user-1',
      displayName: 'Pramit Dutta',
      email: 'pramitdutta04@gmail.com',
      emailLabel: 'pramitdutta04@gmail.com',
      hasEmail: true,
      avatarUrl: null,
      cloudXp: 0,
    };
    assert.equal(
      formatSignInSuccessToast(identity),
      'Signed in as pramitdutta04@gmail.com.'
    );

    const calls: string[] = [];
    const syncRes = await performSyncCloudProfile(
      {
        updateProfile: async (_uid, patch) => {
          calls.push(String(patch.timezone));
          if (patch.timezone === 'Custom/BadZone') {
            return {
              profile: null,
              error: { message: 'Invalid IANA timezone: Custom/BadZone' },
            };
          }
          return {
            profile: makeProfile({ timezone: patch.timezone ?? 'UTC' }),
            error: null,
          };
        },
      },
      'user-1',
      { timezone: 'Custom/BadZone' }
    );

    assert.equal(syncRes.ok, true);
    assert.deepEqual(calls, ['Custom/BadZone', 'UTC']);
    assert.equal(syncRes.profile?.timezone, 'UTC');
  });
});

describe('ROT Stage 4.2 — User-Scoped Offline-Resilient Cloud XP Sync', () => {
  it('Maps all 5 XP event types and never transfers historical guest XP', () => {
    const prevClaimed: Record<string, number> = {
      'mission:2026-11-17:touch-grass': 40,
      'chest:2026-11-17': 50,
    };
    const nextClaimed: Record<string, number> = {
      ...prevClaimed,
      baseline: 284,
      'mission:2026-11-18:touch-grass': 40,
      'chest:2026-11-18': 50,
      'break:2026-11-18:s1:dur10': 30,
      'weekly:2026-11-16:balanced-week': 90,
      'streak_recovery:2026-11-18:2026-11-16': 25,
      'unknown:key': 999,
    };

    const delta = collectNewlyEarnedCloudXpEvents(
      prevClaimed,
      nextClaimed,
      '2026-11-18',
      'Asia/Dhaka',
      '2026-11-18T10:00:00.000Z'
    );

    assert.equal(delta.length, 5);
    assert.equal(delta[0].eventType, 'mission');
    assert.equal(delta[0].eventRef, 'touch-grass');
    assert.equal(delta[1].eventType, 'chest');
    assert.equal(delta[1].eventRef, 'daily-chest');
    assert.equal(delta[2].eventType, 'focus_break');
    assert.equal(delta[2].eventRef, 'focus-break');
    assert.equal(delta[3].eventType, 'weekly_quest');
    assert.equal(delta[3].eventRef, 'balanced-week');
    assert.equal(delta[3].localDateKey, '2026-11-18');
    assert.equal(delta[4].eventType, 'streak_recovery');
    assert.equal(delta[4].eventRef, 'streak-recovery');
    assert.equal(
      mapClaimedEventKeyToPendingXp('mission:2026-11-18:invalid', '2026-11-18'),
      null
    );
  });

  it('Isolates XP queues per userId, ensures timezone pre-sync, retries offline failures, and settles permanent caps', async () => {
    const { storage, map } = createMemoryQueueStorage();

    assert.equal(
      getUserXpQueueStorageKey('user-a'),
      '@rot_cloud_xp_queue_v1_user-a'
    );

    const ev1 = mapClaimedEventKeyToPendingXp(
      'mission:2026-11-18:touch-grass',
      '2026-11-18',
      'Asia/Dhaka',
      '2026-11-18T10:00:00.000Z'
    )!;
    const ev2 = mapClaimedEventKeyToPendingXp(
      'chest:2026-11-18',
      '2026-11-18',
      'Asia/Dhaka',
      '2026-11-18T10:01:00.000Z'
    )!;
    const evUserB = mapClaimedEventKeyToPendingXp(
      'break:2026-11-18:b1:dur5',
      '2026-11-18',
      'UTC',
      '2026-11-18T10:02:00.000Z'
    )!;

    await enqueueUserXpEvents(storage, 'user-a', [ev1, ev1, ev2]); // dedupes ev1
    await enqueueUserXpEvents(storage, 'user-b', [evUserB]);

    assert.equal((await readUserXpQueue(storage, 'user-a')).length, 2);
    assert.equal((await readUserXpQueue(storage, 'user-b')).length, 1);

    // 1. Offline transient failure on second item keeps ev2 queued while ev1 clears
    let tzSyncCount = 0;
    let callNum = 0;
    const offlineFlush = await performFlushCloudXpQueue(
      {
        storage,
        ensureProfileTimezone: async () => {
          tzSyncCount++;
          return { ok: true, effectiveTimezone: 'Asia/Dhaka' };
        },
        awardCloudXp: async (event) => {
          callNum++;
          if (event.idempotencyKey === ev1.idempotencyKey) {
            return {
              data: {
                awarded: true,
                duplicate: false,
                xp_awarded: 40,
                new_cloud_xp: 40,
              },
              error: null,
            };
          }
          return {
            data: null,
            error: new Error('Network request failed'),
          };
        },
      },
      'user-a'
    );

    assert.equal(tzSyncCount, 1);
    assert.equal(callNum, 2);
    assert.equal(offlineFlush.syncedCount, 1);
    assert.equal(offlineFlush.remainingCount, 1);
    assert.equal(offlineFlush.latestCloudXp, 40);
    // User B's queue must remain untouched
    assert.equal((await readUserXpQueue(storage, 'user-b')).length, 1);

    // 2. Retry succeeds cleanly; permanent 22023 cap error drops without wedging
    const evCapped = mapClaimedEventKeyToPendingXp(
      'break:2026-11-18:b4:dur10',
      '2026-11-18',
      'Asia/Dhaka',
      '2026-11-18T10:05:00.000Z'
    )!;
    await enqueueUserXpEvents(storage, 'user-a', [evCapped]);

    const retryFlush = await performFlushCloudXpQueue(
      {
        storage,
        ensureProfileTimezone: async () => ({
          ok: true,
          effectiveTimezone: 'Asia/Dhaka',
        }),
        awardCloudXp: async (event) => {
          if (event.idempotencyKey === ev2.idempotencyKey) {
            return {
              data: {
                awarded: false,
                duplicate: true,
                xp_awarded: 0,
                new_cloud_xp: 90,
              },
              error: null,
            };
          }
          return {
            data: null,
            error: {
              code: '22023',
              message: 'Daily focus break XP cap reached (max 3 per day)',
            },
          };
        },
      },
      'user-a'
    );

    assert.equal(retryFlush.duplicateCount, 1);
    assert.equal(retryFlush.droppedCount, 1);
    assert.equal(retryFlush.remainingCount, 0);
    assert.equal(retryFlush.latestCloudXp, 90);
    assert.equal(map.has(getUserXpQueueStorageKey('user-a')), false);
    assert.equal(
      classifyXpSyncError({ code: '42501', message: 'JWT expired' }).kind,
      'auth'
    );
  });
});

describe('ROT Stage 4.3 — Invite-Only Cloud Squads, Roster & Privacy Formatting', () => {
  it('Validates squad names and normalizes invite codes cleanly', () => {
    assert.equal(validateSquadName(' A ').valid, false);
    const validName = validateSquadName('  Night   Owls  ');
    assert.equal(validName.valid, true);
    assert.equal(validName.cleanName, 'Night Owls');

    assert.equal(normalizeInviteCode('short').valid, false);
    const validCode = normalizeInviteCode('  ab12 cd34 ef56 7890 ');
    assert.equal(validCode.valid, true);
    assert.equal(validCode.cleanCode, 'AB12CD34EF567890');

    assert.equal(validateInviteeUserId('not-a-uuid').valid, false);
    const validUid = validateInviteeUserId(
      '  7F49689F-E9E9-4536-BAA1-6D3B36B2067A '
    );
    assert.equal(validUid.valid, true);
    assert.equal(validUid.cleanId, '7f49689f-e9e9-4536-baa1-6d3b36b2067a');
  });

  it('Formats roster status bands with BT-08 masking and sorts by cloud_xp DESC', async () => {
    assert.deepEqual(formatStatusBandForRoster('over_target', false), {
      label: 'Status hidden',
      tone: 'muted',
    });
    assert.deepEqual(formatStatusBandForRoster('under_target', true), {
      label: 'Under target',
      tone: 'green',
    });
    assert.deepEqual(formatStatusBandForRoster('over_target', true), {
      label: 'Over target',
      tone: 'pink',
    });
    assert.equal(getMemberInitials('Pramit Dutta'), 'PD');

    const sorted = sortSquadRosterForLeaderboard([
      {
        user_id: 'u2',
        display_name: 'Member Two',
        avatar_url: null,
        role: 'member',
        cloud_xp: 40,
        status_band: 'hidden',
        share_squad_status: false,
        joined_at: '2026-11-18T00:00:00Z',
      },
      {
        user_id: 'u1',
        display_name: 'Leader',
        avatar_url: null,
        role: 'owner',
        cloud_xp: 120,
        status_band: 'under_target',
        share_squad_status: true,
        joined_at: '2026-11-18T00:01:00Z',
      },
    ]);
    assert.equal(sorted[0].user_id, 'u1');

    const workspace = await loadSquadWorkspace(
      {
        fetchMySquads: async () => [
          {
            id: 'sq-1',
            name: 'Grass Club',
            owner_id: 'u1',
            max_members: 12,
            created_at: '2026-11-18T00:00:00Z',
            updated_at: '2026-11-18T00:00:00Z',
            myRole: 'owner',
          },
        ],
        fetchRoster: async () => sorted,
        fetchSquadInvites: async () => [],
        fetchIncomingInvites: async () => [],
        fetchBlocks: async () => [],
      },
      'u1'
    );

    assert.equal(workspace.activeSquadId, 'sq-1');
    assert.equal(workspace.roster[0].display_name, 'Leader');
  });
});

describe('ROT Stage 4.4 — Cloud Social Notifications, Unread Count & Invite Actions', () => {
  it('Upserts, counts, merges unread counts, marks read, and maps pending invites', () => {
    const n1: SocialNotificationRow = {
      id: 'notif-1',
      recipient_user_id: 'user-1',
      actor_user_id: 'user-2',
      notification_type: 'squad_invite_received',
      title: 'Squad invitation',
      body: 'Join Grass Club',
      related_entity_id: 'inv-1',
      related_entity_type: 'squad_invitation',
      is_read: false,
      read_at: null,
      dedup_key: null,
      created_at: '2026-11-18T01:00:00Z',
    };
    const n2: SocialNotificationRow = {
      id: 'notif-2',
      recipient_user_id: 'user-1',
      actor_user_id: 'user-3',
      notification_type: 'squad_member_joined',
      title: 'New member',
      body: 'Alex joined Grass Club',
      related_entity_id: 'sq-1',
      related_entity_type: 'squad',
      is_read: false,
      read_at: null,
      dedup_key: null,
      created_at: '2026-11-18T02:00:00Z',
    };

    let list = upsertCloudNotificationInList([], n1);
    list = upsertCloudNotificationInList(list, n2);
    assert.equal(list[0].id, 'notif-2');
    assert.equal(countUnreadCloudNotifications(list), 2);
    assert.equal(computeCombinedUnreadNotificationCount(3, list), 5);

    const afterRead = markCloudNotificationsLocallyRead(
      list,
      ['notif-1'],
      '2026-11-18T02:05:00Z'
    );
    assert.equal(countUnreadCloudNotifications(afterRead), 1);
    assert.equal(computeCombinedUnreadNotificationCount(3, afterRead), 4);
    assert.equal(
      formatCloudNotificationCategoryLabel('squad_invite_received'),
      'SQUAD INVITE'
    );
    assert.equal(
      formatCloudNotificationCategoryLabel('squad_ownership_transferred'),
      'OWNERSHIP'
    );

    const invPending: SquadInvitationRow = {
      id: 'inv-1',
      squad_id: 'sq-1',
      inviter_id: 'user-2',
      invitee_id: 'user-1',
      invite_code: 'ABCD1234EFGH5678',
      status: 'pending',
      expires_at: '2026-11-25T00:00:00Z',
      accepted_by: null,
      responded_at: null,
      created_at: '2026-11-18T01:00:00Z',
    };
    const invAccepted: SquadInvitationRow = {
      ...invPending,
      id: 'inv-2',
      status: 'accepted',
    };

    const inviteMap = buildPendingInviteMap([invPending, invAccepted]);
    assert.equal(Boolean(inviteMap['inv-1']), true);
    assert.equal(Boolean(inviteMap['inv-2']), false);
    assert.equal(DEFAULT_CLOUD_NOTIFICATION_PREFS.squad_invites_enabled, true);
    assert.equal(DEFAULT_CLOUD_NOTIFICATION_PREFS.squad_activity_enabled, true);
  });

  it('Computes popup scrollbar metrics cleanly across 1, 10, 50, and 100 items', () => {
    // 1 item (~110px content < 410px viewport): hidden
    const single = computeScrollbarMetrics({
      viewportHeight: 410,
      contentHeight: 110,
      scrollOffset: 0,
    });
    assert.equal(single.visible, false);

    // 10 items (~1100px): visible thumb proportional to viewport
    const tenTop = computeScrollbarMetrics({
      viewportHeight: 410,
      contentHeight: 1100,
      scrollOffset: 0,
    });
    assert.equal(tenTop.visible, true);
    assert.equal(tenTop.thumbTop, 4);

    // 50 items scrolled halfway
    const fiftyMid = computeScrollbarMetrics({
      viewportHeight: 410,
      contentHeight: 5500,
      scrollOffset: (5500 - 410) / 2,
    });
    assert.equal(fiftyMid.visible, true);
    assert.equal(fiftyMid.thumbHeight >= 28, true);

    // 100 items clamped at bottom
    const hundredBottom = computeScrollbarMetrics({
      viewportHeight: 410,
      contentHeight: 11000,
      scrollOffset: 15000,
    });
    assert.equal(hundredBottom.visible, true);
    assert.equal(
      Math.round(hundredBottom.thumbTop + hundredBottom.thumbHeight),
      406
    );
  });

  it('Sanitizes notification copy, enforces user prefs & dedup, and parses tap routes', () => {
    const cleaned = sanitizeNotificationText(
      'Invite from alice@example.com for 7f49689f-e9e9-4536-baa1-6d3b36b2067a with Bearer abcdefghij12345',
      200
    );
    assert.equal(cleaned.includes('alice@example.com'), false);
    assert.equal(
      cleaned.includes('7f49689f-e9e9-4536-baa1-6d3b36b2067a'),
      false
    );
    assert.equal(cleaned.includes('abcdefghij12345'), false);

    const inviteRow: SocialNotificationRow = {
      id: 'n-invite',
      recipient_user_id: 'user-1',
      actor_user_id: 'user-2',
      notification_type: 'squad_invite_received',
      title: 'Squad invitation from user@example.com',
      body: 'Join Focus Squad',
      related_entity_id: 'inv-1',
      related_entity_type: 'squad_invitation',
      is_read: false,
      read_at: null,
      dedup_key: 'invite-key-1',
      created_at: '2026-11-18T03:00:00Z',
    };
    const joinRow: SocialNotificationRow = {
      ...inviteRow,
      id: 'n-join',
      notification_type: 'squad_member_joined',
      title: 'New member joined',
      body: 'Someone joined Focus Squad',
      dedup_key: 'join-key-1',
      created_at: '2026-11-18T03:05:00Z',
    };
    const readRow: SocialNotificationRow = {
      ...inviteRow,
      id: 'n-read',
      is_read: true,
      dedup_key: 'read-key-1',
    };
    const otherUserRow: SocialNotificationRow = {
      ...inviteRow,
      id: 'n-other',
      recipient_user_id: 'user-2',
    };

    const spec = buildCloudNotificationMirrorSpec(
      inviteRow,
      'user-1',
      DEFAULT_CLOUD_NOTIFICATION_PREFS
    );
    assert.equal(spec?.dedupKey, 'cloud_user-1_invite-key-1');
    assert.equal(spec?.targetRoute, 'Leaderboard:Squad');
    assert.equal(spec?.title.includes('user@example.com'), false);

    // Respects squad_invites_enabled = false and squad_activity_enabled = false
    assert.equal(
      buildCloudNotificationMirrorSpec(inviteRow, 'user-1', {
        squad_invites_enabled: false,
        squad_activity_enabled: true,
      }),
      null
    );
    assert.equal(
      buildCloudNotificationMirrorSpec(joinRow, 'user-1', {
        squad_invites_enabled: true,
        squad_activity_enabled: false,
      }),
      null
    );

    // Skips already-read notifications and mismatched recipient rows
    assert.equal(
      buildCloudNotificationMirrorSpec(
        readRow,
        'user-1',
        DEFAULT_CLOUD_NOTIFICATION_PREFS
      ),
      null
    );
    assert.equal(
      buildCloudNotificationMirrorSpec(
        otherUserRow,
        'user-1',
        DEFAULT_CLOUD_NOTIFICATION_PREFS
      ),
      null
    );

    // Selects only unmirrored items, chronologically ordered and capped
    const sessionMirrored = new Set<string>(['cloud_user-1_invite-key-1']);
    const selected = selectCloudNotificationsToMirror(
      [joinRow, inviteRow, readRow, otherUserRow],
      'user-1',
      DEFAULT_CLOUD_NOTIFICATION_PREFS,
      sessionMirrored,
      { maxBatch: 5 }
    );
    assert.equal(selected.length, 1);
    assert.equal(selected[0].dedupKey, 'cloud_user-1_join-key-1');

    // Route parsing
    assert.deepEqual(parseNotificationTargetRoute('Leaderboard:Squad'), {
      view: 'Leaderboard',
      leaderboardTab: 'Squad',
    });
    assert.deepEqual(parseNotificationTargetRoute('Missions'), {
      view: 'Missions',
    });
    assert.deepEqual(parseNotificationTargetRoute('NotificationCenter'), {
      openNotificationCenter: true,
    });
    assert.equal(parseNotificationTargetRoute('unknown_route'), null);
    assert.equal(parseNotificationTargetRoute(null), null);

    // Foreground Realtime toast & category preference checks
    assert.equal(
      isCloudNotificationTypeEnabled('squad_invite_received', {
        squad_invites_enabled: false,
        squad_activity_enabled: true,
      }),
      false
    );
    assert.equal(
      isCloudNotificationTypeEnabled('squad_member_joined', {
        squad_invites_enabled: true,
        squad_activity_enabled: false,
      }),
      false
    );
    const jwtSanitized = sanitizeNotificationText(
      'Alert eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
      90
    );
    assert.equal(jwtSanitized.includes('eyJhbGci'), false);
  });
});

