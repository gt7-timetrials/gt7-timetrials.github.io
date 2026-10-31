package io.github.gt7timetrials;

/** Something fed every telemetry packet while recording: audio cues, or a calibration run. */
interface Feed {
    /** The time the packet arrived (s), the car's position (m), speed (km/h) and brake (%). */
    void update(double t, double x, double z, double speedKmh, double brake);
}
