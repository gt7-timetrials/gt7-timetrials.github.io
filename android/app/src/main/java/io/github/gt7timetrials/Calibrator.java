package io.github.gt7timetrials;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Measures an audio output's delay: plays a brake countdown (tick, tick, BEEP) a few times, a few seconds apart, and
 * times when the player presses the brake on each BEEP, from the telemetry. The car can stand still: GT7 sends the
 * pedals all the same. The delay is the typical gap between playing the BEEP and the press: the sound's way to the
 * player's ears, the telemetry's way back, and the player's own timing, everything a cue has to allow for.
 * Plain Java, so it can be tested off the phone.
 */
final class Calibrator implements Feed {
    interface Listener {
        /** After each countdown: which one (1-based), how many, and whether a press was found for it. */
        void round(int round, int of, boolean pressed);

        /** At the end: the delay, how many presses it's based on, and whether they agreed well enough to use. */
        void done(double delay, int presses, boolean ok);
    }

    static final int ROUNDS = 6, NEEDED = 4;
    static final double FIRST = 2.0, EVERY = 3.0, SPACING = 0.5;
    static final double FIRM_BRAKE = 20, BEFORE = 0.3, AFTER = 0.8, AGREE = 0.12;

    private final Cues.Sound out;
    private final Listener listener;
    private double start = Double.NaN, lastBrake = 100; // a brake held from before doesn't count as a press
    private int played;                                  // sounds played so far (3 per round)
    private int judged;                                  // rounds whose press window has closed
    private final double[] beepAt = new double[ROUNDS];
    private final double[] pressAt = new double[ROUNDS];
    private boolean finished;

    Calibrator(Cues.Sound out, Listener listener) {
        this.out = out;
        this.listener = listener;
        java.util.Arrays.fill(pressAt, Double.NaN);
    }

    @Override
    public void update(double t, double x, double z, double speedKmh, double brake) {
        if (finished) return;
        if (Double.isNaN(start)) start = t;
        // the countdowns: round r's BEEP at start + FIRST + r * EVERY, with its ticks before it
        while (played < ROUNDS * 3) {
            int r = played / 3, k = played % 3;
            double when = start + FIRST + r * EVERY - (2 - k) * SPACING;
            if (t < when) break;
            out.play(k == 2 ? Cues.BRAKE : Cues.TICK_BRAKE);
            if (k == 2) beepAt[r] = t;
            played++;
        }
        // a press: the brake going firmly down, near a BEEP
        if (brake >= FIRM_BRAKE && lastBrake < FIRM_BRAKE) {
            for (int r = 0; r < ROUNDS; r++) {
                double due = start + FIRST + r * EVERY;
                if (Double.isNaN(pressAt[r]) && t >= due - BEFORE && t <= due + AFTER) pressAt[r] = t;
            }
        }
        lastBrake = brake;
        while (judged < ROUNDS && t > start + FIRST + judged * EVERY + AFTER) {
            listener.round(judged + 1, ROUNDS, !Double.isNaN(pressAt[judged]));
            judged++;
        }
        if (judged == ROUNDS) finish();
    }

    private void finish() {
        finished = true;
        List<Double> gaps = new ArrayList<>();
        for (int r = 0; r < ROUNDS; r++) if (!Double.isNaN(pressAt[r])) gaps.add(pressAt[r] - beepAt[r]);
        if (gaps.isEmpty()) {
            listener.done(0, 0, false);
            return;
        }
        List<Double> sorted = new ArrayList<>(gaps);
        Collections.sort(sorted);
        double median = sorted.get(sorted.size() / 2);
        double sum = 0;
        int n = 0;
        for (double g : gaps) {
            if (Math.abs(g - median) <= AGREE) { sum += g; n++; } // ignore a press that's well off the others
        }
        double delay = Math.max(0, Math.min(0.6, sum / n));
        listener.done(delay, n, n >= NEEDED);
    }
}
