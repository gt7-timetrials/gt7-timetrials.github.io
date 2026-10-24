"""Command line entry point: python -m gt7tt <command>

  daily     fetch current time trials, save snapshots and final boards,
            write REPORT.md and report.json, print the report
  report    print the report from the latest saved snapshots (no network)
  backtest  leave-one-event-out accuracy of the prediction features
"""
import argparse
import json
import os
import sys
from datetime import datetime

from . import api, model, report
from .store import Store, now_utc, parse_time

ROOT = os.path.join(os.path.dirname(__file__), "..")
MAX_FINAL_FETCHES = 50  # per run, to stay well inside the rate limit


def daily(store, args):
    at = now_utc()
    local = at.astimezone(report.MELBOURNE)
    marker = os.path.join(store.root, "last_daily_run.txt")
    if args.not_before_hour is not None:
        # Scheduled runs fire at several UTC times (daylight saving, GitHub delays);
        # only the first one at or after this Melbourne hour each day does the work.
        last = open(marker).read().strip() if os.path.exists(marker) else ""
        if local.hour < args.not_before_hour or last == local.date().isoformat():
            print(f"Melbourne time {local:%Y-%m-%d %H:%M}: not due; nothing to do.")
            return
    client = api.Client()
    store.save_events(client.time_trials())
    events = store.events()

    boards_now = {}
    for ev in events.values():
        if ev.running(at):
            result = client.top100(ev.board_id)
            if result:
                store.save_snapshot(ev.id, result, at)
                store.save_board(ev.id, result, at)
                boards_now[ev.id] = result

    pending = [ev for ev in events.values() if ev.end < at and not store.final_board(ev)]
    for ev in sorted(pending, key=lambda e: e.end, reverse=True)[:MAX_FINAL_FETCHES]:
        result = client.top100(ev.board_id)
        if result:
            store.save_board(ev.id, result, at)

    write_report(store, at, boards_now)
    with open(marker, "w") as f:
        f.write(local.date().isoformat() + "\n")


def latest_boards(store, at):
    boards = {}
    for ev in store.events().values():
        if ev.running(at):
            snaps = store.snapshots(ev.id)
            if snaps:
                boards[ev.id] = snaps[-1]
    return boards


def write_report(store, at, boards_now):
    rep = report.build(store, at, boards_now)
    with open(os.path.join(ROOT, "report.json"), "w", encoding="utf-8") as f:
        json.dump(rep, f, ensure_ascii=False, indent=1)
    with open(os.path.join(ROOT, "REPORT.md"), "w", encoding="utf-8") as f:
        f.write(report.to_markdown(rep))
    print(report.to_text(rep))


def show_report(store, args):
    at = parse_time(args.at) if args.at else now_utc()
    boards = latest_boards(store, at)
    if not boards:
        print("No snapshots of running time trials saved yet; run `python -m gt7tt daily` first.")
        return
    print(report.to_text(report.build(store, at, boards)))


def backtest(store, args):
    at = now_utc()
    sets = [("const",), ("const", "strong"), ("const", "spread100"), ("const", "strong", "spread100")]
    res = model.backtest(store, store.events(), at, sets)
    n = len(model.finished_events(store, store.events(), at))
    print(f"Leave-one-event-out error of predicted final WR, reconstructed history, {n} events")
    print("median / 90th percentile absolute error, % of lap time\n")
    print("day  " + "  ".join(f"{'+'.join(s[1:]) or 'time only':>22}" for s in sets))
    for b in range(model.N_BINS - 1):
        cells = []
        for s in sets:
            v = res[s].get(b)
            cells.append(f"{100 * v[0]:9.3f} / {100 * v[1]:.3f}" if v else " " * 18)
        print(f"{b + 1:>3}  " + "  ".join(f"{c:>22}" for c in cells))


def main(argv=None):
    p = argparse.ArgumentParser(prog="gt7tt", description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    d = sub.add_parser("daily")
    d.add_argument("--not-before-hour", type=int,
                   help="skip unless it is at least this hour in Melbourne and today's run has not happened")
    r = sub.add_parser("report")
    r.add_argument("--at", help="ISO time to report as of (default now)")
    sub.add_parser("backtest")
    args = p.parse_args(argv)
    store = Store()
    {"daily": daily, "report": show_report, "backtest": backtest}[args.cmd](store, args)


if __name__ == "__main__":
    sys.exit(main())
