"""Build the static website: copy site/ and write data.json for it."""
import json
import os
import shutil
import statistics as st
from collections import Counter, defaultdict

from . import report
from .model import finished_events, gold_time, rate_drivers, strong_drivers

SITE_SRC = os.path.join(os.path.dirname(__file__), "..", "site")
TOP_DRIVERS = 50


def site_data(store, at, rep):
    events = store.events()
    finished = finished_events(store, events, at)

    current = []
    for e in rep["events"]:
        current.append({**e, "history": store.predictions(e["event_id"])})

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
        "history_events": rep["history_events"],
        "snapshot_events": rep["snapshot_events"],
        "historical_entrants": rep["historical_entrants"],
        "current": current,
        "past": past,
        "drivers": driver_rows,
        "median_entrants": int(st.median(p["entrants"] for p in past)) if past else None,
    }


def build_site(store, at, rep, out_dir):
    if os.path.exists(out_dir):
        shutil.rmtree(out_dir)
    shutil.copytree(SITE_SRC, out_dir)
    with open(os.path.join(out_dir, "data.json"), "w", encoding="utf-8") as f:
        json.dump(site_data(store, at, rep), f, ensure_ascii=False, separators=(",", ":"))
