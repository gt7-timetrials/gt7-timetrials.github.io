"""Build the static website: copy site/ and write data.json for it."""
import json
import os
import shutil
import statistics as st
from collections import Counter, defaultdict

from . import report, telemetry
from .model import finished_events, gold_time, rate_drivers, strong_drivers
from .store import parse_time

ROOT = os.path.join(os.path.dirname(__file__), "..")
SITE_SRC = os.path.join(ROOT, "site")
RECORDER = os.path.join(ROOT, "tools", "telemetry.py")
TOP_DRIVERS = 50


def site_data(store, at, rep, finished=None, references=None):
    events = store.events()
    finished = finished if finished is not None else finished_events(store, events, at)
    references = references or {}

    current = []
    for e in rep["events"]:
        ev = events[e["event_id"]]
        snaps = store.snapshots(ev.id)
        ref = references.get(ev.id)
        current.append({**e, "history": store.predictions(ev.id),
                        "wr_steps": wr_steps(ev, snaps[-1]["list"] if snaps else []),
                        "reference": ref and {"lap_ms": ref["lap_ms"], "driver": ref["driver"],
                                              "url": f"reference/{ev.id}.json"}})

    past = []
    for ev, b in reversed(finished):
        top = b["list"][0]
        name, category = store.course(ev.course_code)
        car = Counter(x["ranking_stats"]["car_code"] for x in b["list"]).most_common(1)[0][0]
        past.append({
            "event_id": ev.id, "start": ev.start.astimezone(report.MELBOURNE).date().isoformat(),
            "days": round(ev.duration_days), "track": name, "category": category, "car": store.car(car),
            "entrants": b["total"], "wr_ms": top["score"], "wr_holder": top["user"]["np_online_id"],
            "gold_ms": gold_time(top["score"]),
            "top100_spread_pct": round(100 * (b["list"][99]["score"] / top["score"] - 1), 3),
        })

    drivers = rate_drivers(finished)
    strong = strong_drivers(drivers)
    wins, top10, country = defaultdict(int), defaultdict(int), {}
    for _, b in finished:
        for x in b["list"]:
            uid = x["user"]["user_id"]
            country[uid] = x["user"].get("country_code")
            wins[uid] += x["display_rank"] == 1
            top10[uid] += x["display_rank"] <= 10
    ranked = sorted((d for d in drivers.values() if d.appearances >= 6), key=lambda d: d.rating)[:TOP_DRIVERS]
    driver_rows = [{
        "name": d.name, "country": country.get(d.user_id), "events": d.appearances,
        "median_gap_pct": round(100 * d.median_gap, 3), "rating_pct": round(100 * d.rating, 3),
        "wins": wins[d.user_id], "top10": top10[d.user_id], "tracked": d.user_id in strong,
    } for d in ranked]

    return {
        "generated_at": rep["generated_at"],
        "scorecard": scorecard(store, finished),
        "history_events": rep["history_events"],
        "snapshot_events": rep["snapshot_events"],
        "historical_entrants": rep["historical_entrants"],
        "current": current,
        "past": past,
        "drivers": driver_rows,
        "median_entrants": int(st.median(p["entrants"] for p in past)) if past else None,
    }


def wr_steps(ev, entries):
    """World record over time, rebuilt from when each current top-100 time was set.

    Only the final best lap of each driver is visible, so this is the best time
    known to have existed by each moment (the real WR may have been briefly faster
    earlier by a driver who has since improved further, which this cannot show).
    """
    steps, best = [], None
    for x in sorted(entries, key=lambda x: x["update_time"]):
        if best is None or x["score"] < best:
            best = x["score"]
            steps.append({"day": round(ev.elapsed_days(parse_time(x["update_time"])), 3), "wr_ms": best,
                          "gold_ms": gold_time(best), "holder": x["user"]["np_online_id"]})
    return steps


def event_detail(store, ev, board):
    """One finished event's page: top 10, how the record fell, and any logged predictions."""
    top = board["list"]
    name, category = store.course(ev.course_code)
    cars = Counter(x["ranking_stats"]["car_code"] for x in top)
    multi_car = len({x["ranking_stats"]["car_code"] for x in top[:10]}) > 1
    return {
        "event_id": ev.id, "track": name, "category": category, "car": store.car(cars.most_common(1)[0][0]),
        "multi_car": multi_car, "regular_event": ev.is_general,
        "starts": ev.start.astimezone(report.MELBOURNE).isoformat(),
        "ends": ev.end.astimezone(report.MELBOURNE).isoformat(), "days": round(ev.duration_days),
        "leaderboard_url": f"https://www.gran-turismo.com/gb/gt7/sportmode/event/{ev.id}/",
        "entrants": board["total"], "wr_ms": top[0]["score"], "wr_holder": top[0]["user"]["np_online_id"],
        "p100_ms": top[-1]["score"], "ranked": len(top),
        "top100_spread_pct": round(100 * (top[-1]["score"] / top[0]["score"] - 1), 3),
        "top10": [{
            "rank": x["display_rank"], "name": x["user"]["np_online_id"], "country": x["user"].get("country_code"),
            "ms": x["score"],
            **({"car": store.car(x["ranking_stats"]["car_code"])} if multi_car else {}),
        } for x in top[:10]],
        "wr_steps": wr_steps(ev, top),
        "predictions": [r for r in store.predictions(ev.id) if r.get("final_wr_ms")],
    }


def scorecard(store, finished):
    """Predicted vs actual final gold for finished events that have a prediction log."""
    rows = []
    for ev, b in reversed(finished):
        log = [r for r in store.predictions(ev.id) if r.get("gold_ms")]
        if not log:
            continue
        actual = gold_time(b["list"][0]["score"])
        name, _ = store.course(ev.course_code)
        checkpoints = {}
        for day in (1, 3, 7):
            r = min(log, key=lambda r: abs(r["day"] - day))
            if abs(r["day"] - day) <= 1:
                checkpoints[day] = {"gold_ms": r["gold_ms"], "error_pct": round(100 * (r["gold_ms"] / actual - 1), 3),
                                    "in_range": r["gold_fast_ms"] <= actual <= r["gold_slow_ms"]}
        rows.append({"event_id": ev.id, "track": name, "end": ev.end.isoformat(), "actual_gold_ms": actual,
                     "predictions": checkpoints})
    return rows


def build_site(store, at, rep, out_dir):
    if os.path.exists(out_dir):
        shutil.rmtree(out_dir)
    shutil.copytree(SITE_SRC, out_dir)
    finished = finished_events(store, store.events(), at)
    references = current_references(store, rep)
    write_json(os.path.join(out_dir, "data.json"), site_data(store, at, rep, finished, references))
    os.makedirs(os.path.join(out_dir, "reference"))
    for eid, ref in references.items():
        write_json(os.path.join(out_dir, "reference", f"{eid}.json"), ref)
    shutil.copy(RECORDER, os.path.join(out_dir, "telemetry.py"))
    os.makedirs(os.path.join(out_dir, "events"))
    for ev, b in finished:
        write_json(os.path.join(out_dir, "events", f"{ev.id}.json"), event_detail(store, ev, b))


def current_references(store, rep):
    """Reference laps (data/reference_laps/*.csv) matched to the running events."""
    current = []
    for e in rep["events"]:
        snaps = store.snapshots(e["event_id"])
        if snaps and snaps[-1]["list"]:
            entries = snaps[-1]["list"]
            current.append((e["event_id"], entries[0]["ranking_stats"]["car_code"], e["wr_ms"], entries))
    laps = telemetry.reference_laps(os.path.join(store.root, "reference_laps"))
    return telemetry.match_references(laps, current)


def write_json(path, obj):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
