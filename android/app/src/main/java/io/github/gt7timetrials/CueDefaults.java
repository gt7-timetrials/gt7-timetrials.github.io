package io.github.gt7timetrials;

/**
 * The starting delay for an audio output that hasn't been calibrated, per type of output (from the owner's own
 * calibrations), and moving outputs left on the first beta's starting values to these. Plain Java, so it can be
 * tested off the phone.
 */
final class CueDefaults {
    static final double SPEAKER = 0, WIRED = 0, BLUETOOTH = 0.33;
    // the first beta's starting values
    private static final double[] OLD = {0.10, 0.08, 0.25};

    private CueDefaults() {}

    /** The starting delay for "speaker", "wired" or "bluetooth". */
    static double start(String type) {
        return "bluetooth".equals(type) ? BLUETOOTH : "wired".equals(type) ? WIRED : SPEAKER;
    }

    /**
     * The delay an output should have now: an uncalibrated output still on one of the old starting values moves to
     * its type's new one; anything else (calibrated, or set by hand) stays as it is.
     */
    static double current(String type, double delay, boolean calibrated) {
        if (calibrated) return delay;
        for (double old : OLD) if (Math.abs(delay - old) < 1e-6) return start(type);
        return delay;
    }
}
