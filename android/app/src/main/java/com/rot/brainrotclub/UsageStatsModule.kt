package com.rot.brainrotclub

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import org.json.JSONArray
import org.json.JSONObject
import java.lang.ref.WeakReference

class UsageStatsModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "RotUsageStats"
        const val INSTAGRAM_PACKAGE = RotUsageTracker.INSTAGRAM_PACKAGE
        const val EVENT_NOTIFICATIONS_UPDATED = "RotNotificationsUpdated"
        const val EVENT_NOTIFICATION_OPENED = "RotNotificationOpened"

        @Volatile
        private var activeContextRef: WeakReference<ReactApplicationContext>? = null

        @Volatile
        private var pendingNotificationRoute: String? = null

        private val routeLock = Any()

        fun setPendingInitialRoute(route: String?) {
            if (route.isNullOrBlank()) return
            synchronized(routeLock) {
                pendingNotificationRoute = route
            }
        }

        fun handleIncomingNotificationRoute(route: String?) {
            if (route.isNullOrBlank()) return
            val ctx = activeContextRef?.get()
            if (ctx != null && ctx.hasActiveReactInstance()) {
                try {
                    ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                        .emit(EVENT_NOTIFICATION_OPENED, route)
                    return
                } catch (_: Exception) {
                    // Fallback to pending route if JS instance not ready
                }
            }
            setPendingInitialRoute(route)
        }

        fun emitNotificationsUpdated() {
            try {
                val ctx = activeContextRef?.get() ?: return
                if (ctx.hasActiveReactInstance()) {
                    ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                        .emit(EVENT_NOTIFICATIONS_UPDATED, null)
                }
            } catch (_: Exception) {
                // Ignore if headless or JS instance is tearing down
            }
        }
    }

    init {
        activeContextRef = WeakReference(reactContext)
    }

    override fun invalidate() {
        val current = activeContextRef?.get()
        if (current === reactApplicationContext) {
            activeContextRef = null
        }
        super.invalidate()
    }

    override fun getName(): String = NAME

    @ReactMethod
    fun hasUsageAccess(promise: Promise) {
        try {
            promise.resolve(RotUsageTracker.checkUsageAccessGranted(reactApplicationContext))
        } catch (_: Exception) {
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun isInstagramInstalled(promise: Promise) {
        try {
            promise.resolve(RotUsageTracker.checkPackageInstalled(reactApplicationContext, INSTAGRAM_PACKAGE))
        } catch (_: Exception) {
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun openUsageAccessSettings(promise: Promise) {
        try {
            val context = reactApplicationContext
            val specificIntent = Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS).apply {
                data = Uri.fromParts("package", context.packageName, null)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            try {
                context.startActivity(specificIntent)
                promise.resolve(true)
                return
            } catch (_: Exception) {
                // Fallback to general Usage Access screen on OEMs that reject package URI data
            }

            val fallbackIntent = Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(fallbackIntent)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("OPEN_SETTINGS_ERROR", "Unable to open Usage Access settings: ${e.message}", e)
        }
    }

    private fun resolveBestDeviceName(context: Context): String {
        val candidates = mutableListOf<String?>()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N_MR1) {
            try {
                candidates.add(
                    Settings.Global.getString(context.contentResolver, Settings.Global.DEVICE_NAME)
                )
            } catch (_: Exception) {
            }
        }
        try {
            candidates.add(
                Settings.Secure.getString(context.contentResolver, "bluetooth_name")
            )
        } catch (_: Exception) {
        }
        val model = Build.MODEL?.trim().orEmpty()
        val manufacturer = Build.MANUFACTURER?.trim().orEmpty()
        if (model.isNotEmpty()) {
            if (manufacturer.isNotEmpty() && !model.startsWith(manufacturer, ignoreCase = true)) {
                candidates.add("$manufacturer $model")
            } else {
                candidates.add(model)
            }
        }
        for (raw in candidates) {
            val cleaned = raw?.trim().orEmpty()
            if (cleaned.isNotEmpty() && !cleaned.equals("unknown", ignoreCase = true)) {
                return cleaned
            }
        }
        return "ROT User"
    }

    @ReactMethod
    fun getDeviceProfileInfo(promise: Promise) {
        try {
            val context = reactApplicationContext
            val deviceName = resolveBestDeviceName(context)
            val map = Arguments.createMap().apply {
                putString("deviceName", deviceName)
                putString("manufacturer", Build.MANUFACTURER ?: "unknown")
                putString("model", Build.MODEL ?: "unknown")
                putInt("sdkInt", Build.VERSION.SDK_INT)
            }
            promise.resolve(map)
        } catch (_: Exception) {
            val map = Arguments.createMap().apply {
                putString("deviceName", "ROT User")
                putString("manufacturer", Build.MANUFACTURER ?: "unknown")
                putString("model", Build.MODEL ?: "unknown")
                putInt("sdkInt", Build.VERSION.SDK_INT)
            }
            promise.resolve(map)
        }
    }

    @ReactMethod
    fun areNotificationsEnabled(promise: Promise) {
        try {
            val status = RotNotificationHelper.getStatus(reactApplicationContext)
            promise.resolve(status.canDeliverAny)
        } catch (_: Exception) {
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun getNotificationStatus(promise: Promise) {
        try {
            val context = reactApplicationContext
            val status = RotNotificationHelper.getStatus(context)
            val config = RotNotificationPrefs.loadConfig(context)
            val sentToday = RotNotificationPrefs.getSentKeysForDate(
                context,
                RotNotificationPrefs.todayDateKey()
            )
            val sentArr = Arguments.createArray()
            for (k in sentToday) sentArr.pushString(k)

            val map = Arguments.createMap().apply {
                putBoolean("runtimePermissionGranted", status.runtimePermissionGranted)
                putBoolean("appNotificationsEnabled", status.appNotificationsEnabled)
                putBoolean("nudgesChannelEnabled", status.nudgesChannelEnabled)
                putBoolean("remindersChannelEnabled", status.remindersChannelEnabled)
                putBoolean("squadsChannelEnabled", status.squadsChannelEnabled)
                putBoolean("ignoringBatteryOptimizations", status.ignoringBatteryOptimizations)
                putString("deviceManufacturer", status.deviceManufacturer)
                putString("statusCode", status.statusCode)
                putBoolean("quietHoursActiveNow", RotNotificationPrefs.isWithinQuietHours(config))
                putArray("sentKeysToday", sentArr)
            }
            promise.resolve(map)
        } catch (_: Exception) {
            val map = Arguments.createMap().apply {
                putBoolean("runtimePermissionGranted", false)
                putBoolean("appNotificationsEnabled", false)
                putBoolean("nudgesChannelEnabled", false)
                putBoolean("remindersChannelEnabled", false)
                putBoolean("squadsChannelEnabled", false)
                putBoolean("ignoringBatteryOptimizations", false)
                putString("deviceManufacturer", Build.MANUFACTURER ?: "unknown")
                putString("statusCode", "notifications_off")
                putBoolean("quietHoursActiveNow", false)
                putArray("sentKeysToday", Arguments.createArray())
            }
            promise.resolve(map)
        }
    }

    @ReactMethod
    fun openBatteryOptimizationSettings(promise: Promise) {
        try {
            val context = reactApplicationContext
            val batteryIntent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
            } else {
                Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                    data = Uri.fromParts("package", context.packageName, null)
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
            }
            val detailsIntent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                data = Uri.fromParts("package", context.packageName, null)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            // Prefer App Details on Xiaomi/Redmi so user can access both Battery Saver & Autostart directly
            val preferred = if ((Build.MANUFACTURER ?: "").contains("xiaomi", ignoreCase = true) ||
                (Build.MANUFACTURER ?: "").contains("redmi", ignoreCase = true) ||
                (Build.MANUFACTURER ?: "").contains("poco", ignoreCase = true)
            ) {
                detailsIntent
            } else {
                batteryIntent
            }
            try {
                context.startActivity(preferred)
                promise.resolve(true)
            } catch (_: Exception) {
                context.startActivity(detailsIntent)
                promise.resolve(true)
            }
        } catch (e: Exception) {
            promise.reject("OPEN_BATTERY_SETTINGS_ERROR", "Unable to open battery settings: ${e.message}", e)
        }
    }

    @ReactMethod
    fun openNotificationSettings(channelId: String?, promise: Promise) {
        try {
            val context = reactApplicationContext
            RotNotificationHelper.ensureChannels(context)
            val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !channelId.isNullOrBlank()) {
                Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS).apply {
                    putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
                    putExtra(Settings.EXTRA_CHANNEL_ID, channelId)
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).apply {
                    putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
            } else {
                Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                    data = Uri.fromParts("package", context.packageName, null)
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
            }
            try {
                context.startActivity(intent)
                promise.resolve(true)
                return
            } catch (_: Exception) {
                val fallback = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                    data = Uri.fromParts("package", context.packageName, null)
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                context.startActivity(fallback)
                promise.resolve(true)
            }
        } catch (e: Exception) {
            promise.reject("OPEN_NOTIFICATION_SETTINGS_ERROR", "Unable to open Notification settings: ${e.message}", e)
        }
    }

    @ReactMethod
    fun syncNotificationConfig(configMap: ReadableMap, promise: Promise) {
        try {
            val context = reactApplicationContext
            val config = RotNotificationConfig(
                dailyGentleNudge = if (configMap.hasKey("dailyGentleNudge")) configMap.getBoolean("dailyGentleNudge") else true,
                missionReminders = if (configMap.hasKey("missionReminders")) configMap.getBoolean("missionReminders") else true,
                streakReminders = if (configMap.hasKey("streakReminders")) configMap.getBoolean("streakReminders") else true,
                weekendBreathingRoom = if (configMap.hasKey("weekendBreathingRoom")) configMap.getBoolean("weekendBreathingRoom") else false,
                consentAccepted = if (configMap.hasKey("consentAccepted")) configMap.getBoolean("consentAccepted") else false,
                trackingEnabled = if (configMap.hasKey("trackingEnabled")) configMap.getBoolean("trackingEnabled") else true,
                dailyLimitMinutes = if (configMap.hasKey("dailyLimitMinutes")) configMap.getInt("dailyLimitMinutes") else 120,
                eveningReminderHour = if (configMap.hasKey("eveningReminderHour")) configMap.getInt("eveningReminderHour") else 19,
                eveningReminderMinute = if (configMap.hasKey("eveningReminderMinute")) configMap.getInt("eveningReminderMinute") else 0,
                streakReminderHour = if (configMap.hasKey("streakReminderHour")) configMap.getInt("streakReminderHour") else 21,
                streakReminderMinute = if (configMap.hasKey("streakReminderMinute")) configMap.getInt("streakReminderMinute") else 0,
                quietHoursEnabled = if (configMap.hasKey("quietHoursEnabled")) configMap.getBoolean("quietHoursEnabled") else true,
                quietStartHour = if (configMap.hasKey("quietStartHour")) configMap.getInt("quietStartHour") else 22,
                quietEndHour = if (configMap.hasKey("quietEndHour")) configMap.getInt("quietEndHour") else 8,
                currentStreak = if (configMap.hasKey("currentStreak")) configMap.getInt("currentStreak") else 1,
                syncedDateKey = if (configMap.hasKey("syncedDateKey")) configMap.getString("syncedDateKey") ?: "" else "",
                anyNonLimitMissionDoneToday = if (configMap.hasKey("anyNonLimitMissionDoneToday")) configMap.getBoolean("anyNonLimitMissionDoneToday") else false,
                streakActiveToday = if (configMap.hasKey("streakActiveToday")) configMap.getBoolean("streakActiveToday") else false
            )

            var sentJson: JSONObject? = null
            if (configMap.hasKey("sentKeysToday") && configMap.hasKey("syncedDateKey")) {
                val dk = configMap.getString("syncedDateKey").orEmpty()
                val arr = configMap.getArray("sentKeysToday")
                if (dk.isNotEmpty() && arr != null) {
                    val ja = JSONArray()
                    for (i in 0 until arr.size()) {
                        val s = arr.getString(i)
                        if (!s.isNullOrEmpty()) ja.put(s)
                    }
                    sentJson = JSONObject().apply { put(dk, ja) }
                }
            }

            RotNotificationHelper.ensureChannels(context)
            RotNotificationPrefs.saveConfig(context, config, sentJson)
            RotNotificationScheduler.rescheduleAll(context)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("SYNC_NOTIF_CONFIG_ERROR", "Unable to sync notification config: ${e.message}", e)
        }
    }

    @ReactMethod
    fun triggerBackgroundUsageCheckNow(promise: Promise) {
        try {
            RotNotificationScheduler.triggerImmediateUsageCheck(reactApplicationContext)
            promise.resolve(true)
        } catch (_: Exception) {
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun postLocalNotification(
        notificationId: Int,
        title: String,
        body: String,
        promise: Promise
    ) {
        try {
            val channelId = if (notificationId == 1003 || notificationId == 1004) {
                RotNotificationHelper.CHANNEL_REMINDERS_ID
            } else {
                RotNotificationHelper.CHANNEL_NUDGES_ID
            }
            val posted = RotNotificationHelper.postNotification(
                context = reactApplicationContext,
                channelId = channelId,
                notificationId = notificationId,
                title = title,
                body = body
            )
            promise.resolve(posted)
        } catch (_: Exception) {
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun postCloudMirrorNotification(
        dedupKey: String,
        title: String,
        body: String,
        targetRoute: String?,
        promise: Promise
    ) {
        try {
            val posted = RotNotificationHelper.postCloudMirrorNotification(
                context = reactApplicationContext,
                dedupKey = dedupKey,
                title = title,
                body = body,
                targetRoute = targetRoute
            )
            promise.resolve(posted)
        } catch (_: Exception) {
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun getInitialNotificationRoute(promise: Promise) {
        try {
            val consumed = synchronized(routeLock) {
                val route = pendingNotificationRoute
                pendingNotificationRoute = null
                route
            }
            promise.resolve(consumed)
        } catch (_: Exception) {
            promise.resolve(null)
        }
    }

    private fun buildInboxSnapshotMap(items: List<RotNotificationRecord>): WritableMap {
        val arr = Arguments.createArray()
        var unreadCount = 0
        for (item in items) {
            if (!item.read) unreadCount++
            val row = Arguments.createMap().apply {
                putString("id", item.id)
                putInt("notificationId", item.notificationId)
                putString("channelId", item.channelId)
                putString("title", item.title)
                putString("body", item.body)
                putDouble("createdAtMs", item.createdAtMs.toDouble())
                putString("dateKey", item.dateKey)
                putBoolean("read", item.read)
            }
            arr.pushMap(row)
        }
        return Arguments.createMap().apply {
            putInt("unreadCount", unreadCount)
            putArray("items", arr)
        }
    }

    @ReactMethod
    fun getNotificationInbox(promise: Promise) {
        try {
            val items = RotNotificationPrefs.getNotificationHistory(reactApplicationContext)
            promise.resolve(buildInboxSnapshotMap(items))
        } catch (_: Exception) {
            val empty = Arguments.createMap().apply {
                putInt("unreadCount", 0)
                putArray("items", Arguments.createArray())
            }
            promise.resolve(empty)
        }
    }

    @ReactMethod
    fun markAllNotificationsRead(promise: Promise) {
        try {
            val updated = RotNotificationPrefs.markAllNotificationsRead(reactApplicationContext)
            promise.resolve(buildInboxSnapshotMap(updated))
        } catch (_: Exception) {
            val empty = Arguments.createMap().apply {
                putInt("unreadCount", 0)
                putArray("items", Arguments.createArray())
            }
            promise.resolve(empty)
        }
    }

    @ReactMethod
    fun clearNotificationHistory(promise: Promise) {
        try {
            RotNotificationPrefs.clearNotificationHistory(reactApplicationContext)
            promise.resolve(buildInboxSnapshotMap(emptyList()))
        } catch (_: Exception) {
            val empty = Arguments.createMap().apply {
                putInt("unreadCount", 0)
                putArray("items", Arguments.createArray())
            }
            promise.resolve(empty)
        }
    }

    @ReactMethod
    fun getInstagramUsageSummary(daysBack: Int, promise: Promise) {
        try {
            val context = reactApplicationContext
            val now = System.currentTimeMillis()
            val hasPermission = RotUsageTracker.checkUsageAccessGranted(context)
            val instagramInstalled = RotUsageTracker.checkPackageInstalled(context, INSTAGRAM_PACKAGE)
            val deviceName = resolveBestDeviceName(context)

            val result = Arguments.createMap().apply {
                putBoolean("permissionGranted", hasPermission)
                putBoolean("instagramInstalled", instagramInstalled)
                putDouble("queriedAtMs", now.toDouble())
                putString("deviceName", deviceName)
                putString("manufacturer", Build.MANUFACTURER ?: "unknown")
                putString("model", Build.MODEL ?: "unknown")
                putInt("sdkInt", Build.VERSION.SDK_INT)
            }

            if (!hasPermission) {
                result.putString("status", "permission_required")
                result.putString(
                    "statusReason",
                    "ROT needs Usage Access to estimate your Instagram screen time."
                )
                result.putBoolean("isComplete", false)
                result.putString("errorCode", "PERMISSION_DENIED")
                result.putNull("todayForegroundMs")
                result.putArray("dailyBreakdown", Arguments.createArray())
                promise.resolve(result)
                return
            }

            val snapshot = RotUsageTracker.queryInstagramUsage(context, daysBack, now)
            if (snapshot == null) {
                result.putString("status", "query_failed")
                result.putString(
                    "statusReason",
                    "We couldn't retrieve your usage data. Your previous saved data hasn't been deleted."
                )
                result.putBoolean("isComplete", false)
                result.putString("errorCode", "SERVICE_UNAVAILABLE")
                result.putNull("todayForegroundMs")
                result.putArray("dailyBreakdown", Arguments.createArray())
                promise.resolve(result)
                return
            }

            val osHasAnyUsageData = snapshot.totalSystemEventsCount > 0 || snapshot.anyStatsRecords
            val todayWindow = snapshot.todayWindow
            val todayMs = snapshot.todayMs
            val todaySource = when {
                todayWindow.eventDurationMs > 0L -> "usage_events"
                todayWindow.statsDurationMs > 0L -> "daily_aggregate"
                todayWindow.anyDeviceEvents -> "usage_events_zero"
                else -> "no_os_records"
            }
            val todayComplete = todayWindow.eventDurationMs > 0L || todayWindow.anyDeviceEvents

            val breakdownArray = Arguments.createArray()
            for (dw in snapshot.dayWindows) {
                val chosenMs = if (dw.eventDurationMs > 0L) dw.eventDurationMs else dw.statsDurationMs
                val dayMap: WritableMap = Arguments.createMap().apply {
                    putString("date", dw.dateKey)
                    putString("dayLabel", dw.dayLabel)
                    putDouble("foregroundMs", chosenMs.toDouble())
                    putInt("sessionCount", dw.sessionCount)
                    putBoolean("hasOsCoverage", dw.anyDeviceEvents || snapshot.anyStatsRecords)
                    putString(
                        "source",
                        if (dw.eventDurationMs > 0L) "usage_events" else if (dw.statsDurationMs > 0L) "daily_aggregate" else "zero_or_empty"
                    )
                }
                breakdownArray.pushMap(dayMap)
            }

            result.putArray("dailyBreakdown", breakdownArray)
            result.putInt("totalSystemEventsScanned", snapshot.totalSystemEventsCount)
            result.putDouble("lastOsEventAtMs", snapshot.lastEventTimestamp.toDouble())
            result.putDouble("todayStartMs", snapshot.todayStartMs.toDouble())
            result.putString("aggregationSource", todaySource)
            result.putBoolean("isComplete", todayComplete)

            when {
                !instagramInstalled && todayMs == 0L -> {
                    result.putString("status", "not_installed")
                    result.putString(
                        "statusReason",
                        "Instagram isn't installed on this device."
                    )
                    result.putBoolean("isComplete", false)
                    result.putNull("todayForegroundMs")
                }
                !osHasAnyUsageData || (!todayWindow.anyDeviceEvents && todayMs == 0L) -> {
                    result.putString("status", "no_os_record")
                    result.putString(
                        "statusReason",
                        "No usage record is available yet. Open Instagram and check again."
                    )
                    result.putBoolean("isComplete", false)
                    result.putNull("todayForegroundMs")
                }
                todayMs == 0L -> {
                    result.putString("status", "zero_usage")
                    result.putString(
                        "statusReason",
                        "estimated Instagram foreground time"
                    )
                    result.putDouble("todayForegroundMs", 0.0)
                    result.putInt("todaySessionCount", 0)
                }
                !todayWindow.anyDeviceEvents && todayWindow.statsDurationMs > 0L -> {
                    result.putString("status", "incomplete")
                    result.putString(
                        "statusReason",
                        "Estimated from daily OS aggregate bucket because granular interval events were incomplete."
                    )
                    result.putBoolean("isComplete", false)
                    result.putDouble("todayForegroundMs", todayMs.toDouble())
                    result.putInt("todaySessionCount", todayWindow.sessionCount)
                }
                else -> {
                    result.putString("status", "ok")
                    result.putString(
                        "statusReason",
                        "estimated Instagram foreground time"
                    )
                    result.putDouble("todayForegroundMs", todayMs.toDouble())
                    result.putInt("todaySessionCount", todayWindow.sessionCount)
                }
            }

            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("USAGE_QUERY_ERROR", "Failed to query UsageStats: ${e.message}", e)
        }
    }
}
