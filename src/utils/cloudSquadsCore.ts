import {
  AbuseReportCategory,
  ProfileStatusBand,
  SquadInvitationRow,
  SquadRosterMember,
  SquadRow,
  UserBlockRow,
} from '../types/database.types';

export type CloudSquadSummary = SquadRow & {
  myRole: 'owner' | 'member';
};

export type StatusBandDisplay = {
  label: string;
  tone: 'green' | 'pink' | 'orange' | 'muted';
};

export function validateSquadName(rawName: string): {
  valid: boolean;
  cleanName: string;
  error: string | null;
} {
  const cleanName = rawName.trim().replace(/\s+/g, ' ');
  if (cleanName.length < 2 || cleanName.length > 40) {
    return {
      valid: false,
      cleanName,
      error: 'Squad name must be 2 to 40 characters.',
    };
  }
  return { valid: true, cleanName, error: null };
}

export function normalizeInviteCode(rawCode: string): {
  valid: boolean;
  cleanCode: string;
  error: string | null;
} {
  const cleanCode = rawCode.trim().toUpperCase().replace(/\s+/g, '');
  if (cleanCode.length < 8 || cleanCode.length > 64) {
    return {
      valid: false,
      cleanCode,
      error: 'Invite code must be 8 to 64 characters.',
    };
  }
  return { valid: true, cleanCode, error: null };
}

export function validateInviteeUserId(rawId: string): {
  valid: boolean;
  cleanId: string;
  error: string | null;
} {
  const cleanId = rawId.trim();
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(cleanId)) {
    return {
      valid: false,
      cleanId,
      error: 'Enter a valid ROT Member ID (UUID from Settings).',
    };
  }
  return { valid: true, cleanId: cleanId.toLowerCase(), error: null };
}

export function formatStatusBandForRoster(
  band: ProfileStatusBand,
  shareSquadStatus: boolean
): StatusBandDisplay {
  if (!shareSquadStatus || band === 'hidden') {
    return { label: 'Status hidden', tone: 'muted' };
  }
  if (band === 'under_target') {
    return { label: 'Under target', tone: 'green' };
  }
  if (band === 'over_target') {
    return { label: 'Over target', tone: 'pink' };
  }
  return { label: 'Target pending', tone: 'orange' };
}

export function getMemberInitials(displayName: string): string {
  const clean = displayName.trim();
  if (!clean) return 'R';
  const parts = clean.split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return clean.slice(0, 2).toUpperCase();
}

export function sortSquadRosterForLeaderboard(
  roster: SquadRosterMember[]
): SquadRosterMember[] {
  return [...roster].sort((a, b) => {
    if (b.cloud_xp !== a.cloud_xp) {
      return b.cloud_xp - a.cloud_xp;
    }
    return a.joined_at.localeCompare(b.joined_at);
  });
}

export function mapSquadErrorMessage(err: unknown): string {
  const raw =
    err && typeof err === 'object' && 'message' in err
      ? String((err as { message?: unknown }).message ?? '')
      : err instanceof Error
      ? err.message
      : String(err ?? 'Squad action failed.');
  return raw || 'Squad action failed.';
}

export type SquadWorkspaceDeps = {
  fetchMySquads: (userId: string) => Promise<CloudSquadSummary[]>;
  fetchRoster: (squadId: string) => Promise<SquadRosterMember[]>;
  fetchSquadInvites: (
    squadId: string,
    isOwner: boolean
  ) => Promise<SquadInvitationRow[]>;
  fetchIncomingInvites: (userId: string) => Promise<SquadInvitationRow[]>;
  fetchBlocks: (userId: string) => Promise<UserBlockRow[]>;
};

export type SquadWorkspaceSnapshot = {
  squads: CloudSquadSummary[];
  activeSquadId: string | null;
  roster: SquadRosterMember[];
  outgoingInvites: SquadInvitationRow[];
  incomingInvites: SquadInvitationRow[];
  blocks: UserBlockRow[];
};

export async function loadSquadWorkspace(
  deps: SquadWorkspaceDeps,
  userId: string,
  preferredSquadId?: string | null
): Promise<SquadWorkspaceSnapshot> {
  const [squads, incomingInvites, blocks] = await Promise.all([
    deps.fetchMySquads(userId),
    deps.fetchIncomingInvites(userId),
    deps.fetchBlocks(userId),
  ]);

  const activeSquad =
    squads.find((s) => s.id === preferredSquadId) ?? squads[0] ?? null;

  if (!activeSquad) {
    return {
      squads,
      activeSquadId: null,
      roster: [],
      outgoingInvites: [],
      incomingInvites,
      blocks,
    };
  }

  const [roster, outgoingInvites] = await Promise.all([
    deps.fetchRoster(activeSquad.id),
    deps.fetchSquadInvites(activeSquad.id, activeSquad.myRole === 'owner'),
  ]);

  return {
    squads,
    activeSquadId: activeSquad.id,
    roster: sortSquadRosterForLeaderboard(roster),
    outgoingInvites,
    incomingInvites,
    blocks,
  };
}

export const ABUSE_REPORT_CATEGORIES: {
  id: AbuseReportCategory;
  label: string;
}[] = [
  { id: 'harassment', label: 'Harassment' },
  { id: 'spam', label: 'Spam or invite abuse' },
  { id: 'inappropriate_name', label: 'Inappropriate display name' },
  { id: 'impersonation', label: 'Impersonation' },
  { id: 'other', label: 'Other' },
];
