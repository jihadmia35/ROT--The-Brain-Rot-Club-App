import { assert, describe, it } from '../testHarness';
import {
  createChunkedSecureStorage,
  sanitizeSecureStoreKey,
  SecureStoreBackend,
  splitIntoUtf8Chunks,
} from '../secureStorageCore';
import {
  CloudProfile,
  isDisallowedServerKey,
  mapAuthError,
  performGoogleSignIn,
  performSessionRestore,
  performSignOut,
  resolveCloudAccountIdentity,
  validateClientEnv,
} from '../authHelpers';
import {
  calculateTotalXp,
  claimDailyChestState,
  createInitialPersistedState,
  DEFAULT_BASE_XP,
  toggleMissionState,
  updateCustomDisplayNameState,
} from '../domainLogic';
import {
  AppStateStorageAdapter,
  CLOUD_USER_STATE_KEY_PREFIX,
  GUEST_STORAGE_KEY,
  getOwnerStateStorageKey,
  loadPersistedStateForOwner,
  reconcileCloudUserXpWithProfile,
  savePersistedStateForOwner,
} from '../accountStorageCore';

function createMemorySecureStoreBackend(): {
  backend: SecureStoreBackend;
  store: Map<string, string>;
} {
  const store = new Map<string, string>();
  const backend: SecureStoreBackend = {
    async getItemAsync(key: string) {
      return store.get(key) ?? null;
    },
    async setItemAsync(key: string, value: string) {
      for (const ch of key) {
        if (!/[A-Za-z0-9._-]/.test(ch)) {
          throw new Error(`Invalid SecureStore key: ${key}`);
        }
      }
      store.set(key, value);
    },
    async deleteItemAsync(key: string) {
      store.delete(key);
    },
  };
  return { backend, store };
}

function toBase64Url(input: string): string {
  return btoa(input).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function makeFakeJwtWithRole(role: string): string {
  const header = toBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = toBase64Url(JSON.stringify({ role, iss: 'supabase' }));
  return `${header}.${payload}.signature`;
}

describe('ROT Stage 3 — Encrypted Storage, Env Validation & Google Auth (Simulated Unit Tests)', () => {
  it('Sanitizes SecureStore keys and chunks large UTF-8 JWT sessions under 1800 bytes without losing surrogate pairs', async () => {
    assert.equal(sanitizeSecureStoreKey('sb:wlz/auth-token'), 'sb_wlz_auth-token');

    const { backend, store } = createMemorySecureStoreBackend();
    const adapter = createChunkedSecureStorage(backend, 1800);

    // Build a realistic large Supabase session JSON (> 4 KB) with emoji in metadata
    const hugeSessionJson = JSON.stringify({
      access_token: 'a'.repeat(1600),
      refresh_token: 'r'.repeat(800),
      user: {
        id: '11111111-1111-4111-8111-111111111111',
        email: null,
        user_metadata: { full_name: 'Ayla 🧠✨ '.repeat(120) },
      },
    });

    const chunks = splitIntoUtf8Chunks(hugeSessionJson, 1800);
    const encoder = new TextEncoder();
    assert.ok(chunks.length >= 3, 'Expected large session to split into >= 3 chunks');
    for (const chunk of chunks) {
      assert.ok(
        encoder.encode(chunk).length <= 1800,
        'Each chunk must stay within 1800 UTF-8 bytes'
      );
    }

    await adapter.setItem('sb-wlz-auth-token', hugeSessionJson);
    assert.equal(await adapter.getItem('sb-wlz-auth-token'), hugeSessionJson);
    assert.equal(store.get('sb-wlz-auth-token.__chunks'), String(chunks.length));

    // Corrupting a chunk must return null instead of partial JSON
    const savedChunk1 = store.get('sb-wlz-auth-token.__chunk_1')!;
    store.delete('sb-wlz-auth-token.__chunk_1');
    assert.equal(await adapter.getItem('sb-wlz-auth-token'), null);
    store.set('sb-wlz-auth-token.__chunk_1', savedChunk1);

    // Overwriting with a small value must clean up all stale chunk keys
    await adapter.setItem('sb-wlz-auth-token', '{"small":true}');
    assert.equal(await adapter.getItem('sb-wlz-auth-token'), '{"small":true}');
    assert.equal(store.has('sb-wlz-auth-token.__chunks'), false);
    assert.equal(store.has('sb-wlz-auth-token.__chunk_0'), false);

    // Remove deletes remaining entry cleanly
    await adapter.removeItem('sb-wlz-auth-token');
    assert.equal(await adapter.getItem('sb-wlz-auth-token'), null);
    assert.equal(store.size, 0);
  });

  it('Validates client env vars and blocks accidental service_role or secret keys', () => {
    const anonJwt = makeFakeJwtWithRole('anon');
    const serviceRoleJwt = makeFakeJwtWithRole('service_role');

    assert.equal(isDisallowedServerKey(anonJwt), false);
    assert.equal(isDisallowedServerKey(serviceRoleJwt), true);
    assert.equal(isDisallowedServerKey('sb_secret_12345'), true);

    const missingEnv = validateClientEnv({});
    assert.equal(missingEnv.configured, false);

    const httpEnv = validateClientEnv({
      supabaseUrl: 'http://wlzkooowbanponzaxsvj.supabase.co',
      supabaseAnonKey: anonJwt,
    });
    assert.equal(httpEnv.configured, false);

    const serviceRoleEnv = validateClientEnv({
      supabaseUrl: 'https://wlzkooowbanponzaxsvj.supabase.co',
      supabaseAnonKey: serviceRoleJwt,
    });
    assert.equal(serviceRoleEnv.configured, false);

    const validEnv = validateClientEnv({
      supabaseUrl: 'https://wlzkooowbanponzaxsvj.supabase.co',
      supabaseAnonKey: anonJwt,
      googleWebClientId: '123456-abc.apps.googleusercontent.com',
    });
    assert.equal(validEnv.configured, true);
    if (validEnv.configured) {
      assert.equal(validEnv.googleConfigured, true);
      assert.equal(
        validEnv.googleWebClientId,
        '123456-abc.apps.googleusercontent.com'
      );
    }
  });

  it('Handles missing/null email gracefully when resolving CloudAccountIdentity', () => {
    const profile: CloudProfile = {
      id: 'user-1',
      display_name: 'Club Balance',
      avatar_url: 'https://example.com/avatar.png',
      share_squad_status: false,
      status_band: 'hidden',
      timezone: 'UTC',
      cloud_xp: 0,
      created_at: '2026-11-18T00:00:00Z',
      updated_at: '2026-11-18T00:00:00Z',
    };

    const hiddenEmailIdentity = resolveCloudAccountIdentity(
      {
        id: 'user-1',
        email: null,
        user_metadata: { full_name: 'Ignored Meta Name' },
      },
      profile
    );
    assert.equal(hiddenEmailIdentity.email, null);
    assert.equal(hiddenEmailIdentity.hasEmail, false);
    assert.equal(hiddenEmailIdentity.emailLabel, 'Email hidden by Google');
    assert.equal(hiddenEmailIdentity.displayName, 'Club Balance');
    assert.equal(hiddenEmailIdentity.cloudXp, 0);

    // Fallback when profile is not yet loaded and email is undefined
    const fallbackIdentity = resolveCloudAccountIdentity(
      {
        id: 'user-2',
        email: undefined,
        user_metadata: { avatar_url: 'http://insecure.example.com/a.png' },
      },
      null
    );
    assert.equal(fallbackIdentity.displayName, 'ROT Club Member');
    assert.equal(fallbackIdentity.avatarUrl, null);
    assert.equal(fallbackIdentity.emailLabel, 'Email hidden by Google');
  });

  it('Simulates Google Sign-In + Supabase signInWithIdToken success, cancellation, network failure, and invalid token', async () => {
    const profile: CloudProfile = {
      id: 'auth-user-123',
      display_name: 'Ayla',
      avatar_url: null,
      share_squad_status: false,
      status_band: 'hidden',
      timezone: 'UTC',
      cloud_xp: 0,
      created_at: '2026-11-18T00:00:00Z',
      updated_at: '2026-11-18T00:00:00Z',
    };

    // 1. Success flow
    const successRes = await performGoogleSignIn({
      isConfigured: () => true,
      hasPlayServices: async () => true,
      signInWithGoogleNative: async () => ({
        cancelled: false,
        idToken: 'mock-google-id-token',
      }),
      signInWithSupabaseIdToken: async (idToken) => {
        assert.equal(idToken, 'mock-google-id-token');
        return {
          session: {
            access_token: 'mock-access',
            user: { id: 'auth-user-123', email: null },
          },
          error: null,
        };
      },
      fetchProfile: async () => profile,
    });
    assert.equal(successRes.ok, true);
    if (successRes.ok) {
      assert.equal(successRes.profile?.cloud_xp, 0);
    }

    // 2. Guest XP remains strictly separate at DEFAULT_BASE_XP (284)
    const guestState = createInitialPersistedState('2026-11-18');
    assert.equal(calculateTotalXp(guestState), DEFAULT_BASE_XP);
    assert.equal(DEFAULT_BASE_XP, 284);

    // 3. Cancellation flow
    const cancelRes = await performGoogleSignIn({
      isConfigured: () => true,
      hasPlayServices: async () => true,
      signInWithGoogleNative: async () => ({ cancelled: true }),
      signInWithSupabaseIdToken: async () => {
        throw new Error('Should not call Supabase on cancel');
      },
      fetchProfile: async () => null,
    });
    assert.equal(cancelRes.ok, false);
    if (!cancelRes.ok) {
      assert.equal(cancelRes.error.code, 'cancelled');
      assert.equal(cancelRes.error.cancelled, true);
    }

    // 4. Invalid token / nonce error from Supabase
    const invalidTokenRes = await performGoogleSignIn({
      isConfigured: () => true,
      hasPlayServices: async () => true,
      signInWithGoogleNative: async () => ({
        cancelled: false,
        idToken: 'bad-token',
      }),
      signInWithSupabaseIdToken: async () => ({
        session: null,
        error: new Error('Invalid id_token: passed nonce mismatch'),
      }),
      fetchProfile: async () => null,
    });
    assert.equal(invalidTokenRes.ok, false);
    if (!invalidTokenRes.ok) {
      assert.equal(invalidTokenRes.error.code, 'invalid_token');
    }

    // 5. Network failure error mapping
    const netErr = mapAuthError(new Error('Network request failed'));
    assert.equal(netErr.code, 'network_error');

    // 6. Missing idToken error
    const missingTokenRes = await performGoogleSignIn({
      isConfigured: () => true,
      hasPlayServices: async () => true,
      signInWithGoogleNative: async () => ({
        cancelled: false,
        idToken: null,
      }),
      signInWithSupabaseIdToken: async () => ({ session: null, error: null }),
      fetchProfile: async () => null,
    });
    assert.equal(missingTokenRes.ok, false);
    if (!missingTokenRes.ok) {
      assert.equal(missingTokenRes.error.code, 'missing_id_token');
    }
  });

  it('Simulates session restoration across restarts and clean logout preserving guest XP', async () => {
    const restored = await performSessionRestore({
      isConfigured: () => true,
      getSession: async () => ({
        session: {
          access_token: 'restored-jwt',
          user: { id: 'u1', email: 'member@example.com' },
        },
        error: null,
      }),
      fetchProfile: async () => null,
    });
    assert.equal(restored.status, 'authenticated');

    const emptyRestore = await performSessionRestore({
      isConfigured: () => true,
      getSession: async () => ({ session: null, error: null }),
      fetchProfile: async () => null,
    });
    assert.equal(emptyRestore.status, 'guest');

    const unconfiguredRestore = await performSessionRestore({
      isConfigured: () => false,
      getSession: async () => ({ session: null, error: null }),
      fetchProfile: async () => null,
    });
    assert.equal(unconfiguredRestore.status, 'unconfigured');

    // Sign out succeeds even if Google native signOut rejects
    let supabaseSignedOut = false;
    const signOutRes = await performSignOut({
      signOutSupabase: async () => {
        supabaseSignedOut = true;
        return { error: null };
      },
      signOutGoogleNative: async () => {
        throw new Error('Native signOut not initialized');
      },
    });
    assert.equal(supabaseSignedOut, true);
    assert.equal(signOutRes.ok, true);
  });

  it('Invokes ensureGoogleConfigured on cold-restored sign-out and isolates Supabase vs Google errors', async () => {
    const events: string[] = [];
    const coldSignOut = await performSignOut({
      ensureGoogleConfigured: () => {
        events.push('configure_google');
        return true;
      },
      signOutSupabase: async () => {
        events.push('supabase_signout');
        return { error: null };
      },
      signOutGoogleNative: async () => {
        events.push('google_signout');
      },
    });
    assert.equal(coldSignOut.ok, true);
    assert.deepEqual(events, [
      'supabase_signout',
      'configure_google',
      'google_signout',
    ]);

    // Skips native sign-out when Google env is unconfigured
    let nativeCalledWhenUnconfigured = false;
    const unconfiguredSignOut = await performSignOut({
      ensureGoogleConfigured: () => false,
      signOutSupabase: async () => ({ error: null }),
      signOutGoogleNative: async () => {
        nativeCalledWhenUnconfigured = true;
      },
    });
    assert.equal(unconfiguredSignOut.ok, true);
    assert.equal(nativeCalledWhenUnconfigured, false);

    // Fails if Supabase sign-out fails even when Google native succeeds
    const supabaseFailSignOut = await performSignOut({
      ensureGoogleConfigured: () => true,
      signOutSupabase: async () => ({
        error: new Error('Local storage failure'),
      }),
      signOutGoogleNative: async () => {},
    });
    assert.equal(supabaseFailSignOut.ok, false);
  });

  it('Isolates Guest XP (629 XP) across Guest -> Google A -> Guest -> Google B -> Google A transitions', async () => {
    const rawMap = new Map<string, string>();
    const storage: AppStateStorageAdapter = {
      async getItem(key: string) {
        return rawMap.get(key) ?? null;
      },
      async setItem(key: string, value: string) {
        rawMap.set(key, value);
      },
    };

    const dateKey = '2026-11-18';
    assert.equal(getOwnerStateStorageKey(null), GUEST_STORAGE_KEY);
    assert.equal(
      getOwnerStateStorageKey('user-a'),
      `${CLOUD_USER_STATE_KEY_PREFIX}user-a`
    );

    // 1. Seed Guest state at 629 XP (284 base + 345 earned)
    let guestState = createInitialPersistedState(dateKey, 'Redmi 11 Prime');
    guestState = {
      ...guestState,
      consentStatus: 'accepted',
      trackingEnabled: true,
      claimedXpEvents: {
        'mission:2026-11-15:stay-under-target': 45,
        'weekly:week-2026-11-09:under-target-week': 110,
        'mission:2026-11-15:brain-check-in': 25,
        'mission:2026-11-15:touch-grass': 40,
        'mission:2026-11-15:set-scroll-limit': 35,
        'mission:2026-11-16:stay-under-target': 45,
        'mission:2026-11-18:stay-under-target': 45,
      },
    };
    guestState = updateCustomDisplayNameState(guestState, 'Pramit').nextState;
    assert.equal(calculateTotalXp(guestState), 629);
    await savePersistedStateForOwner(storage, null, guestState);

    const profileA: CloudProfile = {
      id: 'user-a',
      display_name: 'Account A',
      avatar_url: null,
      share_squad_status: false,
      status_band: 'hidden',
      timezone: 'Asia/Dhaka',
      cloud_xp: 145,
      created_at: '2026-11-18T00:00:00Z',
      updated_at: '2026-11-18T00:00:00Z',
    };
    const profileB: CloudProfile = {
      ...profileA,
      id: 'user-b',
      display_name: 'Account B',
      cloud_xp: 0,
    };

    // 2. Guest -> Account A: inherits device consent/settings, starts from server 145 XP (not 629/284)
    let stateA = await loadPersistedStateForOwner(storage, 'user-a', dateKey, {
      templateState: guestState,
      cloudProfile: profileA,
    });
    assert.equal(calculateTotalXp(stateA), 145);
    assert.equal(stateA.profile.customDisplayName, null);
    assert.equal(stateA.consentStatus, 'accepted');

    // Account A earns 40 XP locally -> 185 XP
    stateA = toggleMissionState(stateA, 0, dateKey, true).nextState;
    assert.equal(calculateTotalXp(stateA), 185);
    await savePersistedStateForOwner(storage, 'user-a', stateA);

    // Reconciliation when server catches up to 185 must not double-count
    const noDoubleCount = reconcileCloudUserXpWithProfile(stateA, {
      ...profileA,
      cloud_xp: 185,
    });
    assert.equal(noDoubleCount.changed, false);
    assert.equal(calculateTotalXp(noDoubleCount.nextState), 185);

    // 3. Sign out -> Guest must be unchanged at 629 XP with Pramit display name
    const restoredGuest1 = await loadPersistedStateForOwner(
      storage,
      null,
      dateKey
    );
    assert.equal(calculateTotalXp(restoredGuest1), 629);
    assert.equal(restoredGuest1.profile.customDisplayName, 'Pramit');

    // 4. Guest -> Account B: starts completely clean at 0 XP
    let stateB = await loadPersistedStateForOwner(storage, 'user-b', dateKey, {
      templateState: restoredGuest1,
      cloudProfile: profileB,
    });
    assert.equal(calculateTotalXp(stateB), 0);
    assert.equal(Object.keys(stateB.claimedXpEvents).length, 0);
    assert.equal(stateB.profile.customDisplayName, null);

    // Account B claims daily chest (+50 XP)
    stateB = claimDailyChestState(stateB, new Date(2026, 10, 18)).nextState;
    assert.equal(calculateTotalXp(stateB), 50);
    await savePersistedStateForOwner(storage, 'user-b', stateB);

    // 5. Switch back to Guest -> 629 XP; back to Account A -> 185 XP; back to Account B -> 50 XP
    const restoredGuest2 = await loadPersistedStateForOwner(
      storage,
      null,
      dateKey
    );
    const restoredA = await loadPersistedStateForOwner(storage, 'user-a', dateKey, {
      cloudProfile: { ...profileA, cloud_xp: 185 },
    });
    const restoredB = await loadPersistedStateForOwner(storage, 'user-b', dateKey, {
      cloudProfile: { ...profileB, cloud_xp: 50 },
    });
    assert.equal(calculateTotalXp(restoredGuest2), 629);
    assert.equal(calculateTotalXp(restoredA), 185);
    assert.equal(calculateTotalXp(restoredB), 50);
  });
});
