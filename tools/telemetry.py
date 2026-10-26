"""Record GT7's telemetry stream from a PS4/PS5 on the same home network.

Upload the CSV on https://gt7-timetrials.github.io/ to compare a lap with the world record
(the site owner records the world record's replay the same way). Needs only Python 3.8+.

    py telemetry.py                   (Windows; finds your PlayStation by itself)
    py telemetry.py 192.168.1.23      (or give its IP address yourself)
    python3 telemetry.py              (Mac / Linux)

Start GT7 first: the PlayStation only answers while GT7 is running. It searches afresh every time,
since the PlayStation's address can change. Press Ctrl+C to stop; every packet is saved to
telemetry_<date>_<time>.csv next to this script.

How it works: GT7 sends ~60 packets a second to whoever sends it a small "heartbeat" on
UDP port 33739, as long as the heartbeat is repeated every few seconds. Packets arrive on
UDP port 33740 and are encrypted with Salsa20 using a fixed key the community worked out.
To find the PlayStation, the heartbeat is sent to every address on your home network and
the one that answers is used. Nothing here touches your PSN account or changes anything
on the console.
"""
import csv
import os
import socket
import struct
import sys
import time
from datetime import datetime

SEND_PORT, RECV_PORT = 33739, 33740
KEY = b"Simulator Interface Packet GT7 ver 0.0"[:32]
MAGIC = 0x47375330  # "G7S0"
# heartbeat -> (packet length, nonce xor); "B" adds the steering wheel angle and body motion
FORMATS = {b"B": (0x13C, 0xDEADBEEF), b"A": (0x128, 0xDEADBEAF)}
HEARTBEAT_EVERY = 5  # seconds


# --- Salsa20 (pure Python, so there is nothing to install) ---
def _rotl(v, n):
    return ((v << n) & 0xFFFFFFFF) | (v >> (32 - n))


def _salsa20_block(key, nonce, counter):
    c = struct.unpack("<4I", b"expand 32-byte k")
    k = struct.unpack("<8I", key)
    n = struct.unpack("<2I", nonce)
    s = [c[0], *k[:4], c[1], *n, counter & 0xFFFFFFFF, counter >> 32, c[2], *k[4:], c[3]]
    x = s[:]
    for _ in range(10):
        for a, b, cc, d in ((0, 4, 8, 12), (5, 9, 13, 1), (10, 14, 2, 6), (15, 3, 7, 11),
                            (0, 1, 2, 3), (5, 6, 7, 4), (10, 11, 8, 9), (15, 12, 13, 14)):
            x[b] ^= _rotl((x[a] + x[d]) & 0xFFFFFFFF, 7)
            x[cc] ^= _rotl((x[b] + x[a]) & 0xFFFFFFFF, 9)
            x[d] ^= _rotl((x[cc] + x[b]) & 0xFFFFFFFF, 13)
            x[a] ^= _rotl((x[d] + x[cc]) & 0xFFFFFFFF, 18)
    return struct.pack("<16I", *((x[i] + s[i]) & 0xFFFFFFFF for i in range(16)))


def salsa20(key, nonce, data):
    stream = b"".join(_salsa20_block(key, nonce, i) for i in range((len(data) + 63) // 64))
    return bytes(a ^ b for a, b in zip(data, stream))


def decrypt(data, nonce_xor):
    iv1 = struct.unpack_from("<I", data, 0x40)[0]
    nonce = struct.pack("<II", iv1 ^ nonce_xor, iv1)
    out = salsa20(KEY, nonce, data)
    return out if struct.unpack_from("<I", out, 0)[0] == MAGIC else None


# --- packet fields (offsets from the community's decoding of the format) ---
FIELDS = ["time_s", "packet_id", "lap", "laps_total", "best_lap_ms", "last_lap_ms", "car_code",
          "x", "y", "z", "speed_kmh", "throttle_pct", "brake_pct", "gear", "rpm",
          "steering_rad", "yaw_rate", "pitch", "yaw", "roll",
          "wheel_fl_kmh", "wheel_fr_kmh", "wheel_rl_kmh", "wheel_rr_kmh",
          "on_track", "paused", "loading", "tcs_active", "asm_active"]


def parse(p, t0):
    f = lambda off: struct.unpack_from("<f", p, off)[0]
    flags = struct.unpack_from("<H", p, 0x8E)[0]
    wheel_rps = struct.unpack_from("<4f", p, 0xA4)
    radius = struct.unpack_from("<4f", p, 0xB4)
    return {
        "time_s": round(time.time() - t0, 3),
        "packet_id": struct.unpack_from("<i", p, 0x70)[0],
        "lap": struct.unpack_from("<h", p, 0x74)[0],
        "laps_total": struct.unpack_from("<h", p, 0x76)[0],
        "best_lap_ms": struct.unpack_from("<i", p, 0x78)[0],
        "last_lap_ms": struct.unpack_from("<i", p, 0x7C)[0],
        "car_code": struct.unpack_from("<i", p, 0x124)[0],
        "x": round(f(0x04), 2), "y": round(f(0x08), 2), "z": round(f(0x0C), 2),
        "speed_kmh": round(3.6 * f(0x4C), 2),
        "throttle_pct": round(100 * p[0x91] / 255, 1),
        "brake_pct": round(100 * p[0x92] / 255, 1),
        "gear": p[0x90] & 0x0F,
        "rpm": round(f(0x3C)),
        "steering_rad": round(f(0x128), 4) if len(p) >= 0x13C else "",
        "yaw_rate": round(f(0x30), 4),
        "pitch": round(f(0x1C), 4), "yaw": round(f(0x20), 4), "roll": round(f(0x24), 4),
        **{f"wheel_{w}_kmh": round(abs(3.6 * wheel_rps[i] * radius[i]), 2)
           for i, w in enumerate(("fl", "fr", "rl", "rr"))},
        "on_track": int(bool(flags & 1)), "paused": int(bool(flags & 2)), "loading": int(bool(flags & 4)),
        "tcs_active": int(bool(flags & 0x800)), "asm_active": int(bool(flags & 0x400)),
    }


HERE = os.path.dirname(os.path.abspath(__file__))


def fmt_lap(ms):
    return f"{ms // 60000}:{ms % 60000 / 1000:06.3f}"


def local_ip():
    """This computer's address on the home network (no packet is sent)."""
    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        probe.connect(("8.8.8.8", 80))
        return probe.getsockname()[0]
    except OSError:
        return None
    finally:
        probe.close()


def candidates(own_ip):
    """Every other address on the same /24 network as this computer."""
    if not own_ip:
        return []
    base = own_ip.rsplit(".", 1)[0]
    return [f"{base}.{n}" for n in range(1, 255) if f"{base}.{n}" != own_ip]


def read_packet(sock, fmt):
    """(decrypted packet, sender address) or (None, sender) for something unreadable; raises socket.timeout."""
    data, addr = sock.recvfrom(4096)
    return (decrypt(data, FORMATS[fmt][1]) if len(data) >= 0x128 else None), addr[0]


def find_console(sock, given=None):
    """Send heartbeats until a PlayStation answers. Returns (ip, packet format)."""
    targets = [given] if given else candidates(local_ip())
    if not targets:
        sys.exit("Couldn't work out this computer's network address. Run it with your PlayStation's address,\n"
                 "e.g.  py telemetry.py 192.168.1.23  (PS5: Settings > Network > Connection Status).")
    where = given or f"your network ({targets[0].rsplit('.', 1)[0]}.x)"
    print(f"Looking for your PlayStation on {where}. Make sure GT7 is running...")
    started = time.time()
    while True:
        for fmt in (b"B", b"A"):  # "B" adds the steering angle; older game versions only answer "A"
            for ip in targets:
                try:
                    sock.sendto(fmt, (ip, SEND_PORT))
                except OSError:
                    pass
            until = time.time() + 3
            while time.time() < until:
                try:
                    p, sender = read_packet(sock, fmt)
                except socket.timeout:
                    continue
                if p is not None:
                    return sender, fmt
        waited = time.time() - started
        if waited > 20:
            print("  Still no answer. Check that:")
            print("   - GT7 is running on the PlayStation (not just the home screen)")
            print("   - this computer and the PlayStation use the same router (cable or Wi-Fi is fine)")
            print("   - Windows Firewall allowed Python on Private networks (it asks the first time)")
            print("  Or give the address yourself: py telemetry.py 192.168.x.x")
            print("  (PS5: Settings > Network > Connection Status > View Connection Status). Ctrl+C to stop.")
            started = time.time()


def pause_before_closing():
    try:
        input("\nPress Enter to close this window.")
    except (EOFError, KeyboardInterrupt):
        pass


def main():
    given = sys.argv[1] if len(sys.argv) > 1 else None
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.bind(("0.0.0.0", RECV_PORT))
    except OSError as e:
        print(f"Could not listen on port {RECV_PORT} ({e}). Is another telemetry app or recorder already running?")
        pause_before_closing()
        return
    sock.settimeout(0.5)
    try:
        ip, fmt = find_console(sock, given)
    except KeyboardInterrupt:
        print("\nStopped before the PlayStation was found. Nothing was recorded.")
        pause_before_closing()
        return
    print(f"Connected to your PlayStation at {ip}.")

    name = os.path.join(HERE, datetime.now().strftime("telemetry_%Y%m%d_%H%M%S.csv"))
    out = open(name, "w", newline="")
    writer = csv.DictWriter(out, FIELDS)
    writer.writeheader()
    print(f"Saving to {name}")
    print("Drive at least one full lap: start before the line and cross it again. Press Ctrl+C when done.\n")

    t0 = time.time()
    last_beat = last_packet = last_flush = last_status = time.time()
    n = 0
    state = None
    laps = []  # (lap number, lap time ms, replay?, had a gap?)
    prev_lap = None
    gap_in_lap = False
    try:
        while True:
            now = time.time()
            silent = now - last_packet
            # keep the stream alive; ask again straight away if it goes quiet
            if now - last_beat > (1 if silent > 1 else HEARTBEAT_EVERY):
                try:
                    sock.sendto(fmt, (ip, SEND_PORT))
                except OSError:
                    pass
                last_beat = now
            if silent > 5 and now - last_status > 5:
                print(f"  No data for {silent:.0f} s. Is GT7 still running? Still trying...")
                last_status = now
            try:
                p, sender = read_packet(sock, fmt)
            except socket.timeout:
                continue
            if p is None or sender != ip:
                continue
            if silent > 2 and n:
                print(f"  The connection dropped for {silent:.1f} s. The lap in progress may be incomplete.")
                gap_in_lap = True
            last_packet = now
            row = parse(p, t0)
            writer.writerow(row)
            n += 1

            moving = row["speed_kmh"] > 5
            new_state = ("paused" if row["paused"] else "menus" if row["loading"] or not moving
                         else "driving" if row["on_track"] else "replay")
            if new_state != state:
                print({"paused": "  Paused.",
                       "menus": "  Connected. Waiting for the car to move (start driving or play a replay).",
                       "driving": "  Recording: you're driving.",
                       "replay": "  Recording a replay."}[new_state])
                state = new_state
            lap = row["lap"]
            if prev_lap is not None and lap == prev_lap + 1 and lap >= 2 and row["last_lap_ms"] > 0:
                laps.append((lap - 1, row["last_lap_ms"], state == "replay", gap_in_lap))
                note = " (replay)" if state == "replay" else ""
                note += ", but the connection dropped during it" if gap_in_lap else ""
                print(f"  Lap {lap - 1} complete: {fmt_lap(row['last_lap_ms'])}{note}. Saved.")
                gap_in_lap = False
            elif prev_lap is not None and lap != prev_lap:
                gap_in_lap = False  # a restart or a new lap starting: forget gaps from before
            prev_lap = lap
            if now - last_flush > 2:
                out.flush()  # keep what's recorded even if the window is closed
                last_flush = now
    except KeyboardInterrupt:
        pass
    finally:
        out.close()

    secs = time.time() - t0
    print(f"\nStopped after {secs:.0f} s, {n} packets.")
    if laps:
        print("Complete laps recorded:")
        for num, ms, replay, gap in laps:
            print(f"  Lap {num}: {fmt_lap(ms)}{' (replay)' if replay else ''}{'  - had a dropout' if gap else ''}")
        best = min(laps, key=lambda l: l[1])
        print(f"The website uses the fastest complete lap ({fmt_lap(best[1])}).")
        print(f"\nUpload this file on https://gt7-timetrials.github.io/ :\n  {name}")
    elif n:
        print("No complete lap was recorded. Start recording before you cross the start line and keep going")
        print("until you've crossed it again.")
        print(f"The data is still saved in {name}")
    else:
        print("Nothing was received after connecting. Is GT7 still running?")
        os.remove(name)
    pause_before_closing()


if __name__ == "__main__":
    main()
