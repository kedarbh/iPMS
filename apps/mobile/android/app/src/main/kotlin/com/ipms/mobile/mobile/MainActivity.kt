package com.ipms.mobile.mobile

import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import android.os.Bundle
import io.flutter.embedding.android.FlutterFragmentActivity

class MainActivity : FlutterFragmentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        createNotificationChannel()
    }

    /** Android 8+ shows a push only through a channel; this one pops up on screen. Must match the server's channel id. */
    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel("ipms_default", "Notifications", NotificationManager.IMPORTANCE_HIGH)
        channel.description = "Approvals, payments, reviews and reminders"
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }
}
