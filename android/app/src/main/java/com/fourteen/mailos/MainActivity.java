package com.fourteen.mailos;

import android.app.Activity;
import android.app.DownloadManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.graphics.Color;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.SystemClock;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.animation.DecelerateInterpolator;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;

public final class MainActivity extends Activity {
    static final String MAIL_NOTIFICATION_CHANNEL_ID = "mailos_mail";
    /** Created by 1.0.4 with normal importance; Android never lets an app raise that, so it is replaced. */
    private static final String OLD_NOTIFICATION_CHANNEL_ID = "mailos_new_mail";
    static final String EXTRA_OPEN_URL = "com.fourteen.mailos.OPEN_URL";

    private static final String SERVER_KEY = "server_origin";
    private static final String DARK_THEME_KEY = "dark_theme";
    private static final String NOTIFICATION_PERMISSION_REQUESTED_KEY = "notification_permission_requested";
    private static final int NOTIFICATION_PERMISSION_REQUEST = 5101;
    private static final int FILE_PICKER_REQUEST = 4102;
    private static final long BACK_PRESS_EXIT_WINDOW_MS = 2_000L;

    private WebView webView;
    private ProgressBar progressBar;
    private FrameLayout pageView;
    private LinearLayout splashView;
    private String serverOrigin;
    private ValueCallback<Uri[]> fileChooserCallback;
    private OnBackInvokedCallback backInvokedCallback;
    private boolean darkTheme = true;
    private long lastBackPressedAt;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // Android 15+ is edge-to-edge for apps targeting API 35+: the app root pads itself
            // for the status bar, navigation bar, notch and keyboard (see openMailOS).
            getWindow().setDecorFitsSystemWindows(false);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            getWindow().setStatusBarContrastEnforced(false);
            getWindow().setNavigationBarContrastEnforced(false);
        }
        // Debug builds can be inspected from chrome://inspect on a connected computer.
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true);
        }
        darkTheme = getPreferences(MODE_PRIVATE).getBoolean(DARK_THEME_KEY, true);
        createMailNotificationChannel();
        if (Build.VERSION.SDK_INT >= 33) {
            backInvokedCallback = this::handleBackNavigation;
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT, backInvokedCallback);
        }

        serverOrigin = getPreferences(MODE_PRIVATE).getString(SERVER_KEY, null);
        if (serverOrigin == null || serverOrigin.isEmpty()) {
            showServerSetup(null);
            return;
        }
        MailCheckJob.schedule(this, serverOrigin);
        openMailOS(urlFromIntent(getIntent(), serverOrigin + "/inbox"));
    }

    /** Notification taps open the right email, whether the app was closed or already open. */
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (webView == null || serverOrigin == null) return;
        String url = urlFromIntent(intent, null);
        if (url != null) webView.loadUrl(url);
    }

    private String urlFromIntent(Intent intent, String fallback) {
        String url = intent == null ? null : intent.getStringExtra(EXTRA_OPEN_URL);
        if (url != null && isSameOrigin(Uri.parse(url))) return url;
        return fallback;
    }

    private void openMailOS(String url) {
        FrameLayout page = new FrameLayout(this);
        pageView = page;
        page.setBackgroundColor(surfaceColor(darkTheme));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            page.setOnApplyWindowInsetsListener((view, insets) -> {
                android.graphics.Insets bars = insets.getInsets(
                        WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                // The keyboard replaces the navigation bar at the bottom: compose and search
                // fields stay visible above it instead of hiding behind it.
                android.graphics.Insets ime = insets.getInsets(WindowInsets.Type.ime());
                view.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));
                return WindowInsets.CONSUMED;
            });
        }

        webView = new WebView(this);
        webView.setBackgroundColor(surfaceColor(darkTheme));
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setSupportMultipleWindows(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        // Pre-render the page off screen so the first frame and scrolling are smoother.
        settings.setOffscreenPreRaster(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            webView.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, true);
        }
        webView.addJavascriptInterface(new ThemeBridge(), "MailOSAndroid");
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false);
        webView.setDownloadListener(this::downloadFile);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri target = request.getUrl();
                if (isSameOrigin(target)) return false;
                openExternal(target);
                return true;
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                if (splashView == null) {
                    progressBar.setAlpha(1f);
                    progressBar.setVisibility(View.VISIBLE);
                }
            }

            // First visible paint: reveal MailOS right away instead of waiting for every image
            // and script to finish loading.
            @Override
            public void onPageCommitVisible(WebView view, String url) {
                revealPage();
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                revealPage();
                if (progressBar.getVisibility() == View.VISIBLE) {
                    progressBar.animate().alpha(0f).setDuration(160)
                            .withEndAction(() -> progressBar.setVisibility(View.GONE)).start();
                }
                if (isSameOrigin(Uri.parse(url))) {
                    syncThemeFromPage(view);
                    requestNotificationPermissionOnFirstUse();
                }
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                // The app's own reconnecting screen handles later drops; this covers the very first
                // launch before it has been stored.
                if (request.isForMainFrame() && splashView != null) showSplashError();
            }

            // If Android stops the web engine to free memory, rebuild the screen instead of crashing.
            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                if (view != webView) return true;
                String current = view.getUrl();
                page.removeAllViews();
                view.destroy();
                webView = null;
                openMailOS(current != null && isSameOrigin(Uri.parse(current)) ? current : serverOrigin + "/inbox");
                return true;
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                    FileChooserParams params) {
                if (fileChooserCallback != null) fileChooserCallback.onReceiveValue(null);
                fileChooserCallback = callback;
                Intent intent = params.createIntent();
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                try {
                    startActivityForResult(intent, FILE_PICKER_REQUEST);
                    return true;
                } catch (ActivityNotFoundException error) {
                    fileChooserCallback = null;
                    Toast.makeText(MainActivity.this, "No file picker is available", Toast.LENGTH_SHORT).show();
                    return false;
                }
            }
        });

        page.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        progressBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progressBar.setIndeterminate(true);
        progressBar.setIndeterminateTintList(android.content.res.ColorStateList.valueOf(Color.rgb(20, 184, 166)));
        progressBar.setVisibility(View.GONE);
        page.addView(progressBar, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(3), Gravity.TOP));

        splashView = buildSplash();
        page.addView(splashView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        setContentView(page);
        applySystemBarTheme(darkTheme);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) page.requestApplyInsets();
        webView.loadUrl(url);
    }

    /** Branded launch screen shown until MailOS paints its first frame. */
    private LinearLayout buildSplash() {
        LinearLayout splash = new LinearLayout(this);
        splash.setOrientation(LinearLayout.VERTICAL);
        splash.setGravity(Gravity.CENTER);
        splash.setBackgroundColor(surfaceColor(darkTheme));
        splash.setClickable(true);

        ImageView logo = new ImageView(this);
        logo.setImageResource(R.drawable.mailos_airplane);
        logo.setContentDescription("MailOS");
        splash.addView(logo, new LinearLayout.LayoutParams(dp(84), dp(84)));
        logo.setScaleX(0.92f);
        logo.setScaleY(0.92f);
        logo.animate().scaleX(1f).scaleY(1f).setDuration(420).setInterpolator(new DecelerateInterpolator()).start();

        ProgressBar spinner = new ProgressBar(this);
        spinner.setIndeterminateTintList(android.content.res.ColorStateList.valueOf(Color.rgb(20, 184, 166)));
        LinearLayout.LayoutParams spinnerParams = new LinearLayout.LayoutParams(dp(26), dp(26));
        spinnerParams.topMargin = dp(28);
        splash.addView(spinner, spinnerParams);
        return splash;
    }

    private void revealPage() {
        LinearLayout splash = splashView;
        if (splash == null) return;
        splashView = null;
        splash.animate().alpha(0f).setDuration(220).setInterpolator(new DecelerateInterpolator())
                .withEndAction(() -> {
                    ViewGroup parent = (ViewGroup) splash.getParent();
                    if (parent != null) parent.removeView(splash);
                }).start();
    }

    private void showSplashError() {
        LinearLayout splash = splashView;
        if (splash == null || splash.getChildCount() > 2) return;
        splash.removeViewAt(1);
        TextView message = new TextView(this);
        message.setText("Can't reach MailOS.\nCheck your internet connection.");
        message.setTextColor(Color.rgb(154, 160, 166));
        message.setTextSize(15);
        message.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams messageParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        messageParams.topMargin = dp(24);
        splash.addView(message, messageParams);
        Button retry = new Button(this);
        retry.setText("Try again");
        retry.setTextColor(Color.rgb(4, 32, 29));
        retry.setBackgroundTintList(android.content.res.ColorStateList.valueOf(Color.rgb(20, 184, 166)));
        LinearLayout.LayoutParams retryParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        retryParams.topMargin = dp(16);
        splash.addView(retry, retryParams);
        retry.setOnClickListener(view -> {
            if (webView == null) return;
            splash.removeView(message);
            splash.removeView(retry);
            ProgressBar spinner = new ProgressBar(this);
            spinner.setIndeterminateTintList(android.content.res.ColorStateList.valueOf(Color.rgb(20, 184, 166)));
            LinearLayout.LayoutParams spinnerParams = new LinearLayout.LayoutParams(dp(26), dp(26));
            spinnerParams.topMargin = dp(28);
            splash.addView(spinner, 1, spinnerParams);
            webView.reload();
        });
    }

    /** Attachments and Drive files: saved to Downloads with the signed-in session. */
    private void downloadFile(String url, String userAgent, String contentDisposition, String mimeType, long contentLength) {
        Uri uri = Uri.parse(url);
        if (!"https".equalsIgnoreCase(uri.getScheme())) {
            Toast.makeText(this, "This file can't be downloaded here", Toast.LENGTH_SHORT).show();
            return;
        }
        try {
            String fileName = URLUtil.guessFileName(url, contentDisposition, mimeType);
            DownloadManager.Request request = new DownloadManager.Request(uri)
                    .setTitle(fileName)
                    .setDescription("MailOS")
                    .setMimeType(mimeType)
                    .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);
            String cookies = CookieManager.getInstance().getCookie(url);
            if (cookies != null) request.addRequestHeader("Cookie", cookies);
            if (userAgent != null) request.addRequestHeader("User-Agent", userAgent);
            DownloadManager manager = getSystemService(DownloadManager.class);
            if (manager == null) throw new IllegalStateException("No download manager");
            manager.enqueue(request);
            Toast.makeText(this, "Downloading " + fileName, Toast.LENGTH_SHORT).show();
        } catch (RuntimeException error) {
            Toast.makeText(this, "Download couldn't start", Toast.LENGTH_SHORT).show();
        }
    }

    private void createMailNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;
        if (manager.getNotificationChannel(OLD_NOTIFICATION_CHANNEL_ID) != null) manager.deleteNotificationChannel(OLD_NOTIFICATION_CHANNEL_ID);
        if (manager.getNotificationChannel(MAIL_NOTIFICATION_CHANNEL_ID) != null) return;

        NotificationChannel channel = new NotificationChannel(
                MAIL_NOTIFICATION_CHANNEL_ID,
                "New mail",
                NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("Alerts when new email arrives in your MailOS inbox.");
        channel.setShowBadge(true);
        channel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PRIVATE);
        channel.enableLights(true);
        channel.setLightColor(Color.rgb(20, 184, 166));
        channel.enableVibration(true);
        channel.setVibrationPattern(new long[] { 0, 120, 80, 120 });
        channel.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION),
                new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build());
        manager.createNotificationChannel(channel);
    }

    private void requestNotificationPermissionOnFirstUse() {
        if (Build.VERSION.SDK_INT < 33
                || checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)
                        == android.content.pm.PackageManager.PERMISSION_GRANTED) return;
        android.content.SharedPreferences preferences = getPreferences(MODE_PRIVATE);
        if (preferences.getBoolean(NOTIFICATION_PERMISSION_REQUESTED_KEY, false)) return;
        preferences.edit().putBoolean(NOTIFICATION_PERMISSION_REQUESTED_KEY, true).apply();
        requestPermissions(new String[] { android.Manifest.permission.POST_NOTIFICATIONS },
                NOTIFICATION_PERMISSION_REQUEST);
    }

    private int surfaceColor(boolean dark) {
        return dark ? Color.rgb(14, 16, 19) : Color.WHITE;
    }

    private void applySystemBarTheme(boolean dark) {
        int background = surfaceColor(dark);
        if (pageView != null) pageView.setBackgroundColor(background);
        if (webView != null) webView.setBackgroundColor(background);
        if (splashView != null) splashView.setBackgroundColor(background);

        boolean edgeToEdge = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R;
        getWindow().setStatusBarColor(edgeToEdge ? Color.TRANSPARENT : background);
        getWindow().setNavigationBarColor(edgeToEdge ? Color.TRANSPARENT : background);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // Some phones (e.g. Xiaomi on Android 16) have no controller until the view is attached.
            WindowInsetsController controller = getWindow().getDecorView().getWindowInsetsController();
            if (controller == null) controller = getWindow().getInsetsController();
            if (controller != null) {
                int lightBars = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                        | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                controller.setSystemBarsAppearance(dark ? 0 : lightBars, lightBars);
            }
        } else {
            int flags = 0;
            if (!dark) {
                flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
                }
            }
            getWindow().getDecorView().setSystemUiVisibility(flags);
        }
    }

    private void syncThemeFromPage(WebView view) {
        String script = "(() => {"
                + "const sync = () => window.MailOSAndroid.setDarkMode(document.documentElement.classList.contains('dark'));"
                + "sync();"
                + "if (!window.__mailOSThemeObserver) {"
                + "window.__mailOSThemeObserver = new MutationObserver(sync);"
                + "window.__mailOSThemeObserver.observe(document.documentElement,{attributes:true,attributeFilter:['class']});"
                + "}"
                + "})();";
        view.evaluateJavascript(script, null);
    }

    private final class ThemeBridge {
        @JavascriptInterface
        public void setDarkMode(boolean dark) {
            runOnUiThread(() -> {
                if (darkTheme == dark) return;
                darkTheme = dark;
                getPreferences(MODE_PRIVATE).edit().putBoolean(DARK_THEME_KEY, dark).apply();
                applySystemBarTheme(dark);
            });
        }
    }

    private boolean isSameOrigin(Uri target) {
        if (target == null || serverOrigin == null || target.getScheme() == null || target.getHost() == null) return false;
        Uri origin = Uri.parse(serverOrigin);
        return origin.getScheme().equalsIgnoreCase(target.getScheme())
                && origin.getHost().equalsIgnoreCase(target.getHost())
                && origin.getPort() == target.getPort();
    }

    private void openExternal(Uri target) {
        String scheme = target.getScheme();
        if (scheme == null) return;
        if (!scheme.equalsIgnoreCase("https") && !scheme.equalsIgnoreCase("mailto")
                && !scheme.equalsIgnoreCase("tel")) return;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, target));
        } catch (ActivityNotFoundException ignored) {
            Toast.makeText(this, "No app can open this link", Toast.LENGTH_SHORT).show();
        }
    }

    private void showServerSetup(String existingValue) {
        LinearLayout form = new LinearLayout(this);
        form.setOrientation(LinearLayout.VERTICAL);
        form.setPadding(dp(28), dp(44), dp(28), dp(28));
        form.setBackgroundColor(surfaceColor(true));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            form.setOnApplyWindowInsetsListener((view, insets) -> {
                android.graphics.Insets safeInsets = insets.getInsets(
                        WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                android.graphics.Insets ime = insets.getInsets(WindowInsets.Type.ime());
                view.setPadding(dp(28) + safeInsets.left, dp(44) + safeInsets.top,
                        dp(28) + safeInsets.right, dp(28) + Math.max(safeInsets.bottom, ime.bottom));
                return WindowInsets.CONSUMED;
            });
        }

        ImageView logo = new ImageView(this);
        logo.setImageResource(R.drawable.mailos_airplane);
        logo.setContentDescription("MailOS paper-plane icon");
        logo.setScaleType(ImageView.ScaleType.FIT_CENTER);
        LinearLayout.LayoutParams logoParams = new LinearLayout.LayoutParams(dp(64), dp(64));
        logoParams.bottomMargin = dp(16);
        form.addView(logo, logoParams);

        TextView title = new TextView(this);
        title.setText("MailOS");
        title.setTextColor(Color.rgb(232, 234, 237));
        title.setTextSize(32);
        title.setTypeface(null, android.graphics.Typeface.BOLD);
        form.addView(title);

        TextView description = new TextView(this);
        description.setText("Connect to your MailOS server. The app will open your inbox directly next time.");
        description.setTextColor(Color.rgb(154, 160, 166));
        description.setTextSize(16);
        LinearLayout.LayoutParams descriptionParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        descriptionParams.topMargin = dp(12);
        form.addView(description, descriptionParams);

        EditText serverInput = new EditText(this);
        serverInput.setSingleLine(true);
        serverInput.setInputType(android.text.InputType.TYPE_CLASS_TEXT
                | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        serverInput.setHint("https://mail.yourcompany.com");
        serverInput.setTextColor(Color.rgb(232, 234, 237));
        serverInput.setHintTextColor(Color.rgb(95, 99, 104));
        serverInput.setText(existingValue == null ? "" : existingValue);
        serverInput.setSelectAllOnFocus(true);
        LinearLayout.LayoutParams inputParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        inputParams.topMargin = dp(28);
        form.addView(serverInput, inputParams);

        Button connect = new Button(this);
        connect.setText("Open inbox");
        connect.setTextColor(Color.rgb(4, 32, 29));
        connect.setBackgroundTintList(android.content.res.ColorStateList.valueOf(Color.rgb(20, 184, 166)));
        LinearLayout.LayoutParams buttonParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        buttonParams.topMargin = dp(18);
        form.addView(connect, buttonParams);
        connect.setOnClickListener(view -> {
            String normalized = normalizeServer(serverInput.getText().toString());
            if (normalized == null) {
                serverInput.setError("Enter your MailOS HTTPS address");
                return;
            }
            serverOrigin = normalized;
            getPreferences(MODE_PRIVATE).edit().putString(SERVER_KEY, serverOrigin).apply();
            MailCheckJob.schedule(this, serverOrigin);
            openMailOS(serverOrigin + "/inbox");
        });

        TextView privacy = new TextView(this);
        privacy.setText("Your server address is saved on this device. Use HTTPS for a secure connection.");
        privacy.setTextColor(Color.rgb(128, 134, 139));
        privacy.setTextSize(13);
        LinearLayout.LayoutParams privacyParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        privacyParams.topMargin = dp(20);
        form.addView(privacy, privacyParams);
        setContentView(form);
        applySystemBarTheme(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) form.requestApplyInsets();
        form.setAlpha(0f);
        form.setTranslationY(dp(8));
        form.animate().alpha(1f).translationY(0f).setDuration(220)
                .setInterpolator(new DecelerateInterpolator()).start();
    }

    private String normalizeServer(String raw) {
        String value = raw == null ? "" : raw.trim();
        if (value.isEmpty()) return null;
        if (!value.contains("://")) value = "https://" + value;
        Uri uri = Uri.parse(value);
        String scheme = uri.getScheme();
        String host = uri.getHost();
        if (scheme == null || host == null || uri.getUserInfo() != null
                || uri.getQuery() != null || uri.getFragment() != null
                || (uri.getPath() != null && !uri.getPath().isEmpty() && !uri.getPath().equals("/"))) {
            return null;
        }
        if (!scheme.equalsIgnoreCase("https")) return null;
        StringBuilder origin = new StringBuilder(scheme.toLowerCase()).append("://").append(host);
        if (uri.getPort() != -1) origin.append(':').append(uri.getPort());
        return origin.toString();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    @Override
    protected void onResume() {
        super.onResume();
        MailCheckJob.appVisible = true;
        MailCheckJob.markSeenNow(this);
        if (webView != null) webView.onResume();
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) manager.cancelAll();
    }

    @Override
    protected void onPause() {
        MailCheckJob.appVisible = false;
        if (webView != null) webView.onPause();
        // Save the sign-in to disk now, so closing the app (or Android closing it) never signs you out.
        CookieManager.getInstance().flush();
        super.onPause();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != FILE_PICKER_REQUEST || fileChooserCallback == null) return;
        Uri[] results = resultCode == RESULT_OK && data != null
                ? WebChromeClient.FileChooserParams.parseResult(resultCode, data) : null;
        fileChooserCallback.onReceiveValue(results);
        fileChooserCallback = null;
    }

    @Override
    public void onBackPressed() {
        handleBackNavigation();
    }

    /**
     * Back first closes whatever is open on top in MailOS (composer, menu, dialog, side menu);
     * only when nothing is open does it go back a page or offer to exit.
     */
    private void handleBackNavigation() {
        if (webView == null) {
            finish();
            return;
        }
        webView.evaluateJavascript("(function(){try{return !!(window.__mailosBack&&window.__mailosBack());}catch(e){return false;}})()",
                value -> {
                    if (!"true".equals(value)) navigateBack();
                });
    }

    private void navigateBack() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        if (webView != null) {
            long now = SystemClock.elapsedRealtime();
            if (now - lastBackPressedAt < BACK_PRESS_EXIT_WINDOW_MS) {
                finish();
                return;
            }
            lastBackPressedAt = now;
            Toast.makeText(this, "Press back again to exit MailOS", Toast.LENGTH_SHORT).show();
            return;
        }
        finish();
    }

    @Override
    protected void onDestroy() {
        if (Build.VERSION.SDK_INT >= 33 && backInvokedCallback != null) {
            getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(backInvokedCallback);
            backInvokedCallback = null;
        }
        if (fileChooserCallback != null) fileChooserCallback.onReceiveValue(null);
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
