package io.github.gt7timetrials;

import java.util.ArrayList;
import java.util.List;

/**
 * Audio cues while recording: a countdown to each point where the reference lap brakes or lifts, and a beep just
 * before it gets back on the throttle. Fed every telemetry packet; works out where the car is on the reference line,
 * predicts when it will reach each point from its distance, speed and acceleration, and plays each sound early by
 * the audio delay. It also learns that delay from when the player actually presses the brake (auto-calibration).
 * Plain Java (sound and saving go through interfaces), so it can be tested off the phone by replaying recordings.
 */
final class Cues {
    static final int TICK = 0, BRAKE = 1, LIFT = 2, GAS = 3, PIP = 4;
    static final int KIND_BRAKE = 0, KIND_LIFT = 1, KIND_GAS = 2;

    interface Sound {
        void play(int sound);
    }

    /** Calibration progress: the delay so far, how many presses it's based on, and whether it's settled. */
    interface Calibration {
        void update(double delay, int presses, boolean done);
    }

    static final class Settings {
        int ticks = 2;              // beeps before the brake or lift BEEP
        double spacing = 0.5;       // seconds between them
        boolean lift = true, gas = true, chicane = false;
        double brakeEarly = 0;      // the brake BEEP this many seconds before the reference's braking point
        double gasAdjust = 0;       // + = gas beep later
        double delay = 0.1;         // audio and data delay of this output (s): every sound plays this much early
        boolean calibrated = false; // false: learn the delay from the first brake presses
    }

    /** A point on the reference lap: distance along its line (m), the reference's time there (s), and its kind. */
    static final class Point {
        final double s, t;
        final int kind;

        Point(double s, double t, int kind) {
            this.s = s;
            this.t = t;
            this.kind = kind;
        }
    }

    /** One sound to play when the car is `lead` seconds from distance `s`. */
    private static final class Beep {
        final double s, lead;
        final int sound;
        boolean fired;

        Beep(double s, double lead, int sound) {
            this.s = s;
            this.lead = lead;
            this.sound = sound;
        }
    }

    static final double OFF_LINE_M = 20;     // further than this from the reference line: no cues
    static final double CALIBRATE_WINDOW = 0.6, CALIBRATED_WITHIN = 0.1, FIRM_BRAKE = 20, GAS_GAP = 0.3;
    static final int CALIBRATED_AFTER = 3;   // presses in a row within CALIBRATED_WITHIN
    private static final double LOOKAHEAD_M = 800;

    private final double[] x, z, s; // the reference line, every few metres, and the distance along it
    private final boolean loop;
    private final double length;
    private final Sound out;
    private final Calibration calibration;
    private final List<Beep> beeps = new ArrayList<>();
    private double delay;
    private boolean calibrated;

    // where the car is
    private int at = -1;                // nearest line point, or -1 when lost
    private double pos = Double.NaN;    // distance along the line
    private double lastX, lastZ;
    private boolean haveLast;
    private int backwards;
    // speed history (about 0.5 s) for the acceleration and how fast it's changing
    private final double[] histT = new double[40], histV = new double[40];
    private int hist;
    // calibration
    private final List<Double> implied = new ArrayList<>(), errors = new ArrayList<>();
    private double beepAt = Double.NaN, beepDelay;   // the last brake BEEP still waiting for a press
    private double lastPress = Double.NEGATIVE_INFINITY, lastBrake;

    Cues(double[] x, double[] z, double step, boolean loop, List<Point> points, Settings set, Sound out, Calibration calibration) {
        this.x = x;
        this.z = z;
        this.loop = loop;
        this.out = out;
        this.calibration = calibration;
        s = new double[x.length];
        for (int i = 0; i < x.length; i++) s[i] = i * step;
        length = (x.length - (loop ? 0 : 1)) * step;
        delay = set.delay;
        calibrated = set.calibrated;
        plan(points, set);
    }

    /** Which sounds to play where, with the overlap rules: no countdown inside another, gas gives way. */
    private void plan(List<Point> points, Settings set) {
        double window = Math.max(set.ticks * set.spacing, 0.3);
        double lastMain = Double.NEGATIVE_INFINITY;
        List<double[]> soundTimes = new ArrayList<>(); // reference times of brake and lift sounds
        for (Point p : points) {
            if (p.kind == KIND_GAS || (p.kind == KIND_LIFT && !set.lift)) continue;
            double early = p.kind == KIND_BRAKE ? set.brakeEarly : 0;
            double when = p.t - early;
            if (when - lastMain < window) { // inside the previous countdown: a chicane or a double brake
                if (set.chicane) {
                    beeps.add(new Beep(p.s, early, PIP));
                    soundTimes.add(new double[]{when});
                }
                continue;
            }
            lastMain = when;
            beeps.add(new Beep(p.s, early, p.kind == KIND_BRAKE ? BRAKE : LIFT));
            soundTimes.add(new double[]{when});
            for (int i = 1; i <= set.ticks; i++) {
                beeps.add(new Beep(p.s, early + i * set.spacing, TICK));
                soundTimes.add(new double[]{when - i * set.spacing});
            }
        }
        if (!set.gas) return;
        for (Point p : points) {
            if (p.kind != KIND_GAS) continue;
            double lead = Math.max(0, 0.5 - set.gasAdjust), when = p.t - lead;
            boolean clash = false;
            for (double[] t : soundTimes) if (Math.abs(t[0] - when) < GAS_GAP) clash = true;
            if (!clash) beeps.add(new Beep(p.s, lead, GAS));
        }
    }

    double delay() {
        return delay;
    }

    boolean calibrated() {
        return calibrated;
    }

    /** Where the car is along the reference line, or NaN when it isn't on it. */
    double position() {
        return pos;
    }

    /** One telemetry packet: the time it arrived (s), position (m), speed (km/h) and brake (%). */
    void update(double t, double px, double pz, double speedKmh, double brake) {
        double v = speedKmh / 3.6;
        hist++;
        histT[hist % histT.length] = t;
        histV[hist % histV.length] = v;
        calibrate(t, brake);

        double before = pos;
        locate(px, pz);
        if (Double.isNaN(pos)) return;
        double ds = Double.isNaN(before) ? 0 : pos - before;
        if (loop && ds < -length / 2) ds += length; // across the line: a new lap
        if (loop && ds > length / 2) ds -= length;
        backwards = ds < -0.05 ? backwards + 1 : 0;
        if (backwards > 10 || v < 3) return; // reversing, or stopped: no cues

        double a = acceleration(t, 0, 0.3);
        // for the gas beep: a quicker acceleration (0.2 s) and how fast it's changing (jerk, over the last 0.15 s)
        double aNow = acceleration(t, 0, 0.2), jerk = (aNow - acceleration(t, 0.15, 0.2)) / 0.15;
        for (Beep b : beeps) {
            double d = b.s - pos;
            if (loop && d < -length / 2) d += length;
            if (d < -30) b.fired = false; // well past it: ready for the next lap, or a restart
            if (b.fired || d < -3 || d > LOOKAHEAD_M) continue; // just past still counts: packets come every 1/60 s
            // the gas beep comes while braking and turning in, when the deceleration changes fast: allow for that too
            double due = (b.sound == GAS ? timeTo(d, v, aNow, jerk) : timeTo(d, v, a)) - b.lead - delay; // until it plays
            if (due > 0.008) continue; // later (a packet comes every 1/60 s)
            b.fired = true;
            if (due < -0.25) continue; // missed (just found the line again): better silent than late
            out.play(b.sound);
            if (b.sound == BRAKE && !calibrated) {
                beepAt = t;
                beepDelay = delay;
                if (lastPress >= t + delay - CALIBRATE_WINDOW) press(lastPress); // pressed already, on the ticks
            }
        }
    }

    /** Time to cover d metres at speed v (m/s) and acceleration a (m/s²). */
    static double timeTo(double d, double v, double a) {
        if (v < 0.5) return Double.POSITIVE_INFINITY;
        if (Math.abs(a) < 0.2) return d / v;
        double disc = v * v + 2 * a * d;
        if (disc < 0) return Double.POSITIVE_INFINITY; // slowing down: won't get there at this rate
        return (-v + Math.sqrt(disc)) / a;
    }

    /** Time to cover d metres from speed v, with acceleration a changing at `jerk` m/s³ (over at most 3 s). */
    static double timeTo(double d, double v, double a, double jerk) {
        double lo = 0, hi = 3;
        if (v < 0.5 || covered(hi, v, a, jerk) < d) return timeTo(d, v, a);
        for (int i = 0; i < 30; i++) {
            double m = (lo + hi) / 2;
            if (covered(m, v, a, jerk) < d) lo = m;
            else hi = m;
        }
        return hi;
    }

    private static double covered(double t, double v, double a, double jerk) {
        return v * t + a * t * t / 2 + jerk * t * t * t / 6;
    }

    /** The acceleration over `window` seconds, ending `ago` seconds before t. */
    private double acceleration(double t, double ago, double window) {
        double v1 = Double.NaN, t1 = 0;
        int n = Math.min(hist, histT.length - 1);
        for (int back = 0; back <= n; back++) {
            int i = (hist - back) % histT.length;
            if (Double.isNaN(v1)) {
                if (t - histT[i] >= ago) { v1 = histV[i]; t1 = histT[i]; }
            } else if (t1 - histT[i] >= window) {
                return Math.max(-15, Math.min(10, (v1 - histV[i]) / (t1 - histT[i])));
            }
        }
        return 0;
    }

    // --- where the car is on the reference line ---

    private int wrap(int i) {
        int n = x.length;
        return loop ? ((i % n) + n) % n : Math.max(0, Math.min(n - 1, i));
    }

    private void locate(double px, double pz) {
        int best = -1;
        double bestD = Double.POSITIVE_INFINITY;
        if (at >= 0) { // near where it was: tracks can cross themselves
            for (int k = at - 10; k <= at + 60; k++) {
                int i = wrap(k);
                double d = sq(x[i] - px) + sq(z[i] - pz);
                if (d < bestD) { bestD = d; best = i; }
            }
            if (Math.sqrt(bestD) > OFF_LINE_M) best = -1;
        }
        if (best < 0) { // lost: search everywhere, and only accept a point the car is driving along
            bestD = Double.POSITIVE_INFINITY;
            for (int i = 0; i < x.length; i++) {
                double d = sq(x[i] - px) + sq(z[i] - pz);
                if (d < bestD) { bestD = d; best = i; }
            }
            boolean heading = false;
            if (haveLast && Math.hypot(px - lastX, pz - lastZ) > 0.3) {
                int j = wrap(best + 1), h = j == best ? wrap(best - 1) : best;
                double lx = x[j] - x[h], lz = z[j] - z[h];
                heading = (px - lastX) * lx + (pz - lastZ) * lz > 0;
            }
            if (Math.sqrt(bestD) > OFF_LINE_M * 0.75 || !heading) best = -1;
        }
        lastX = px;
        lastZ = pz;
        haveLast = true;
        at = best;
        if (best < 0) {
            pos = Double.NaN;
            return;
        }
        // the exact spot: on the segment either side of the nearest point
        double along = s[best], dist = Math.sqrt(bestD);
        for (int a : new int[]{best - 1, best}) {
            if (!loop && (a < 0 || a + 1 >= x.length)) continue;
            int i = wrap(a), j = wrap(a + 1);
            double sx = x[j] - x[i], sz = z[j] - z[i], len2 = sx * sx + sz * sz;
            if (len2 == 0) continue;
            double f = Math.max(0, Math.min(1, ((px - x[i]) * sx + (pz - z[i]) * sz) / len2));
            double d = Math.hypot(x[i] + f * sx - px, z[i] + f * sz - pz);
            if (d < dist) {
                dist = d;
                along = s[i] + f * Math.sqrt(len2);
            }
        }
        pos = along;
    }

    private static double sq(double v) {
        return v * v;
    }

    // --- calibration: when did the player actually press the brake, compared with the BEEP? ---

    private void calibrate(double t, double brake) {
        if (brake >= FIRM_BRAKE && lastBrake < FIRM_BRAKE) {
            lastPress = t;
            if (!Double.isNaN(beepAt) && !calibrated) press(t);
        }
        lastBrake = brake;
        if (!Double.isNaN(beepAt) && t > beepAt + beepDelay + CALIBRATE_WINDOW) beepAt = Double.NaN; // no press: ignore
    }

    private void press(double t) {
        double intended = beepAt + beepDelay; // when the BEEP was meant to be heard
        double error = t - intended;
        beepAt = Double.NaN;
        if (Math.abs(error) > CALIBRATE_WINDOW) return; // missed it, or braking for another reason
        implied.add(t - (intended - beepDelay)); // the delay that would have made this press bang on
        errors.add(error);
        int n = implied.size();
        double sum = 0;
        for (int i = Math.max(0, n - 5); i < n; i++) sum += implied.get(i);
        delay = Math.max(0, Math.min(0.6, sum / Math.min(n, 5)));
        boolean done = n >= CALIBRATED_AFTER;
        for (int i = Math.max(0, n - CALIBRATED_AFTER); i < n; i++) if (Math.abs(errors.get(i)) > CALIBRATED_WITHIN) done = false;
        calibrated = done;
        if (calibration != null) calibration.update(delay, n, done);
    }
}
