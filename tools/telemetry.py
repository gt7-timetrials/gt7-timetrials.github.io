"""Record GT7's telemetry stream from a PS4/PS5 on the same home network.

Upload the CSV on https://gt7-timetrials.github.io/ to compare a lap with the world record
(the site owner records the world record's replay the same way). Needs only Python 3.8+.

    py telemetry.py 192.168.1.23      (Windows; use your PS5's IP address)
    python3 telemetry.py 192.168.1.23 (Mac / Linux)

The PS5's IP address is under Settings > Network > Connection Status > View Connection Status.
Press Ctrl+C to stop. Every packet is saved to telemetry_<date>_<time>.csv next to this script.

How it works: GT7 sends ~60 packets a second to whoever sends it a small "heartbeat" on
UDP port 33739, as long as the heartbeat is repeated every few seconds. Packets arrive on
UDP port 33740 and are encrypted with Salsa20 using a fixed key the community worked out.
Nothing here touches your PSN account or changes anything on the console.
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


def main():
    ip = sys.argv[1] if len(sys.argv) > 1 else input("PS5 IP address (e.g. 192.168.1.23): ").strip()
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.bind(("0.0.0.0", RECV_PORT))
    except OSError as e:
        sys.exit(f"Could not listen on port {RECV_PORT} ({e}). Is another telemetry app running?")
    sock.settimeout(1.0)

    name = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        datetime.now().strftime("telemetry_%Y%m%d_%H%M%S.csv"))
    out = open(name, "w", newline="")
    writer = csv.DictWriter(out, FIELDS)
    writer.writeheader()

    fmt_order = [b"B", b"A"]
    heartbeat = fmt_order[0]
    t0 = time.time()
    last_beat = last_status = 0.0
    started_fmt_at = t0
    n = bad = 0
    row = None
    seen_cars, laps = set(), set()
    max_speed = 0.0
    xs, zs = [], []
    print(f"Asking {ip} for telemetry. Start driving or play a replay in GT7. Ctrl+C to stop.")
    print(f"Saving to {name}\n")
    try:
        while True:
            now = time.time()
            if now - last_beat > HEARTBEAT_EVERY:
                sock.sendto(heartbeat, (ip, SEND_PORT))
                last_beat = now
            # if nothing decodes with the richer format after a while, fall back to the basic one
            if n == 0 and heartbeat == fmt_order[0] and now - started_fmt_at > 8:
                heartbeat, last_beat = fmt_order[1], 0.0
                print("Switching to the basic packet format.")
            try:
                data, _ = sock.recvfrom(4096)
            except socket.timeout:
                if now - last_status > 3:
                    print(f"  waiting for data... (packets so far: {n})")
                    last_status = now
                continue
            nonce_xor = FORMATS[heartbeat][1]
            p = decrypt(data, nonce_xor) if len(data) >= 0x128 else None
            if p is None:
                bad += 1
                continue
            row = parse(p, t0)
            writer.writerow(row)
            n += 1
            seen_cars.add(row["car_code"])
            laps.add(row["lap"])
            max_speed = max(max_speed, row["speed_kmh"])
            if n % 30 == 0:
                xs.append(row["x"]); zs.append(row["z"])
            if now - last_status > 1:
                state = "paused" if row["paused"] else "loading" if row["loading"] else \
                    "on track" if row["on_track"] else "not on track"
                steer = f" | steer {row['steering_rad']:+.2f}" if row["steering_rad"] != "" else ""
                print(f"  {n:6d} packets | {row['speed_kmh']:6.1f} km/h | throttle {row['throttle_pct']:5.1f}% | "
                      f"brake {row['brake_pct']:5.1f}% | gear {row['gear']} | lap {row['lap']}{steer} | {state}")
                last_status = now
    except KeyboardInterrupt:
        pass
    finally:
        out.close()

    secs = time.time() - t0
    print("\nSummary")
    print(f"  Packets saved:    {n} in {secs:.0f} s ({n / max(secs, 1):.0f} per second)")
    print(f"  Packet format:    {heartbeat.decode()} ({'with' if heartbeat == b'B' else 'without'} steering angle)")
    if bad:
        print(f"  Unreadable:       {bad} packets")
    if n:
        moved = (max(xs) - min(xs) + max(zs) - min(zs)) if xs else 0
        print(f"  Top speed:        {max_speed:.0f} km/h")
        print(f"  Laps seen:        {sorted(laps)}")
        print(f"  Car codes seen:   {sorted(seen_cars)}")
        print(f"  Car moved about:  {moved:.0f} m (x + z range)")
        print(f"\nData saved to {name}")
    else:
        print("  No telemetry received. Check the IP address, that GT7 is running, and that Windows")
        print("  Firewall allowed Python on private networks.")


if __name__ == "__main__":
    main()
