package com.rot.brainrotclub

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class RotAlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action ?: return
        val pendingResult = goAsync()
        Thread {
            try {
                when (action) {
                    RotNotificationScheduler.ACTION_EVENING_REMINDER -> {
                        RotNotificationHelper.evaluateScheduledReminder(context, "evening")
                        RotNotificationScheduler.scheduleDailyAlarms(context)
                    }
                    RotNotificationScheduler.ACTION_STREAK_REMINDER -> {
                        RotNotificationHelper.evaluateScheduledReminder(context, "streak")
                        RotNotificationScheduler.scheduleDailyAlarms(context)
                    }
                }
            } catch (_: Exception) {
                // Prevent receiver crash on OEM background restrictions
            } finally {
                pendingResult.finish()
            }
        }.start()
    }
}

class RotBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action ?: return
        if (action == Intent.ACTION_BOOT_COMPLETED ||
            action == Intent.ACTION_MY_PACKAGE_REPLACED ||
            action == Intent.ACTION_TIME_CHANGED ||
            action == Intent.ACTION_TIMEZONE_CHANGED
        ) {
            val pendingResult = goAsync()
            Thread {
                try {
                    RotNotificationHelper.ensureChannels(context)
                    RotNotificationScheduler.rescheduleAll(context)
                } catch (_: Exception) {
                    // Ignore OEM background reschedule restrictions
                } finally {
                    pendingResult.finish()
                }
            }.start()
        }
    }
}
