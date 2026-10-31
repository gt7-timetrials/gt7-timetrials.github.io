"""Reference laps for the lap comparison on the website.

The owner records a top driver's replay with telemetry.py (on the website's download link)
and uploads the CSV to data/reference_laps/. At build time each running event gets the
fastest matching lap: same car, and the lap time closest to that event's world record.
The comparison itself runs in the browser (site/coach.js); this only extracts the lap.
"""
import csv
import glob
import json
import os

FIELDS = {"x": 2, "z": 2, "speed_kmh": 1, "throttle_pct": 0, "brake_pct": 0, "steering_rad": 3,
          "wheel_rl_kmh": 1, "wheel_rr_kmh": 1, "gear": 0}


def load_json(path):
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def read_csv(path):
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def complete_laps(rows):
    """(start, end) row indexes of every complete lap: the lap counter going up by one, twice."""
    ups = [i for i in range(1, len(rows))
           if int(rows[i]["lap"]) == int(rows[i - 1]["lap"]) + 1 >= 1 and float(rows[i]["speed_kmh"]) > 30]
    return [(a, b) for a, b in zip(ups, ups[1:]) if int(rows[b]["lap"]) == int(rows[a]["lap"]) + 1
            and int(rows[b]["last_lap_ms"]) > 0]


def fastest_lap(rows):
    """The fastest complete lap as compact arrays, or None."""
    laps = complete_laps(rows)
    if not laps:
        return None
    a, b = min(laps, key=lambda ab: int(rows[ab[1]]["last_lap_ms"]))
    lap = rows[a:b + 1]
    p0 = int(lap[0]["packet_id"])
    out = {"lap_ms": int(rows[b]["last_lap_ms"]), "car_code": int(lap[0]["car_code"]),
           "t": [round((int(r["packet_id"]) - p0) / 60, 3) for r in lap]}
    for k, digits in FIELDS.items():
        out[k] = [round(float(r[k]), digits) if r[k] != "" else 0 for r in lap]
        if digits == 0:
            out[k] = [int(v) for v in out[k]]
    return out


def reference_laps(folder):
    laps = []
    for path in sorted(glob.glob(os.path.join(folder, "*.csv"))):
        lap = fastest_lap(read_csv(path))
        if lap:
            laps.append({**lap, "source": os.path.basename(path)})
    return laps


def match_references(laps, current):
    """{event_id: lap} for running events. current: [(event_id, car_code, wr_ms, entries)]."""
    out = {}
    for lap in laps:
        cands = [c for c in current if c[1] == lap["car_code"]]
        if not cands:
            continue
        eid, _, wr, entries = min(cands, key=lambda c: abs(lap["lap_ms"] - c[2]))
        if eid not in out or lap["lap_ms"] < out[eid]["lap_ms"]:
            driver = next((x["user"]["np_online_id"] for x in entries if x["score"] == lap["lap_ms"]), None)
            out[eid] = {**lap, "driver": driver}
    return out
