export type CloudProfile = {
  id: string;
  display_name: string;
  avatar_url: string | null;
  share_squad_status: boolean;
  status_band: 'under_target' | 'over_target' | 'incomplete' | 'hidden';
  timezone: string;
  cloud_xp: number;
  created_at: string;
  updated_at: string;
};

export type AuthUserLike = {
  id: string;
  email?: string | null;
  user_metadata?: {
    full_name?: unknown;
    name?: unknown;
    avatar_url?: unknown;
    picture?: unknown;
  } | null;
};

export type AuthSessionLike<U extends AuthUserLike = AuthUserLike> = {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
  user: U;
};

export type CloudAuthStatus =
  | 'loading'
  | 'authenticated'
  | 'guest'
  | 'unconfigured';

export type CloudAccountIdentity = {
  userId: string;
  displayName: string;
  email: string | null;
  emailLabel: string;
  hasEmail: boolean;
  avatarUrl: string | null;
  cloudXp: number;
};

export type SupabaseEnvConfig = {
  url: string;
  anonKey: string;
};

export type EnvValidationResult =
  | {
      configured: true;
      supabase: SupabaseEnvConfig;
      googleWebClientId: string | null;
      googleConfigured: boolean;
    }
  | {
      configured: false;
      reason: string;
      googleConfigured: boolean;
    };

export type AuthErrorCode =
  | 'cancelled'
  | 'in_progress'
  | 'play_services_unavailable'
  | 'not_configured'
  | 'missing_id_token'
  | 'invalid_token'
  | 'network_error'
  | 'developer_error'
  | 'sign_in_failed'
  | 'sign_out_failed';

export type MappedAuthError = {
  code: AuthErrorCode;
  cancelled: boolean;
  userMessage: string;
};

export type GoogleSignInOutcome =
  | {
      ok: true;
      session: AuthSessionLike;
      profile: CloudProfile | null;
    }
  | {
      ok: false;
      error: MappedAuthError;
    };

export type SessionRestoreOutcome =
  | {
      status: 'unconfigured';
      session: null;
      profile: null;
      error: string;
    }
  | {
      status: 'authenticated';
      session: AuthSessionLike;
      profile: CloudProfile | null;
      error: null;
    }
  | {
      status: 'guest';
      session: null;
      profile: null;
      error: string | null;
    };

const PLACEHOLDER_TOKENS = [
  'your-supabase-anon-key',
  'your-google-web-client-id',
  'your-project',
  'placeholder',
  'changeme',
];

function isPlaceholderValue(value: string): boolean {
  const lower = value.trim().toLowerCase();
  return (
    lower.length === 0 ||
    PLACEHOLDER_TOKENS.some((token) => lower.includes(token))
  );
}

const BASE64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function decodeBase64UrlAscii(segment: string): string | null {
  try {
    const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    let out = '';
    for (let i = 0; i < padded.length; i += 4) {
      const c1 = BASE64_ALPHABET.indexOf(padded[i]);
      const c2 = BASE64_ALPHABET.indexOf(padded[i + 1]);
      const c3 = padded[i + 2] === '=' ? -1 : BASE64_ALPHABET.indexOf(padded[i + 2]);
      const c4 = padded[i + 3] === '=' ? -1 : BASE64_ALPHABET.indexOf(padded[i + 3]);
      if (c1 < 0 || c2 < 0) return null;
      const triple =
        (c1 << 18) |
        (c2 << 12) |
        ((c3 >= 0 ? c3 : 0) << 6) |
        (c4 >= 0 ? c4 : 0);
      out += String.fromCharCode((triple >> 16) & 0xff);
      if (c3 >= 0) out += String.fromCharCode((triple >> 8) & 0xff);
      if (c4 >= 0) out += String.fromCharCode(triple & 0xff);
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Defensive guard against accidentally bundling a Supabase `service_role` or secret key
 * into client environment variables.
 */
export function isDisallowedServerKey(key: string): boolean {
  const trimmed = key.trim();
  if (trimmed.startsWith('sb_secret_')) {
    return true;
  }
  const parts = trimmed.split('.');
  if (parts.length === 3) {
    const payloadText = decodeBase64UrlAscii(parts[1]);
    if (payloadText) {
      try {
        const payload = JSON.parse(payloadText) as { role?: unknown };
        if (payload.role === 'service_role') {
          return true;
        }
      } catch {
        // Not valid JSON payload; ignore
      }
    }
  }
  return false;
}

export function validateClientEnv(env: {
  supabaseUrl?: string | null;
  supabaseAnonKey?: string | null;
  googleWebClientId?: string | null;
}): EnvValidationResult {
  const url = (env.supabaseUrl ?? '').trim();
  const anonKey = (env.supabaseAnonKey ?? '').trim();
  const rawGoogleId = (env.googleWebClientId ?? '').trim();

  const googleConfigured =
    rawGoogleId.length > 0 &&
    !isPlaceholderValue(rawGoogleId) &&
    rawGoogleId.endsWith('.apps.googleusercontent.com');
  const googleWebClientId = googleConfigured ? rawGoogleId : null;

  if (!url || isPlaceholderValue(url)) {
    return {
      configured: false,
      reason: 'Missing EXPO_PUBLIC_SUPABASE_URL environment variable.',
      googleConfigured,
    };
  }
  if (!url.startsWith('https://')) {
    return {
      configured: false,
      reason: 'EXPO_PUBLIC_SUPABASE_URL must use https://.',
      googleConfigured,
    };
  }
  if (!anonKey || isPlaceholderValue(anonKey)) {
    return {
      configured: false,
      reason: 'Missing EXPO_PUBLIC_SUPABASE_ANON_KEY environment variable.',
      googleConfigured,
    };
  }
  if (isDisallowedServerKey(anonKey)) {
    return {
      configured: false,
      reason:
        'Refusing to initialize client with a Supabase service_role or secret key.',
      googleConfigured,
    };
  }

  return {
    configured: true,
    supabase: { url, anonKey },
    googleWebClientId,
    googleConfigured,
  };
}

export function resolveCloudAccountIdentity(
  user: AuthUserLike,
  profile: CloudProfile | null
): CloudAccountIdentity {
  const cleanEmail =
    typeof user.email === 'string' && user.email.trim().length > 0
      ? user.email.trim()
      : null;

  const metaName =
    typeof user.user_metadata?.full_name === 'string' &&
    user.user_metadata.full_name.trim().length > 0
      ? user.user_metadata.full_name.trim()
      : typeof user.user_metadata?.name === 'string' &&
        user.user_metadata.name.trim().length > 0
      ? user.user_metadata.name.trim()
      : null;

  const profileName =
    profile && profile.display_name.trim().length > 0
      ? profile.display_name.trim()
      : null;

  const emailPrefix =
    cleanEmail && cleanEmail.includes('@')
      ? cleanEmail.split('@')[0]?.trim() || null
      : null;

  const displayName =
    profileName ?? metaName ?? emailPrefix ?? 'ROT Club Member';

  const rawAvatar =
    profile?.avatar_url ??
    (typeof user.user_metadata?.avatar_url === 'string'
      ? user.user_metadata.avatar_url
      : typeof user.user_metadata?.picture === 'string'
      ? user.user_metadata.picture
      : null);

  return {
    userId: user.id,
    displayName,
    email: cleanEmail,
    emailLabel: cleanEmail ?? 'Email hidden by Google',
    hasEmail: cleanEmail !== null,
    avatarUrl:
      typeof rawAvatar === 'string' && rawAvatar.startsWith('https://')
        ? rawAvatar
        : null,
    cloudXp: profile?.cloud_xp ?? 0,
  };
}

export function mapAuthError(err: unknown): MappedAuthError {
  const anyErr = err as { code?: unknown; message?: unknown; status?: unknown } | null;
  const code = anyErr && typeof anyErr.code === 'string' ? anyErr.code : '';
  const rawMessage =
    anyErr && typeof anyErr.message === 'string'
      ? anyErr.message
      : err instanceof Error
      ? err.message
      : String(err ?? 'Unknown authentication error');
  const lowerMsg = rawMessage.toLowerCase();

  if (
    code === 'SIGN_IN_CANCELLED' ||
    code === '12501' ||
    lowerMsg.includes('cancel')
  ) {
    return {
      code: 'cancelled',
      cancelled: true,
      userMessage: 'Google sign-in was cancelled. You can stay in Guest Mode.',
    };
  }

  if (code === 'IN_PROGRESS') {
    return {
      code: 'in_progress',
      cancelled: false,
      userMessage: 'Google sign-in is already in progress.',
    };
  }

  if (
    code === 'PLAY_SERVICES_NOT_AVAILABLE' ||
    lowerMsg.includes('play services')
  ) {
    return {
      code: 'play_services_unavailable',
      cancelled: false,
      userMessage:
        'Google Play Services is unavailable or needs updating on this Android device.',
    };
  }

  if (
    code === '10' ||
    code === 'DEVELOPER_ERROR' ||
    lowerMsg.includes('developer_error')
  ) {
    return {
      code: 'developer_error',
      cancelled: false,
      userMessage:
        'Google OAuth configuration mismatch (DEVELOPER_ERROR). Verify the Android SHA-1 and Web Client ID in Google Cloud Console.',
    };
  }

  if (
    code === 'NETWORK_ERROR' ||
    code === '7' ||
    lowerMsg.includes('network') ||
    lowerMsg.includes('fetch failed') ||
    lowerMsg.includes('timeout') ||
    lowerMsg.includes('unable to resolve host')
  ) {
    return {
      code: 'network_error',
      cancelled: false,
      userMessage:
        'Network error while signing in. Check your connection and try again.',
    };
  }

  if (
    lowerMsg.includes('invalid') &&
    (lowerMsg.includes('token') ||
      lowerMsg.includes('jwt') ||
      lowerMsg.includes('nonce') ||
      lowerMsg.includes('audience'))
  ) {
    return {
      code: 'invalid_token',
      cancelled: false,
      userMessage:
        'Could not verify the Google ID token with Supabase. Verify Supabase Google provider client ID and nonce settings.',
    };
  }

  return {
    code: 'sign_in_failed',
    cancelled: false,
    userMessage: rawMessage || 'Could not sign in with Google right now.',
  };
}

export type GoogleSignInDeps = {
  isConfigured: () => boolean;
  hasPlayServices: () => Promise<boolean>;
  signInWithGoogleNative: () => Promise<
    | { cancelled: true }
    | { cancelled: false; idToken: string | null }
  >;
  signInWithSupabaseIdToken: (idToken: string) => Promise<{
    session: AuthSessionLike | null;
    error: unknown | null;
  }>;
  fetchProfile: (userId: string) => Promise<CloudProfile | null>;
};

export async function performGoogleSignIn(
  deps: GoogleSignInDeps
): Promise<GoogleSignInOutcome> {
  if (!deps.isConfigured()) {
    return {
      ok: false,
      error: {
        code: 'not_configured',
        cancelled: false,
        userMessage:
          'Cloud sign-in is not configured yet. Add EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY, and EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID to .env.',
      },
    };
  }

  try {
    const playOk = await deps.hasPlayServices();
    if (!playOk) {
      return {
        ok: false,
        error: {
          code: 'play_services_unavailable',
          cancelled: false,
          userMessage:
            'Google Play Services is unavailable or needs updating on this device.',
        },
      };
    }

    const nativeResult = await deps.signInWithGoogleNative();
    if (nativeResult.cancelled) {
      return {
        ok: false,
        error: {
          code: 'cancelled',
          cancelled: true,
          userMessage: 'Google sign-in was cancelled. You can stay in Guest Mode.',
        },
      };
    }

    if (!nativeResult.idToken) {
      return {
        ok: false,
        error: {
          code: 'missing_id_token',
          cancelled: false,
          userMessage:
            'Google did not return an ID token. Check EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID.',
        },
      };
    }

    const { session, error } = await deps.signInWithSupabaseIdToken(
      nativeResult.idToken
    );
    if (error || !session) {
      return {
        ok: false,
        error: mapAuthError(
          error ?? new Error('Supabase did not return an active session.')
        ),
      };
    }

    let profile: CloudProfile | null = null;
    try {
      profile = await deps.fetchProfile(session.user.id);
    } catch {
      profile = null;
    }

    return {
      ok: true,
      session,
      profile,
    };
  } catch (err) {
    return {
      ok: false,
      error: mapAuthError(err),
    };
  }
}

export type SessionRestoreDeps = {
  isConfigured: () => boolean;
  getSession: () => Promise<{
    session: AuthSessionLike | null;
    error: unknown | null;
  }>;
  fetchProfile: (userId: string) => Promise<CloudProfile | null>;
};

export async function performSessionRestore(
  deps: SessionRestoreDeps
): Promise<SessionRestoreOutcome> {
  if (!deps.isConfigured()) {
    return {
      status: 'unconfigured',
      session: null,
      profile: null,
      error: 'Cloud environment variables are not configured.',
    };
  }

  try {
    const { session, error } = await deps.getSession();
    if (error) {
      return {
        status: 'guest',
        session: null,
        profile: null,
        error: mapAuthError(error).userMessage,
      };
    }
    if (!session) {
      return {
        status: 'guest',
        session: null,
        profile: null,
        error: null,
      };
    }

    let profile: CloudProfile | null = null;
    try {
      profile = await deps.fetchProfile(session.user.id);
    } catch {
      profile = null;
    }

    return {
      status: 'authenticated',
      session,
      profile,
      error: null,
    };
  } catch (err) {
    return {
      status: 'guest',
      session: null,
      profile: null,
      error: mapAuthError(err).userMessage,
    };
  }
}

export type SignOutDeps = {
  ensureGoogleConfigured?: () => boolean;
  signOutSupabase: () => Promise<{ error: unknown | null }>;
  signOutGoogleNative: () => Promise<void>;
};

export async function performSignOut(
  deps: SignOutDeps
): Promise<{ ok: boolean; error: string | null }> {
  let supabaseError: unknown | null = null;
  try {
    const res = await deps.signOutSupabase();
    supabaseError = res.error ?? null;
  } catch (err) {
    supabaseError = err;
  }

  try {
    const shouldSignOutGoogle = deps.ensureGoogleConfigured
      ? deps.ensureGoogleConfigured()
      : true;
    if (shouldSignOutGoogle) {
      await deps.signOutGoogleNative();
    }
  } catch {
    // Best-effort Google sign-out: Supabase session clearing is authoritative
  }

  if (supabaseError) {
    return {
      ok: false,
      error: mapAuthError(supabaseError).userMessage,
    };
  }

  return {
    ok: true,
    error: null,
  };
}
