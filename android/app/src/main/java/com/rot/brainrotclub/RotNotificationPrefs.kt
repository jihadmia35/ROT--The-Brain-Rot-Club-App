package com.rot.brainrotclub

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.concurrent.atomic.AtomicInteger

data class RotNotificationRecord(
    val id: String,
    val notificationId: Int,
    val channelId: String,
    val title: String,
    val body: String,
    val createdAtMs: Long,
    val dateKey: String,
    val read: Boolean
)

data class RotNotificationConfig(
    val dailyGentleNudge: Boolean = true,
    val missionReminders: Boolean = true,
    val streakReminders: Boolean = true,
    val weekendBreathingRoom: Boolean = false,
    val consentAccepted: Boolean = false,
    val trackingEnabled: Boolean = true,
    val dailyLimitMinutes: Int = 120,
    val eveningReminderHour: Int = 19,
    val eveningReminderMinute: Int = 0,
    val streakReminderHour: Int = 21,
    val streakReminderMinute: Int = 0,
    val quietHoursEnabled: Boolean = true,
    val quietStartHour: Int = 22,
    val quietEndHour: Int = 8,
    val currentStreak: Int = 1,
    val syncedDateKey: String = "",
    val anyNonLimitMissionDoneToday: Boolean = false,
    val streakActiveToday: Boolean = false
)

object RotNotificationPrefs {
    private const val PREFS_NAME = "rot_notification_prefs"
    private const val KEY_CONFIG_JSON = "config_json"
    private const val KEY_SENT_BY_DATE = "sent_by_date_json"
    private const val KEY_NOTIFICATION_HISTORY = "notification_history_json"
    private const val KEY_CLOUD_OS_DEDUP_IDS = "cloud_os_dedup_ids_json"
    private const val MAX_HISTORY_ITEMS = 150
    private const val MAX_CLOUD_DEDUP_ITEMS = 300
    private val historySequence = AtomicInteger(0)

    fun todayDateKey(nowMs: Long = System.currentTimeMillis()): String {
        return SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date(nowMs))
    }

    fun saveConfig(context: Context, config: RotNotificationConfig, sentByDateJson: JSONObject? = null) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val obj = JSONObject().apply {
            put("dailyGentleNudge", config.dailyGentleNudge)
            put("missionReminders", config.missionReminders)
            put("streakReminders", config.streakReminders)
            put("weekendBreathingRoom", config.weekendBreathingRoom)
            put("consentAccepted", config.consentAccepted)
            put("trackingEnabled", config.trackingEnabled)
            put("dailyLimitMinutes", config.dailyLimitMinutes.coerceIn(15, 720))
            put("eveningReminderHour", config.eveningReminderHour.coerceIn(0, 23))
            put("eveningReminderMinute", config.eveningReminderMinute.coerceIn(0, 59))
            put("streakReminderHour", config.streakReminderHour.coerceIn(0, 23))
            put("streakReminderMinute", config.streakReminderMinute.coerceIn(0, 59))
            put("quietHoursEnabled", config.quietHoursEnabled)
            put("quietStartHour", config.quietStartHour.coerceIn(0, 23))
            put("quietEndHour", config.quietEndHour.coerceIn(0, 23))
            put("currentStreak", config.currentStreak.coerceAtLeast(0))
            put("syncedDateKey", config.syncedDateKey)
            put("anyNonLimitMissionDoneToday", config.anyNonLimitMissionDoneToday)
            put("streakActiveToday", config.streakActiveToday)
        }
        val editor = prefs.edit().putString(KEY_CONFIG_JSON, obj.toString())
        if (sentByDateJson != null) {
            val existing = loadSentMap(context)
            val keys = sentByDateJson.keys()
            while (keys.hasNext()) {
                val dateKey = keys.next()
                val arr = sentByDateJson.optJSONArray(dateKey) ?: continue
                val merged = existing.getOrPut(dateKey) { mutableSetOf() }
                for (i in 0 until arr.length()) {
                    val item = arr.optString(i)
                    if (item.isNotEmpty()) merged.add(item)
                }
            }
            editor.putString(KEY_SENT_BY_DATE, serializeSentMap(mergedRecentOnly(existing)))
        }
        editor.apply()
    }

    fun loadConfig(context: Context): RotNotificationConfig {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val raw = prefs.getString(KEY_CONFIG_JSON, null) ?: return RotNotificationConfig()
        return try {
            val obj = JSONObject(raw)
            RotNotificationConfig(
                dailyGentleNudge = obj.optBoolean("dailyGentleNudge", true),
                missionReminders = obj.optBoolean("missionReminders", true),
                streakReminders = obj.optBoolean("streakReminders", true),
                weekendBreathingRoom = obj.optBoolean("weekendBreathingRoom", false),
                consentAccepted = obj.optBoolean("consentAccepted", false),
                trackingEnabled = obj.optBoolean("trackingEnabled", true),
                dailyLimitMinutes = obj.optInt("dailyLimitMinutes", 120).coerceIn(15, 720),
                eveningReminderHour = obj.optInt("eveningReminderHour", 19).coerceIn(0, 23),
                eveningReminderMinute = obj.optInt("eveningReminderMinute", 0).coerceIn(0, 59),
                streakReminderHour = obj.optInt("streakReminderHour", 21).coerceIn(0, 23),
                streakReminderMinute = obj.optInt("streakReminderMinute", 0).coerceIn(0, 59),
                quietHoursEnabled = obj.optBoolean("quietHoursEnabled", true),
                quietStartHour = obj.optInt("quietStartHour", 22).coerceIn(0, 23),
                quietEndHour = obj.optInt("quietEndHour", 8).coerceIn(0, 23),
                currentStreak = obj.optInt("currentStreak", 1).coerceAtLeast(0),
                syncedDateKey = obj.optString("syncedDateKey", ""),
                anyNonLimitMissionDoneToday = obj.optBoolean("anyNonLimitMissionDoneToday", false),
                streakActiveToday = obj.optBoolean("streakActiveToday", false)
            )
        } catch (_: Exception) {
            RotNotificationConfig()
        }
    }

    fun wasSentOnDate(context: Context, dateKey: String, notificationKey: String): Boolean {
        return loadSentMap(context)[dateKey]?.contains(notificationKey) == true
    }

    fun markSentOnDate(context: Context, dateKey: String, notificationKey: String) {
        val map = loadSentMap(context)
        map.getOrPut(dateKey) { mutableSetOf() }.add(notificationKey)
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putString(KEY_SENT_BY_DATE, serializeSentMap(mergedRecentOnly(map))).apply()
    }

    fun getSentKeysForDate(context: Context, dateKey: String): List<String> {
        return loadSentMap(context)[dateKey]?.toList().orEmpty()
    }

    fun isWithinQuietHours(config: RotNotificationConfig, cal: Calendar = Calendar.getInstance()): Boolean {
        if (!config.quietHoursEnabled) return false
        val start = config.quietStartHour.coerceIn(0, 23)
        val end = config.quietEndHour.coerceIn(0, 23)
        if (start == end) return false
        val hour = cal.get(Calendar.HOUR_OF_DAY)
        return if (start > end) {
            // Overnight window, e.g., 22:00 -> 08:00
            hour >= start || hour < end
        } else {
            // Same-day window, e.g., 13:00 -> 15:00
            hour in start until end
        }
    }

    fun effectiveDailyLimitMinutes(config: RotNotificationConfig, cal: Calendar = Calendar.getInstance()): Int {
        val dayOfWeek = cal.get(Calendar.DAY_OF_WEEK)
        val weekendBonus =
            if (config.weekendBreathingRoom && (dayOfWeek == Calendar.SATURDAY || dayOfWeek == Calendar.SUNDAY)) {
                30
            } else {
                0
            }
        return (config.dailyLimitMinutes + weekendBonus).coerceIn(15, 720)
    }

    private fun loadSentMap(context: Context): MutableMap<String, MutableSet<String>> {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val raw = prefs.getString(KEY_SENT_BY_DATE, null) ?: return mutableMapOf()
        return try {
            val obj = JSONObject(raw)
            val result = mutableMapOf<String, MutableSet<String>>()
            val keys = obj.keys()
            while (keys.hasNext()) {
                val dateKey = keys.next()
                val arr = obj.optJSONArray(dateKey) ?: continue
                val set = mutableSetOf<String>()
                for (i in 0 until arr.length()) {
                    val v = arr.optString(i)
                    if (v.isNotEmpty()) set.add(v)
                }
                result[dateKey] = set
            }
            result
        } catch (_: Exception) {
            mutableMapOf()
        }
    }

    private fun mergedRecentOnly(map: Map<String, MutableSet<String>>): Map<String, Set<String>> {
        val sortedDates = map.keys.sortedDescending().take(7)
        val out = linkedMapOf<String, Set<String>>()
        for (d in sortedDates) {
            out[d] = map[d].orEmpty()
        }
        return out
    }

    private fun serializeSentMap(map: Map<String, Set<String>>): String {
        val obj = JSONObject()
        for ((dateKey, set) in map) {
            val arr = JSONArray()
            for (item in set) arr.put(item)
            obj.put(dateKey, arr)
        }
        return obj.toString()
    }

    @Synchronized
    fun hasNotificationId(context: Context, id: String): Boolean {
        return loadHistoryList(context).any { it.id == id }
    }

    @Synchronized
    fun recordDeliveredNotification(
        context: Context,
        dedupKey: String?,
        notificationId: Int,
        channelId: String,
        title: String,
        body: String,
        nowMs: Long = System.currentTimeMillis()
    ): Boolean {
        val current = loadHistoryList(context).toMutableList()
        if (!dedupKey.isNullOrBlank() && current.any { it.id == dedupKey }) {
            return false
        }
        val dateKey = todayDateKey(nowMs)
        val recordId = if (!dedupKey.isNullOrBlank()) {
            dedupKey
        } else {
            "notif_${notificationId}_${nowMs}_${historySequence.incrementAndGet()}"
        }
        val record = RotNotificationRecord(
            id = recordId,
            notificationId = notificationId,
            channelId = channelId,
            title = title,
            body = body,
            createdAtMs = nowMs,
            dateKey = dateKey,
            read = false
        )
        current.add(0, record)
        val trimmed = if (current.size > MAX_HISTORY_ITEMS) {
            current.subList(0, MAX_HISTORY_ITEMS)
        } else {
            current
        }
        saveHistoryList(context, trimmed)
        return true
    }

    @Synchronized
    fun getNotificationHistory(context: Context): List<RotNotificationRecord> {
        return loadHistoryList(context)
    }

    @Synchronized
    fun getUnreadNotificationCount(context: Context): Int {
        return loadHistoryList(context).count { !it.read }
    }

    @Synchronized
    fun markAllNotificationsRead(context: Context): List<RotNotificationRecord> {
        val current = loadHistoryList(context)
        if (current.none { !it.read }) {
            return current
        }
        val updated = current.map { if (it.read) it else it.copy(read = true) }
        saveHistoryList(context, updated)
        return updated
    }

    @Synchronized
    fun clearNotificationHistory(context: Context) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().remove(KEY_NOTIFICATION_HISTORY).commit()
    }

    private fun loadHistoryList(context: Context): List<RotNotificationRecord> {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val raw = prefs.getString(KEY_NOTIFICATION_HISTORY, null) ?: return emptyList()
        return try {
            val arr = JSONArray(raw)
            val list = ArrayList<RotNotificationRecord>(arr.length())
            for (i in 0 until arr.length()) {
                val obj = arr.optJSONObject(i) ?: continue
                val id = obj.optString("id", "")
                if (id.isEmpty()) continue
                list.add(
                    RotNotificationRecord(
                        id = id,
                        notificationId = obj.optInt("notificationId", 0),
                        channelId = obj.optString("channelId", RotNotificationHelper.CHANNEL_NUDGES_ID),
                        title = obj.optString("title", ""),
                        body = obj.optString("body", ""),
                        createdAtMs = obj.optLong("createdAtMs", 0L),
                        dateKey = obj.optString("dateKey", ""),
                        read = obj.optBoolean("read", false)
                    )
                )
            }
            list
        } catch (_: Exception) {
            emptyList()
        }
    }

    private fun saveHistoryList(context: Context, list: List<RotNotificationRecord>) {
        val arr = JSONArray()
        for (item in list) {
            arr.put(
                JSONObject().apply {
                    put("id", item.id)
                    put("notificationId", item.notificationId)
                    put("channelId", item.channelId)
                    put("title", item.title)
                    put("body", item.body)
                    put("createdAtMs", item.createdAtMs)
                    put("dateKey", item.dateKey)
                    put("read", item.read)
                }
            )
        }
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putString(KEY_NOTIFICATION_HISTORY, arr.toString()).commit()
    }

    @Synchronized
    fun hasCloudOsDedupKey(context: Context, dedupKey: String): Boolean {
        if (dedupKey.isBlank()) return false
        return loadCloudOsDedupList(context).contains(dedupKey)
    }

    @Synchronized
    fun recordCloudOsDedupKey(context: Context, dedupKey: String): Boolean {
        if (dedupKey.isBlank()) return false
        val list = loadCloudOsDedupList(context).toMutableList()
        if (list.contains(dedupKey)) return false
        list.add(0, dedupKey)
        val trimmed = if (list.size > MAX_CLOUD_DEDUP_ITEMS) {
            list.subList(0, MAX_CLOUD_DEDUP_ITEMS)
        } else {
            list
        }
        val arr = JSONArray()
        for (item in trimmed) arr.put(item)
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putString(KEY_CLOUD_OS_DEDUP_IDS, arr.toString()).commit()
        return true
    }

    private fun loadCloudOsDedupList(context: Context): List<String> {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val raw = prefs.getString(KEY_CLOUD_OS_DEDUP_IDS, null) ?: return emptyList()
        return try {
            val arr = JSONArray(raw)
            val list = ArrayList<String>(arr.length())
            for (i in 0 until arr.length()) {
                val value = arr.optString(i, "")
                if (value.isNotBlank()) list.add(value)
            }
            list
        } catch (_: Exception) {
            emptyList()
        }
    }
}
