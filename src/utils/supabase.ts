import { AppState, AppStateStatus } from 'react-native';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Database } from '../types/database.types';
import { chunkedSecureStorage } from './secureStorage';
import {
  CloudProfile,
  EnvValidationResult,
  validateClientEnv,
} from './authHelpers';

let cachedClient: SupabaseClient<Database> | null = null;
let cachedEnvKey = '';

export function getClientEnvValidation(): EnvValidationResult {
  return validateClientEnv({
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    googleWebClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  });
}

export function getSupabaseClient(): SupabaseClient<Database> | null {
  const validation = getClientEnvValidation();
  if (!validation.configured) {
    return null;
  }

  const nextKey = `${validation.supabase.url}::${validation.supabase.anonKey}`;
  if (cachedClient && cachedEnvKey === nextKey) {
    return cachedClient;
  }

  cachedClient = createClient<Database>(
    validation.supabase.url,
    validation.supabase.anonKey,
    {
      auth: {
        storage: chunkedSecureStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    }
  );
  cachedEnvKey = nextKey;
  return cachedClient;
}

export function startSupabaseAutoRefreshLifecycle(): () => void {
  const client = getSupabaseClient();
  if (!client) {
    return () => {};
  }

  void client.auth.startAutoRefresh();

  const subscription = AppState.addEventListener(
    'change',
    (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        void client.auth.startAutoRefresh();
      } else {
        void client.auth.stopAutoRefresh();
      }
    }
  );

  return () => {
    subscription.remove();
    void client.auth.stopAutoRefresh();
  };
}

export async function fetchCloudProfile(
  userId: string
): Promise<CloudProfile | null> {
  const client = getSupabaseClient();
  if (!client) {
    return null;
  }

  const { data, error } = await client
    .from('profiles')
    .select(
      'id, display_name, avatar_url, share_squad_status, status_band, timezone, cloud_xp, created_at, updated_at'
    )
    .eq('id', userId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data;
}
