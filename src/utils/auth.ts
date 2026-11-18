import {
  GoogleSignin,
  isCancelledResponse,
  isSuccessResponse,
} from '@react-native-google-signin/google-signin';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import {
  CloudProfile,
  GoogleSignInOutcome,
  performGoogleSignIn,
  performSessionRestore,
  performSignOut,
  SessionRestoreOutcome,
} from './authHelpers';
import {
  fetchCloudProfile,
  getClientEnvValidation,
  getSupabaseClient,
} from './supabase';

let configuredForWebClientId: string | null = null;

export function ensureGoogleSignInConfigured(): boolean {
  const env = getClientEnvValidation();
  if (!env.configured || !env.googleConfigured || !env.googleWebClientId) {
    return false;
  }
  if (configuredForWebClientId !== env.googleWebClientId) {
    GoogleSignin.configure({
      webClientId: env.googleWebClientId,
      offlineAccess: false,
      scopes: ['profile', 'email'],
    });
    configuredForWebClientId = env.googleWebClientId;
  }
  return true;
}

export async function signInWithGoogle(): Promise<GoogleSignInOutcome> {
  const client = getSupabaseClient();
  const googleReady = ensureGoogleSignInConfigured();

  return performGoogleSignIn({
    isConfigured: () => Boolean(client && googleReady),
    hasPlayServices: () =>
      GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true }),
    signInWithGoogleNative: async () => {
      const response = await GoogleSignin.signIn();
      if (isCancelledResponse(response)) {
        return { cancelled: true };
      }
      if (!isSuccessResponse(response)) {
        return { cancelled: true };
      }
      let idToken = response.data.idToken;
      if (!idToken) {
        const tokens = await GoogleSignin.getTokens();
        idToken = tokens.idToken ?? null;
      }
      return {
        cancelled: false,
        idToken,
      };
    },
    signInWithSupabaseIdToken: async (idToken: string) => {
      if (!client) {
        return {
          session: null,
          error: new Error('Supabase client is not configured.'),
        };
      }
      const { data, error } = await client.auth.signInWithIdToken({
        provider: 'google',
        token: idToken,
      });
      return {
        session: data.session,
        error,
      };
    },
    fetchProfile: fetchCloudProfile,
  });
}

export async function restoreCloudSession(): Promise<SessionRestoreOutcome> {
  const client = getSupabaseClient();
  return performSessionRestore({
    isConfigured: () => Boolean(client),
    getSession: async () => {
      if (!client) {
        return { session: null, error: null };
      }
      const { data, error } = await client.auth.getSession();
      return {
        session: data.session,
        error,
      };
    },
    fetchProfile: fetchCloudProfile,
  });
}

export async function signOutFromCloud(): Promise<{
  ok: boolean;
  error: string | null;
}> {
  const client = getSupabaseClient();
  return performSignOut({
    ensureGoogleConfigured: () => ensureGoogleSignInConfigured(),
    signOutSupabase: async () => {
      if (!client) {
        return { error: null };
      }
      const { error } = await client.auth.signOut();
      if (error) {
        // Ensure local session is still cleared even if global token revocation fails (e.g. offline)
        const { error: localErr } = await client.auth.signOut({ scope: 'local' });
        return { error: localErr ?? null };
      }
      return { error: null };
    },
    signOutGoogleNative: async () => {
      await GoogleSignin.signOut();
    },
  });
}

export function subscribeToCloudAuthChanges(
  onChange: (
    event: AuthChangeEvent,
    session: Session | null,
    profile: CloudProfile | null
  ) => void
): () => void {
  const client = getSupabaseClient();
  if (!client) {
    return () => {};
  }

  let active = true;
  const {
    data: { subscription },
  } = client.auth.onAuthStateChange((event, session) => {
    if (!active) return;
    if (!session?.user) {
      onChange(event, null, null);
      return;
    }
    void fetchCloudProfile(session.user.id)
      .then((profile) => {
        if (active) {
          onChange(event, session, profile);
        }
      })
      .catch(() => {
        if (active) {
          onChange(event, session, null);
        }
      });
  });

  return () => {
    active = false;
    subscription.unsubscribe();
  };
}
