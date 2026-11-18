package com.rot.brainrotclub

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.Calendar
import java.util.concurrent.TimeUnit

object RotNotificationScheduler {
    private const val UNIQUE_USAGE_PERIODIC_WORK = "rot_usage_periodic_check"
    private const val UNIQUE_USAGE_IMMEDIATE_WORK = "rot_usage_immediate_check"
    const val ACTION_EVENING_REMINDER = "com.rot.brainrotclub.ACTION_EVENING_REMINDER"
    const val ACTION_STREAK_REMINDER = "com.rot.brainrotclub.ACTION_STREAK_REMINDER"
    private const val REQ_CODE_EVENING = 4101
    private const val REQ_CODE_STREAK = 4102

    fun rescheduleAll(context: Context) {
        val config = RotNotificationPrefs.loadConfig(context)
        schedulePeriodicUsageChecks(context, config)
        scheduleDailyAlarms(context, config)
    }

    fun schedulePeriodicUsageChecks(
        context: Context,
        config: RotNotificationConfig = RotNotificationPrefs.loadConfig(context)
    ) {
        val wm = WorkManager.getInstance(context)
        if (config.consentAccepted && config.trackingEnabled && config.dailyGentleNudge) {
            val request = PeriodicWorkRequestBuilder<RotUsageCheckWorker>(
                15,
                TimeUnit.MINUTES
            ).build()
            wm.enqueueUniquePeriodicWork(
                UNIQUE_USAGE_PERIODIC_WORK,
                ExistingPeriodicWorkPolicy.UPDATE,
                request
            )
        } else {
            wm.cancelUniqueWork(UNIQUE_USAGE_PERIODIC_WORK)
        }
    }

    fun triggerImmediateUsageCheck(context: Context) {
        val request = OneTimeWorkRequestBuilder<RotUsageCheckWorker>().build()
        WorkManager.getInstance(context).enqueueUniqueWork(
            UNIQUE_USAGE_IMMEDIATE_WORK,
            ExistingWorkPolicy.REPLACE,
            request
        )
    }

    fun scheduleDailyAlarms(
        context: Context,
        config: RotNotificationConfig = RotNotificationPrefs.loadConfig(context)
    ) {
        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return

        if (config.missionReminders) {
            val triggerAt = nextTriggerTimeMillis(
                config.eveningReminderHour,
                config.eveningReminderMinute
            )
            val pi = buildAlarmPendingIntent(context, ACTION_EVENING_REMINDER, REQ_CODE_EVENING)
            setInexactOrAllowWhileIdle(alarmManager, triggerAt, pi)
        } else {
            cancelAlarm(context, alarmManager, ACTION_EVENING_REMINDER, REQ_CODE_EVENING)
        }

        if (config.streakReminders) {
            val triggerAt = nextTriggerTimeMillis(
                config.streakReminderHour,
                config.streakReminderMinute
            )
            val pi = buildAlarmPendingIntent(context, ACTION_STREAK_REMINDER, REQ_CODE_STREAK)
            setInexactOrAllowWhileIdle(alarmManager, triggerAt, pi)
        } else {
            cancelAlarm(context, alarmManager, ACTION_STREAK_REMINDER, REQ_CODE_STREAK)
        }
    }

    fun nextTriggerTimeMillis(hour: Int, minute: Int, nowMs: Long = System.currentTimeMillis()): Long {
        val cal = Calendar.getInstance().apply {
            timeInMillis = nowMs
            set(Calendar.HOUR_OF_DAY, hour.coerceIn(0, 23))
            set(Calendar.MINUTE, minute.coerceIn(0, 59))
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }
        if (cal.timeInMillis <= nowMs + 5_000L) {
            cal.add(Calendar.DAY_OF_YEAR, 1)
        }
        return cal.timeInMillis
    }

    private fun buildAlarmPendingIntent(context: Context, action: String, requestCode: Int): PendingIntent {
        val intent = Intent(context, RotAlarmReceiver::class.java).apply {
            this.action = action
        }
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }
        return PendingIntent.getBroadcast(context, requestCode, intent, flags)
    }

    private fun setInexactOrAllowWhileIdle(
        alarmManager: AlarmManager,
        triggerAtMillis: Long,
        pendingIntent: PendingIntent
    ) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                alarmManager.setAndAllowWhileIdle(
                    AlarmManager.RTC_WAKEUP,
                    triggerAtMillis,
                    pendingIntent
                )
            } else {
                alarmManager.set(
                    AlarmManager.RTC_WAKEUP,
                    triggerAtMillis,
                    pendingIntent
                )
            }
        } catch (_: SecurityException) {
            // Some OEM ROMs may restrict alarms under extreme battery restriction
        } catch (_: Exception) {
            // Avoid crashing background receiver if AlarmManager rejects quota
        }
    }

    private fun cancelAlarm(
        context: Context,
        alarmManager: AlarmManager,
        action: String,
        requestCode: Int
    ) {
        val intent = Intent(context, RotAlarmReceiver::class.java).apply {
            this.action = action
        }
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
        } else {
            PendingIntent.FLAG_NO_CREATE
        }
        val existing = PendingIntent.getBroadcast(context, requestCode, intent, flags)
        if (existing != null) {
            alarmManager.cancel(existing)
            existing.cancel()
        }
    }
}
