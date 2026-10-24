"""On-disk data layout (all JSON, committed to the repo by the daily job).

data/events.json                     {event_id: event parameters}
data/boards/<event_id>.json          final (or latest) public top 100 + total
data/snapshots/<event_id>/<date>.json  daily top 100 + total while running
data/ref/course.csv, cars.csv        name lookups (from ddm999/gt7info)
"""
import csv
import glob
import json
import os
from dataclasses import dataclass
from datetime import datetime, timezone

DATA = os.environ.get("GT7_DATA") or os.path.join(os.path.dirname(__file__), "..", "data")
GENERAL_TITLE = "OnlineTA_General_Title"


def parse_time(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def load_json(path, default=None):
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    return default


def save_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1, sort_keys=True)
    os.replace(tmp, path)


def slim_entry(x):
    """Keep only the fields we use, so daily snapshots stay small."""
    u = x["user"]
    return {
        "display_rank": x["display_rank"],
        "score": x["score"],
        "update_time": x["update_time"],
        "ranking_stats": {"car_code": x["ranking_stats"]["car_code"]},
        "user": {k: u.get(k) for k in ("user_id", "np_online_id", "country_code", "driver_rating")},
    }


@dataclass
class Event:
    id: int
    params: dict

    @property
    def start(self):
        return parse_time(self.params["online"]["begin_date"])

    @property
    def end(self):
        return parse_time(self.params["online"]["end_date"])

    @property
    def board_id(self):
        return self.params["online"]["ranking_id"]

    @property
    def duration_days(self):
        return (self.end - self.start).total_seconds() / 86400

    @property
    def is_general(self):
        """Regular fortnightly/weekly time trial (not a sponsored one-off)."""
        return self.params["event"].get("event_title_key") == GENERAL_TITLE

    @property
    def course_code(self):
        return self.params["track"]["course_code"]

    def elapsed_days(self, at):
        return (at - self.start).total_seconds() / 86400

    def running(self, at):
        return self.start <= at <= self.end


class Store:
    def __init__(self, root=DATA):
        self.root = root

    # events
    def events(self):
        raw = load_json(os.path.join(self.root, "events.json"), {})
        return {int(k): Event(int(k), v) for k, v in raw.items()}

    def save_events(self, params_by_id):
        path = os.path.join(self.root, "events.json")
        raw = load_json(path, {})
        raw.update({str(k): v for k, v in params_by_id.items()})
        save_json(path, raw)

    # final / latest boards
    def board(self, event_id):
        return load_json(os.path.join(self.root, "boards", f"{event_id}.json"))

    def save_board(self, event_id, result, fetched_at):
        save_json(
            os.path.join(self.root, "boards", f"{event_id}.json"),
            {"event_id": event_id, "fetched_at": fetched_at.isoformat(), "total": result["total"],
             "list": [slim_entry(x) for x in result["list"]]},
        )

    def final_board(self, event):
        """The board fetched after the event ended, or None."""
        b = self.board(event.id)
        if b and parse_time(b["fetched_at"]) > event.end and len(b.get("list", [])) >= 1:
            return b
        return None

    # daily snapshots
    def save_snapshot(self, event_id, result, fetched_at):
        save_json(
            os.path.join(self.root, "snapshots", str(event_id), fetched_at.strftime("%Y-%m-%d") + ".json"),
            {"event_id": event_id, "fetched_at": fetched_at.isoformat(), "total": result["total"],
             "list": [slim_entry(x) for x in result["list"]]},
        )

    def snapshots(self, event_id):
        paths = sorted(glob.glob(os.path.join(self.root, "snapshots", str(event_id), "*.json")))
        return [load_json(p) for p in paths]

    # name lookups
    def _csv(self, name):
        path = os.path.join(self.root, "ref", name)
        if not os.path.exists(path):
            return {}
        with open(path, encoding="utf-8") as f:
            return {int(r["ID"]): r for r in csv.DictReader(f)}

    def course(self, code):
        if not hasattr(self, "_courses"):
            self._courses = self._csv("course.csv")
        r = self._courses.get(code)
        return (r["Name"], r["Category"]) if r else (f"course {code}", "unknown")

    def car(self, code):
        if not hasattr(self, "_cars"):
            self._cars = self._csv("cars.csv")
        r = self._cars.get(code)
        return r["ShortName"] if r else f"car {code}"


def now_utc():
    return datetime.now(timezone.utc)
