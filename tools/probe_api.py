"""Quick check of the GT7 website API for a time trial event.

Usage:  python tools/probe_api.py 15000

Prints the event window, world record, top-100 spread, total entrants
and the gold time (WR x 1.03). Uses only the standard library.
"""
import json
import sys
import urllib.error
import urllib.request

API = "https://web-api.gt7.game.gran-turismo.com"


def post(path, body):
    req = urllib.request.Request(
        API + path,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as e:
        return {"error": {"http": e.code}}


def fmt(ms):
    return f"{ms // 60000}:{ms % 60000 // 1000:02d}.{ms % 1000:03d}"


def main(event_id):
    params = post("/event/get_parameter", {"event_id": event_id})
    if "result" not in params:
        sys.exit(f"event {event_id}: {params}")
    online = params["result"]["online"]
    board_id = online["ranking_id"]
    print(f"event {event_id}  board {board_id}  {online['begin_date']} -> {online['end_date']}")

    top = post("/ranking/get_top_list", {"board_id": board_id})
    if "result" not in top:
        sys.exit(f"top list: {top}")
    entries = top["result"]["list"]
    wr = entries[0]["score"]
    gold = int(wr * 1.03)
    print(f"total entrants : {top['result']['total']:,}")
    print(f"world record   : {fmt(wr)}  by {entries[0]['user']['np_online_id']}")
    for rank in (10, 50, 100):
        if len(entries) >= rank:
            s = entries[rank - 1]["score"]
            print(f"P{rank:<3} time      : {fmt(s)}  (+{(s / wr - 1) * 100:.2f}%)")
    print(f"gold (WR+3%)   : {fmt(gold)}")

    # Full pages need a signed-in PSN token; report whether we got one.
    page = post("/ranking/get_list_by_page", {"board_id": board_id, "page": 0})
    print("full pages     :", "available" if "result" in page else f"unavailable {page['error']}")


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 15000)
