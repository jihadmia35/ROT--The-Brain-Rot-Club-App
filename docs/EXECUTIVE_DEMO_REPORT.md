# ROT. — Executive Project Report: Phase 1 Foundation through Stage 4 Cloud Squads & Account Isolation

**Project:** ROT. – The Brainrot Club (`com.rot.brainrotclub`)  
**Current Branch:** `fix/rot-cloud-account-isolation` (Stage 3–4 Cloud Integration + Account Isolation Fixes on top of `master`)  
**Previous Milestone Branches:** `feature/rot-mvp-core` (`PR #2`, merged at `1272ada`) and `feature/rot-executive-demo` (`PR #1`, `6554c81`)  
**Verified Hardware:** Xiaomi Redmi 11 Prime (`22071219AI`), Android 14 (API 34, MIUI / HyperOS)  
**Document Scope:** Transition record from Phase 1 Executive Demo and Local-First MVP (`PR #1`–`PR #2`) to Stage 3–4 Cloud Authentication, Scoped XP Sync, Invite-Only Squads, and Multi-Account Isolation, cross-checked against `Software Requirements Specification and Project Plan.pdf` (v1.0, 11 November 2026)

---

## A. Project Overview

**ROT. – The Brainrot Club** is a local-first, privacy-respecting Android digital wellbeing companion that helps users understand and manage their Instagram scrolling habits without shame, dark patterns, or Instagram account login.

- **Original Problem Statement & Objectives (SRS Sections 1–2):**
  - Help users understand their Instagram usage using honest **estimated Instagram foreground time** via Android's `UsageStatsManager`, while explicitly acknowledging OS boundaries (never claiming exact Reel counts or relying on fragile, policy-sensitive `AccessibilityService` scraping).
  - Encourage self-directed healthier habits through configurable daily targets, gentle non-shaming nudges, and offline recovery breaks.
  - Make habit awareness engaging via non-monetary XP, levels, badges, daily missions, weekly quests, streaks, and a playful mascot—without rewarding longer time inside Instagram or ROT.
  - Build user trust through explicit onboarding consent, clear data-quality/staleness states (never disguising missing data as `0h 00m`), local-only storage, and one-tap history export/deletion.
- **Intended Users:** Android users (primarily Gen Z / young-adult Instagram scrollers) using ROT as a **local/guest companion** on one device (`SRS Section 4.1`). Optional registered accounts and social squads remain gated behind a future backend phase.

---

## B. Phase 1 — Foundation (`PR #1`, `feature/rot-executive-demo`)

> **Preserved Historical Milestone:** Phase 1 upgraded ROT from a static UI prototype (`d771b8e`) into an installable, local-first Android Executive Demo verified on Xiaomi Redmi 11 Prime (`PR #1`).

### Phase 1 Completed Objectives
1. **Native Android Development Build (`android/`):** Configured `com.rot.brainrotclub` for Expo `58.0.24` / React Native `0.88.1` with New Architecture / Bridgeless & Hermes enabled, plus a portable Windows CMake staging configuration (`${rootDir.toPath().root}rot-cxx`, `-DCMAKE_OBJECT_PATH_MAX=210`) in `android/app/build.gradle`.
2. **Local-First Device & Custom Display-Name Identity (`Part B`):** Removed all hardcoded `"Rafi"` / `"rafi."` strings (enforced by static lint rules in `scripts/lint.mjs`). Resolved the Android device name (`Redmi 11 Prime`) on first launch via `UsageStatsModule.getDeviceProfileInfo()` and enabled inline/Settings custom name editing (max 28 characters) with `AsyncStorage` persistence and 1-tap revert.
3. **Structured 9-State `UsageStats` Data Contract (`Part C`):** Implemented `UsageQueryResult` distinguishing `permission_required`, `tracking_paused`, `not_installed`, `no_os_record`, `query_failed`, `stale`, `incomplete`, `zero_usage`, and `ok`. Missing, paused, or failed queries never render `0h 00m` and never overwrite `cachedUsageSummary`.
4. **Core Phase 1 Gameplay & Controls:** Implemented consent modal (`UsagePermissionModal.tsx`), Usage Access deep-linking (including Xiaomi MIUI `SpecialPermissionInterceptActivity` compatibility), preset daily targets (`30m`–`3h 00m`), Weekend Breathing Room (`+30m`), Brainrot Index, idempotent daily missions/chest/focus break (`1m` / `5m` / `10m`), 6 badges, and `Clear local history`.

### Phase 1 Commit History (`feature/rot-executive-demo`)

| Commit | Summary | Scope |
| :--- | :--- | :--- |
| `eb447d8` | `feat(android): configure native Android project and UsageStats module` | Native Android project (`android/`), `PACKAGE_USAGE_STATS` & `<queries>` manifest declarations, `UsageStatsModule.kt`, `UsageStatsPackage.kt`, `MainApplication.kt`. |
| `2e748cc` | `feat(app): implement UsageStats dashboard, consent flow, limits, and local persistence` | Typed native bridge (`src/utils/usageStats.ts`), `AsyncStorage` persistence (`src/utils/storage.ts`), domain logic (`src/utils/domainLogic.ts`), shared types (`src/constants/types.ts`). |
| `a636277` | `test(ci): add unit tests, static lint checks, GitHub Actions CI, and setup docs` | Unit test suite (`src/utils/__tests__/domainLogic.test.ts`), static linter (`scripts/lint.mjs`), GitHub Actions CI (`.github/workflows/ci.yml`), `README.md`. |
| `1cd80c3` | `fix(android): configure Windows CMake object path limit and SafeAreaProvider` | Windows CMake path length mitigation and Android safe-area handling. |
| `6554c81` | `feat(demo): add device/custom display name profile, complete UsageStats data states, and finalize SRS report` | Identity system (`Part B`), 9-state `UsageQueryResult` contract (`Part C`), portable screenshots (`docs/screenshots/executive-demo/`), initial `docs/EXECUTIVE_DEMO_REPORT.md`. |

---

## C. Phase 2 — MVP Implementation (`PR #2` & `PR #2.1`, `feature/rot-mvp-core`)

Phase 2 transforms ROT from an executive demonstration into a complete local-first MVP. Commit `0115d7e` delivered the PR #2 Core MVP engine, and the working-tree `PR #2.1` pass adds real native Android notifications, unread inbox badge persistence, dual PNG card export/sharing, and final UX polish. Only verified codebase features are listed below:

1. **User Profile & Settings (`src/screens/SettingsScreen.tsx`, `src/screens/TodayScreen.tsx`):**
   - Automatic Android device name discovery (`Settings.Global.DEVICE_NAME` -> `bluetooth_name` -> `Build.MODEL`) with fallback `"ROT User"`.
   - Inline editing on Today and dedicated **Profile & Display Name** card in Settings (`MAX_DISPLAY_NAME_LENGTH = 28`), custom name persistence, and 1-tap revert to device name.
   - Custom daily scroll limit presets (`30m`–`3h 00m`), `±5m` stepper, and custom numeric minute entry (`15m`–`720m`), plus **Weekend Breathing Room** (`+30m` on Saturday/Sunday).
   - **Local Data, Export & History** controls: structured JSON export (`Export / Share JSON` + inline `Preview JSON`, format `rot-user-data-export-v1`) and two-tap `Clear local history` (`clearLocalHistoryState`) preserving consent/profile/settings.
2. **Screen-Time Tracking & `UsageStats` Integration (`RotUsageTracker.kt`, `UsageStatsModule.kt`, `src/utils/usageStats.ts`):**
   - Multi-activity foreground interval tracking (`ACTIVITY_RESUMED`, `ACTIVITY_PAUSED`, `ACTIVITY_STOPPED`, screen off / keyguard / shutdown boundaries) for `com.instagram.android` across a rolling 7-day window.
   - Deduplicated `INTERVAL_DAILY` bucket fallback (`maxOf` per day) to guard against MIUI/HyperOS duplicate bucket inflation, tagged `status: 'incomplete'` when granular events are unavailable.
   - 9-state `UsageQueryResult` enforcement and 30-minute staleness threshold (`STALE_THRESHOLD_MS`).
3. **Brainrot Index, Breakdown & Mood Logging (`src/screens/TodayScreen.tsx`, `src/utils/domainLogic.ts`):**
   - Calculates `0–99` Brainrot Index (`calculateBrainrotIndex`) from usage-vs-target ratio minus mission and focus-break bonuses, with an expandable **Breakdown** panel showing exact base score, mission bonus, focus break bonus, and summary text.
   - Interactive **Mood Check-in** drawer with 4 mood presets (`balanced`, `curious`, `cooked`, `offline_reset`), optional 120-character note (`MAX_MOOD_NOTE_LENGTH`), and recent mood check-in history (`moodLogsByDate`).
4. **Missions & Weekly Quests (`src/screens/MissionsScreen.tsx`, `src/constants/data.ts`, `src/utils/domainLogic.ts`):**
   - 4 daily healthy-habit missions (`touch-grass`, `set-scroll-limit`, `brain-check-in`, and usage-linked `stay-under-target` which auto-verifies when verified daily Instagram usage stays within the effective daily limit).
   - 3 auto-tracked **Weekly Quests** (`balanced-week`, `focus-master`, `under-target-week`) with progress bars and claimable XP rewards (`+90`, `+80`, `+110 XP`).
5. **XP System & Brain Bank Transaction Ledger (`App.tsx`, `src/screens/MissionsScreen.tsx`, `src/utils/domainLogic.ts`):**
   - Deterministic, idempotent XP awards via `claimedXpEvents` (`mission:<date>:<id>`, `chest:<date>`, `break:<date>:<session>`, `weekly-quest:<week>:<id>`, `streak-recovery:<date>`).
   - Chronological `xpLedger` with consistency verification (`verifyXpLedgerConsistency`, displayed as `Verified · <N> XP` in **Brain Bank XP Ledger**).
   - Interactive top-bar XP pill (`xpPill` in `App.tsx`) that switches to `Missions` and auto-scrolls directly to `Brain Bank XP Ledger`.
6. **Player Levels, Streaks, Grace Days, Badges & Leaderboard Preview:**
   - **Player Levels (`calculatePlayerLevel`):** Progressive 100-XP-step levels and rank titles (*Newbie Scroller* through *Offline Legend*).
   - **Streak & Grace-Day Engine (`evaluateStreakState`, `recoverStreakState`):** Evaluates missed/completed days across timezone-safe local date keys (`yyyy-MM-dd`), grants 1 automatic **Grace Day** per week (`maxGraceDaysPerWeek`), never punishes missing `UsageStats` days (`BT-07`), and supports streak recovery (`+25 XP`).
   - **Badges (`getBadges` in `src/constants/data.ts`, `BadgesScreen.tsx`):** 6 badges (`first-flight`, `limit-setter`, `grass-toucher`, `brain-check`, `soft-launcher`, `offline-icon`) with earned timestamps (`unlockedAt`) and celebration modal/audio.
   - **Leaderboard (`LeaderboardScreen.tsx`):** Local `Friends`, `Squad`, and `Campus` preview tabs merging the user's live display name, handle, initials, and XP with dynamic XP sorting and friendly high-five toasts (local demo data).
7. **Focus Breaks & Rewards (`src/components/BreakModal.tsx`, `src/components/DailyChestCard.tsx`, `src/utils/sound.ts`):**
   - Non-blocking `1m` (demo), `5m`, and `10m` offline Focus Break timer (`completeFocusBreakState`), awarding `+30 XP`, completing *"Touch some grass"*, unlocking `Offline Icon`, and recording duration-specific ledger entries.
   - Daily Reward Chest awarding `+50 XP` and a daily cosmetic item label (`Soft Reset sticker`, `Golden brain pin`, `Offline icon`, `Tiny victory badge`) with offline WAV confirmation jingles via `expo-audio`.
8. **Notification System, Notification Center & Persistent Unread Badge:**
   - Dedicated Android notification channels (`rot_wellbeing_nudges` and `rot_scheduled_reminders`) managed by `RotNotificationHelper.kt`.
   - `RotNotificationPrefs.kt` persists up to 150 delivered notifications in native `SharedPreferences` (`rot_notification_prefs`) with ID deduplication (`hasNotificationId`) so foreground, `WorkManager`, and `AlarmManager` notifications never double-count.
   - Top-bar bell displays a red badge (`formatUnreadBadgeCount`: hidden at `0`, exact count `1–99`, `99+` above `99`), syncs on app launch/resume, and marks notifications read upon opening `NotificationCenterModal.tsx` (highlighting newly read items with a `NEW` pill).
9. **Background Scheduling, Quiet Hours, Weekend Rules & Reboot Recovery:**
   - **WorkManager (`RotUsageCheckWorker.kt`):** Runs periodic 15-minute background usage checks (`rot_usage_periodic_check`) to evaluate 80% / 100% daily budget nudges even when the UI is closed.
   - **AlarmManager (`RotNotificationScheduler.kt`, `RotAlarmReceiver`):** Schedules daily evening mission reminders and streak protection reminders at user-configurable hour/minute values.
   - **Quiet Hours & Weekend Adjustments:** Configurable quiet window (`quietStartHour`–`quietEndHour`, overnight wrap supported, default `22:00–08:00`) suppresses non-test notifications; `weekendBreathingRoom` adds `+30m` to native threshold calculations on Saturday/Sunday (`effectiveDailyLimitMinutes`).
   - **Reboot & Timezone Recovery (`RotBootReceiver`):** Registered in `AndroidManifest.xml` for `BOOT_COMPLETED`, `MY_PACKAGE_REPLACED`, `TIME_SET`, and `TIMEZONE_CHANGED` to reschedule periodic work and daily alarms.
10. **Dual Shareable Cards, Swipe Modal, PNG Export, Private Mode & Native Sharing:**
    - **Archetype Collector Card (`ArchetypeCardPoster`):** Renders dynamic archetype (`Soft Launcher`, `Grass Toucher`, `Night Owl`, `Scroll Explorer`), `RotMascot` SVG/view illustration, player level progress, Brainrot Index, streak, and XP.
    - **Weekly Achievement Card (`WeeklyAchievementPoster`):** Summarizes `buildWeeklyAchievementSummary` (weekly XP earned, missions completed, weekly quests, streak, badges) with an honest zero-progress empty state.
    - **Main Browsing & Swipe Modal (`BrainrotCardScreen.tsx`, `CardSelectionModal.tsx`):** Main screen focuses on horizontal card browsing (`Archetype` <-> `Weekly`), Evolution Path, daily wisdom, and a single `Save or Share` button. Opening `CardSelectionModal` freezes background card gestures while allowing smooth spring-animated swiping/tapping between tilted card previews inside the modal.
    - **Feed `4:5` & Story `9:16` PNG Generation (`react-native-view-shot` + `RotCardMediaModule.kt`):** Captures hidden high-resolution card views and normalizes exact **`1080x1350`** (Feed) and **`1080x1920`** (Story) PNGs.
    - **Private Mode & Stats Redaction:** When Settings `Private mode` is ON, `CardSelectionModal` exposes a stats visibility toggle; hiding stats replaces personal metrics with `PRIVATE EDITION` / `PRIVATE CARD · PERSONAL STATS HIDDEN` (Archetype) and `PRIVATE WEEKLY CHECK-IN` / `PRIVATE WEEKLY CARD · STATS HIDDEN BY USER` (Weekly). When Private Mode is OFF, the modal toggle stays hidden while keeping `Save PNG` and `Share` actions consistent.
    - **Android Gallery Save, Duplicate Prevention & Native Share Sheet:** Saves PNGs to `Pictures/ROT` via `MediaStore` (API 29+) or `MediaScannerConnection` (API 24–28), deduplicates repeated saves of the same card/format/date/stats hash (`saved_uri_<key>` + `findExistingGalleryUriByName`), and shares via `FileProvider` (`${applicationId}.fileprovider`) and `Intent.createChooser` (`Share ROT Card`).

---

## C.5 Stage 3–4 Cloud Integration & Account Isolation (`fix/rot-cloud-account-isolation`)

Building on the merged MVP (`1272ada`), Stage 3 (`f02c5a3`), Stage 4 (`09ebd1a`), and the `fix/rot-cloud-account-isolation` stabilization changes add optional Google/Supabase cloud accounts while preserving strict local Guest Mode separation:

1. **Stage 3 Foundation (`f02c5a3`) — Supabase Schema, RLS/RPC Security & Google OAuth:**
   - Added 4 SQL migrations (`supabase/migrations/20261118000001`–`20261118000004`) and `supabase/tests/database_security_test.sql` implementing `profiles`, `xp_events`, `squads`, `squad_members`, `squad_invitations`, `user_blocks`, `abuse_reports`, and `notifications` with RLS policies and `SECURITY DEFINER` RPCs (e.g., `award_cloud_xp`, squad/invite/block/transfer/report RPCs).
   - Configured native Google Sign-In (`@react-native-google-signin/google-signin`) -> Supabase `signInWithIdToken`, chunked encrypted session persistence via `expo-secure-store` (`src/utils/secureStorageCore.ts`), and client env validation (`src/utils/authHelpers.ts`) blocking `service_role` or secret keys.
2. **Stage 4 Cloud Integration (`09ebd1a`) — Cloud Profile, Scoped XP Queue, Cloud Squads & Realtime:**
   - **Cloud Profile Sync (`src/utils/cloudProfile.ts` / `cloudProfileCore.ts`):** Syncs IANA timezone, optional user-approved display name, and `BT-08`-compliant `status_band` masking (`hidden` when `share_squad_status` is off), plus a lightweight Google sign-in toast.
   - **Per-User Offline XP Queue (`src/utils/cloudXpSync.ts` / `cloudXpSyncCore.ts`):** Queues newly earned XP events per `userId`, syncs timezone first, flushes idempotently through `award_cloud_xp` on reconnect, and never transfers historical Guest XP to cloud accounts.
   - **Invite-Only Cloud Squads (`src/utils/cloudSquads.ts` / `cloudSquadsCore.ts`, `LeaderboardScreen.tsx`):** Enables authenticated users to create squads, generate/redeem invite codes, manage rosters, block/unblock members, submit abuse reports, and transfer ownership on the **Squad** tab, while **Friends** and **Campus** tabs stay explicitly labeled **Local Demo Preview**.
   - **Cloud Notifications & Realtime (`src/utils/cloudNotifications.ts` / `cloudNotificationsCore.ts`, `NotificationCenterModal.tsx`):** Merges Supabase squad notifications and preference toggles (`Squad activity alerts`) with local native notifications.
3. **Guest & Multi-Account Isolation + Targeted Invitations (`fix/rot-cloud-account-isolation`):**
   - **Guest XP Isolation (`@rot_executive_demo_state_v1`):** Keeps Guest `baseXp`, `claimedXpEvents`, `xpLedger`, and `customDisplayName` isolated in `GUEST_STORAGE_KEY` (`src/utils/accountStorageCore.ts`, `src/utils/storage.ts`).
   - **Per-User Cloud State (`@rot_cloud_user_state_v1_<userId>`):** Gives every authenticated account an independent `AsyncStorage` key (`CLOUD_USER_STATE_KEY_PREFIX`) initialized with `baseXp: 0` and empty `claimedXpEvents`/`xpLedger` while inheriting only device consent/settings/limit preferences.
   - **Cloud XP Reconciliation & Account Switching:** `reconcileCloudUserXpWithProfile` ensures local cloud Brain Bank balances match `profiles.cloud_xp` monotonically without double-counting; `switchActiveOwnerState`, `loadedStateOwnerRef`, and `ownerSwitchSeqRef` in `App.tsx` guard async saves and auth switches against cross-owner leaks.
   - **Google Sign-Out Cold-Start Fix:** `signOutFromCloud()` (`src/utils/auth.ts` / `authHelpers.ts`) runs `ensureGoogleSignInConfigured()` prior to `GoogleSignin.signOut()` so cold-restored sessions still revoke native Google account selection, with `{ scope: 'local' }` Supabase sign-out fallback if global revocation fails offline.
   - **Targeted Squad Invitations by Member ID:** Added `validateInviteeUserId` (`cloudSquadsCore.ts`), `SEND TARGETED INVITATION BY MEMBER ID` owner controls (`LeaderboardScreen.tsx`), and selectable `Member ID` display in `SettingsScreen.tsx`, alongside resetting ephemeral squad form/confirmation UI state when `cloudUserId` changes.

---

## D. Application Architecture

ROT uses a **local-first React Native + Native Android Kotlin bridge** architecture with optional Supabase cloud synchronization:

- **React Native Frontend (`App.tsx`, `src/screens/*`, `src/components/*`):**
  - **Navigation & State Management:** Single-root `App.tsx` manages tab navigation (`Today`, `Missions`, `Badges`, `Leaderboard`, `Card`, `Settings`) and owner-scoped `PersistedAppState` hydrated from `AsyncStorage` (`@rot_executive_demo_state_v1` for Guest vs. `@rot_cloud_user_state_v1_<userId>` for authenticated accounts via `src/utils/accountStorageCore.ts` and `src/utils/storage.ts`).
  - **Cloud Auth & Sync Services (`src/utils/auth.ts`, `supabase.ts`, `cloudProfile.ts`, `cloudXpSync.ts`, `cloudSquads.ts`, `cloudNotifications.ts`):** Optional Google OAuth + Supabase client backed by chunked `expo-secure-store` sessions, per-user XP sync queues, RLS-protected squad RPCs, and Realtime notification subscriptions.
  - **Pure Domain Layer (`src/utils/domainLogic.ts`, `src/constants/types.ts`, `src/constants/data.ts`):** Pure TypeScript functions handle display-name resolution, 9-state `UsageDisplayState` mapping, Brainrot Index math, idempotent XP ledger updates, streak/grace-day evaluation, weekly quests, notification evaluation, player level calculation, and JSON export serialization.
- **Android Native Kotlin Modules (`android/app/src/main/java/com/rot/brainrotclub/`):**
  - Registered via `UsageStatsPackage.kt` inside `MainApplication.kt`:
    - `UsageStatsModule.kt` + `RotUsageTracker.kt`: Queries `UsageStatsManager`, checks `AppOpsManager` `OPSTR_GET_USAGE_STATS`, retrieves device profile info, manages `RotNotificationPrefs`, triggers `RotNotificationScheduler`, posts test/immediate notifications, and opens Android Usage Access / Notification Settings.
    - `RotCardMediaModule.kt`: Validates/normalizes off-screen `react-native-view-shot` captures into `1080x1350` or `1080x1920` PNGs, saves to Android Gallery (`MediaStore`) with duplicate prevention, and launches the native Android Share Sheet via `FileProvider`.
    - `RotNotificationHelper.kt`, `RotNotificationPrefs.kt`, `RotNotificationScheduler.kt`, `RotNotificationReceivers.kt`, `RotUsageCheckWorker.kt`: Handle notification channels, persistent unread inbox storage, `WorkManager` periodic usage checks, `AlarmManager` daily reminders, and boot/time-change rescheduling.
- **JavaScript-to-Native Bridge (`src/utils/usageStats.ts`):**
  - Wraps `NativeModules.UsageStatsModule` and `NativeModules.RotCardMedia` with typed promises, timeout guards (`6000ms` query timeout), notification config syncing (`syncNativeNotificationConfig`), inbox reads/mark-read (`getNativeNotificationInbox`, `markAllNativeNotificationsRead`), and card export (`prepareAndVerifyCardPng`, `saveCardPngToGallery`, `shareCardPng`).
- **Notification Persistence & Synchronization:**
  - Native `RotNotificationPrefs` is the single source of truth for delivered notification history and unread counts. On mount and `AppState` foreground transitions (`App.tsx`), JS syncs user notification settings/limit down to native `SharedPreferences` and pulls `NotificationInboxSnapshot` back up to keep the bell badge synchronized with background notifications.

---

## E. Technology Stack

All versions below are verified directly from `package.json`, `android/gradle.properties`, `android/build.gradle`, and `android/app/build.gradle`:

| Layer | Technology / Dependency | Verified Version / Configuration |
| :--- | :--- | :--- |
| **App Framework** | Expo SDK / React Native / React | `expo` `~58.0.24`, `react-native` `0.88.1`, `react` `19.3.0` |
| **Language & Tooling** | TypeScript / Babel | `typescript` `~6.0.3`, `babel-preset-expo` `~58.0.24`, `@types/react` `~19.3.0` |
| **Local Storage** | `@react-native-async-storage/async-storage`, `expo-secure-store` | `2.2.0` (`AsyncStorage` owner-scoped app state + native `SharedPreferences`), `~58.0.8` (chunked encrypted auth session storage) |
| **Cloud & Auth (Optional)** | `@supabase/supabase-js`, `@react-native-google-signin/google-signin` | `^2.81.1` (Auth, PostgREST RPCs, Realtime), `^16.0.0` (Android Google Sign-In) |
| **UI, Icons & Media** | `react-native-svg`, `@expo/vector-icons`, `expo-linear-gradient`, `react-native-safe-area-context`, `react-native-view-shot`, `expo-audio`, `expo-font`, `expo-asset`, `expo-status-bar` | `react-native-svg` `15.16.0`, `@expo/vector-icons` `~15.0.2`, `expo-linear-gradient` `~58.0.4`, `react-native-safe-area-context` `~5.11.1`, `react-native-view-shot` `^6.1.1`, `expo-audio` `~58.0.12`, `expo-font` `~58.0.12`, `expo-asset` `~58.0.21`, `expo-status-bar` `~58.0.5` |
| **Android Native** | Kotlin / WorkManager / AndroidX Core | `androidx.work:work-runtime-ktx:2.10.0`, `FileProvider`, `UsageStatsManager`, `AlarmManager`, `MediaStore` |
| **Build & Runtime** | Android Gradle Plugin / Hermes / New Architecture | `newArchEnabled=true`, `hermesEnabled=true`, `edgeToEdgeEnabled=true`, `reactNativeArchitectures=arm64-v8a` |

---

## F. Verification and Testing

### 1. Automated Verification (`fix/rot-cloud-account-isolation`)

| Check | Command | Result | Scope |
| :--- | :--- | :--- | :--- |
| **TypeScript Typecheck** | `npm run typecheck` (`tsc --noEmit`) | **PASS** (`0` errors) | Full TypeScript codebase |
| **Static Lint** | `npm run lint` (`node scripts/lint.mjs`) | **PASS** (`0` errors) | `44` TypeScript/React Native files (merge markers, `debugger`, banned `"on Instagram Reels"` claim, hardcoded `"Rafi"` check) |
| **Unit Tests** | `npm test` (`node scripts/run-tests.mjs`) | **PASS** (`31 passed, 0 failed`) | `domainLogic.test.ts` (15 tests), `authAndStorage.test.ts` (7 tests incl. cold sign-out & Guest/Account A/Account B XP isolation), `cloudStage4.test.ts` (9 tests incl. XP queues, Member ID validation, squads & notifications) |
| **Android Debug Build** | `cd android && .\gradlew.bat :app:assembleDebug --no-daemon` | **PASS** (`BUILD SUCCESSFUL`) | Compiles native Kotlin modules, WorkManager, Google Sign-In, ViewShot, and debug APK |

### 2. Stage 4 / Cloud Integration Verification (Redmi 11 Prime, Two-Account Live QA + Regression Suite)

All sensitive values (account emails, full user UUIDs, raw invite codes, and tokens) are redacted below; test accounts are labeled **Account A** and **Account B**.

#### Automated Tests (`PASS` — `31 / 31`)
- Verified `performSignOut` invokes `ensureGoogleConfigured` on cold-restored sessions and isolates Supabase vs. native Google sign-out errors (`authAndStorage.test.ts`).
- Verified Guest XP (`629 XP`) isolation across `Guest -> Account A -> Guest -> Account B -> Account A` switches with `@rot_executive_demo_state_v1` vs. `@rot_cloud_user_state_v1_<userId>`, `reconcileCloudUserXpWithProfile` monotonic sync without double-counting, and separate per-user XP queues (`authAndStorage.test.ts`, `cloudStage4.test.ts`).
- Verified `validateInviteeUserId` UUID normalization/validation for targeted invitations (`cloudStage4.test.ts`).

#### Device-Tested Behavior (`PASS` on Xiaomi Redmi 11 Prime, Android 14)
- **Account A Cloud XP:** `145` Cloud XP, independently persisted across sessions.
- **Account B Cloud XP:** Started at `0` Cloud XP and independently progressed to `50` Cloud XP.
- **Guest Mode Isolation:** Guest retained `629` XP and display name `Pramit` through repeated Account A / Account B sign-in and sign-out cycles.
- **Per-User Scoped Storage Keys:** Confirmed Account A and Account B stored independent local progress in separate `@rot_cloud_user_state_v1_<userId>` keys.
- **Squad Join & Roster Verification:** Account B successfully joined **Balance Club** using a generated invite code; both Account A and Account B displayed the matching two-member roster and XP (`145` and `50`).
- **Invite-Accepted Notification:** Account A received the persistent unread invite-accepted notification after Account B joined.
- **Blocking & Unblocking:** Blocking and unblocking between squad members worked, accurately hiding (`1 / 12`) and restoring (`2 / 12`) roster visibility.
- **Abuse Reporting:** An abuse report (`Other`) was submitted successfully from Account B.
- **Notification Preferences:** Squad activity alert preferences were toggled cleanly on Account A.
- **Ownership Transfer:** Ownership of **Balance Club** transferred cleanly from Account A to Account B.
- **Targeted Invitations by Member ID:** Account A successfully created targeted invitations for Account B's Member ID in both **Night Owls** and **Decline Test**.

#### Untested / Not Verified Behavior (Explicitly Open)
- **Accepting and declining the two targeted invitations** (in **Night Owls** and **Decline Test**).
- **Leaving a squad** (`Leave squad`).
- **Removing a squad member** (`Remove`).
- **Deleting a squad** (`Delete squad`).
- **Simultaneous multi-device Realtime push:** Single-device testing verified persisted notifications across account switches rather than concurrent two-device foreground Realtime push delivery.

### 3. Phase 2 Local Physical-Device QA (`PR #2.1` on Xiaomi Redmi 11 Prime)

- **Notification Badge & Cold-Restart Persistence (`PASS`):**
  - Verified bell badge hidden at `0` unread (`"All caught up"` empty inbox); sending 1st and 2nd test nudges updated badge to `"1"` then `"2"`.
  - Cold force-stop (`am force-stop com.rot.brainrotclub`) and relaunch preserved badge `"2"`.
  - Opening `NotificationCenterModal` displayed unread items with `NEW` and `TEST NUDGE` pills and cleared the bell badge to hidden (`0`), persisting across a second cold restart.
- **Interactive Top-Bar XP Indicator (`PASS`):**
  - Tapped `664 XP >` pill from `Today` -> navigated to `Missions` and auto-scrolled directly to `TRANSACTION HISTORY / Brain Bank XP Ledger` (`Verified · 664 XP`, rows summing to `664 XP`).
- **Background Card Carousel Freeze (`PASS`):**
  - Opening `CardSelectionModal` froze background preview interactions; tapping/swiping between `Archetype` and `Weekly Achievement` moved only the modal cards; `KEYCODE_BACK` closed the modal cleanly and restored main-screen horizontal swipe.
- **All 4 Card PNG Exports, Share Sheet, Duplicate Prevention & Private Mode (`PASS`):**
  - Pulled exported files from `/sdcard/Pictures/ROT/` and verified exact PNG pixel dimensions:
    1. `ROT_Archetype_Pramit_20261115.png` (`Save PNG`): **`1080x1350`** (`197,185` bytes).
    2. `ROT_Archetype_Pramit_20261115_Story.png` (`Save PNG`): **`1080x1920`** (`211,405` bytes).
    3. `ROT_Weekly_Achievement_Pramit_20261115.png` (`Share`): **`1080x1350`** (`280,439` bytes) and launched native Android Share Sheet (`MiuiChooserActivity`, `"Share ROT Card"`).
    4. `ROT_Weekly_Achievement_Pramit_20261115_Story.png` (`Save PNG`, Private Mode ON + stats hidden): **`1080x1920`** (`264,454` bytes vs `293,680` bytes with stats shown), confirming zero XP/streak leakage.
  - Repeated `Save PNG` verified duplicate-save prevention (1 file on disk in `Pictures/ROT`).
  - Verified Private stats toggle inside modal is hidden when Private Mode is OFF while `Save PNG` / `Share` labels stay consistent.
- **Cross-Tab Regression, Schedulers & Logcat (`PASS`):**
  - Spot-checked `Today` (`0h 03m`, `UsageStats · usage_events`, `1 day streak`, `1/1 grace day left`, `99/100`), `Missions`, `Badges` (`6/6`, `100%`), `Board` (`Gold-ish league`, `Rank 1 of 5`), `Card`, and `Settings` (`Pramit`, fallback `Redmi 11 Prime`, `90m`, `Notifications: Allowed`, `Nudge channel: On`, `Quiet hours active`).
  - `dumpsys alarm` confirmed `ACTION_STREAK_REMINDER` and `ACTION_EVENING_REMINDER` registered; `dumpsys jobscheduler` confirmed `SystemJobService#309` (`RUNNABLE`, `1x successful_finish`).
  - App logcat (`PID 29786`) and Metro (`shell-25`) showed zero runtime JS or native crashes/errors.

---

## G. Known Limitations

### Unverified Runtime & Squad Scenarios (`NOT VERIFIED`)
1. **Untested Cloud Squad Actions:** Accepting and declining targeted invitations (**Night Owls** and **Decline Test**), leaving a squad (`Leave squad`), removing a member (`Remove`), deleting a squad (`Delete squad`), and concurrent two-device foreground Realtime push have not been exercised live.
2. **Unattended Wall-Clock `AlarmManager` Firing:** Scheduled alarms (`ACTION_STREAK_REMINDER`, `ACTION_EVENING_REMINDER`) were confirmed registered in `dumpsys alarm`, but waiting across real wall-clock evening/streak hours for unattended OS delivery has **not** been executed live.
3. **Physical-Device Reboot Recovery:** `RotBootReceiver` (`BOOT_COMPLETED`, `MY_PACKAGE_REPLACED`, `TIME_SET`, `TIMEZONE_CHANGED`) is declared in `AndroidManifest.xml` and compiled, but an actual device reboot was **not** performed during wireless ADB QA.
4. **100+ Real Notifications & `99+` Badge Overflow On-Device:** `formatUnreadBadgeCount` `99+` saturation is verified by unit tests (`domainLogic.test.ts`), while on-device QA tested `0`, `1`, and `2` real notifications (not 100+ live OS notifications).
5. **Standalone Release APK Generation & Distribution:** Verification used the debug build (`app-debug.apk`) paired with Metro; a standalone bundled/signed release APK has **not** been built or tested on-device.

### Technical & Platform Constraints (Preserved from Phase 1 & SRS)
- **App-Level Foreground Granularity Only:** `UsageStatsManager` reports foreground activity events for `com.instagram.android`, not internal Reels views; ROT labels all numbers as estimated foreground time.
- **OS `UsageEvents` Retention (~7 Days):** Android prunes raw `UsageEvents` after roughly a week, leaving older days reliant on local cached summaries or coarse buckets.
- **OEM / MIUI Quirk Mitigation:** MIUI `INTERVAL_DAILY` queries can return duplicate buckets (mitigated via `maxOf` deduplication and `incomplete` labeling); OEM battery optimization can still delay background `WorkManager`/`AlarmManager` delivery.
- **Mixed Social Scope:** **Squad** uses Supabase cloud sync for authenticated users, while **Friends** and **Campus** tabs remain **Local Demo Preview** entries.

---

## H. Remaining Work and Future Roadmap

1. **Completed Through `fix/rot-cloud-account-isolation`:**
   - Local-first MVP (`PR #2`), Stage 3 Supabase RLS/RPC & Google Auth foundation (`f02c5a3`), Stage 4 cloud profile/XP/Squads/Realtime notifications (`09ebd1a`), and Guest/multi-account storage isolation, cold-start Google sign-out fix, and targeted Member ID squad invitations.
2. **Outstanding Verification (Before Release / Beta):**
   - Live verification of targeted invitation accept/decline, `Leave squad`, `Remove` member, `Delete squad`, and concurrent two-device Realtime delivery.
   - Real-time or accelerated verification of `RotAlarmReceiver` wall-clock firing, physical device reboot persistence (`RotBootReceiver`), `100+` notification badge overflow rendering on-device, and standalone release APK installation/testing without Metro.
3. **Production-Readiness Work (Required Before Public Play Release):**
   - Production release keystore configuration, release SHA-1 registration in Google Cloud OAuth, and Play App Signing.
   - Google Play Console `PACKAGE_USAGE_STATS` prominent-disclosure & declaration review, privacy policy URL, cloud account-deletion Edge Function / self-service flow, and battery/accessibility audit (`AT-09` TalkBack & font-scaling pass).
   - Multi-device OEM compatibility matrix testing beyond Redmi 11 Prime.
4. **Future Enhancements & Original Planned Features Not Yet Implemented:**
   - **Social & Cosmetic Extensions:** Cloud Friends/Campus synchronization (currently labeled Local Demo Preview), multi-tier daily chest reward table & equippable cosmetic inventory (`FR-015`).
   - **SRS Phase 1/2 Concepts Not Yet Built:** User toggle to disable/reset mascot (`FR-011` detail) and mute/report Daily Roast templates (`FR-012` detail), dedicated Black Box estimate-change log (`FR-026`), Braincell Graveyard view (`FR-023`), unified Museum gallery (`FR-029`), Offline Domino chain (`FR-022`), monthly/annual Wrapped (`FR-016`), and What If Simulator (`FR-030`).
   - **Deferred / Rejected SRS Scope:** 24-Hour Friend Challenges (`FR-019`), Brainrot Weather (`FR-025`), Contagion Map (`FR-027` deferred/P2), Blackout campaigns (`FR-028`), Anonymous Roast Battle (`FR-020`), Prediction Market (`FR-031`), and `AccessibilityService` Reel counting.

---

## I. Current Project Status

- **Stage 3–4 Cloud Integration & Account Isolation:** **Implemented and verified** on branch `fix/rot-cloud-account-isolation` (based on `upstream/master` merge `1272ada`).
- **Verification:** Automated suite passes (`tsc --noEmit` 0 errors, `lint` 44 files, `31/31` unit tests, `:app:assembleDebug` successful) and two-account Redmi 11 Prime verification confirmed Guest (`629 XP`) & Account A/B (`145 XP`, `0 -> 50 XP`) isolation, squad join/roster, invite notification, block/unblock, abuse report, preferences, ownership transfer, and targeted invite creation. Targeted invite accept/decline, leave squad, remove member, and delete squad remain explicitly **Not Verified**.

---

## J. SRS Cross-Check & Requirement-Status Matrix

Cross-referenced directly against `Software Requirements Specification and Project Plan.pdf` (v1.0, 11 November 2026 — Sections 6, 7, 8, and 17.6).  
*Note:* Earlier Phase 1 documentation used shifted FR numbers for a few rows (e.g., mapping Brainrot Index to `FR-007` and Streak Freeze to `FR-030`). The matrix below uses the **exact requirement IDs and titles from Section 6 of the root SRS PDF**.

### J.1 Functional Requirements (`FR-001` – `FR-031`)

**Verified FR Totals (31 Requirements):** **13 Implemented** (`FR-001`–`FR-010`, `FR-013`, `FR-014`, `FR-021`) · **9 Partially Implemented** (`FR-011`, `FR-012`, `FR-015`, `FR-016`, `FR-017`, `FR-022`, `FR-024`, `FR-026`, `FR-029`) · **9 Not Implemented** (`FR-018`–`FR-020`, `FR-023`, `FR-025`, `FR-027`, `FR-028`, `FR-030`, `FR-031`, of which 3 are Deferred/Rejected by SRS).

| Requirement | SRS Reference | Implementation Status | Evidence / Notes |
| :--- | :--- | :--- | :--- |
| **Onboarding and Consent** | `FR-001` (P0) | **Implemented** | `src/components/UsagePermissionModal.tsx`, `App.tsx`, `src/utils/storage.ts`. Explicit consent precedes `UsageStats` tracking; decline preserves app usability; privacy explanation & tracking toggle accessible in Settings. |
| **Usage Access Setup** | `FR-002` (P0) | **Implemented** | `UsageStatsModule.kt`, `RotUsageTracker.kt`, `src/screens/SettingsScreen.tsx`. Deep-links to `ACTION_USAGE_ACCESS_SETTINGS` (MIUI intercept tested), auto-rechecks on `AppState` resume, pauses cleanly on revocation without data loss. |
| **Instagram Foreground-Time Estimate** | `FR-003` (P0) | **Implemented** | `RotUsageTracker.kt`, `UsageStatsModule.kt`, `src/screens/TodayScreen.tsx`. Aggregates `queryEvents` + deduplicated `INTERVAL_DAILY` fallback for `com.instagram.android`; labels as estimated foreground time; never shows Reel counts. |
| **Tracking Status and Data Quality** | `FR-004` (P0) | **Implemented** | `src/constants/types.ts`, `src/utils/domainLogic.ts`, `src/screens/TodayScreen.tsx`. 9-state `UsageQueryResult` distinguishes `zero_usage` from `no_os_record`, `permission_required`, `tracking_paused`, `not_installed`, `query_failed`, `stale`, and `incomplete`. |
| **Daily Usage Limit** | `FR-005` (P0) | **Implemented** | `src/screens/SettingsScreen.tsx`, `src/utils/domainLogic.ts`. Supports presets (`30m`–`3h 00m`), `±5m` steppers, custom numeric entry (`15m`–`720m`), and Weekend Breathing Room (`+30m`). *Difference from SRS:* no explicit "disable limit entirely" mode—limit is always bounded `15m–720m`. |
| **Limit Warnings and Reminders** | `FR-006` (P0) | **Implemented** | `RotNotificationScheduler.kt`, `RotUsageCheckWorker.kt`, `RotNotificationReceivers.kt`, `RotNotificationHelper.kt`, `SettingsScreen.tsx`, `NotificationCenterModal.tsx`. 80%/100% threshold nudges, configurable evening/streak reminders, quiet hours, category toggles, and force-stop/background-job note. *Unattended wall-clock `AlarmManager` delivery & reboot recovery are `Not Verified` on-device (see Section G).* |
| **Daily and Weekly Reports** | `FR-007` (P0 daily; P1 weekly/monthly) | **Implemented** | `TodayScreen.tsx` (daily summary + 7-day trend bars with OS coverage/completeness flags), `buildWeeklyAchievementSummary` in `domainLogic.ts`, and `WeeklyAchievementPoster` in `ShareableCards.tsx`. *Note:* Monthly report (P1 extension) is not implemented. |
| **XP and Levels** | `FR-008` (P0) | **Implemented** | `src/utils/domainLogic.ts`, `App.tsx`, `src/screens/MissionsScreen.tsx`. Deterministic XP rules (`mission`, `chest`, `focus_break`, `weekly_quest`, `streak`), idempotent `claimedXpEvents`, `xpLedger` consistency check, interactive XP pill, and `calculatePlayerLevel`. |
| **Badges and Achievements** | `FR-009` (P0 limited set) | **Implemented** | `src/constants/data.ts` (`getBadges`), `src/screens/BadgesScreen.tsx`. 6 badges with unique IDs, descriptions, eligibility rules, and `unlockedAt` timestamps. |
| **Daily Missions** | `FR-010` (P0) | **Implemented** | `src/constants/data.ts`, `src/screens/MissionsScreen.tsx`, `src/utils/domainLogic.ts`. 4 daily missions (including usage-linked auto-verified `stay-under-target`); skippable with zero punitive XP/streak penalty. *(App also implements Weekly Quests + Streak/Grace-Day Engine alongside FR-010.)* |
| **Mascot Mood and Evolution** | `FR-011` (P0) | **Partially Implemented** | `src/components/RotMascot.tsx`, `TodayScreen.tsx`, `BrainrotCardScreen.tsx`, `domainLogic.ts`. 5 mascot archetype variants, computed Brain Mood, manual Mood Check-in Log, and Evolution Path exist; **missing** a user setting to disable/hide or reset the mascot feature as specified by SRS FR-011. |
| **Smart Daily Roast** | `FR-012` (P0 template-based) | **Partially Implemented** | `domainLogic.ts`, `BrainrotCardScreen.tsx`, `TodayScreen.tsx`. Local non-shaming template quotes (`"One more Reel" is your bedtime story.`, `"ROT. daily wisdom"`) with zero external AI calls; **missing** a dedicated Daily Roast feed and explicit mute/hide/report content toggle. |
| **Private Profile Card** | `FR-013` (P0 private; P1 shareable) | **Implemented** | `BrainrotCardScreen.tsx`, `CardSelectionModal.tsx`, `ShareableCards.tsx`, `RotCardMediaModule.kt`. Private Mode & stats redaction toggle inside export modal, off-by-default sharing with explicit preview, Feed/Story PNG gallery export, and Android Share Sheet. |
| **Data Export, Deletion, and Tracking Disablement** | `FR-014` (P0) | **Implemented** | `SettingsScreen.tsx`, `domainLogic.ts`, `storage.ts`, `RotNotificationPrefs.kt`. Tracking pause toggle, two-tap `Clear local history`, and `Export / Share JSON` (`rot-user-data-export-v1`) + inline JSON preview. |
| **Customization and Cosmetic Inventory** | `FR-015` (P1) | **Partially Implemented** | `src/constants/data.ts` (`dailyItems`), `src/components/DailyChestCard.tsx`. Daily chest awards named cosmetic items (`Soft Reset sticker`, etc.), **but there is no persistent cosmetic inventory or equip/unequip slot UI**. |
| **Brainrot Wrapped** | `FR-016` (P1) | **Partially Implemented** | `ShareableCards.tsx` (`WeeklyAchievementPoster`), `domainLogic.ts` (`buildWeeklyAchievementSummary`). Weekly Achievement recap card with week range, progress, and preview-before-share exists; **monthly/annual multi-card Wrapped** is not implemented. |
| **Personality Type** | `FR-017` (P1) | **Partially Implemented** | `domainLogic.ts` (`calculateBrainrotIndex`), `RotMascot.tsx`, `BrainrotCardScreen.tsx`. Assigns 4 humorous nonclinical archetypes (`Soft Launcher`, `Grass Toucher`, `Night Owl`, `Scroll Explorer`); **missing** user manual selection/override or dedicated opt-out toggle outside Private Mode. |
| **Friend Groups / Squads** | `FR-018` (P1, Social Phase) | **Partially Implemented** | Cloud Squads implemented via Supabase for authenticated users (`cloudSquads.ts`, `LeaderboardScreen.tsx`: squad creation, invite codes, targeted Member ID invitations, ownership transfer, block/unblock, abuse reporting); Friends/Campus tabs remain Local Demo Preview; accept/decline targeted invites, leave, remove, and delete squad are live-unverified. |
| **24-Hour Friend Challenge** | `FR-019` (P1, Social Phase) | **Not Implemented** | No friend challenge invites, challenge state, or multi-user sync exist. |
| **Anonymous Roast Battle** | `FR-020` (Deferred) | **Not Implemented** | Intentionally deferred by SRS pending moderation owner, reporting/blocking, and abuse-response plan. |
| **Braincell Recovery Mode / Focus Session** | `FR-021` (P0 basic; P1 focus session) | **Implemented** | `src/components/BreakModal.tsx`, `App.tsx`, `domainLogic.ts`. `1m`/`5m`/`10m` break timer, early stop allowed, never blocks Instagram, awards `+30 XP`, completes mission & unlocks `Offline Icon`. |
| **Touch Grass / Offline Domino** | `FR-022` (P1) | **Partially Implemented** | `data.ts`, `MissionsScreen.tsx`, `BreakModal.tsx`. Self-reported `"Touch some grass"` mission works without GPS/photos/contacts/health data; **missing** the multi-step "Offline Domino" activity chain mechanic. |
| **Braincell Graveyard** | `FR-023` (P1) | **Not Implemented** | Broken streaks/missed days exist in `streak.historyByDate` with `recoverStreakState`, **but there is no dedicated opt-in Braincell Graveyard UI view**. |
| **Mystery Rewards** | `FR-024` (P1) | **Partially Implemented** | `DailyChestCard.tsx`, `domainLogic.ts`. Non-monetary daily chest awards `+50 XP` and a cosmetic item name; **missing** transparent reward-pool/odds catalog and persistent unlocked-item vault. |
| **Brainrot Weather** | `FR-025` (P2) | **Not Implemented** | Future community-aggregate climate requiring backend and cohort privacy thresholds. |
| **Black Box / Estimate Explanation** | `FR-026` (P1) | **Partially Implemented** | `UsagePermissionModal.tsx` explains tracking method and `TodayScreen.tsx` displays `source` + staleness/incomplete banners + Brainrot Index Breakdown, **but there is no dedicated Black Box history log explaining why past daily estimates changed or had gaps**. |
| **Contagion Map** | `FR-027` (Deferred / P2) | **Not Implemented** | Deferred/P2 community visualization excluded due to re-identification and stigma risk. |
| **Blackout / Focus Campaign** | `FR-028` (P1) | **Not Implemented** | Individual Focus Breaks exist, but opt-in group/scheduled time-boxed Blackout campaigns are not implemented. |
| **Museum** | `FR-029` (P1) | **Partially Implemented** | `BadgesScreen.tsx` ("The ROT. Trophy Cabinet") displays 6 badges with unlock dates, **but does not showcase mascot evolution forms, chest cosmetics, or historical milestones together**. |
| **What If Simulator** | `FR-030` (P2) | **Not Implemented** | No interactive hypothetical target / time-saved projection simulator exists. |
| **Prediction Market** | `FR-031` (Rejected / Deferred) | **Not Implemented** | Intentionally rejected/excluded by SRS; zero wagering, betting, or paid randomized mechanics exist. |

### J.2 Non-Functional Requirements (`NFR-01` – `NFR-18`), Business Rules (`BT-01` – `BT-15`) & Acceptance Criteria (`AT-01` – `AT-12`)

**Verified NFR Totals (18 Requirements):** **9 Implemented** (`NFR-05`, `NFR-06`, `NFR-07`, `NFR-09`, `NFR-12`, `NFR-13`, `NFR-14`, `NFR-17`, `NFR-18`) · **6 Partially Implemented / Not Verified** (`NFR-01`–`NFR-04`, `NFR-10`, `NFR-11`) · **3 Not Implemented / Backend N/A** (`NFR-08`, `NFR-15`, `NFR-16`).

| Requirement Group | SRS Reference | Implementation Status | Evidence / Notes |
| :--- | :--- | :--- | :--- |
| **Performance & Battery Targets** (`< 2s` dashboard, `< 3s` cold launch, `< 2%` battery/24h) | `NFR-01`, `NFR-02`, `NFR-03` | **Not Verified** | Async native `UsageStats` bridge + cached summary render on open, **but formal P95 latency percentiles and 24-hour battery profiling (`NFR-03`) have not been benchmarked**. |
| **Beta Crash-Free Reliability** (`>= 99.5%` beta sessions) | `NFR-04` | **Not Verified** | Local debug QA showed zero crashes, **but `>= 99.5%` monitored beta crash-free telemetry awaits closed beta**. |
| **Freshness, Accuracy Communication, Localization, Maintainability, Logging & Notification Controls** | `NFR-05`, `NFR-06`, `NFR-12`–`NFR-14`, `NFR-18` | **Implemented** | `formatFreshnessLabel`, `statusDetail`, 9-state contract (`NFR-05`, `NFR-06`); English MVP UI (`NFR-12`); `15/15` unit tests (`NFR-13`); zero PII logs (`NFR-14`); per-category notification toggles without nagging (`NFR-18`). |
| **Privacy, Local Security & Immediate Deletion** | `NFR-07`, `NFR-09`, `NFR-17` | **Implemented** | No contacts, passwords, or Instagram credentials stored; `Clear local history` & JSON export work immediately locally (`NFR-17`). |
| **Accessibility** (`screen readers, scalable text, contrast, touch targets`) | `NFR-10` | **Partially Implemented / Not Verified** | Key header controls (`Notifications`, `XP Pill`, name clear) have `accessibilityLabel`/`accessibilityRole`, **but a full TalkBack screen-reader & font-scaling audit across all 6 screens has not been executed**. |
| **Device & OS Compatibility Matrix** (`supported OS range & reference devices`) | `NFR-11` | **Partially Implemented** | Verified on 1 reference device (**Xiaomi Redmi 11 Prime, Android 14 / API 34**; `minSdk 24`–`targetSdk 36`); **wider multi-device OEM compatibility matrix has not been tested**. |
| **Backend TLS, Availability & Social Abuse Prevention** | `NFR-08`, `NFR-15`, `NFR-16` | **Not Implemented** (Backend / Social N/A) | `NFR-08`/`NFR-16` backend targets are N/A in local MVP; `NFR-15` moderation/reporting is gated on Phase 2 social features. |
| **Core Local Business Rules** (`consent-first`, `estimate-only`, `no Reel counts`, `missing != 0`, `track-disable safe`, `healthy XP`, `non-punitive gaps`, `share off by default`, `no paid loot/betting`, `no GPS`, `fictional mood`, `local timezone`) | `BT-01`–`BT-08`, `BT-11`–`BT-13`, `BT-15` | **Implemented** | Enforced in `domainLogic.ts`, `RotUsageTracker.kt`, `RotNotificationPrefs.kt`, `CardSelectionModal.tsx`, and `scripts/lint.mjs`; Leaderboard is strictly local demo preview with no external sharing. |
| **Social / Community Business Rules** (`leave/block/report`, `anonymous moderation`, `minimum cohort thresholds`) | `BT-09`, `BT-10`, `BT-14` | **Not Implemented** | Social groups, anonymous roast battles, and community aggregates (`FR-018`, `FR-020`, `FR-025`, `FR-027`) are not implemented in local MVP. |
| **Acceptance Tests Verified on Device & Unit Suite** (`denied`, `granted`, `no OS record`, `limit persists`, `idempotent XP`, `incomplete streak`, `delete history`, `no share w/o action`, `no Reel count`) | `AT-01`–`AT-04`, `AT-06`–`AT-08`, `AT-10`, `AT-11` | **Implemented** (Verified) | Covered across `src/utils/__tests__/domainLogic.test.ts` (15 tests), `scripts/lint.mjs`, and Redmi 11 Prime QA (`AT-01`–`AT-04`, `AT-08`, `AT-10`, `AT-11` live; `AT-06`, `AT-07` via unit tests). |
| **Acceptance Tests Partially / Not Live-Verified** (`notifications disabled UI`, `background delay stale warning`, `screen reader`) | `AT-05`, `AT-12`, `AT-09` | **Not Verified** (Live Device) | `AT-05` (`notifications_off` / `permission_required` diagnostics in `SettingsScreen.tsx`) and `AT-12` (`STALE_THRESHOLD_MS` in `domainLogic.test.ts`) exist in code/unit tests without full live-device simulation; `AT-09` (TalkBack navigation) is **Not Verified**. |

### J.3 Summary of Missing, Partial, and Clarified Scope
- **Additional MVP Features Implemented Beyond Minimum P0:** Streak & Grace-Day Engine + Streak Recovery, Weekly Quests, Brain Bank XP Ledger + Interactive Header Jump, Mood Check-in Log, Dual Shareable Cards (`1080x1350` & `1080x1920`) with Native Share Sheet & Gallery Deduplication, Private Mode Redaction, and WorkManager/AlarmManager + Persistent Unread Badge.
- **Unfulfilled P0/P1 Details Needing Decision or Polish:**
  - `FR-005`: Option to disable daily limit entirely (currently `15m–720m` numeric range).
  - `FR-011` / `FR-012` / `FR-017`: Settings toggles to hide/reset mascot, mute Daily Roast copy, or manually override/opt out of Personality Type.
  - `FR-015` / `FR-024` / `FR-029`: Equippable Cosmetic Inventory UI, transparent Mystery Reward catalog, and unified Museum view.
  - `FR-022` / `FR-023` / `FR-026`: Offline Domino chain, Braincell Graveyard view, and Black Box estimate-change log.
  - `FR-016` / `FR-028` / `FR-030`: Monthly/Annual Wrapped, Blackout campaigns, and What If Simulator.
  - `FR-018` / `FR-019` / `FR-025` / `FR-027` / `FR-020` / `FR-031`: Social, community, and deferred/rejected concepts gated on backend/moderation approval.

---

## Appendix: Phase 1 Screenshot Gallery (`docs/screenshots/executive-demo/`) & PR #1 Archive

All Phase 1 device verification screenshots remain preserved in `docs/screenshots/executive-demo/`:

| # | File | Description | Preview |
| :--- | :--- | :--- | :--- |
| **01** | [01-today-device-name-verified.png](screenshots/executive-demo/01-today-device-name-verified.png) | Today screen on first launch showing Android device name default (`Good evening, Redmi 11 Prime.`) and live verified Instagram usage (`1h 42m`, `22 intervals today`). | ![01 Today Device Default](screenshots/executive-demo/01-today-device-name-verified.png) |
| **02** | [02-today-inline-name-editor.png](screenshots/executive-demo/02-today-inline-name-editor.png) | Inline display-name editor on the Today screen with custom name `"Pramit"` entered. | ![02 Today Inline Name Editor](screenshots/executive-demo/02-today-inline-name-editor.png) |
| **03** | [03-today-custom-name-persisted.png](screenshots/executive-demo/03-today-custom-name-persisted.png) | Today screen after `am force-stop` cold restart confirming `"Good evening, Pramit."`, `334 XP`, and `1h 42m` persisted. | ![03 Today Custom Name Persisted](screenshots/executive-demo/03-today-custom-name-persisted.png) |
| **04** | [04-today-tracking-paused.png](screenshots/executive-demo/04-today-tracking-paused.png) | Today screen when tracking is paused (`"Tracking is paused. Your previous saved progress is preserved."` — never `0h 00m`). | ![04 Today Tracking Paused](screenshots/executive-demo/04-today-tracking-paused.png) |
| **05** | [05-today-permission-required.png](screenshots/executive-demo/05-today-permission-required.png) | Today screen when Usage Access is denied/revoked (`"ROT needs Usage Access to estimate your Instagram screen time."`). | ![05 Today Permission Required](screenshots/executive-demo/05-today-permission-required.png) |
| **06** | [06-miui-permission-intercept.png](screenshots/executive-demo/06-miui-permission-intercept.png) | Xiaomi MIUI `SpecialPermissionInterceptActivity` 10-second security intercept when granting Usage Access. | ![06 MIUI Permission Intercept](screenshots/executive-demo/06-miui-permission-intercept.png) |
| **07** | [07-settings-profile-and-diagnostics.png](screenshots/executive-demo/07-settings-profile-and-diagnostics.png) | Settings screen showing `Display name: Pramit`, `Revert to device name (Redmi 11 Prime)`, and Usage Access diagnostic badges. | ![07 Settings Profile and Diagnostics](screenshots/executive-demo/07-settings-profile-and-diagnostics.png) |
| **08** | [08-brainrot-card-custom-identity.png](screenshots/executive-demo/08-brainrot-card-custom-identity.png) | Phase 1 Brainrot Card dynamically rendering `ROT. BRAINROT CLUB · PRAMIT` and `334 XP`. | ![08 Brainrot Card Identity](screenshots/executive-demo/08-brainrot-card-custom-identity.png) |
| **09** | [09-missions-progression.png](screenshots/executive-demo/09-missions-progression.png) | Phase 1 Missions screen showing idempotent daily missions and weekly quest progress. | ![09 Missions Screen](screenshots/executive-demo/09-missions-progression.png) |

### PR #1 Historical Scope & Product-Owner Approval Boundaries
- **PR #1 Title (`feature/rot-executive-demo`):** `feat(android): deliver ROT Executive Demo with UsageStats tracking, local profile identity, and persistent progression`
- **Items Explicitly Gated on Product-Owner Approval (Preserved):**
  1. Backend infrastructure, accounts & cloud sync (`FR-018`, `FR-019`).
  2. Anonymous Roast Battles (`FR-020`) — deferred for moderation & psychological safety.
  3. Accessibility Service exact Reel counting — rejected per SRS `Section 3.2` / `BT-03`.
  4. Google Play Store production signing, `PACKAGE_USAGE_STATS` declaration, and public privacy policy URL.
