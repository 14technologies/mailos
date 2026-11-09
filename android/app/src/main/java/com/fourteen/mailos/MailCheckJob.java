package com.fourteen.mailos;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Build;
import android.webkit.CookieManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;

/**
 * Checks MailOS for new inbox mail while the app is closed (about every 15 minutes, which is
 * Android's shortest background interval) and shows a notification for each new message.
 * It uses the app's own signed-in session, so nothing extra is stored or sent anywhere else.
 */
public final class MailCheckJob extends JobService {
    static final String PREFS = "mailos_mail_check";
    static final String SERVER_KEY = "server_origin";
    private static final String LAST_SEEN_KEY = "last_seen_iso";
    private static final int JOB_ID = 6201;
    private static final String GROUP = "mailos_new_mail_group";
    private static final int SUMMARY_ID = 6200;

    /** Set by MainActivity: no notifications while the app is on screen (it shows mail live). */
    static volatile boolean appVisible = false;

    static void schedule(Context context, String serverOrigin) {
        context.getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(SERVER_KEY, serverOrigin).apply();
        JobScheduler scheduler = context.getSystemService(JobScheduler.class);
        if (scheduler == null) return;
        for (JobInfo pending : scheduler.getAllPendingJobs()) {
            if (pending.getId() == JOB_ID) return;
        }
        JobInfo job = new JobInfo.Builder(JOB_ID, new ComponentName(context, MailCheckJob.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPeriodic(15 * 60 * 1000L)
                .setPersisted(true)
                .build();
        try {
            scheduler.schedule(job);
        } catch (RuntimeException ignored) {
            // A phone that refuses background jobs must never stop the app from opening.
        }
    }

    /** Called when the app is open: anything already listed counts as seen. */
    static void markSeenNow(Context context) {
        context.getSharedPreferences(PREFS, MODE_PRIVATE).edit()
                .putString(LAST_SEEN_KEY, java.time.Instant.now().toString()).apply();
    }

    @Override
    public boolean onStartJob(JobParameters params) {
        new Thread(() -> {
            try {
                check();
            } catch (Exception ignored) {
                // Network or session problems: try again at the next interval.
            }
            jobFinished(params, false);
        }, "mailos-mail-check").start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        return true;
    }

    private void check() throws Exception {
        if (appVisible) return;
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        String origin = prefs.getString(SERVER_KEY, null);
        if (origin == null) return;
        String cookies = CookieManager.getInstance().getCookie(origin);
        if (cookies == null || cookies.isEmpty()) return;

        HttpURLConnection connection = (HttpURLConnection) new URL(origin
                + "/api/messages?direction=inbound&status=received&read=unread&limit=10").openConnection();
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(20000);
        connection.setRequestProperty("Cookie", cookies);
        connection.setRequestProperty("Accept", "application/json");
        if (connection.getResponseCode() != 200) return;
        JSONArray messages = new JSONObject(readAll(connection.getInputStream())).optJSONArray("messages");
        if (messages == null) return;

        String lastSeen = prefs.getString(LAST_SEEN_KEY, null);
        if (lastSeen == null) {
            // First run: start from now, never announce mail that was already waiting.
            markSeenNow(this);
            return;
        }
        List<JSONObject> fresh = new ArrayList<>();
        String newest = lastSeen;
        for (int index = 0; index < messages.length(); index++) {
            JSONObject message = messages.getJSONObject(index);
            String created = message.optString("createdAt", "");
            if (created.compareTo(lastSeen) > 0) {
                fresh.add(message);
                if (created.compareTo(newest) > 0) newest = created;
            }
        }
        if (fresh.isEmpty()) return;
        prefs.edit().putString(LAST_SEEN_KEY, newest).apply();
        notifyNewMail(origin, fresh);
    }

    private void notifyNewMail(String origin, List<JSONObject> fresh) {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null || !manager.areNotificationsEnabled()) return;
        for (JSONObject message : fresh) {
            String id = message.optString("id");
            String sender = firstNonEmpty(message.optString("fromContactName"), message.optString("fromAddr"), "New email");
            String subject = firstNonEmpty(message.optString("subject"), "(no subject)");
            String preview = message.optString("snippet", "");
            Notification notification = baseBuilder()
                    .setContentTitle(sender)
                    .setContentText(subject)
                    .setStyle(new Notification.BigTextStyle().bigText(subject + (preview.isEmpty() ? "" : "\n" + preview)))
                    .setContentIntent(openIntent(origin + "/inbox/" + id, id.hashCode()))
                    .setGroup(GROUP)
                    .setWhen(System.currentTimeMillis())
                    .build();
            manager.notify(id.hashCode(), notification);
        }
        Notification summary = baseBuilder()
                .setContentTitle("MailOS")
                .setContentText(fresh.size() == 1 ? "1 new email" : fresh.size() + " new emails")
                .setContentIntent(openIntent(origin + "/inbox", SUMMARY_ID))
                .setGroup(GROUP)
                .setGroupSummary(true)
                .build();
        manager.notify(SUMMARY_ID, summary);
    }

    private Notification.Builder baseBuilder() {
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(this, MainActivity.MAIL_NOTIFICATION_CHANNEL_ID)
                : new Notification.Builder(this);
        return builder
                .setSmallIcon(R.drawable.ic_stat_mail)
                .setColor(Color.rgb(20, 184, 166))
                .setCategory(Notification.CATEGORY_EMAIL)
                .setVisibility(Notification.VISIBILITY_PRIVATE)
                .setAutoCancel(true)
                .setShowWhen(true);
    }

    private PendingIntent openIntent(String url, int requestCode) {
        Intent intent = new Intent(this, MainActivity.class)
                .setAction(Intent.ACTION_VIEW)
                .putExtra(MainActivity.EXTRA_OPEN_URL, url)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(this, requestCode, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static String firstNonEmpty(String... values) {
        for (String value : values) {
            if (value != null && !value.isEmpty() && !"null".equals(value)) return value;
        }
        return "";
    }

    private static String readAll(InputStream input) throws Exception {
        try (InputStream in = input; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = in.read(buffer)) != -1) out.write(buffer, 0, read);
            return out.toString("UTF-8");
        }
    }
}
