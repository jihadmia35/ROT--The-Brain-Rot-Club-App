package com.rot.brainrotclub

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import java.util.Calendar
import kotlin.math.roundToInt

object RotNotificationHelper {
    const val CHANNEL_NUDGES_ID = "rot_wellbeing_nudges"
    const val CHANNEL_NUDGES_NAME = "ROT Gentle Nudges & Achievements"
    const val CHANNEL_REMINDERS_ID = "rot_scheduled_reminders"
    const val CHANNEL_REMINDERS_NAME = "ROT Daily & Streak Reminders"
    const val CHANNEL_SQUADS_ID = "rot_cloud_squads"
    const val CHANNEL_SQUADS_NAME = "ROT Squad & Account Alerts"
    const val EXTRA_TARGET_ROUTE = "rot_target_route"

    data class NotificationStatusInfo(
        val runtimePermissionGranted: Boolean,
        val appNotificationsEnabled: Boolean,
        val nudgesChannelEnabled: Boolean,
        val remindersChannelEnabled: Boolean,
        val squadsChannelEnabled: Boolean,
        val ignoringBatteryOptimizations: Boolean,
        val deviceManufacturer: String,
        val statusCode: String // "allowed" | "permission_required" | "notifications_off" | "channel_disabled"
    ) {
        val canDeliverAny: Boolean
            get() = runtimePermissionGranted && appNotificationsEnabled && (nudgesChannelEnabled || remindersChannelEnabled || squadsChannelEnabled)
    }

    fun ensureChannels(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
                ?: return
            if (manager.getNotificationChannel(CHANNEL_NUDGES_ID) == null) {
                val nudges = NotificationChannel(
                    CHANNEL_NUDGES_ID,
                    CHANNEL_NUDGES_NAME,
                    NotificationManager.IMPORTANCE_DEFAULT
                ).apply {
                    description = "80% & 100% daily scroll target alerts, achievements, and mission completions"
                }
                manager.createNotificationChannel(nudges)
            }
            if (manager.getNotificationChannel(CHANNEL_REMINDERS_ID) == null) {
                val reminders = NotificationChannel(
                    CHANNEL_REMINDERS_ID,
                    CHANNEL_REMINDERS_NAME,
                    NotificationManager.IMPORTANCE_DEFAULT
                ).apply {
                    description = "Scheduled evening mission reminders and pre-midnight streak protection"
                }
                manager.createNotificationChannel(reminders)
            }
            if (manager.getNotificationChannel(CHANNEL_SQUADS_ID) == null) {
                val squads = NotificationChannel(
                    CHANNEL_SQUADS_ID,
                    CHANNEL_SQUADS_NAME,
                    NotificationManager.IMPORTANCE_DEFAULT
                ).apply {
                    description = "Cloud squad invitations, acceptances, member updates, and role changes"
                }
                manager.createNotificationChannel(squads)
            }
        }
    }

    fun getStatus(context: Context): NotificationStatusInfo {
        ensureChannels(context)
        val runtimeGranted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.checkSelfPermission(
                context,
                android.Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
        } else {
            true
        }
        val appEnabled = NotificationManagerCompat.from(context).areNotificationsEnabled()

        var nudgesEnabled = true
        var remindersEnabled = true
        var squadsEnabled = true
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
            val nudgesCh = manager?.getNotificationChannel(CHANNEL_NUDGES_ID)
            val remindersCh = manager?.getNotificationChannel(CHANNEL_REMINDERS_ID)
            val squadsCh = manager?.getNotificationChannel(CHANNEL_SQUADS_ID)
            if (nudgesCh != null) {
                nudgesEnabled = nudgesCh.importance != NotificationManager.IMPORTANCE_NONE
            }
            if (remindersCh != null) {
                remindersEnabled = remindersCh.importance != NotificationManager.IMPORTANCE_NONE
            }
            if (squadsCh != null) {
                squadsEnabled = squadsCh.importance != NotificationManager.IMPORTANCE_NONE
            }
        }

        val ignoringBatteryOptimizations = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            try {
                val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
                pm?.isIgnoringBatteryOptimizations(context.packageName) ?: false
            } catch (_: Exception) {
                false
            }
        } else {
            true
        }

        val statusCode = when {
            !runtimeGranted -> "permission_required"
            !appEnabled -> "notifications_off"
            !nudgesEnabled || !remindersEnabled || !squadsEnabled -> "channel_disabled"
            else -> "allowed"
        }

        return NotificationStatusInfo(
            runtimePermissionGranted = runtimeGranted,
            appNotificationsEnabled = appEnabled,
            nudgesChannelEnabled = nudgesEnabled,
            remindersChannelEnabled = remindersEnabled,
            squadsChannelEnabled = squadsEnabled,
            ignoringBatteryOptimizations = ignoringBatteryOptimizations,
            deviceManufacturer = Build.MANUFACTURER ?: "unknown",
            statusCode = statusCode
        )
    }

    fun canPostToChannel(context: Context, channelId: String): Boolean {
        val status = getStatus(context)
        if (!status.runtimePermissionGranted || !status.appNotificationsEnabled) return false
        return when (channelId) {
            CHANNEL_REMINDERS_ID -> status.remindersChannelEnabled
            CHANNEL_SQUADS_ID -> status.squadsChannelEnabled
            else -> status.nudgesChannelEnabled
        }
    }

    private fun dailyKeyForNotificationId(notificationId: Int): String? = when (notificationId) {
        1001 -> "limit_100"
        1002 -> "limit_80"
        1003 -> "mission_reminder"
        1004 -> "streak_reminder"
        1005 -> "mission_under_target"
        1006 -> "achievement_badge_today"
        else -> null
    }

    fun defaultTargetRouteForNotification(notificationId: Int, channelId: String): String {
        if (channelId == CHANNEL_SQUADS_ID) {
            return "Leaderboard:Squad"
        }
        return when (notificationId) {
            1001, 1002 -> "Today"
            1003, 1004, 1005 -> "Missions"
            1006 -> "Badges"
            else -> "Today"
        }
    }

    fun postNotification(
        context: Context,
        channelId: String,
        notificationId: Int,
        title: String,
        body: String,
        dedupKey: String? = null,
        targetRoute: String? = null,
        recordInLocalInbox: Boolean = true
    ): Boolean {
        return try {
            ensureChannels(context)
            if (!canPostToChannel(context, channelId)) {
                return false
            }
            val nowMs = System.currentTimeMillis()
            val dateKey = RotNotificationPrefs.todayDateKey(nowMs)
            val dailyKey = dailyKeyForNotificationId(notificationId)
            val resolvedDedupKey = dedupKey ?: dailyKey?.let { "${dateKey}_${notificationId}" }

            if (recordInLocalInbox &&
                !resolvedDedupKey.isNullOrBlank() &&
                RotNotificationPrefs.hasNotificationId(context, resolvedDedupKey)
            ) {
                return false
            }

            val resolvedRoute = targetRoute?.takeIf { it.isNotBlank() }
                ?: defaultTargetRouteForNotification(notificationId, channelId)
            val launchIntent = Intent(context, MainActivity::class.java).apply {
                action = Intent.ACTION_VIEW
                data = Uri.parse("rot://notification/${Uri.encode(resolvedRoute)}/$notificationId")
                addFlags(
                    Intent.FLAG_ACTIVITY_NEW_TASK or
                        Intent.FLAG_ACTIVITY_CLEAR_TOP or
                        Intent.FLAG_ACTIVITY_SINGLE_TOP
                )
                putExtra(EXTRA_TARGET_ROUTE, resolvedRoute)
            }
            val pendingFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            } else {
                PendingIntent.FLAG_UPDATE_CURRENT
            }
            val pendingIntent = PendingIntent.getActivity(
                context,
                notificationId,
                launchIntent,
                pendingFlags
            )
            val iconRes = if (context.applicationInfo.icon != 0) {
                context.applicationInfo.icon
            } else {
                android.R.drawable.ic_dialog_info
            }

            val builder = NotificationCompat.Builder(context, channelId)
                .setSmallIcon(iconRes)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setAutoCancel(true)

            if (pendingIntent != null) {
                builder.setContentIntent(pendingIntent)
            }

            NotificationManagerCompat.from(context).notify(notificationId, builder.build())

            if (recordInLocalInbox) {
                RotNotificationPrefs.recordDeliveredNotification(
                    context = context,
                    dedupKey = resolvedDedupKey,
                    notificationId = notificationId,
                    channelId = channelId,
                    title = title,
                    body = body,
                    nowMs = nowMs
                )
                if (dailyKey != null) {
                    RotNotificationPrefs.markSentOnDate(context, dateKey, dailyKey)
                }
                UsageStatsModule.emitNotificationsUpdated()
            }
            true
        } catch (_: SecurityException) {
            false
        } catch (_: Exception) {
            false
        }
    }

    fun postCloudMirrorNotification(
        context: Context,
        dedupKey: String,
        title: String,
        body: String,
        targetRoute: String? = null
    ): Boolean {
        val cleanKey = dedupKey.trim()
        if (cleanKey.isEmpty()) return false
        ensureChannels(context)
        if (!canPostToChannel(context, CHANNEL_SQUADS_ID)) {
            return false
        }
        if (RotNotificationPrefs.hasCloudOsDedupKey(context, cleanKey)) {
            return false
        }
        val stableId = 3000 + ((cleanKey.hashCode() and 0x7fffffff) % 900000)
        val posted = postNotification(
            context = context,
            channelId = CHANNEL_SQUADS_ID,
            notificationId = stableId,
            title = title,
            body = body,
            dedupKey = null,
            targetRoute = targetRoute ?: "Leaderboard:Squad",
            recordInLocalInbox = false
        )
        if (posted) {
            RotNotificationPrefs.recordCloudOsDedupKey(context, cleanKey)
        }
        return posted
    }

    fun evaluateUsageInBackground(context: Context): Int {
        val config = RotNotificationPrefs.loadConfig(context)
        val nowCal = Calendar.getInstance()
        val dateKey = RotNotificationPrefs.todayDateKey(nowCal.timeInMillis)
        if (RotNotificationPrefs.isWithinQuietHours(config, nowCal)) {
            return 0
        }
        if (!config.consentAccepted || !config.trackingEnabled || !config.dailyGentleNudge) {
            return 0
        }
        if (!canPostToChannel(context, CHANNEL_NUDGES_ID)) {
            return 0
        }
        val snapshot = RotUsageTracker.queryInstagramUsage(context, daysBack = 1, now = nowCal.timeInMillis)
            ?: return 0
        if (!snapshot.hasPermission || !snapshot.hasVerifiedTodayEstimate) {
            return 0
        }

        val usedMinutes = (snapshot.todayMs / 60000.0).roundToInt().coerceAtLeast(0)
        val effLimit = RotNotificationPrefs.effectiveDailyLimitMinutes(config, nowCal)
        val pct = if (effLimit > 0) (usedMinutes.toDouble() / effLimit.toDouble()) * 100.0 else 0.0
        var postedCount = 0

        if (usedMinutes >= effLimit && !RotNotificationPrefs.wasSentOnDate(context, dateKey, "limit_100")) {
            val posted = postNotification(
                context = context,
                channelId = CHANNEL_NUDGES_ID,
                notificationId = 1001,
                title = "Daily scroll target reached",
                body = "You passed your ${effLimit}m Instagram target (${usedMinutes}m today). No guilt—a focus break is a great way to reset."
            )
            if (posted) {
                RotNotificationPrefs.markSentOnDate(context, dateKey, "limit_100")
                postedCount++
            }
        } else if (pct >= 80.0 && usedMinutes < effLimit && !RotNotificationPrefs.wasSentOnDate(context, dateKey, "limit_80")) {
            val remaining = (effLimit - usedMinutes).coerceAtLeast(1)
            val posted = postNotification(
                context = context,
                channelId = CHANNEL_NUDGES_ID,
                notificationId = 1002,
                title = "Gentle scroll nudge",
                body = "$remaining min left in today's ${effLimit}m Instagram target."
            )
            if (posted) {
                RotNotificationPrefs.markSentOnDate(context, dateKey, "limit_80")
                postedCount++
            }
        }

        // Relevant evening under-target recognition if user stayed well within limit after 18:00
        if (nowCal.get(Calendar.HOUR_OF_DAY) >= 18 &&
            usedMinutes <= effLimit &&
            !RotNotificationPrefs.wasSentOnDate(context, dateKey, "mission_under_target")
        ) {
            val posted = postNotification(
                context = context,
                channelId = CHANNEL_NUDGES_ID,
                notificationId = 1005,
                title = "Stay-under-target mission on track",
                body = "Nice balance: ${usedMinutes}m of your ${effLimit}m Instagram target used today (+45 XP verified)."
            )
            if (posted) {
                RotNotificationPrefs.markSentOnDate(context, dateKey, "mission_under_target")
                postedCount++
            }
        }

        return postedCount
    }

    fun evaluateScheduledReminder(context: Context, kind: String): Boolean {
        val config = RotNotificationPrefs.loadConfig(context)
        val nowCal = Calendar.getInstance()
        val dateKey = RotNotificationPrefs.todayDateKey(nowCal.timeInMillis)
        if (RotNotificationPrefs.isWithinQuietHours(config, nowCal)) {
            return false
        }
        if (!canPostToChannel(context, CHANNEL_REMINDERS_ID)) {
            return false
        }
        val isSameSyncedDay = config.syncedDateKey == dateKey

        return when (kind) {
            "evening" -> {
                if (!config.missionReminders) return false
                if (isSameSyncedDay && config.anyNonLimitMissionDoneToday) return false
                if (RotNotificationPrefs.wasSentOnDate(context, dateKey, "mission_reminder")) return false
                val posted = postNotification(
                    context = context,
                    channelId = CHANNEL_REMINDERS_ID,
                    notificationId = 1003,
                    title = "Evening reset check-in",
                    body = "Complete one quick mission or brain mood check-in to grow your Brain Bank today."
                )
                if (posted) {
                    RotNotificationPrefs.markSentOnDate(context, dateKey, "mission_reminder")
                }
                posted
            }
            "streak" -> {
                if (!config.streakReminders || config.currentStreak <= 0) return false
                if (isSameSyncedDay && config.streakActiveToday) return false
                if (RotNotificationPrefs.wasSentOnDate(context, dateKey, "streak_reminder")) return false
                val posted = postNotification(
                    context = context,
                    channelId = CHANNEL_REMINDERS_ID,
                    notificationId = 1004,
                    title = "Protect your ${config.currentStreak}-day streak",
                    body = "Take a quick focus break or log your brain mood before midnight to keep your streak."
                )
                if (posted) {
                    RotNotificationPrefs.markSentOnDate(context, dateKey, "streak_reminder")
                }
                posted
            }
            else -> false
        }
    }
}
