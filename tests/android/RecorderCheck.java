package io.github.gt7timetrials;

import java.io.IOException;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetSocketAddress;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.List;

/**
 * Off-phone checks for the app's recorder (run by tests/test_gt7tt.py with plain javac/java).
 *   decrypt <packets.bin>         decrypt packets encrypted by tools/telemetry.py and print their CSV rows
 *   replay <recording.csv> <out>  play a recording as a fake PlayStation on this computer, record it with
 *                                 Recorder, and save what it recorded
 *   find <discover|sweep> <recording.csv>
 *                                 search without being given the address: a fake PlayStation that only answers the
 *                                 Remote Play discovery broadcast, or only the sweep of the phone's network
 */
public final class RecorderCheck {
    public static void main(String[] args) throws Exception {
        if (args[0].equals("decrypt")) {
            byte[] all = Files.readAllBytes(Paths.get(args[1]));
            for (int off = 0; off < all.length; off += Telemetry.LENGTH_B) {
                byte[] one = java.util.Arrays.copyOfRange(all, off, off + Telemetry.LENGTH_B);
                ByteBuffer p = Telemetry.decrypt(one, one.length, Telemetry.nonceXor('B'));
                System.out.println(p == null ? "null" : Telemetry.csvRow(p, 0));
            }
            return;
        }
        if (args[0].equals("find")) {
            find(args[1].equals("discover"), Files.readAllLines(Paths.get(args[2])));
            return;
        }
        List<String> rows = Files.readAllLines(Paths.get(args[1]));
        StringBuilder events = new StringBuilder();
        Recorder rec = new Recorder(json -> {
            synchronized (events) { events.append(json).append('\n'); }
            System.out.println(json);
        }, null, "127.0.0.1");
        Thread t = new Thread(rec);
        try (DatagramSocket console = new DatagramSocket(new InetSocketAddress("127.0.0.1", Telemetry.SEND_PORT))) {
            t.start(); // only once the fake console is listening, so the first heartbeat isn't lost
            DatagramPacket beat = new DatagramPacket(new byte[16], 16);
            console.receive(beat); // the heartbeat
            if (beat.getData()[0] != 'B') throw new AssertionError("expected heartbeat B");
            InetSocketAddress to = new InetSocketAddress("127.0.0.1", Telemetry.RECV_PORT);
            String[] head = rows.get(0).split(",", -1);
            for (int i = 1; i < rows.size(); i++) {
                byte[] enc = packet(head, rows.get(i).split(",", -1), i);
                console.send(new DatagramPacket(enc, enc.length, to));
                if (i % 5 == 0) Thread.sleep(1); // don't overflow the socket buffer, or the test loses packets on a busy computer
            }
        }
        Thread.sleep(700);
        rec.stop();
        t.join();
        Files.write(Paths.get(args[2]), rec.csv().getBytes(StandardCharsets.UTF_8));
    }

    private static void find(boolean discover, List<String> rows) throws Exception {
        // the "phone" is 127.0.0.1, so the sweep goes to 127.0.0.2-254. Listening on 127.0.0.1 only, the console never
        // hears the sweep and can only be found by discovery; listening on every address, it hears the sweep.
        DatagramSocket console = new DatagramSocket(null);
        console.setReuseAddress(true);
        console.bind(new InetSocketAddress(discover ? "127.0.0.1" : "0.0.0.0", Telemetry.SEND_PORT));
        DatagramSocket ask = null;
        if (discover) {
            ask = new DatagramSocket(null);
            ask.setReuseAddress(true);
            ask.bind(new InetSocketAddress(9302));
            DatagramSocket answer = new DatagramSocket(new InetSocketAddress("127.0.0.1", 0));
            DatagramSocket asks = ask;
            Thread responder = new Thread(() -> {
                byte[] reply = "HTTP/1.1 620 Server Standby\nhost-type:PS5\n".getBytes(StandardCharsets.US_ASCII);
                try {
                    DatagramPacket q = new DatagramPacket(new byte[512], 512);
                    asks.receive(q);
                    answer.send(new DatagramPacket(reply, reply.length, q.getSocketAddress()));
                } catch (IOException ignored) {
                    // closed at the end of the test
                }
            });
            responder.setDaemon(true);
            responder.start();
        }
        String[] connected = new String[1];
        Recorder rec = new Recorder(json -> {
            System.out.println(json);
            if (json.contains("\"connected\"")) connected[0] = json;
        }, null, null, "127.0.0.1", null);
        Thread t = new Thread(rec);
        t.start();
        console.setSoTimeout(15000);
        DatagramPacket beat = new DatagramPacket(new byte[16], 16);
        console.receive(beat);
        String[] head = rows.get(0).split(",", -1);
        InetSocketAddress to = new InetSocketAddress(beat.getAddress(), Telemetry.RECV_PORT);
        for (int i = 1; i < 200 && connected[0] == null; i++) {
            byte[] enc = packet(head, rows.get(i).split(",", -1), i);
            console.send(new DatagramPacket(enc, enc.length, to));
            Thread.sleep(5);
        }
        rec.stop();
        t.join();
        console.close();
        if (ask != null) ask.close();
    }

    private static double col(String[] head, String[] row, String name) {
        for (int i = 0; i < head.length; i++) if (head[i].equals(name)) return row[i].isEmpty() ? 0 : Double.parseDouble(row[i]);
        throw new IllegalArgumentException(name);
    }

    /** A GT7 packet ("B" format) carrying the recording's values, encrypted the way the console does it. */
    private static byte[] packet(String[] h, String[] r, int iv) throws IOException {
        ByteBuffer p = ByteBuffer.allocate(Telemetry.LENGTH_B).order(ByteOrder.LITTLE_ENDIAN);
        p.putInt(0, Telemetry.MAGIC);
        p.putFloat(0x04, (float) col(h, r, "x")).putFloat(0x08, (float) col(h, r, "y")).putFloat(0x0C, (float) col(h, r, "z"));
        p.putFloat(0x4C, (float) (col(h, r, "speed_kmh") / 3.6));
        p.putInt(0x70, (int) col(h, r, "packet_id")).putShort(0x74, (short) col(h, r, "lap"));
        p.putInt(0x7C, (int) col(h, r, "last_lap_ms")).putInt(0x124, (int) col(h, r, "car_code"));
        p.put(0x91, (byte) Math.round(col(h, r, "throttle_pct") * 2.55)).put(0x92, (byte) Math.round(col(h, r, "brake_pct") * 2.55));
        p.putShort(0x8E, (short) ((int) col(h, r, "on_track") | 2 * (int) col(h, r, "paused") | 4 * (int) col(h, r, "loading")));
        p.putFloat(0x128, (float) col(h, r, "steering_rad"));
        p.putFloat(0xB4 + 8, 0.3f).putFloat(0xB4 + 12, 0.3f);
        p.putFloat(0xA4 + 8, (float) (col(h, r, "wheel_rl_kmh") / 3.6 / 0.3)).putFloat(0xA4 + 12, (float) (col(h, r, "wheel_rr_kmh") / 3.6 / 0.3));
        byte[] nonce = ByteBuffer.allocate(8).order(ByteOrder.LITTLE_ENDIAN).putInt(iv ^ 0xDEADBEEF).putInt(iv).array();
        byte[] enc = Telemetry.salsa20(nonce, p.array(), Telemetry.LENGTH_B);
        ByteBuffer.wrap(enc).order(ByteOrder.LITTLE_ENDIAN).putInt(0x40, iv); // the console sends the IV in the clear
        return enc;
    }
}
