import { Database, ProfileStatusBand } from '../types/database.types';
import { CloudAccountIdentity, CloudProfile } from './authHelpers';

export type ProfileUpdatePatch = Database['public']['Tables']['profiles']['Update'];

const TIMEZONE_ALIAS_MAP: Record<string, string> = {
  'Asia/Calcutta': 'Asia/Kolkata',
  'Asia/Dacca': 'Asia/Dhaka',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Europe/Kiev': 'Europe/Kyiv',
  'America/Buenos_Aires': 'America/Argentina/Buenos_Aires',
};

export function normalizeDeviceTimezone(rawTz?: string | null): string {
  const trimmed = (rawTz ?? '').trim();
  if (!trimmed) {
    return 'UTC';
  }
  const mapped = TIMEZONE_ALIAS_MAP[trimmed] ?? trimmed;
  if (mapped === 'UTC' || mapped === 'Etc/UTC' || mapped === 'GMT') {
    return mapped === 'GMT' ? 'UTC' : mapped;
  }
  // Standard IANA zone shape: Region/City or Region/Subregion/City
  if (/^[A-Za-z_+-]+(?:\/[A-Za-z0-9_+-]+){1,2}$/.test(mapped)) {
    return mapped;
  }
  return 'UTC';
}

export function getDeviceTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return normalizeDeviceTimezone(tz);
  } catch {
    return 'UTC';
  }
}

export function sanitizeCloudDisplayName(
  rawName: string | null | undefined
): string | null {
  if (typeof rawName !== 'string') {
    return null;
  }
  const collapsed = rawName.trim().replace(/\s+/g, ' ');
  if (!collapsed) {
    return null;
  }
  return collapsed.slice(0, 28);
}

/**
 * Derives privacy-preserving status band for squad display:
 * - Never exposes raw usage minutes or logs.
 * - Always returns 'hidden' when shareSquadStatus is false (BT-08).
 */
export function deriveCloudStatusBand(params: {
  shareSquadStatus: boolean;
  hasVerifiedEstimate: boolean;
  usedMinutes: number | null;
  limitMinutes: number;
  isOverLimit?: boolean;
}): ProfileStatusBand {
  if (!params.shareSquadStatus) {
    return 'hidden';
  }
  if (!params.hasVerifiedEstimate || params.usedMinutes === null) {
    return 'incomplete';
  }
  if (params.isOverLimit || params.usedMinutes > params.limitMinutes) {
    return 'over_target';
  }
  return 'under_target';
}

export function buildProfileSyncPatch(
  current: CloudProfile | null,
  desired: {
    timezone?: string;
    shareSquadStatus?: boolean;
    statusBand?: ProfileStatusBand;
    displayName?: string;
  }
): ProfileUpdatePatch | null {
  const patch: ProfileUpdatePatch = {};

  if (desired.timezone !== undefined) {
    const cleanTz = normalizeDeviceTimezone(desired.timezone);
    if (!current || current.timezone !== cleanTz) {
      patch.timezone = cleanTz;
    }
  }

  const effectiveShare =
    desired.shareSquadStatus ?? current?.share_squad_status ?? false;

  if (
    desired.shareSquadStatus !== undefined &&
    (!current || current.share_squad_status !== desired.shareSquadStatus)
  ) {
    patch.share_squad_status = desired.shareSquadStatus;
  }

  const nextBand: ProfileStatusBand | undefined =
    desired.shareSquadStatus === false
      ? 'hidden'
      : desired.statusBand !== undefined
      ? effectiveShare
        ? desired.statusBand
        : 'hidden'
      : desired.shareSquadStatus === true && current?.status_band === 'hidden'
      ? 'incomplete'
      : undefined;

  if (nextBand !== undefined && (!current || current.status_band !== nextBand)) {
    patch.status_band = nextBand;
  }

  if (desired.displayName !== undefined) {
    const cleanName = sanitizeCloudDisplayName(desired.displayName);
    if (cleanName && (!current || current.display_name !== cleanName)) {
      patch.display_name = cleanName;
    }
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

export function formatSignInSuccessToast(identity: CloudAccountIdentity): string {
  if (identity.hasEmail && identity.email) {
    return `Signed in as ${identity.email}.`;
  }
  return `Signed in to ROT Club as ${identity.displayName}.`;
}

export type SyncCloudProfileDeps = {
  updateProfile: (
    userId: string,
    patch: ProfileUpdatePatch
  ) => Promise<{ profile: CloudProfile | null; error: unknown | null }>;
};

export async function performSyncCloudProfile(
  deps: SyncCloudProfileDeps,
  userId: string,
  patch: ProfileUpdatePatch
): Promise<{
  ok: boolean;
  profile: CloudProfile | null;
  error: string | null;
}> {
  if (!userId) {
    return {
      ok: false,
      profile: null,
      error: 'Authentication required to update cloud profile.',
    };
  }

  const safePatch: ProfileUpdatePatch = { ...patch };
  if (safePatch.share_squad_status === false) {
    safePatch.status_band = 'hidden';
  }
  if (safePatch.display_name !== undefined) {
    const clean = sanitizeCloudDisplayName(safePatch.display_name);
    if (!clean) {
      return {
        ok: false,
        profile: null,
        error: 'Display name must contain 1 to 28 non-space characters.',
      };
    }
    safePatch.display_name = clean;
  }

  try {
    const res = await deps.updateProfile(userId, safePatch);
    if (!res.error && res.profile) {
      return { ok: true, profile: res.profile, error: null };
    }

    const msg = extractErrorMessage(res.error);
    // If OS timezone string was rejected by pg_timezone_names, fall back to UTC safely
    if (
      safePatch.timezone &&
      safePatch.timezone !== 'UTC' &&
      msg.toLowerCase().includes('timezone')
    ) {
      const retryPatch: ProfileUpdatePatch = { ...safePatch, timezone: 'UTC' };
      const retryRes = await deps.updateProfile(userId, retryPatch);
      if (!retryRes.error && retryRes.profile) {
        return { ok: true, profile: retryRes.profile, error: null };
      }
      return {
        ok: false,
        profile: null,
        error: extractErrorMessage(retryRes.error) || msg,
      };
    }

    return {
      ok: false,
      profile: null,
      error: msg || 'Could not update cloud profile.',
    };
  } catch (err) {
    return {
      ok: false,
      profile: null,
      error: extractErrorMessage(err) || 'Could not update cloud profile.',
    };
  }
}

function extractErrorMessage(err: unknown): string {
  if (!err) return '';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && 'message' in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return String(err);
}
