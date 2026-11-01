package io.github.gt7timetrials;

import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioTrack;

/**
 * The cue sounds, made once as short tones and played through Android's low-latency audio, mixed over whatever else
 * is playing. Brake: low ticks and a low BEEP; lift: high ticks and a middle BEEP; gas: a rising chirp; chicane pip:
 * short and high. At half volume with soft edges, so Bluetooth's compression doesn't distort them; while cues are on,
 * silence plays in the background so Bluetooth headphones don't doze off between cues (which delays or clips the
 * next one).
 */
final class CueSounds implements Cues.Sound {
    private static final int RATE = 48000;
    // per sound (Cues.TICK_BRAKE, BRAKE, LIFT, GAS, PIP, TICK_LIFT): pitch (Hz) at the start and the end, length (ms)
    private static final int[][] TONES = {{520, 520, 50}, {440, 440, 260}, {880, 880, 220}, {900, 1700, 160},
            {2000, 2000, 40}, {1400, 1400, 35}};
    private final AudioTrack[] tracks = new AudioTrack[TONES.length];
    private final AudioAttributes attrs;
    private final AudioFormat format;
    private AudioTrack silence;

    CueSounds() {
        attrs = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_GAME)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();
        format = new AudioFormat.Builder()
                .setSampleRate(RATE)
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                .build();
        for (int i = 0; i < TONES.length; i++) tracks[i] = track(tone(TONES[i][0], TONES[i][1], TONES[i][2]));
    }

    private AudioTrack track(short[] pcm) {
        AudioTrack t = new AudioTrack.Builder()
                .setAudioAttributes(attrs)
                .setAudioFormat(format)
                .setBufferSizeInBytes(pcm.length * 2)
                .setTransferMode(AudioTrack.MODE_STATIC)
                .setPerformanceMode(AudioTrack.PERFORMANCE_MODE_LOW_LATENCY)
                .build();
        t.write(pcm, 0, pcm.length);
        return t;
    }

    /** While cues or a calibration run: half a second of silence on a loop, to keep the audio output awake. */
    synchronized void keepAwake(boolean on) {
        try {
            if (on && silence == null) {
                short[] quiet = new short[RATE / 2];
                silence = track(quiet);
                silence.setLoopPoints(0, quiet.length, -1);
                silence.play();
            } else if (!on && silence != null) {
                silence.stop();
                silence.release();
                silence = null;
            }
        } catch (IllegalStateException | UnsupportedOperationException ignored) {
            silence = null; // the audio system said no: cues still play, just without this
        }
    }

    private static short[] tone(int fromHz, int toHz, int ms) {
        int n = RATE * ms / 1000, fade = RATE * 10 / 1000; // 10 ms in and out, so it doesn't click
        short[] pcm = new short[n];
        double phase = 0;
        for (int k = 0; k < n; k++) {
            double env = Math.min(1, Math.min(k, n - 1 - k) / (double) fade);
            phase += 2 * Math.PI * (fromHz + (toHz - fromHz) * k / (double) n) / RATE;
            pcm[k] = (short) (0.5 * env * Short.MAX_VALUE * Math.sin(phase));
        }
        return pcm;
    }

    @Override
    public synchronized void play(int sound) {
        AudioTrack t = tracks[sound];
        if (t == null) return;
        try {
            if (t.getPlayState() != AudioTrack.PLAYSTATE_STOPPED) t.stop();
            t.reloadStaticData();
            t.play();
        } catch (IllegalStateException ignored) {
            // released, or the audio system is busy: skip this one
        }
    }

    synchronized void release() {
        keepAwake(false);
        for (int i = 0; i < tracks.length; i++) {
            if (tracks[i] != null) tracks[i].release();
            tracks[i] = null;
        }
    }
}
