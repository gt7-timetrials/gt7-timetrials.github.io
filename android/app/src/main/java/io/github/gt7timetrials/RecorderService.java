package io.github.gt7timetrials;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.IBinder;
import android.os.PowerManager;

/**
 * Keeps the app running while it records, so a lap isn't lost when the player locks the phone or switches apps:
 * without it Android pauses (and on newer versions freezes) apps in the background. The recording itself stays in
 * MainActivity's Recorder; this only holds a "Recording" notification and keeps the CPU awake.
 */
public class RecorderService extends Service {
    private static final String CHANNEL = "recording";
    private static final long MAX_MS = 4 * 60 * 60 * 1000L; // never hold the phone awake longer than this
    private PowerManager.WakeLock wake;

    static void start(Context c) {
        c.startForegroundService(new Intent(c, RecorderService.class));
    }

    static void stop(Context c) {
        c.stopService(new Intent(c, RecorderService.class));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int id) {
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Recording", NotificationManager.IMPORTANCE_LOW));
        // tapping the notification brings the app back as it was, like the launcher icon does
        Intent back = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent open = PendingIntent.getActivity(this, 0, back, PendingIntent.FLAG_IMMUTABLE);
        Notification n = new Notification.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_launcher_foreground)
                .setContentTitle("Recording your laps")
                .setContentText("Tap to go back to the app, then tap Stop and compare.")
                .setContentIntent(open)
                .setOngoing(true)
                .build();
        startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE);
        if (wake == null) {
            wake = getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "gt7timetrials:recording");
            wake.acquire(MAX_MS);
        }
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        if (wake != null && wake.isHeld()) wake.release();
        wake = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
