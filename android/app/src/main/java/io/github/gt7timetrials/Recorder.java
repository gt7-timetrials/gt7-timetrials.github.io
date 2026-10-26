package io.github.gt7timetrials;

import java.io.IOException;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.SocketTimeoutException;
import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;

/**
 * Records GT7's telemetry on the phone, the same way tools/telemetry.py does on a computer: find the PlayStation by
 * sending the heartbeat to every address on the home network, keep the stream alive, and keep every packet as a CSV
 * line. Progress is reported to the website as small JSON events. Plain Java, so it can be tested off the phone.
 */
final class Recorder implements Runnable {
    interface Listener {
        void event(String json);
    }

    private static final long HEARTBEAT_EVERY_MS = 5000;

    private final Listener listener;
    private final String savedIp; // last time's address, tried first
    private final String onlyIp;  // for tests: talk to this address only
    private volatile boolean running = true;
    private final StringBuilder csv = new StringBuilder(Telemetry.HEADER + "\n");
    private int packets = 0, laps = 0;
    private String ip;

    Recorder(Listener listener, String savedIp, String onlyIp) {
        this.listener = listener;
        this.savedIp = savedIp;
        this.onlyIp = onlyIp;
    }

    void stop() {
        running = false;
    }

    synchronized String csv() {
        return csv.toString();
    }

    synchronized int packets() {
        return packets;
    }

    /** The address the PlayStation answered from, once found. */
    String ip() {
        return ip;
    }

    private static String q(String s) {
        return "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
    }

    private void emit(String type, String extra) {
        listener.event("{\"type\":" + q(type) + (extra.isEmpty() ? "" : "," + extra) + "}");
    }

    /** This phone's address on the home network (Wi-Fi), or null. */
    static String localIp() {
        try {
            String best = null;
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (InetAddress a : Collections.list(ni.getInetAddresses())) {
                    if (!(a instanceof Inet4Address) || !a.isSiteLocalAddress()) continue;
                    if (ni.getName().startsWith("wlan")) return a.getHostAddress();
                    if (best == null) best = a.getHostAddress();
                }
            }
            return best;
        } catch (IOException e) {
            return null;
        }
    }

    /** Addresses to try, most likely first: the saved one, then everything on the same /24 network. */
    static List<String> candidates(String ownIp, String saved) {
        List<String> out = new ArrayList<>();
        if (saved != null && !saved.isEmpty()) out.add(saved);
        if (ownIp != null) {
            String base = ownIp.substring(0, ownIp.lastIndexOf('.'));
            for (int n = 1; n < 255; n++) {
                String a = base + "." + n;
                if (!a.equals(ownIp) && !a.equals(saved)) out.add(a);
            }
        }
        return out;
    }

    private static void send(DatagramSocket sock, char format, String to) {
        try {
            byte[] b = {(byte) format};
            sock.send(new DatagramPacket(b, 1, new InetSocketAddress(to, Telemetry.SEND_PORT)));
        } catch (IOException | IllegalArgumentException ignored) {
            // an address that can't be reached: skip it
        }
    }

    @Override
    public void run() {
        try (DatagramSocket sock = new DatagramSocket(null)) {
            sock.setReuseAddress(true);
            sock.bind(new InetSocketAddress(Telemetry.RECV_PORT));
            sock.setSoTimeout(500);
            record(sock);
        } catch (IOException e) {
            emit("error", "\"message\":" + q("Couldn't listen for the PlayStation's data (" + e.getMessage()
                    + "). Is another telemetry app running?"));
        }
        emit("stopped", "\"packets\":" + packets() + ",\"laps\":" + laps);
    }

    private void record(DatagramSocket sock) throws IOException {
        byte[] buf = new byte[4096];
        DatagramPacket dp = new DatagramPacket(buf, buf.length);
        List<String> targets = onlyIp != null ? Collections.singletonList(onlyIp) : candidates(localIp(), savedIp);
        if (targets.isEmpty()) {
            emit("error", "\"message\":" + q("This phone isn't on a Wi-Fi network. Connect to the same router as your PlayStation."));
            return;
        }
        emit("searching", "\"network\":" + q(targets.get(targets.size() - 1).replaceAll("\\.\\d+$", ".x")));

        // find the console: heartbeat everyone, take the first one that answers with a GT7 packet
        char format = 0;
        long started = System.currentTimeMillis();
        boolean hinted = false;
        search:
        while (running) {
            for (char f : new char[]{'B', 'A'}) {
                for (String t : targets) send(sock, f, t);
                long until = System.currentTimeMillis() + 3000;
                while (running && System.currentTimeMillis() < until) {
                    try {
                        sock.receive(dp);
                    } catch (SocketTimeoutException e) {
                        continue;
                    }
                    if (Telemetry.decrypt(buf, dp.getLength(), Telemetry.nonceXor(f)) != null) {
                        ip = dp.getAddress().getHostAddress();
                        format = f;
                        break search;
                    }
                }
            }
            if (!hinted && System.currentTimeMillis() - started > 20000) {
                emit("slow", "");
                hinted = true;
            }
        }
        if (!running) return;
        emit("connected", "\"ip\":" + q(ip));

        long t0 = System.currentTimeMillis(), lastBeat = t0, lastPacket = t0, lastWarn = 0;
        String state = null;
        Integer prevLap = null;
        boolean gapInLap = false;
        int xor = Telemetry.nonceXor(format);
        while (running) {
            long now = System.currentTimeMillis();
            long silent = now - lastPacket;
            // keep the stream alive; ask again straight away if it goes quiet
            if (now - lastBeat > (silent > 1000 ? 1000 : HEARTBEAT_EVERY_MS)) {
                send(sock, format, ip);
                lastBeat = now;
            }
            if (silent > 5000 && now - lastWarn > 5000) {
                emit("silent", "\"seconds\":" + silent / 1000);
                lastWarn = now;
            }
            try {
                sock.receive(dp);
            } catch (SocketTimeoutException e) {
                continue;
            }
            if (!dp.getAddress().getHostAddress().equals(ip)) continue;
            ByteBuffer p = Telemetry.decrypt(buf, dp.getLength(), xor);
            if (p == null) continue;
            if (silent > 2000 && packets() > 0) {
                emit("dropout", "\"seconds\":" + String.format(Locale.ROOT, "%.1f", silent / 1000.0));
                gapInLap = true;
            }
            lastPacket = now;
            synchronized (this) {
                csv.append(Telemetry.csvRow(p, (now - t0) / 1000.0)).append('\n');
                packets++;
            }

            boolean moving = Telemetry.speedKmh(p) > 5;
            String newState = Telemetry.paused(p) ? "paused" : Telemetry.loading(p) || !moving ? "menus"
                    : Telemetry.onTrack(p) ? "driving" : "replay";
            if (!newState.equals(state)) {
                emit("state", "\"state\":" + q(newState));
                state = newState;
            }
            int lap = Telemetry.lap(p), lastMs = Telemetry.lastLapMs(p);
            if (prevLap != null && lap == prevLap + 1 && lap >= 2 && lastMs > 0) {
                laps++;
                emit("lap", "\"lap\":" + (lap - 1) + ",\"ms\":" + lastMs + ",\"time\":" + q(Telemetry.fmtLap(lastMs))
                        + ",\"replay\":" + "replay".equals(state) + ",\"dropout\":" + gapInLap);
                gapInLap = false;
            } else if (prevLap != null && lap != prevLap) {
                gapInLap = false; // a restart or a new lap starting: forget gaps from before
            }
            prevLap = lap;
        }
    }
}
