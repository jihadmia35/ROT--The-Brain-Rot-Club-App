import { CloudProfile } from './authHelpers';
import {
  performSyncCloudProfile,
  ProfileUpdatePatch,
} from './cloudProfileCore';
import { getSupabaseClient } from './supabase';

export async function updateCloudProfile(
  userId: string,
  patch: ProfileUpdatePatch
): Promise<{
  ok: boolean;
  profile: CloudProfile | null;
  error: string | null;
}> {
  const client = getSupabaseClient();
  if (!client) {
    return {
      ok: false,
      profile: null,
      error: 'Cloud client is not configured.',
    };
  }

  return performSyncCloudProfile(
    {
      updateProfile: async (uid, nextPatch) => {
        const { data, error } = await client
          .from('profiles')
          .update(nextPatch)
          .eq('id', uid)
          .select(
            'id, display_name, avatar_url, share_squad_status, status_band, timezone, cloud_xp, created_at, updated_at'
          )
          .single();

        return {
          profile: data ?? null,
          error,
        };
      },
    },
    userId,
    patch
  );
}
