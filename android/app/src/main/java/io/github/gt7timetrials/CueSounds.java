package io.github.gt7timetrials;

import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioTrack;

/**
 * The cue sounds, made once as short tones and played through Android's low-latency audio, mixed over whatever else
 * is playing. Brake: low ticks and a low BEEP; lift: high ticks and a middle BEEP; gas: a rising chirp; chicane pip:
 * short and high.
 */
final class CueSounds implements Cues.Sound {
    private static final int RATE = 48000;
    // per sound (Cues.TICK_BRAKE, BRAKE, LIFT, GAS, PIP, TICK_LIFT): pitch (Hz) at the start and the end, length (ms)
    private static final int[][] TONES = {{520, 520, 50}, {440, 440, 260}, {880, 880, 220}, {900, 1700, 160},
            {2000, 2000, 40}, {1400, 1400, 35}};
    private final AudioTrack[] tracks = new AudioTrack[TONES.length];

    CueSounds() {
        AudioAttributes attrs = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_GAME)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();
        AudioFormat format = new AudioFormat.Builder()
                .setSampleRate(RATE)
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                .build();
        for (int i = 0; i < TONES.length; i++) {
            short[] pcm = tone(TONES[i][0], TONES[i][1], TONES[i][2]);
            tracks[i] = new AudioTrack.Builder()
                    .setAudioAttributes(attrs)
                    .setAudioFormat(format)
                    .setBufferSizeInBytes(pcm.length * 2)
                    .setTransferMode(AudioTrack.MODE_STATIC)
                    .setPerformanceMode(AudioTrack.PERFORMANCE_MODE_LOW_LATENCY)
                    .build();
            tracks[i].write(pcm, 0, pcm.length);
        }
    }

    private static short[] tone(int fromHz, int toHz, int ms) {
        int n = RATE * ms / 1000, fade = RATE * 5 / 1000; // 5 ms in and out, so it doesn't click
        short[] pcm = new short[n];
        double phase = 0;
        for (int k = 0; k < n; k++) {
            double env = Math.min(1, Math.min(k, n - 1 - k) / (double) fade);
            phase += 2 * Math.PI * (fromHz + (toHz - fromHz) * k / (double) n) / RATE;
            pcm[k] = (short) (0.8 * env * Short.MAX_VALUE * Math.sin(phase));
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
        for (int i = 0; i < tracks.length; i++) {
            if (tracks[i] != null) tracks[i].release();
            tracks[i] = null;
        }
    }
}
