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
 *   CueCheck <cues.txt> <recording.csv> timing <delay> [brake early]
 *       prints "sound <name> <time> <seconds before the car reached the point>" for every sound
 *   CueCheck <cues.txt> <recording.csv> edge <how> [p2p]
 *       the recording replayed with something unusual happening, with a delay of 0: prints "played <name> <time>"
 *       for every sound and "window <from> <to>" for when the unusual part happened (in the replay's time). <how>:
 *       none, offline (40 m off the line for 10 s), reverse (3 s backwards), restart (back to the start line after
 *       80 s), pause (no packets for 30 s). "p2p" treats the track as point to point instead of a loop.
 *   CueCheck defaults
 *       prints the starting delays and how outputs on old starting values move: "start <type> <delay>", "now ..."
 *   CueCheck calibrate <true delay> [missed round] [wild round]
 *       a player sitting in the car who presses the brake <true delay> after each BEEP plays (give or take 0.03 s),
 *       except that they miss one round and press well off in another; prints "round ..." and "done <delay> <presses> <ok> <spread>"
 *
 * cues.txt (from Coach.cuePoints): "loop step", then the x values, then the z values, then "s t kind" per point.
 */
public class CueCheck {
    static final String[] NAMES = {"tick", "brake", "lift", "gas", "pip", "lift tick"};

    public static void main(String[] args) throws IOException {
        if (args[0].equals("defaults")) {
            for (String type : new String[]{"speaker", "wired", "bluetooth"}) {
                System.out.println(String.format(Locale.ROOT, "start %s %.2f", type, CueDefaults.start(type)));
            }
            double[][] cases = {{0.10, 0}, {0.25, 0}, {0.08, 0}, {0.25, 1}, {0.17, 0}};
            String[] types = {"speaker", "bluetooth", "wired", "bluetooth", "speaker"};
            for (int i = 0; i < cases.length; i++) {
                System.out.println(String.format(Locale.ROOT, "now %s %.2f %b %.2f", types[i], cases[i][0], cases[i][1] > 0,
                        CueDefaults.current(types[i], cases[i][0], cases[i][1] > 0)));
            }
            return;
        }
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
        if (mode.equals("edge")) {
            edge(x, z, step, loop && !(args.length > 4 && args[4].equals("p2p")), points, rows, cols, args[3]);
            return;
        }
        Cues.Settings set = new Cues.Settings();
        set.delay = Double.parseDouble(args[3]);
        if (args.length > 4) set.brakeEarly = Double.parseDouble(args[4]);

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

    /** The recording with something unusual happening part way through; see the top of the file. */
    static void edge(double[] x, double[] z, double step, boolean loop, List<Cues.Point> points, List<String> rows,
                     List<String> cols, String how) {
        int ct = cols.indexOf("time_s"), cx = cols.indexOf("x"), cz = cols.indexOf("z"), cv = cols.indexOf("speed_kmh"),
                cb = cols.indexOf("brake_pct");
        List<double[]> pk = new ArrayList<>(); // time, x, z, speed, brake
        for (int i = 1; i < rows.size(); i++) {
            String[] r = rows.get(i).split(",", -1);
            pk.add(new double[]{Double.parseDouble(r[ct]), Double.parseDouble(r[cx]), Double.parseDouble(r[cz]),
                    Double.parseDouble(r[cv]), Double.parseDouble(r[cb])});
        }
        java.util.function.DoubleToIntFunction from = t -> {
            for (int i = 0; i < pk.size(); i++) if (pk.get(i)[0] >= t) return i;
            return pk.size() - 1;
        };
        List<double[]> feed = new ArrayList<>();
        double shift = 0, wa = Double.NaN, wb = Double.NaN;
        switch (how) {
            case "offline": { // 40 m to the side of the line from 50 s to 60 s
                for (double[] p : pk) {
                    double[] q = p.clone();
                    if (p[0] >= 50 && p[0] < 60) q[1] += 40;
                    feed.add(q);
                }
                wa = 50; wb = 60;
                break;
            }
            case "reverse": { // at 70 s, 3 s of driving backwards over the last stretch, then on again
                int r = from.applyAsInt(70);
                for (int i = 0; i < r; i++) feed.add(pk.get(i).clone());
                double t = pk.get(r)[0];
                for (int i = r; i > r - 180; i--) { double[] q = pk.get(i).clone(); q[0] = t += 1 / 60.0; q[3] = 15; feed.add(q); }
                wa = pk.get(r)[0]; wb = t;
                for (int i = r - 180; i < pk.size(); i++) { double[] q = pk.get(i).clone(); q[0] = t += 1 / 60.0; feed.add(q); }
                break;
            }
            case "restart": { // at 80 s, back to the start of the lap (a restart), and the whole lap again
                int r = from.applyAsInt(80), s0 = from.applyAsInt(7.7);
                for (int i = 0; i < r; i++) feed.add(pk.get(i).clone());
                double t = pk.get(r)[0];
                wa = t;
                for (int i = s0; i < pk.size(); i++) { double[] q = pk.get(i).clone(); q[0] = t += 1 / 60.0; feed.add(q); }
                wb = wa + 1;
                break;
            }
            case "pause": { // no packets for 30 s from 45 s (the game paused, or Wi-Fi dropped), then on as before
                for (double[] p : pk) { double[] q = p.clone(); if (p[0] >= 45) q[0] += 30; feed.add(q); }
                wa = 45; wb = 75;
                break;
            }
            default:
                for (double[] p : pk) feed.add(p.clone());
        }
        Cues.Settings set = new Cues.Settings();
        set.delay = 0;
        double[] now = {0};
        Cues cues = new Cues(x, z, step, loop, points, set,
                sound -> System.out.println(String.format(Locale.ROOT, "played %s %.3f", NAMES[sound].replace(' ', '_'), now[0])));
        if (!Double.isNaN(wa)) System.out.println(String.format(Locale.ROOT, "window %.3f %.3f", wa, wb));
        for (double[] p : feed) {
            now[0] = p[0];
            cues.update(p[0], p[1], p[2], p[3], p[4]);
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

            public void done(double delay, int presses, double spread, boolean ok) {
                System.out.println(String.format(Locale.ROOT, "done %.3f %d %b %.3f", delay, presses, ok, spread));
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
