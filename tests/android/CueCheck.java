package io.github.gt7timetrials;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Replays a recording through the audio cue engine as if it were live, for tests/test_gt7tt.py.
 *
 *   CueCheck <cues.txt> <recording.csv> timing <delay>
 *       prints "sound <name> <time> <seconds before the car reached the point>" for every sound
 *   CueCheck <cues.txt> <recording.csv> calibrate <start delay> <true delay>
 *       replaces the recording's braking with a simulated player who presses the brake <true delay> after each
 *       brake BEEP is played, and prints each calibration update: "calibration <delay> <presses> <done>"
 *
 * cues.txt (from Coach.cuePoints): "loop step", then the x values, then the z values, then "s t kind" per point.
 */
public class CueCheck {
    static final String[] NAMES = {"tick", "brake", "lift", "gas", "pip"};

    public static void main(String[] args) throws IOException {
        List<String> c = Files.readAllLines(Paths.get(args[0]));
        String[] head = c.get(0).split(" ");
        boolean loop = head[0].equals("true");
        double step = Double.parseDouble(head[1]);
        double[] x = nums(c.get(1)), z = nums(c.get(2));
        List<Cues.Point> points = new ArrayList<>();
        for (int i = 3; i < c.size(); i++) {
            String[] p = c.get(i).split(" ");
            int kind = p[2].equals("brake") ? Cues.KIND_BRAKE : p[2].equals("lift") ? Cues.KIND_LIFT : Cues.KIND_GAS;
            points.add(new Cues.Point(Double.parseDouble(p[0]), Double.parseDouble(p[1]), kind));
        }

        List<String> rows = Files.readAllLines(Paths.get(args[1]));
        List<String> cols = List.of(rows.get(0).split(","));
        int ct = cols.indexOf("time_s"), cx = cols.indexOf("x"), cz = cols.indexOf("z"), cv = cols.indexOf("speed_kmh"),
                cb = cols.indexOf("brake_pct");
        String mode = args[2];
        Cues.Settings set = new Cues.Settings();
        set.delay = Double.parseDouble(args[3]);
        set.calibrated = mode.equals("timing");
        double trueDelay = mode.equals("calibrate") ? Double.parseDouble(args[4]) : 0;

        List<double[]> played = new ArrayList<>(); // time, sound, position, cue position
        double[] now = {0};
        double[] pressAt = {Double.NaN};
        Cues[] cues = new Cues[1];
        cues[0] = new Cues(x, z, step, loop, points, set, sound -> {
            played.add(new double[]{now[0], sound, cues[0].position()});
            if (sound == Cues.BRAKE) pressAt[0] = now[0] + trueDelay;
        }, (delay, presses, done) ->
                System.out.println(String.format(Locale.ROOT, "calibration %.3f %d %b", delay, presses, done)));

        List<double[]> track = new ArrayList<>(); // time, position: to find when the car reached each point
        for (int i = 1; i < rows.size(); i++) {
            String[] r = rows.get(i).split(",", -1);
            double t = Double.parseDouble(r[ct]);
            now[0] = t;
            double brake = Double.parseDouble(r[cb]);
            if (mode.equals("calibrate")) brake = !Double.isNaN(pressAt[0]) && t >= pressAt[0] && t < pressAt[0] + 0.4 ? 100 : 0;
            cues[0].update(t, Double.parseDouble(r[cx]), Double.parseDouble(r[cz]), Double.parseDouble(r[cv]), brake);
            track.add(new double[]{t, cues[0].position()});
        }
        if (!mode.equals("timing")) return;
        // for each brake, lift and gas sound: how long before the car reached the next cue point it played
        for (double[] p : played) {
            int sound = (int) p[1];
            if (sound == Cues.TICK || sound == Cues.PIP) continue;
            double best = Double.NaN;
            int kind = sound == Cues.BRAKE ? Cues.KIND_BRAKE : sound == Cues.LIFT ? Cues.KIND_LIFT : Cues.KIND_GAS;
            for (Cues.Point q : points) {
                if (q.kind == kind && q.s >= p[2] - 3 && (Double.isNaN(best) || q.s < best)) best = q.s;
            }
            if (Double.isNaN(best)) continue;
            double reached = Double.NaN;
            for (int i = 1; i < track.size(); i++) {
                double[] a = track.get(i - 1), b = track.get(i);
                if (a[0] < p[0] || Double.isNaN(a[1]) || Double.isNaN(b[1])) continue;
                if (a[1] <= best && b[1] >= best) {
                    reached = a[0] + (best - a[1]) / Math.max(1e-9, b[1] - a[1]) * (b[0] - a[0]);
                    break;
                }
            }
            System.out.println(String.format(Locale.ROOT, "sound %s %.3f %.3f", NAMES[sound], p[0], reached - p[0]));
        }
    }

    static double[] nums(String line) {
        String[] p = line.trim().split(" ");
        double[] out = new double[p.length];
        for (int i = 0; i < p.length; i++) out[i] = Double.parseDouble(p[i]);
        return out;
    }
}
