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

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.OutputStream;
import java.net.Inet4Address;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

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
    private CueStore cueStore;
    private CueSounds sounds;
    private OnBackInvokedCallback back; // Android 13+: Back goes back in the page while there's somewhere to go

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        cueStore = new CueStore(this);
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
        RecorderService.stop(this);
        releaseSounds();
        web.destroy();
        super.onDestroy();
    }

    /** While recording: the screen stays on, and the app keeps running if the phone is locked or put aside. */
    private void recording(boolean on) {
        if (on) RecorderService.start(this);
        else RecorderService.stop(this);
        runOnUiThread(() -> {
            if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        });
    }

    private void toPage(String json) {
        runOnUiThread(() -> web.evaluateJavascript("window.GT7AppEvent && GT7AppEvent(" + json + ")", null));
    }

    private synchronized CueSounds sounds() {
        if (sounds == null) sounds = new CueSounds();
        return sounds;
    }

    private synchronized void releaseSounds() {
        if (sounds != null) sounds.release();
        sounds = null;
    }

    /** Audio cues for a recording, from the page's cue points (Coach.cuePoints), or null if they can't be set up. */
    private Cues cues(String json) {
        try {
            JSONObject c = new JSONObject(json), out = cueStore.output();
            JSONArray xs = c.getJSONArray("x"), zs = c.getJSONArray("z"), ps = c.getJSONArray("cues");
            double[] x = new double[xs.length()], z = new double[zs.length()];
            for (int i = 0; i < x.length; i++) { x[i] = xs.getDouble(i); z[i] = zs.getDouble(i); }
            List<Cues.Point> points = new ArrayList<>();
            for (int i = 0; i < ps.length(); i++) {
                JSONObject p = ps.getJSONObject(i);
                String kind = p.getString("kind");
                points.add(new Cues.Point(p.getDouble("s"), p.getDouble("t"), kind.equals("brake") ? Cues.KIND_BRAKE
                        : kind.equals("lift") ? Cues.KIND_LIFT : Cues.KIND_GAS));
            }
            Cues.Settings set = cueStore.settings(out);
            String name = out.getString("name");
            toPage(cueEvent(name, set.delay, 0, set.calibrated, false));
            return new Cues(x, z, c.getDouble("step"), c.getBoolean("loop"), points, set, sounds(), (delay, presses, done) -> {
                cueStore.calibration(out, delay, done);
                toPage(cueEvent(name, delay, presses, done, true));
            });
        } catch (JSONException | RuntimeException e) {
            return null;
        }
    }

    private static String cueEvent(String output, double delay, int presses, boolean calibrated, boolean update) {
        return String.format(Locale.ROOT, "{\"type\":\"cues\",\"output\":%s,\"delay\":%.3f,\"presses\":%d,\"calibrated\":%b,\"update\":%b}",
                JSONObject.quote(output), delay, presses, calibrated, update);
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
            startWithCues(ip, "");
        }

        /** Like start(ip), with audio cues from the page's cue points (JSON), or none if it's "". */
        @JavascriptInterface
        public synchronized void startWithCues(String ip, String cuePoints) {
            stopRecorder(); // the old one must let go of the port first
            Network net = homeNetwork();
            Recorder[] self = new Recorder[1];
            self[0] = new Recorder(json -> {
                Recorder r = self[0];
                if (json.contains("\"stopped\"") && recorder == r) recording(false);
                runOnUiThread(() -> web.evaluateJavascript("window.GT7AppEvent && GT7AppEvent(" + json + ")", null));
            }, ip, ipv4(net), sock -> {
                if (net != null) net.bindSocket(sock);
            });
            recorder = self[0];
            if (cuePoints != null && !cuePoints.isEmpty()) recorder.cues = cues(cuePoints);
            recording(true);
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
            recording(false);
        }

        /** The Audio cues tab: settings, whether cues are on, and each audio output's delay (JSON). */
        @JavascriptInterface
        public String cueState() {
            return cueStore.state();
        }

        /** Save a change from the Audio cues tab (see CueStore.save). */
        @JavascriptInterface
        public void saveCues(String change) {
            cueStore.save(change);
        }

        /** Play a countdown through the current output: tick, tick, BEEP. */
        @JavascriptInterface
        public void testSound() {
            CueSounds s = sounds();
            new Thread(() -> {
                try {
                    s.play(Cues.TICK);
                    Thread.sleep(500);
                    s.play(Cues.TICK);
                    Thread.sleep(500);
                    s.play(Cues.BRAKE);
                } catch (InterruptedException ignored) {
                    Thread.currentThread().interrupt();
                }
            }, "test sound").start();
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
