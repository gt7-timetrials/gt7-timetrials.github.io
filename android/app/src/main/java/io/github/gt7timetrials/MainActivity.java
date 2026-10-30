package io.github.gt7timetrials;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Insets;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.widget.FrameLayout;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.OutputStream;
import java.net.Inet4Address;
import java.nio.charset.StandardCharsets;

/**
 * The website in a WebView, plus recording on the phone: the page calls window.GT7App (Bridge below) to record GT7's
 * telemetry over Wi-Fi, and gets progress back through window.GT7AppEvent. Links to other sites open in the browser.
 */
public class MainActivity extends Activity {
    static final String SITE = "https://gt7-timetrials.github.io/";
    private static final int PICK_FILE = 1;

    private WebView web;
    private Recorder recorder;
    private Thread recorderThread;
    private ValueCallback<Uri[]> fileCallback;
    private OnBackInvokedCallback back; // Android 13+: Back goes back in the page while there's somewhere to go

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        boolean dark = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(dark ? 0xFF111317 : 0xFFF5F6F8); // the site's background colour
        web.setBackgroundColor(dark ? 0xFF111317 : 0xFFF5F6F8);
        root.addView(web);
        setContentView(root);
        // Android 15 draws the app behind the status and navigation bars: keep the page clear of them
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                Insets b = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                v.setPadding(b.left, b.top, b.right, b.bottom);
            } else {
                v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                        insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            }
            return insets;
        });

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        web.addJavascriptInterface(new Bridge(), "GT7App");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if ("gt7-timetrials.github.io".equals(url.getHost())) return false;
                openOutside(url);
                return true;
            }

            @Override
            public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) {
                updateBack();
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                // any file type: phones label CSV files inconsistently (text/csv, text/comma-separated-values,
                // application/octet-stream...), so filtering on the page's ".csv,text/csv" greys them out.
                // The page checks the file itself.
                Intent pick = new Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
                try {
                    startActivityForResult(Intent.createChooser(pick, "Choose a recording (.csv)"), PICK_FILE);
                } catch (ActivityNotFoundException e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }
        });
        web.setDownloadListener((url, userAgent, disposition, mime, length) -> openOutside(Uri.parse(url)));
        if (state != null) web.restoreState(state);
        else web.loadUrl(SITE);
    }

    private void openOutside(Uri url) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, url));
        } catch (ActivityNotFoundException ignored) {
            // no browser: nothing to do
        }
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        if (request == PICK_FILE && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
            fileCallback = null;
        }
        super.onActivityResult(request, result, data);
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    /** Android 13+: catch Back only while the page has history, so otherwise Back leaves the app as usual. */
    private void updateBack() {
        if (Build.VERSION.SDK_INT < 33) return;
        OnBackInvokedDispatcher d = getOnBackInvokedDispatcher();
        if (web.canGoBack() && back == null) {
            back = () -> web.goBack();
            d.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, back);
        } else if (!web.canGoBack() && back != null) {
            d.unregisterOnBackInvokedCallback(back);
            back = null;
        }
    }

    @Override
    public void onBackPressed() { // Android 12 and older
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (recorder != null) recorder.stop();
        web.destroy();
        super.onDestroy();
    }

    private void keepScreenOn(boolean on) {
        runOnUiThread(() -> {
            if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        });
    }

    /** The phone's Wi-Fi (or Ethernet) network, so the search goes there even if mobile data or a VPN is on. */
    private Network homeNetwork() {
        ConnectivityManager cm = getSystemService(ConnectivityManager.class);
        for (Network n : cm.getAllNetworks()) {
            NetworkCapabilities c = cm.getNetworkCapabilities(n);
            if (c != null && (c.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) || c.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET))) return n;
        }
        return null;
    }

    private String ipv4(Network n) {
        LinkProperties lp = n == null ? null : getSystemService(ConnectivityManager.class).getLinkProperties(n);
        if (lp == null) return null;
        for (LinkAddress a : lp.getLinkAddresses()) if (a.getAddress() instanceof Inet4Address) return a.getAddress().getHostAddress();
        return null;
    }

    /** What the page can call, as window.GT7App. */
    private class Bridge {
        @JavascriptInterface
        public String version() {
            try {
                return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            } catch (Exception e) {
                return "";
            }
        }

        /** The website before typed-in addresses: search the whole network. */
        @JavascriptInterface
        public void start() {
            start("");
        }

        /**
         * Find the PlayStation (at the address given, or anywhere on the Wi-Fi network if it's "") and record until
         * stop(). Events go to window.GT7AppEvent.
         */
        @JavascriptInterface
        public synchronized void start(String ip) {
            stopRecorder(); // the old one must let go of the port first
            Network net = homeNetwork();
            Recorder[] self = new Recorder[1];
            self[0] = new Recorder(json -> {
                Recorder r = self[0];
                if (json.contains("\"stopped\"") && recorder == r) keepScreenOn(false);
                runOnUiThread(() -> web.evaluateJavascript("window.GT7AppEvent && GT7AppEvent(" + json + ")", null));
            }, ip, ipv4(net), sock -> {
                if (net != null) net.bindSocket(sock);
            });
            recorder = self[0];
            keepScreenOn(true);
            recorderThread = new Thread(recorder, "recorder");
            recorderThread.start();
        }

        private void stopRecorder() {
            if (recorder != null) recorder.stop();
            if (recorderThread != null) {
                try {
                    recorderThread.join(2000);
                } catch (InterruptedException ignored) {
                    Thread.currentThread().interrupt();
                }
            }
        }

        @JavascriptInterface
        public synchronized void stop() {
            if (recorder != null) recorder.stop();
            keepScreenOn(false);
        }

        /** Everything recorded since start(), as a telemetry.py CSV. */
        @JavascriptInterface
        public synchronized String csv() {
            return recorder == null ? "" : recorder.csv();
        }

        /** Save a recording to Downloads. Returns the file name, or "" if it couldn't be saved. */
        @JavascriptInterface
        public String save(String csv, String name) {
            ContentValues v = new ContentValues();
            v.put(MediaStore.Downloads.DISPLAY_NAME, name);
            v.put(MediaStore.Downloads.MIME_TYPE, "text/csv");
            v.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
            try {
                Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                if (uri == null) return "";
                try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                    out.write(csv.getBytes(StandardCharsets.UTF_8));
                }
                return name;
            } catch (Exception e) {
                return "";
            }
        }
    }
}
