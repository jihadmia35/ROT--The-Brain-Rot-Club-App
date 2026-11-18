import {
  AbuseReportCategory,
  SquadInvitationRow,
  SquadRosterMember,
  SquadRow,
  UserBlockRow,
} from '../types/database.types';
import {
  CloudSquadSummary,
  loadSquadWorkspace,
  mapSquadErrorMessage,
  normalizeInviteCode,
  SquadWorkspaceSnapshot,
  validateSquadName,
} from './cloudSquadsCore';
import { getSupabaseClient } from './supabase';

export type SquadActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export async function fetchSquadWorkspaceForUser(
  userId: string,
  preferredSquadId?: string | null
): Promise<SquadActionResult<SquadWorkspaceSnapshot>> {
  const client = getSupabaseClient();
  if (!client || !userId) {
    return { ok: false, error: 'Sign in required to load Cloud Squads.' };
  }

  try {
    const snapshot = await loadSquadWorkspace(
      {
        fetchMySquads: async (uid) => {
          const [squadsRes, membersRes] = await Promise.all([
            client
              .from('squads')
              .select('id, name, owner_id, max_members, created_at, updated_at')
              .order('created_at', { ascending: true }),
            client
              .from('squad_members')
              .select('squad_id, role')
              .eq('user_id', uid),
          ]);

          if (squadsRes.error) throw squadsRes.error;
          if (membersRes.error) throw membersRes.error;

          const roleBySquad = new Map<string, 'owner' | 'member'>();
          for (const m of membersRes.data ?? []) {
            roleBySquad.set(m.squad_id, m.role === 'owner' ? 'owner' : 'member');
          }

          return ((squadsRes.data ?? []) as SquadRow[]).map((s) => ({
            ...s,
            myRole:
              roleBySquad.get(s.id) ??
              (s.owner_id === uid ? 'owner' : 'member'),
          }));
        },
        fetchRoster: async (squadId) => {
          const { data, error } = await client.rpc('get_squad_roster', {
            p_squad_id: squadId,
          });
          if (error) throw error;
          return (data ?? []) as SquadRosterMember[];
        },
        fetchSquadInvites: async (squadId, isOwner) => {
          if (!isOwner) return [];
          const { data, error } = await client
            .from('squad_invitations')
            .select('*')
            .eq('squad_id', squadId)
            .eq('status', 'pending')
            .gt('expires_at', new Date().toISOString())
            .order('created_at', { ascending: false });
          if (error) throw error;
          return (data ?? []) as SquadInvitationRow[];
        },
        fetchIncomingInvites: async (uid) => {
          const { data, error } = await client
            .from('squad_invitations')
            .select('*')
            .eq('invitee_id', uid)
            .eq('status', 'pending')
            .gt('expires_at', new Date().toISOString())
            .order('created_at', { ascending: false });
          if (error) throw error;
          return (data ?? []) as SquadInvitationRow[];
        },
        fetchBlocks: async (uid) => {
          const { data, error } = await client
            .from('user_blocks')
            .select('blocker_id, blocked_id, created_at')
            .eq('blocker_id', uid)
            .order('created_at', { ascending: false });
          if (error) throw error;
          return (data ?? []) as UserBlockRow[];
        },
      },
      userId,
      preferredSquadId
    );

    return { ok: true, data: snapshot };
  } catch (err) {
    return { ok: false, error: mapSquadErrorMessage(err) };
  }
}

export async function createCloudSquad(
  rawName: string
): Promise<SquadActionResult<{ id: string; name: string }>> {
  const client = getSupabaseClient();
  if (!client) {
    return { ok: false, error: 'Cloud client not configured.' };
  }
  const validation = validateSquadName(rawName);
  if (!validation.valid) {
    return { ok: false, error: validation.error || 'Invalid squad name.' };
  }

  const { data, error } = await client.rpc('create_squad', {
    p_name: validation.cleanName,
  });
  if (error || !data) {
    return { ok: false, error: mapSquadErrorMessage(error) };
  }
  const obj = data as { id: string; name: string };
  return { ok: true, data: obj };
}

export async function createCloudSquadInvitation(
  squadId: string,
  inviteeId: string | null = null,
  expiresInHours = 168
): Promise<SquadActionResult<{ id: string; invite_code: string; expires_at: string }>> {
  const client = getSupabaseClient();
  if (!client) {
    return { ok: false, error: 'Cloud client not configured.' };
  }
  const { data, error } = await client.rpc('create_squad_invitation', {
    p_squad_id: squadId,
    p_invitee_id: inviteeId,
    p_expires_in_hours: expiresInHours,
  });
  if (error || !data) {
    return { ok: false, error: mapSquadErrorMessage(error) };
  }
  return {
    ok: true,
    data: data as { id: string; invite_code: string; expires_at: string },
  };
}

export async function acceptCloudSquadInvitation(
  rawCode: string
): Promise<SquadActionResult<{ squad_id: string; squad_name: string }>> {
  const client = getSupabaseClient();
  if (!client) {
    return { ok: false, error: 'Cloud client not configured.' };
  }
  const normalized = normalizeInviteCode(rawCode);
  if (!normalized.valid) {
    return { ok: false, error: normalized.error || 'Invalid invite code.' };
  }
  const { data, error } = await client.rpc('accept_squad_invitation', {
    p_invite_code: normalized.cleanCode,
  });
  if (error || !data) {
    return { ok: false, error: mapSquadErrorMessage(error) };
  }
  return {
    ok: true,
    data: data as { squad_id: string; squad_name: string },
  };
}

export async function declineCloudSquadInvitation(
  invitationId: string
): Promise<SquadActionResult> {
  const client = getSupabaseClient();
  if (!client) {
    return { ok: false, error: 'Cloud client not configured.' };
  }
  const { error } = await client.rpc('decline_squad_invitation', {
    p_invitation_id: invitationId,
  });
  if (error) {
    return { ok: false, error: mapSquadErrorMessage(error) };
  }
  return { ok: true, data: undefined };
}

export async function revokeCloudSquadInvitation(
  invitationId: string
): Promise<SquadActionResult> {
  const client = getSupabaseClient();
  if (!client) {
    return { ok: false, error: 'Cloud client not configured.' };
  }
  const { error } = await client.rpc('revoke_squad_invitation', {
    p_invitation_id: invitationId,
  });
  if (error) {
    return { ok: false, error: mapSquadErrorMessage(error) };
  }
  return { ok: true, data: undefined };
}

export async function leaveCloudSquad(
  squadId: string
): Promise<SquadActionResult<{ squad_deleted: boolean }>> {
  const client = getSupabaseClient();
  if (!client) {
    return { ok: false, error: 'Cloud client not configured.' };
  }
  const { data, error } = await client.rpc('leave_squad', {
    p_squad_id: squadId,
  });
  if (error || !data) {
    return { ok: false, error: mapSquadErrorMessage(error) };
  }
  return { ok: true, data: data as { squad_deleted: boolean } };
}

export async function deleteCloudSquad(
  squadId: string
): Promise<SquadActionResult> {
  const client = getSupabaseClient();
  if (!client) {
    return { ok: false, error: 'Cloud client not configured.' };
  }
  const { error } = await client.rpc('delete_squad', {
    p_squad_id: squadId,
  });
  if (error) {
    return { ok: false, error: mapSquadErrorMessage(error) };
  }
  return { ok: true, data: undefined };
}

export async function transferCloudSquadOwnership(
  squadId: string,
  newOwnerId: string
): Promise<SquadActionResult> {
  const client = getSupabaseClient();
  if (!client) {
    return { ok: false, error: 'Cloud client not configured.' };
  }
  const { error } = await client.rpc('transfer_squad_ownership', {
    p_squad_id: squadId,
    p_new_owner_id: newOwnerId,
  });
  if (error) {
    return { ok: false, error: mapSquadErrorMessage(error) };
  }
  return { ok: true, data: undefined };
}

export async function removeCloudSquadMember(
  squadId: string,
  targetUserId: string
): Promise<SquadActionResult> {
  const client = getSupabaseClient();
  if (!client) {
    return { ok: false, error: 'Cloud client not configured.' };
  }
  const { error } = await client.rpc('remove_squad_member', {
    p_squad_id: squadId,
    p_target_user_id: targetUserId,
  });
  if (error) {
    return { ok: false, error: mapSquadErrorMessage(error) };
  }
  return { ok: true, data: undefined };
}

export async function blockCloudUser(
  blockerId: string,
  blockedId: string
): Promise<SquadActionResult> {
  const client = getSupabaseClient();
  if (!client) {
    return { ok: false, error: 'Cloud client not configured.' };
  }
  const { error } = await client.from('user_blocks').insert({
    blocker_id: blockerId,
    blocked_id: blockedId,
  });
  if (error) {
    return { ok: false, error: mapSquadErrorMessage(error) };
  }
  return { ok: true, data: undefined };
}

export async function unblockCloudUser(
  blockerId: string,
  blockedId: string
): Promise<SquadActionResult> {
  const client = getSupabaseClient();
  if (!client) {
    return { ok: false, error: 'Cloud client not configured.' };
  }
  const { error } = await client
    .from('user_blocks')
    .delete()
    .eq('blocker_id', blockerId)
    .eq('blocked_id', blockedId);
  if (error) {
    return { ok: false, error: mapSquadErrorMessage(error) };
  }
  return { ok: true, data: undefined };
}

export async function submitCloudAbuseReport(params: {
  reportedUserId: string;
  category: AbuseReportCategory;
  details: string;
  squadId: string | null;
}): Promise<SquadActionResult> {
  const client = getSupabaseClient();
  if (!client) {
    return { ok: false, error: 'Cloud client not configured.' };
  }
  const { error } = await client.rpc('submit_abuse_report', {
    p_reported_user_id: params.reportedUserId,
    p_category: params.category,
    p_details: params.details.trim(),
    p_squad_id: params.squadId,
  });
  if (error) {
    return { ok: false, error: mapSquadErrorMessage(error) };
  }
  return { ok: true, data: undefined };
}
