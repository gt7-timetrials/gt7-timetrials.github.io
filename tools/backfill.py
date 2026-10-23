"""Backfill historic GT7 online time trials.

Step 1 (scan):  python tools/backfill.py scan 1 15300
    Calls /event/get_parameter for every id in range and keeps the time
    trials (event_title_key == "OnlineTA_General_Title") in data/events.json.
Step 2 (boards): python tools/backfill.py boards
    Fetches the public top 100 + total entrants for every known event into
    data/boards/<event_id>.json (skips ones already downloaded unless the
    event was still running when fetched).
"""
import concurrent.futures as cf
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

API = "https://web-api.gt7.game.gran-turismo.com"
DATA = os.path.join(os.path.dirname(__file__), "..", "data")
EVENTS = os.path.join(DATA, "events.json")
BOARDS = os.path.join(DATA, "boards")


def post(path, body, retries=3):
    req = urllib.request.Request(
        API + path, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"}
    )
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                return json.load(resp)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            time.sleep(2 ** attempt)
        except (urllib.error.URLError, TimeoutError):
            time.sleep(2 ** attempt)
    raise RuntimeError(f"{path} {body} failed after {retries} attempts")


def load_events():
    if os.path.exists(EVENTS):
        with open(EVENTS) as f:
            return {int(k): v for k, v in json.load(f).items()}
    return {}


def save_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1, sort_keys=True)
    os.replace(tmp, path)


def scan(start, stop, workers=3):
    events = load_events()

    def fetch(eid):
        d = post("/event/get_parameter", {"event_id": eid})
        return eid, (d or {}).get("result")

    ids = [i for i in range(start, stop) if i not in events]
    with cf.ThreadPoolExecutor(workers) as ex:
        for n, (eid, r) in enumerate(ex.map(fetch, ids), 1):
            if r and r["event"].get("event_title_key") == "OnlineTA_General_Title":
                events[eid] = r
                print(eid, r["online"].get("begin_date"), flush=True)
            if n % 1000 == 0:
                save_json(EVENTS, events)
                print(f"... {n}/{len(ids)} scanned, {len(events)} time trials", flush=True)
    save_json(EVENTS, events)
    print(f"done: {len(events)} time trials")


def boards():
    now = datetime.now(timezone.utc).isoformat()
    for eid, ev in sorted(load_events().items()):
        path = os.path.join(BOARDS, f"{eid}.json")
        if os.path.exists(path):
            with open(path) as f:
                if json.load(f)["fetched_at"] > ev["online"]["end_date"]:
                    continue
        top = post("/ranking/get_top_list", {"board_id": ev["online"]["ranking_id"]})
        if not top or "result" not in top:
            print(eid, "no board", flush=True)
            continue
        save_json(path, {"event_id": eid, "fetched_at": now, **top["result"]})
        print(eid, top["result"]["total"], flush=True)
        time.sleep(0.3)


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "scan":
        scan(int(sys.argv[2]), int(sys.argv[3]))
    elif cmd == "boards":
        boards()
