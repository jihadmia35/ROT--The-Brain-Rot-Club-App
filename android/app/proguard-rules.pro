# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# react-native-reanimated
-keep class com.swmansion.reanimated.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }

# Add any project specific keep options here:

# Preserve ROT native modules, @ReactMethod entrypoints, receivers, and WorkManager worker under R8
-keep class com.rot.brainrotclub.MainApplication { *; }
-keep class com.rot.brainrotclub.MainActivity { *; }
-keep class com.rot.brainrotclub.UsageStatsPackage { *; }
-keep class com.rot.brainrotclub.UsageStatsModule { *; }
-keep class com.rot.brainrotclub.RotCardMediaModule { *; }
-keep class com.rot.brainrotclub.RotUsageCheckWorker { *; }
-keep class com.rot.brainrotclub.RotAlarmReceiver { *; }
-keep class com.rot.brainrotclub.RotBootReceiver { *; }

-keepclassmembers class * extends com.facebook.react.bridge.BaseJavaModule {
    @com.facebook.react.bridge.ReactMethod <methods>;
}
-keepclassmembers class * extends com.facebook.react.bridge.ReactContextBaseJavaModule {
    @com.facebook.react.bridge.ReactMethod <methods>;
}
-keep @androidx.annotation.Keep class * { *; }
-keepclassmembers class * {
    @androidx.annotation.Keep *;
}

# Preserve generated RoomDatabase *_Impl no-arg constructors (e.g. WorkManager WorkDatabase_Impl) under R8 full mode
-keep class * extends androidx.room.RoomDatabase {
    <init>();
}
