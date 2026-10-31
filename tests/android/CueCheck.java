package io.github.gt7timetrials;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Replays a recording through the audio cue engine as if it were live, or runs a calibration, for tests/test_gt7tt.py.
 *
 *   CueCheck <cues.txt> <recording.csv> timing <delay>
 *       prints "sound <name> <time> <seconds before the car reached the point>" for every sound
 *   CueCheck calibrate <true delay> [missed round] [wild round]
 *       a player sitting in the car who presses the brake <true delay> after each BEEP plays (give or take 0.03 s),
 *       except that they miss one round and press well off in another; prints "round ..." and "done <delay> <presses> <ok>"
 *
 * cues.txt (from Coach.cuePoints): "loop step", then the x values, then the z values, then "s t kind" per point.
 */
public class CueCheck {
    static final String[] NAMES = {"tick", "brake", "lift", "gas", "pip", "lift tick"};

    public static void main(String[] args) throws IOException {
        if (args[0].equals("calibrate")) {
            calibrate(Double.parseDouble(args[1]), args.length > 2 ? Integer.parseInt(args[2]) : -1,
                    args.length > 3 ? Integer.parseInt(args[3]) : -1);
            return;
        }
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

        List<double[]> played = new ArrayList<>(); // time, sound, position, cue position
        double[] now = {0};
        Cues[] cues = new Cues[1];
        cues[0] = new Cues(x, z, step, loop, points, set, sound -> played.add(new double[]{now[0], sound, cues[0].position()}));

        List<double[]> track = new ArrayList<>(); // time, position: to find when the car reached each point
        for (int i = 1; i < rows.size(); i++) {
            String[] r = rows.get(i).split(",", -1);
            double t = Double.parseDouble(r[ct]);
            now[0] = t;
            cues[0].update(t, Double.parseDouble(r[cx]), Double.parseDouble(r[cz]), Double.parseDouble(r[cv]),
                    Double.parseDouble(r[cb]));
            track.add(new double[]{t, cues[0].position()});
        }
        // for each brake, lift and gas sound: how long before the car reached the next cue point it played
        for (double[] p : played) {
            int sound = (int) p[1];
            if (sound == Cues.TICK_BRAKE || sound == Cues.TICK_LIFT || sound == Cues.PIP) continue;
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

    static void calibrate(double trueDelay, int missed, int wild) {
        java.util.Random rng = new java.util.Random(7);
        double[] now = {0}, press = {Double.NaN};
        int[] beeps = {0};
        boolean[] over = {false};
        Calibrator cal = new Calibrator(sound -> {
            if (sound != Cues.BRAKE) return;
            int round = beeps[0]++;
            if (round == missed) return;
            press[0] = now[0] + (round == wild ? trueDelay + 0.4 : trueDelay + (rng.nextDouble() - 0.5) * 0.06);
        }, new Calibrator.Listener() {
            public void round(int round, int of, boolean pressed) {
                System.out.println("round " + round + " " + of + " " + pressed);
            }

            public void done(double delay, int presses, boolean ok) {
                System.out.println(String.format(Locale.ROOT, "done %.3f %d %b", delay, presses, ok));
                over[0] = true;
            }
        });
        for (int i = 0; i < 60 * 40 && !over[0]; i++) { // 60 packets a second, standing still
            now[0] = 100 + i / 60.0;
            boolean down = !Double.isNaN(press[0]) && now[0] >= press[0] && now[0] < press[0] + 0.5;
            cal.update(now[0], 0, 0, 0, down ? 80 : 0);
        }
    }

    static double[] nums(String line) {
        String[] p = line.trim().split(" ");
        double[] out = new double[p.length];
        for (int i = 0; i < p.length; i++) out[i] = Double.parseDouble(p[i]);
        return out;
    }
}
