package io.github.gt7timetrials;

import java.io.IOException;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.PortUnreachableException;
import java.net.SocketTimeoutException;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Records GT7's telemetry on the phone, the same way tools/telemetry.py does on a computer: find the PlayStation by
 * sending the heartbeat to every address on the home network, keep the stream alive, and keep every packet as a CSV
 * line. Progress is reported to the website as small JSON events. Plain Java, so it can be tested off the phone.
 */
final class Recorder implements Runnable {
    interface Listener {
        void event(String json);
    }

    /** Lets the app send and receive through the Wi-Fi network even when mobile data or a VPN is also on. */
    interface SocketSetup {
        void setup(DatagramSocket socket) throws IOException;
    }

    private static final long HEARTBEAT_EVERY_MS = 5000;

    private final Listener listener;
    private final String onlyIp;  // the address the player typed in (or a test's): talk to this one only
    private final String ownIp;   // this phone's Wi-Fi address, if the app knows it
    private final SocketSetup setup;
    private volatile boolean running = true;
    private final StringBuilder csv = new StringBuilder(Telemetry.HEADER + "\n");
    private int packets = 0, laps = 0;
    private volatile String ip;
    // PlayStations that answered the Remote Play discovery broadcast: they get the heartbeat first
    private final Set<String> found = ConcurrentHashMap.newKeySet();

    Recorder(Listener listener, String onlyIp, String ownIp, SocketSetup setup) {
        this.listener = listener;
        this.onlyIp = onlyIp == null || onlyIp.trim().isEmpty() ? null : onlyIp.trim();
        this.ownIp = ownIp;
        this.setup = setup;
    }

    Recorder(Listener listener, String onlyIp) {
        this(listener, onlyIp, null, null);
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

    /** Every other address on the same /24 network as the phone. */
    static List<String> candidates(String ownIp) {
        List<String> out = new ArrayList<>();
        if (ownIp != null) {
            String base = ownIp.substring(0, ownIp.lastIndexOf('.'));
            for (int n = 1; n < 255; n++) {
                String a = base + "." + n;
                if (!a.equals(ownIp)) out.add(a);
            }
        }
        return out;
    }

    /** Sends the heartbeat; false if the phone couldn't send it. */
    private static boolean send(DatagramSocket sock, char format, String to) {
        try {
            byte[] b = {(byte) format};
            sock.send(new DatagramPacket(b, 1, new InetSocketAddress(to, Telemetry.SEND_PORT)));
            return true;
        } catch (IOException | IllegalArgumentException e) {
            return false; // an address that can't be reached: skip it
        }
    }

    private static void pause(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    /**
     * Ask every PlayStation on the network where it is, the way the Remote Play apps do: one broadcast reaches them
     * all and each answers with its address. Runs until the console is found or recording stops. This is quicker
     * and gentler than heartbeating every address, which some Wi-Fi routers and mesh systems throttle.
     */
    private void discover(String phone) {
        byte[][] asks = {
                "SRCH * HTTP/1.1\ndevice-discovery-protocol-version:00030010\n".getBytes(StandardCharsets.US_ASCII), // PS5
                "SRCH * HTTP/1.1\ndevice-discovery-protocol-version:00020020\n".getBytes(StandardCharsets.US_ASCII), // PS4
        };
        int[] ports = {9302, 987};
        List<String> to = new ArrayList<>();
        to.add("255.255.255.255");
        if (phone != null) to.add(phone.substring(0, phone.lastIndexOf('.')) + ".255");
        try (DatagramSocket ds = new DatagramSocket()) {
            ds.setBroadcast(true);
            if (setup != null) setup.setup(ds);
            ds.setSoTimeout(500);
            byte[] buf = new byte[2048];
            DatagramPacket dp = new DatagramPacket(buf, buf.length);
            while (running && ip == null) {
                for (String t : to) {
                    for (int i = 0; i < asks.length; i++) {
                        try {
                            ds.send(new DatagramPacket(asks[i], asks[i].length, new InetSocketAddress(t, ports[i])));
                        } catch (IOException | IllegalArgumentException ignored) {
                            // broadcasts not allowed here: the address sweep still runs
                        }
                    }
                }
                long until = System.currentTimeMillis() + 2000;
                while (running && ip == null && System.currentTimeMillis() < until) {
                    try {
                        ds.receive(dp);
                    } catch (IOException e) {
                        continue;
                    }
                    if (new String(buf, 0, Math.min(dp.getLength(), 8), StandardCharsets.US_ASCII).equals("HTTP/1.1")) {
                        found.add(dp.getAddress().getHostAddress());
                    }
                }
            }
        } catch (IOException ignored) {
            // no discovery: the address sweep still runs
        }
    }

    private static String jsonList(Set<String> items) {
        StringBuilder sb = new StringBuilder("[");
        for (String s : items) sb.append(sb.length() > 1 ? "," : "").append(q(s));
        return sb.append(']').toString();
    }

    @Override
    public void run() {
        try (DatagramSocket sock = new DatagramSocket(null)) {
            sock.setReuseAddress(true);
            sock.bind(new InetSocketAddress(Telemetry.RECV_PORT));
            if (setup != null) setup.setup(sock);
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
        String phone = ownIp != null ? ownIp : localIp();
        List<String> targets = onlyIp != null ? Collections.singletonList(onlyIp) : candidates(phone);
        if (targets.isEmpty()) {
            emit("error", "\"message\":" + q("This phone isn't on a Wi-Fi network. Connect to the same router as your PlayStation."));
            return;
        }
        String where = onlyIp != null ? onlyIp : targets.get(targets.size() - 1).replaceAll("\\.\\d+$", ".x");
        emit("searching", "\"network\":" + q(where) + ",\"phone\":" + q(phone == null ? "" : phone));

        // find the console: heartbeat everyone, take the first one that answers with a GT7 packet. Consoles that answer
        // the discovery broadcast get the heartbeat every half second; the sweep is spread out so the Wi-Fi doesn't
        // drop it as a flood.
        if (onlyIp == null) new Thread(() -> discover(phone), "discovery").start();
        char format = 0;
        long started = System.currentTimeMillis();
        boolean hinted = false;
        int heard = 0, sendErrors = 0; // for the "still looking" message: anything at all arriving, or sends failing
        search:
        while (running) {
            for (char f : new char[]{'B', 'A'}) {
                int sent = 0;
                for (String t : targets) {
                    if (!send(sock, f, t)) sendErrors++;
                    if (++sent % 4 == 0) pause(1);
                }
                long until = System.currentTimeMillis() + 3000, lastFound = 0;
                while (running && System.currentTimeMillis() < until) {
                    if (System.currentTimeMillis() - lastFound > 500) {
                        for (String d : found) send(sock, f, d);
                        lastFound = System.currentTimeMillis();
                    }
                    try {
                        sock.receive(dp);
                    } catch (SocketTimeoutException | PortUnreachableException e) { // nothing yet, or an "unreachable" reply to a heartbeat
                        continue;
                    }
                    heard++;
                    if (Telemetry.decrypt(buf, dp.getLength(), Telemetry.nonceXor(f)) != null) {
                        ip = dp.getAddress().getHostAddress();
                        format = f;
                        break search;
                    }
                }
            }
            if (!hinted && System.currentTimeMillis() - started > 20000) {
                emit("slow", "\"phone\":" + q(phone == null ? "" : phone) + ",\"network\":" + q(where)
                        + ",\"heard\":" + heard + ",\"sendErrors\":" + sendErrors + ",\"tried\":" + targets.size()
                        + ",\"consoles\":" + jsonList(found));
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
            } catch (SocketTimeoutException | PortUnreachableException e) { // nothing yet, or an "unreachable" reply to a heartbeat
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
