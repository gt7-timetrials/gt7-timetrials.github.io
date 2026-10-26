package io.github.gt7timetrials;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

/**
 * GT7's telemetry packets: decryption and the fields the website uses. A port of tools/telemetry.py; the CSV it
 * writes has the same columns, so the website reads a phone recording exactly like one from the computer recorder.
 */
final class Telemetry {
    static final int SEND_PORT = 33739, RECV_PORT = 33740;
    static final int MAGIC = 0x47375330; // "G7S0"
    static final int LENGTH_A = 0x128, LENGTH_B = 0x13C;
    private static final byte[] KEY = "Simulator Interface Packet GT7 ver 0.0".substring(0, 32).getBytes(StandardCharsets.US_ASCII);

    static final String[] FIELDS = {"time_s", "packet_id", "lap", "laps_total", "best_lap_ms", "last_lap_ms", "car_code",
            "x", "y", "z", "speed_kmh", "throttle_pct", "brake_pct", "gear", "rpm",
            "steering_rad", "yaw_rate", "pitch", "yaw", "roll",
            "wheel_fl_kmh", "wheel_fr_kmh", "wheel_rl_kmh", "wheel_rr_kmh",
            "on_track", "paused", "loading", "tcs_active", "asm_active"};
    static final String HEADER = String.join(",", FIELDS);

    private Telemetry() {}

    /** The heartbeat byte sent to the console: 'B' adds the steering angle, older game versions only answer 'A'. */
    static int nonceXor(char format) {
        return format == 'B' ? 0xDEADBEEF : 0xDEADBEAF;
    }

    // --- Salsa20 ---
    private static int rotl(int v, int n) {
        return (v << n) | (v >>> (32 - n));
    }

    private static void block(int[] s, byte[] out) {
        int[] x = s.clone();
        int[][] q = {{0, 4, 8, 12}, {5, 9, 13, 1}, {10, 14, 2, 6}, {15, 3, 7, 11},
                {0, 1, 2, 3}, {5, 6, 7, 4}, {10, 11, 8, 9}, {15, 12, 13, 14}};
        for (int r = 0; r < 10; r++) {
            for (int[] g : q) {
                int a = g[0], b = g[1], c = g[2], d = g[3];
                x[b] ^= rotl(x[a] + x[d], 7);
                x[c] ^= rotl(x[b] + x[a], 9);
                x[d] ^= rotl(x[c] + x[b], 13);
                x[a] ^= rotl(x[d] + x[c], 18);
            }
        }
        ByteBuffer bb = ByteBuffer.wrap(out).order(ByteOrder.LITTLE_ENDIAN);
        for (int i = 0; i < 16; i++) bb.putInt(i * 4, x[i] + s[i]);
    }

    /** Salsa20 with the fixed key; encrypting and decrypting are the same. */
    static byte[] salsa20(byte[] nonce, byte[] data, int length) {
        ByteBuffer k = ByteBuffer.wrap(KEY).order(ByteOrder.LITTLE_ENDIAN);
        ByteBuffer n = ByteBuffer.wrap(nonce).order(ByteOrder.LITTLE_ENDIAN);
        ByteBuffer c = ByteBuffer.wrap("expand 32-byte k".getBytes(StandardCharsets.US_ASCII)).order(ByteOrder.LITTLE_ENDIAN);
        int[] s = {c.getInt(0), k.getInt(0), k.getInt(4), k.getInt(8), k.getInt(12), c.getInt(4), n.getInt(0), n.getInt(4),
                0, 0, c.getInt(8), k.getInt(16), k.getInt(20), k.getInt(24), k.getInt(28), c.getInt(12)};
        byte[] out = new byte[length], stream = new byte[64];
        for (int i = 0; i < length; i++) {
            if (i % 64 == 0) {
                s[8] = i / 64;
                block(s, stream);
            }
            out[i] = (byte) (data[i] ^ stream[i % 64]);
        }
        return out;
    }

    /** The decrypted packet, or null if it isn't a GT7 packet in this format. */
    static ByteBuffer decrypt(byte[] data, int length, int nonceXor) {
        if (length < LENGTH_A) return null;
        int iv1 = ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN).getInt(0x40);
        byte[] nonce = ByteBuffer.allocate(8).order(ByteOrder.LITTLE_ENDIAN).putInt(iv1 ^ nonceXor).putInt(iv1).array();
        ByteBuffer p = ByteBuffer.wrap(salsa20(nonce, data, length)).order(ByteOrder.LITTLE_ENDIAN);
        return p.getInt(0) == MAGIC ? p : null;
    }

    // --- fields ---
    static int packetId(ByteBuffer p) { return p.getInt(0x70); }
    static int lap(ByteBuffer p) { return p.getShort(0x74); }
    static int lastLapMs(ByteBuffer p) { return p.getInt(0x7C); }
    static double speedKmh(ByteBuffer p) { return 3.6 * p.getFloat(0x4C); }
    static int flags(ByteBuffer p) { return p.getShort(0x8E) & 0xFFFF; }
    static boolean onTrack(ByteBuffer p) { return (flags(p) & 1) != 0; }
    static boolean paused(ByteBuffer p) { return (flags(p) & 2) != 0; }
    static boolean loading(ByteBuffer p) { return (flags(p) & 4) != 0; }

    private static String num(double v, int digits) {
        return digits == 0 ? Long.toString(Math.round(v)) : String.format(Locale.ROOT, "%." + digits + "f", v);
    }

    private static int bit(int flags, int mask) {
        return (flags & mask) != 0 ? 1 : 0;
    }

    /** One CSV line (no newline) in the order of FIELDS. */
    static String csvRow(ByteBuffer p, double timeS) {
        int fl = flags(p);
        StringBuilder sb = new StringBuilder(220);
        sb.append(num(timeS, 3)).append(',').append(packetId(p)).append(',').append(lap(p)).append(',')
                .append(p.getShort(0x76)).append(',').append(p.getInt(0x78)).append(',').append(lastLapMs(p)).append(',')
                .append(p.getInt(0x124)).append(',')
                .append(num(p.getFloat(0x04), 2)).append(',').append(num(p.getFloat(0x08), 2)).append(',')
                .append(num(p.getFloat(0x0C), 2)).append(',').append(num(speedKmh(p), 2)).append(',')
                .append(num(100.0 * (p.get(0x91) & 0xFF) / 255, 1)).append(',')
                .append(num(100.0 * (p.get(0x92) & 0xFF) / 255, 1)).append(',')
                .append(p.get(0x90) & 0x0F).append(',').append(num(p.getFloat(0x3C), 0)).append(',')
                .append(p.limit() >= LENGTH_B ? num(p.getFloat(0x128), 4) : "").append(',')
                .append(num(p.getFloat(0x30), 4)).append(',').append(num(p.getFloat(0x1C), 4)).append(',')
                .append(num(p.getFloat(0x20), 4)).append(',').append(num(p.getFloat(0x24), 4));
        for (int i = 0; i < 4; i++) {
            double rps = p.getFloat(0xA4 + 4 * i), radius = p.getFloat(0xB4 + 4 * i);
            sb.append(',').append(num(Math.abs(3.6 * rps * radius), 2));
        }
        sb.append(',').append(bit(fl, 1)).append(',').append(bit(fl, 2)).append(',').append(bit(fl, 4))
                .append(',').append(bit(fl, 0x800)).append(',').append(bit(fl, 0x400));
        return sb.toString();
    }

    static String fmtLap(int ms) {
        return String.format(Locale.ROOT, "%d:%06.3f", ms / 60000, (ms % 60000) / 1000.0);
    }
}
