package io.github.gt7timetrials;

import android.content.Context;
import android.content.SharedPreferences;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.Iterator;

/**
 * What the app saves on the phone, all for audio cues: the settings on the Audio cues tab, whether the checkbox is
 * ticked, and the calibrated delay for each audio output (phone speaker, wired headphones, each Bluetooth device).
 */
final class CueStore {
    // starting delays (s) for an output that hasn't been calibrated yet, per type of output
    static final double START_SPEAKER = 0.10, START_WIRED = 0.08, START_BLUETOOTH = 0.25;

    private final Context context;
    private final SharedPreferences prefs;

    CueStore(Context context) {
        this.context = context;
        prefs = context.getSharedPreferences("cues", Context.MODE_PRIVATE);
    }

    /** The audio output sounds go to now: { key, name, type }. */
    JSONObject output() {
        AudioManager am = context.getSystemService(AudioManager.class);
        String key = "speaker", name = "Phone speaker", type = "speaker";
        for (AudioDeviceInfo d : am.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) {
            int t = d.getType();
            boolean bt = t == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP || t == AudioDeviceInfo.TYPE_BLE_HEADSET
                    || t == AudioDeviceInfo.TYPE_BLE_SPEAKER || t == AudioDeviceInfo.TYPE_HEARING_AID;
            boolean wired = t == AudioDeviceInfo.TYPE_WIRED_HEADSET || t == AudioDeviceInfo.TYPE_WIRED_HEADPHONES
                    || t == AudioDeviceInfo.TYPE_USB_HEADSET;
            if (bt) { // Bluetooth wins: when it's connected, that's where sound goes
                String product = d.getProductName() == null ? "" : d.getProductName().toString().trim();
                key = "bt:" + product;
                name = product.isEmpty() ? "Bluetooth" : product;
                type = "bluetooth";
                break;
            }
            if (wired && type.equals("speaker")) {
                key = "wired";
                name = "Wired headphones";
                type = "wired";
            }
        }
        try {
            return new JSONObject().put("key", key).put("name", name).put("type", type);
        } catch (JSONException e) {
            throw new IllegalStateException(e);
        }
    }

    private static double start(String type) {
        return type.equals("bluetooth") ? START_BLUETOOTH : type.equals("wired") ? START_WIRED : START_SPEAKER;
    }

    private JSONObject json(String name) {
        try {
            return new JSONObject(prefs.getString(name, "{}"));
        } catch (JSONException e) {
            return new JSONObject();
        }
    }

    /** Everything the Audio cues tab shows. */
    synchronized String state() {
        try {
            JSONObject out = output(), outputs = json("outputs"), current;
            String key = out.getString("key");
            if (!outputs.has(key)) { // a new output: it starts from the usual delay for its type
                outputs.put(key, new JSONObject().put("name", out.getString("name")).put("type", out.getString("type"))
                        .put("delay", start(out.getString("type"))).put("calibrated", false));
                prefs.edit().putString("outputs", outputs.toString()).apply();
            }
            JSONArray rows = new JSONArray();
            for (Iterator<String> it = outputs.keys(); it.hasNext(); ) {
                String k = it.next();
                JSONObject o = outputs.getJSONObject(k);
                rows.put(new JSONObject(o.toString()).put("key", k).put("current", k.equals(key))
                        .put("start", start(o.optString("type", "speaker"))));
            }
            current = outputs.getJSONObject(key);
            return new JSONObject().put("settings", json("settings")).put("enabled", prefs.getBoolean("enabled", false))
                    .put("outputs", rows).put("current", new JSONObject(current.toString()).put("key", key)).toString();
        } catch (JSONException e) {
            return "{}";
        }
    }

    /**
     * Changes from the page: { settings?, enabled?, delay?: {key, delay}, reset?: key }. Reset sets the output back to
     * its starting delay, so it calibrates again on the next drive.
     */
    synchronized void save(String change) {
        try {
            JSONObject c = new JSONObject(change);
            SharedPreferences.Editor e = prefs.edit();
            if (c.has("settings")) e.putString("settings", c.getJSONObject("settings").toString());
            if (c.has("enabled")) e.putBoolean("enabled", c.getBoolean("enabled"));
            JSONObject outputs = json("outputs");
            if (c.has("delay")) {
                JSONObject d = c.getJSONObject("delay");
                JSONObject o = outputs.optJSONObject(d.getString("key"));
                if (o != null) o.put("delay", Math.max(0, Math.min(0.6, d.getDouble("delay"))));
            }
            if (c.has("reset")) {
                JSONObject o = outputs.optJSONObject(c.getString("reset"));
                if (o != null) o.put("delay", start(o.optString("type", "speaker"))).put("calibrated", false);
            }
            e.putString("outputs", outputs.toString()).apply();
        } catch (JSONException ignored) {
            // a malformed change: keep what's saved
        }
    }

    /** The settings and the current output's delay, for a recording with cues. */
    synchronized Cues.Settings settings(JSONObject output) throws JSONException {
        JSONObject s = json("settings"), o = new JSONObject(state()).getJSONObject("current");
        Cues.Settings set = new Cues.Settings();
        set.ticks = Math.max(0, Math.min(3, s.optInt("ticks", set.ticks)));
        set.spacing = Math.max(0.3, Math.min(1.0, s.optDouble("spacing", set.spacing)));
        set.lift = s.optBoolean("lift", set.lift);
        set.gas = s.optBoolean("gas", set.gas);
        set.chicane = s.optBoolean("chicane", set.chicane);
        set.brakeEarly = Math.max(0, Math.min(1.0, s.optDouble("brakeEarly", set.brakeEarly)));
        set.gasAdjust = Math.max(-0.5, Math.min(0.5, s.optDouble("gasAdjust", set.gasAdjust)));
        set.delay = o.optDouble("delay", start(output.getString("type")));
        return set;
    }

    /** Whether the output has been calibrated (otherwise it uses the starting value for its type). */
    synchronized boolean calibrated(JSONObject output) {
        try {
            JSONObject o = json("outputs").optJSONObject(output.getString("key"));
            return o != null && o.optBoolean("calibrated", false);
        } catch (JSONException e) {
            return false;
        }
    }

    /** A calibration result for an output. */
    synchronized void calibration(JSONObject output, double delay, boolean done) {
        try {
            JSONObject outputs = json("outputs");
            String key = output.getString("key");
            JSONObject o = outputs.optJSONObject(key);
            if (o == null) o = new JSONObject().put("name", output.getString("name")).put("type", output.getString("type"));
            o.put("delay", delay).put("calibrated", done);
            outputs.put(key, o);
            prefs.edit().putString("outputs", outputs.toString()).apply();
        } catch (JSONException ignored) {
            // nothing sensible to do: the next drive calibrates again
        }
    }
}
