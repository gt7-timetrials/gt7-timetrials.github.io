"""Build the daily report for running time trials as a dict, text and Markdown."""
from zoneinfo import ZoneInfo

from .model import Predictor, entrant_projection, features, gold_time, historical_entrants

MELBOURNE = ZoneInfo("Australia/Melbourne")


def fmt_ms(ms):
    return f"{ms // 60000}:{ms % 60000 // 1000:02d}.{ms % 1000:03d}"


def build(store, at, boards_now):
    """boards_now: {event_id: latest top-100 result} for running events."""
    events = store.events()
    predictor = Predictor(store, events, at)
    strong = predictor.strong
    hist = historical_entrants(store, events, at)
    out = {"generated_at": at.isoformat(), "history_events": predictor.n_events,
           "snapshot_events": predictor.n_snapshot_events, "historical_entrants": hist, "events": []}
    for eid, board in sorted(boards_now.items()):
        ev = events[eid]
        entries = board["list"]
        if not entries:
            continue
        name, category = store.course(ev.course_code)
        elapsed = ev.elapsed_days(at)
        frac = elapsed / ev.duration_days
        f = features(entries, strong)
        wr = entries[0]["score"]
        item = {
            "event_id": eid,
            "track": name,
            "category": category,
            "car": store.car(entries[0]["ranking_stats"]["car_code"]),
            "starts": ev.start.astimezone(MELBOURNE).isoformat(),
            "ends": ev.end.astimezone(MELBOURNE).isoformat(),
            "days_elapsed": round(elapsed, 1),
            "days_left": round(ev.duration_days - elapsed, 1),
            "entrants": board["total"],
            "entrants_projection": entrant_projection(store, events, at, ev, board["total"]),
            "wr_ms": wr,
            "wr_holder": entries[0]["user"]["np_online_id"],
            "gold_now_ms": gold_time(wr),
            "top100_spread_pct": round(100 * f["spread100"], 3),
            "strong_drivers_posted": sorted(strong[x["user"]["user_id"]].name for x in entries
                                            if x["user"]["user_id"] in strong),
            "strong_drivers_total": len(strong),
            "regular_event": ev.is_general,
        }
        pred = predictor.predict(entries, frac)
        if pred:
            y, y_lo, y_hi = pred["y"], pred["low"], pred["high"]
            final_wr = round(wr / (1 + y))
            item["predicted"] = {
                "final_wr_ms": final_wr,
                "gold_ms": gold_time(final_wr),
                # more improvement still to come = faster time, so y_hi gives the fast end
                "gold_fast_ms": gold_time(round(wr / (1 + y_hi))),
                "gold_slow_ms": gold_time(round(wr / (1 + y_lo))),
                "method": pred["method"],
            }
        out["events"].append(item)
    return out


def to_text(rep):
    lines = []
    for e in rep["events"]:
        lines.append(f"{e['track']}  |  {e['car']}  |  event {e['event_id']}"
                     + ("" if e["regular_event"] else "  (special event)"))
        lines.append(f"  day {e['days_elapsed']:.1f} of {e['days_elapsed'] + e['days_left']:.0f}"
                     f"  ({e['days_left']:.1f} days left)")
        lines.append(f"  entrants        {e['entrants']:,}" + _entrants_suffix(e, rep))
        lines.append(f"  world record    {fmt_ms(e['wr_ms'])}  by {e['wr_holder']}")
        lines.append(f"  gold now        {fmt_ms(e['gold_now_ms'])}")
        p = e.get("predicted")
        if p:
            lines.append(f"  predicted gold  {fmt_ms(p['gold_ms'])}  (likely {fmt_ms(p['gold_fast_ms'])}"
                         f" - {fmt_ms(p['gold_slow_ms'])})   predicted final WR {fmt_ms(p['final_wr_ms'])}")
        else:
            lines.append("  predicted gold  not enough history for this point of the event yet")
        lines.append(f"  top-100 spread  {e['top100_spread_pct']:.2f}%")
        lines.append(f"  top drivers in  {len(e['strong_drivers_posted'])}/{e['strong_drivers_total']}"
                     + (f": {', '.join(e['strong_drivers_posted'])}" if e["strong_drivers_posted"] else ""))
        lines.append("")
    lines.append(_footer(rep))
    return "\n".join(lines)


def _entrants_suffix(e, rep):
    pr = e["entrants_projection"]
    if pr:
        return f"  (projected final {pr['projected']:,}, likely {pr['low']:,}-{pr['high']:,})"
    h = rep["historical_entrants"]
    if h:
        return f"  (past events finish with {h['p10']:,}-{h['p90']:,}, median {h['median']:,})"
    return ""


def _footer(rep):
    methods = sorted({e["predicted"]["method"] for e in rep["events"] if e.get("predicted")})
    return (f"Prediction: {'; '.join(methods) or 'n/a'}. History: {rep['history_events']} finished events,"
            f" {rep['snapshot_events']} with daily snapshots.")


def to_markdown(rep):
    at = rep["generated_at"]
    md = [f"# GT7 time trials\n", f"Updated {at[:16].replace('T', ' ')} UTC\n"]
    for e in rep["events"]:
        p = e.get("predicted")
        md.append(f"## {e['track']} — {e['car']}\n")
        md.append(f"Day {e['days_elapsed']:.1f} of {e['days_elapsed'] + e['days_left']:.0f}"
                  f" · event {e['event_id']}" + ("" if e["regular_event"] else " · special event") + "\n")
        md.append("| | |\n|---|---|")
        md.append(f"| Entrants | {e['entrants']:,}{_entrants_suffix(e, rep)} |")
        md.append(f"| World record | {fmt_ms(e['wr_ms'])} ({e['wr_holder']}) |")
        md.append(f"| Gold now | {fmt_ms(e['gold_now_ms'])} |")
        if p:
            md.append(f"| **Predicted gold** | **{fmt_ms(p['gold_ms'])}** "
                      f"(likely {fmt_ms(p['gold_fast_ms'])} – {fmt_ms(p['gold_slow_ms'])}) |")
            md.append(f"| Predicted final WR | {fmt_ms(p['final_wr_ms'])} |")
        md.append(f"| Top-100 spread | {e['top100_spread_pct']:.2f}% |")
        md.append(f"| Top drivers posted | {len(e['strong_drivers_posted'])} of {e['strong_drivers_total']} |\n")
    md.append(f"_{_footer(rep)}_\n")
    return "\n".join(md)
