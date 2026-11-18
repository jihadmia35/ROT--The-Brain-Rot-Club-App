# ROT. — The Brainrot Club (Android MVP + Cloud Squads)

ROT. is a local-first, privacy-respecting Android digital wellbeing companion that helps users build healthier Instagram scrolling habits through honest `UsageStats` foreground-time estimates, daily targets, streaks, focus breaks, notifications, shareable collector cards, and optional Google/Supabase-backed Cloud Squads—without shame, dark patterns, or Instagram login.

Full Phase 1–2 historical milestones, Stage 3–4 cloud architecture, physical-device QA results, and the SRS cross-check matrix (`FR-001`–`FR-031`, `NFR-01`–`NFR-18`, `BT-01`–`BT-15`, `AT-01`–`AT-12`) are documented in [docs/EXECUTIVE_DEMO_REPORT.md](docs/EXECUTIVE_DEMO_REPORT.md).

---

## Current Scope (`fix/rot-cloud-account-isolation` on `master`)

1. **Android Development Build & Native Bridge (`android/`):** Native Android project (`com.rot.brainrotclub`) configured for **Expo `~58.0.24`**, **React Native `0.88.1`**, **React `19.3.0`**, **TypeScript `~6.0.3`**, and **WorkManager `2.10.0`** with New Architecture and Hermes enabled.
2. **Local-First Profile & Device Identity:** Automatically resolves the Android device name (`Settings.Global.DEVICE_NAME`, `bluetooth_name`, or `Build.MODEL`) on first launch, allows custom display-name editing from Today or Settings (max 28 characters), persists locally in `AsyncStorage`, and reverts cleanly to the device default or `"ROT User"` fallback.
3. **Instagram Foreground Tracking (`RotUsageTracker.kt` & `UsageStatsModule.kt`):** Queries `UsageStatsManager` (`queryEvents` across foreground activity lifecycle transitions with deduplicated `INTERVAL_DAILY` fallback) for `com.instagram.android` across a rolling 7-day window.
4. **Honest 9-State `UsageStats` Data Contract:**
   - Distinguishes `permission_required`, `tracking_paused`, `not_installed`, `no_os_record`, `query_failed`, `stale`, `incomplete`, `zero_usage`, and `ok`.
   - **Never displays missing, paused, or failed data as `0h 00m`**, preserves `cachedUsageSummary`, and labels metrics strictly as **estimated Instagram foreground time** (never claiming exact Reel counts).
5. **Custom Targets, Brainrot Index Breakdown & Mood Check-In:**
   - Preset daily targets (`30m`–`3h 00m`), `±5m` steppers, custom target input (`15m`–`720m`), and optional **Weekend Breathing Room** (`+30m`).
   - Expandable Brainrot Index score breakdown (`0–99`) and daily **Mood Check-in** drawer with 4 presets, 120-char notes, and recent mood history.
6. **Streak & Grace-Day Engine, Usage-Linked Missions & Weekly Quests:**
   - Daily streak evaluator with 1 weekly automatic **Grace Day**, non-punitive missing-data handling, and streak recovery (`+25 XP`).
   - 4 daily missions (including auto-verified `stay-under-target`) and 3 auto-tracked Weekly Quests (`Balanced Week`, `Focus Break Master`, `Target Guardian`).
7. **Idempotent XP, Brain Bank Ledger, Levels, Focus Breaks & Badges:**
   - Deterministic event keys (`claimedXpEvents`) backed by a verified **Brain Bank XP Ledger** (`Verified · <N> XP`), interactive top-bar XP pill shortcut, player levels, `1m` / `5m` / `10m` Focus Break timer (`expo-audio` WAV jingles), Daily Reward Chest, and 6 unlockable badges.
8. **Optional Google Auth, Cloud XP Sync & Invite-Only Squads (Stage 3–4 + Isolation Fix):**
   - **Authentication & Session Storage:** Native Android Google Sign-In (`@react-native-google-signin/google-signin`) exchanges an ID token with Supabase Auth (`signInWithIdToken`) and stores sessions in chunked `expo-secure-store` (`src/utils/secureStorageCore.ts`).
   - **Cloud Profile & Scoped XP Queue:** Authenticated users get server-persisted `profiles` (`cloud_xp`, timezone-normalized sync, optional display-name sync, and `BT-08` status-band privacy) plus a per-user offline-capable XP queue flushed via the `award_cloud_xp` RPC without ever transferring historical Guest XP.
   - **Cloud Squads vs. Local Demo Preview:** The **Squad** tab is cloud-powered for authenticated users (squad creation, invite code generation/redemption, **targeted invitations by Member ID**, ownership transfer, block/unblock, abuse reporting, and Realtime-backed squad notifications), while **Friends** and **Campus** tabs remain clearly labeled **Local Demo Preview** entries.
9. **Account Isolation & Cold-Start Sign-Out Hardening (`fix/rot-cloud-account-isolation`):**
   - **Guest XP Isolation (`@rot_executive_demo_state_v1`):** Guest progress, `baseXp`, `claimedXpEvents`, `xpLedger`, and custom display name remain strictly isolated in `GUEST_STORAGE_KEY`.
   - **Per-User Cloud State (`@rot_cloud_user_state_v1_<userId>`):** Each signed-in account uses its own user-scoped `AsyncStorage` key (`CLOUD_USER_STATE_KEY_PREFIX` in `src/utils/accountStorageCore.ts`), starting with `baseXp: 0` and preserving only device-level permissions/settings (`consentStatus`, `trackingEnabled`, `dailyLimitMinutes`, `settings`, `cachedUsageSummary`).
   - **Cloud XP Reconciliation & Safe Switching:** `reconcileCloudUserXpWithProfile` monotonically aligns local cloud XP with `profiles.cloud_xp` without inflating server XP or altering Guest XP, while `switchActiveOwnerState` and `loadedStateOwnerRef` guards prevent stale async writes across account switches.
   - **Google Sign-Out Cold-Start Fix:** `signOutFromCloud()` (`src/utils/auth.ts` / `src/utils/authHelpers.ts`) invokes `ensureGoogleSignInConfigured()` before `GoogleSignin.signOut()` so cold-restored sessions still clear native Google account selection, and falls back to `supabase.auth.signOut({ scope: 'local' })` if remote revocation fails.
   - **Targeted Squad Invitations by Member ID:** Squad owners can send targeted invitations using an invitee's UUID Member ID (`validateInviteeUserId` in `src/utils/cloudSquadsCore.ts`, `SEND TARGETED INVITATION BY MEMBER ID` in `LeaderboardScreen.tsx`), and signed-in users can view/select their `Member ID` in **Settings**.
10. **Native Notifications, Persistent Unread Badge, Shareable Cards & Privacy Controls:**
    - Real Android notification channels, `WorkManager` 15-minute periodic checks, `AlarmManager` daily reminders, quiet hours, `RotBootReceiver`, and persistent unread inbox merged with cloud notifications in `NotificationCenterModal.tsx`.
    - Swipeable **Archetype Collector Card** and **Weekly Achievement Card** (`1080x1350` Feed / `1080x1920` Story PNGs) with Private Mode stats redaction, `MediaStore` deduplication, Android Share Sheet, JSON export (`rot-user-data-export-v1`), and two-tap `Clear local history`.

---

## 1. Prerequisites

| Requirement | Verified Version / Configuration |
| :--- | :--- |
| **Node.js** | v22+ or v24+ |
| **JDK** | JDK 17 (`JAVA_HOME` configured) |
| **Android Build** | `newArchEnabled=true`, `hermesEnabled=true`, `reactNativeArchitectures=arm64-v8a`, `androidx.work:work-runtime-ktx:2.10.0` |
| **Expo / React Native** | `expo@~58.0.24`, `react-native@0.88.1`, `react@19.3.0`, `typescript@~6.0.3` |
| **Cloud SDKs (Optional Cloud Mode)** | `@supabase/supabase-js@^2.81.1`, `@react-native-google-signin/google-signin@^16.0.0`, `expo-secure-store@~58.0.8` |
| **Target Device** | Physical Android device or emulator (verified on **Xiaomi Redmi 11 Prime**, Android 14 / API 34) |

---

## 2. Local & Cloud Setup

Clone the repository, check out your working branch, and install dependencies:

```bash
git checkout fix/rot-cloud-account-isolation
npm install
```

### Optional Cloud Configuration (`.env`)

To enable Google Sign-In and Supabase cloud features locally, copy `.env.example` to `.env` and populate your own public client values:

```bash
cp .env.example .env
```

Required variables in `.env` (never commit `.env`, access tokens, or `service_role` / `client_secret` credentials):
- `EXPO_PUBLIC_SUPABASE_URL` — Supabase project URL.
- `EXPO_PUBLIC_SUPABASE_ANON_KEY` — Supabase public anonymous/publishable key (never a `service_role` key; `src/utils/authHelpers.ts` actively rejects secret keys).
- `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` — Google Cloud OAuth 2.0 Web Client ID paired with the Android OAuth client package name (`com.rot.brainrotclub`) and signing SHA-1 fingerprint.

Database schema migrations (`supabase/migrations/20261118000001`–`20261118000004`) and SQL security tests (`supabase/tests/database_security_test.sql`) live under `supabase/`.

---

## 3. Android Debug Build

To compile the native Android debug APK (`android/app/build/outputs/apk/debug/app-debug.apk`):

```bash
# macOS / Linux
cd android && ./gradlew :app:assembleDebug --no-daemon

# Windows (PowerShell / CMD)
cd android && .\gradlew.bat :app:assembleDebug --no-daemon
```

> **Windows Long-Path Mitigation:** `android/app/build.gradle` configures a root-relative CMake staging directory (`${rootDir.toPath().root}rot-cxx`) and `-DCMAKE_OBJECT_PATH_MAX=210` so Windows builds succeed regardless of repository folder depth.

---

## 4. Physical Device Installation

1. Enable **Developer Options** and **USB Debugging** (or Wireless Debugging; plus **Install via USB** on Xiaomi/MIUI devices) on your Android phone.
2. Verify device connection:
   ```bash
   adb devices -l
   ```
3. Install the debug APK, forward the Metro bundler port, and launch the application:
   ```bash
   adb install -r android/app/build/outputs/apk/debug/app-debug.apk
   adb reverse tcp:8081 tcp:8081
   npx expo start --dev-client
   ```

---

## 5. Android Permissions Setup

- **Usage Access (`PACKAGE_USAGE_STATS`):** Required for Instagram foreground-time estimates. ROT opens Android's **Usage access** screen from the onboarding modal, Today banner, or Settings and rechecks on app resume.
- **Notifications (`POST_NOTIFICATIONS` on Android 13+):** Required for budget nudges and evening/streak reminders. Manageable per channel in **Settings > Preferences & Local Notifications**.
- **Boot & Alarm Rescheduling (`RECEIVE_BOOT_COMPLETED`):** Allows `RotBootReceiver` to re-register periodic `WorkManager` jobs and `AlarmManager` reminders after device restart or timezone changes.

For automated ADB testing:

```bash
# Grant / revoke Usage Access via AppOps
adb shell appops set com.rot.brainrotclub GET_USAGE_STATS allow
adb shell appops set com.rot.brainrotclub GET_USAGE_STATS ignore
```

---

## 6. Xiaomi / MIUI Notes

- On **Xiaomi MIUI / HyperOS (Android 14)**, opening `Settings.ACTION_USAGE_ACCESS_SETTINGS` triggers MIUI's `SpecialPermissionInterceptActivity` 10-second security dialog before **Accept** becomes enabled.
- `RotUsageTracker.kt` prioritizes granular `queryEvents` transitions and deduplicates MIUI's `INTERVAL_DAILY` buckets by taking the maximum bucket duration per day (`status: 'incomplete'` when only bucket data exists).
- MIUI battery/autostart restrictions may delay background `WorkManager` or `AlarmManager` triggers unless ROT is exempted in system battery settings.

---

## 7. Verification Commands

Run all static and unit checks from the project root:

```bash
npm run typecheck
npm run lint
npm test
```

Latest verified suite: `tsc --noEmit` (`0` errors), `npm run lint` (`44` files), `npm test` (`31` passed, `0` failed), and `:app:assembleDebug` (`BUILD SUCCESSFUL`).

---

## 8. Stage 4 / Cloud Integration Verification

The tables below distinguish **automated tests**, **device-tested behavior** on a Xiaomi Redmi 11 Prime (two distinct Google/Supabase accounts labeled **Account A** and **Account B**, with sensitive emails, UUIDs, and invite codes redacted), and **explicitly untested behavior**.

### Automated Tests (`31 passed, 0 failed`)
- **Storage, Auth & Account Isolation (`src/utils/__tests__/authAndStorage.test.ts`):**
  - Chunked UTF-8 `SecureStore` session serialization and env validation rejecting `service_role`/secret keys.
  - Simulated Google Sign-In + Supabase `signInWithIdToken`, session restoration across restarts, and cold-start `ensureGoogleSignInConfigured()` execution during `performSignOut`.
  - Regression test verifying Guest XP (`629 XP`) isolation across `Guest -> Account A -> Guest -> Account B -> Account A` transitions using separate `@rot_executive_demo_state_v1` and `@rot_cloud_user_state_v1_<userId>` keys without double-counting reconciled `cloud_xp`.
- **Cloud Stage 4 Core (`src/utils/__tests__/cloudStage4.test.ts`):**
  - Timezone normalization + UTC fallback, `BT-08` `status_band` privacy masking, profile sync patches, per-user XP queue isolation + offline retry/cap handling, squad name/invite code/Member ID UUID (`validateInviteeUserId`) validation, roster sorting, and notification inbox merge/read tracking.
- **Core Local MVP (`src/utils/__tests__/domainLogic.test.ts`):**
  - 9-state `UsageQueryResult`, daily limits, XP ledger idempotency, focus breaks, streak & grace-day engine, weekly quests, mood logs, Brainrot Index, quiet hours, dual card summaries, and `99+` unread badge saturation.

### Device-Tested Behavior (Xiaomi Redmi 11 Prime, Android 14)
- **Account A Cloud XP:** Confirmed at `145` Cloud XP and independently persisted across sessions.
- **Account B Cloud XP:** Started at `0` Cloud XP and independently progressed to `50` Cloud XP.
- **Guest Mode Isolation:** Guest retained `629` XP and custom display name `Pramit` across repeated Account A and Account B sign-in/sign-out cycles.
- **User-Scoped Storage Keys:** Confirmed Account A and Account B each persisted to separate `@rot_cloud_user_state_v1_<userId>` entries while Guest used `@rot_executive_demo_state_v1`.
- **Squad Join & Shared Roster:** Account B successfully joined **Balance Club** using a generated invite code; both Account A and Account B observed the accurate two-member roster (`145` XP and `50` XP).
- **Invite-Accepted Notification:** Account A received the persistent invite-accepted notification for Account B joining **Balance Club**.
- **Block & Unblock Controls:** Blocking and unblocking between members succeeded, updating squad roster visibility (`1 / 12` hidden while blocked, `2 / 12` restored upon unblock) and blocked-users state.
- **Abuse / Safety Reporting:** Account B successfully submitted an abuse report (`Other` category).
- **Notification Preferences:** Squad activity notification alerts toggle (`OFF`/`ON`) updated cleanly for Account A.
- **Ownership Transfer:** Ownership transfer in **Balance Club** from Account A to Account B succeeded (`Account B = Owner`, `Account A = Member`).
- **Targeted Invitations by Member ID:** Account A successfully created targeted invitations for Account B's Member ID in both **Night Owls** and **Decline Test** squads.

### Untested / Not Verified Behavior (Do Not Claim PASS)
- **Accepting and declining the two targeted invitations** (created for Account B in **Night Owls** and **Decline Test**).
- **Leaving a squad** (`Leave squad`).
- **Removing a squad member** (`Remove`).
- **Deleting a squad** (`Delete squad`).
- **Simultaneous two-device Realtime push:** Single-device switching verified persistent invite-accepted notifications, while live cross-device foreground Realtime push without switching accounts remains unverified.
- **Preserved Runtime Items (`NOT VERIFIED`):** Unattended wall-clock `AlarmManager` firing, physical device reboot recovery (`RotBootReceiver`), `100+` live OS notifications, and standalone release APK generation.

---

## 9. Known Limitations & Unverified Scenarios

1. **App-Level Foreground Granularity Only:** `UsageStatsManager` cannot verify individual Reels watched; ROT reports **estimated Instagram foreground time** only.
2. **OS `UsageEvents` Retention (~7 Days):** Android retains raw `UsageEvents` for approximately 7 days before pruning older events.
3. **Mixed Social Model:** **Squad** uses authenticated Supabase cloud sync (`cloudSquads.ts`), whereas **Friends** and **Campus** tabs remain **Local Demo Preview** entries.
4. **Untested Flows Listed Above:** Targeted invite accept/decline, `Leave squad`, `Remove` member, `Delete squad`, unattended wall-clock alarms, physical reboot recovery, `100+` live notifications, and standalone release APK distribution remain unverified on hardware.

