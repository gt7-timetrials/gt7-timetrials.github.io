"""Backfill historic GT7 online time trials.

The API sits behind an AWS rate limit (HTTP 403 for a few minutes once
exceeded), so requests are sequential and throttled, and back off on 403.

Step 1 (scan):   python tools/backfill.py scan 13000 15300
    Calls /event/get_parameter for every id in range and keeps the time
    trials (event_title_key == "OnlineTA_General_Title") in data/events.json.
    Ids already checked are remembered in data/scan_state.json so a scan can
    be stopped and resumed.
Step 2 (boards): python tools/backfill.py boards
    Fetches the public top 100 + total entrants for every known event into
    data/boards/<event_id>.json (refetches only events that were still
    running when last fetched).
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

API = "https://web-api.gt7.game.gran-turismo.com"
DATA = os.environ.get("GT7_DATA") or os.path.join(os.path.dirname(__file__), "..", "data")
EVENTS = os.path.join(DATA, "events.json")
SCAN_STATE = os.path.join(DATA, "scan_state.json")
BOARDS = os.path.join(DATA, "boards")

delay = 2.0  # seconds between requests; grows after each rate-limit hit


def post(path, body):
    """POST and return parsed JSON, or None for 404. Waits out rate limits."""
    global delay
    req = urllib.request.Request(
        API + path, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"}
    )
    for attempt in range(6):
        time.sleep(delay)
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                return json.load(resp)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if e.code == 403:
                delay *= 1.5
                print(f"rate limited at {body}; waiting 6 min, delay now {delay:.1f}s", flush=True)
                time.sleep(360)
            else:
                print(f"HTTP {e.code} on {path} {body}", flush=True)
                time.sleep(10 * (attempt + 1))
        except (urllib.error.URLError, TimeoutError) as e:
            print(f"{e} on {path} {body}", flush=True)
            time.sleep(10 * (attempt + 1))
    raise RuntimeError(f"{path} {body} failed repeatedly")


def load_json(path, default):
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    return default


def save_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1, sort_keys=True)
    os.replace(tmp, path)


def scan(start, stop):
    events = load_json(EVENTS, {})
    scanned = set(load_json(SCAN_STATE, []))
    ids = [i for i in range(stop - 1, start - 1, -1) if i not in scanned]  # newest first
    for n, eid in enumerate(ids, 1):
        d = post("/event/get_parameter", {"event_id": eid})
        r = (d or {}).get("result")
        if r and r["event"].get("event_title_key") == "OnlineTA_General_Title":
            events[str(eid)] = r
            print(eid, r["online"].get("begin_date"), flush=True)
        scanned.add(eid)
        if n % 100 == 0 or n == len(ids):
            save_json(EVENTS, events)
            save_json(SCAN_STATE, sorted(scanned))
            print(f"... {n}/{len(ids)} scanned, {len(events)} time trials", flush=True)
    print(f"done: {len(events)} time trials")


def boards():
    now = datetime.now(timezone.utc).isoformat()
    for eid, ev in sorted(load_json(EVENTS, {}).items(), key=lambda kv: int(kv[0])):
        path = os.path.join(BOARDS, f"{eid}.json")
        if os.path.exists(path) and load_json(path, {})["fetched_at"] > ev["online"]["end_date"]:
            continue
        top = post("/ranking/get_top_list", {"board_id": ev["online"]["ranking_id"]})
        if not top or "result" not in top:
            print(eid, "no board", flush=True)
            continue
        save_json(path, {"event_id": int(eid), "fetched_at": now, **top["result"]})
        print(eid, "entrants", top["result"]["total"], flush=True)


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "scan":
        scan(int(sys.argv[2]), int(sys.argv[3]))
    elif cmd == "boards":
        boards()
