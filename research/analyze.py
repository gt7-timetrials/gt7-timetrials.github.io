import csv, json, os, sys, statistics as st
from collections import defaultdict
from datetime import datetime

ROOT = sys.argv[1]
REF = sys.argv[2]
events = {int(k): v for k, v in json.load(open(f"{ROOT}/data/events.json")).items()}
courses = {int(r["ID"]): r for r in csv.DictReader(open(f"{REF}/course.csv"))}
cars = {int(r["ID"]): r["ShortName"] for r in csv.DictReader(open(f"{REF}/cars.csv"))}
ts = lambda s: datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()

rows = []
for eid, ev in sorted(events.items()):
    p = f"{ROOT}/data/boards/{eid}.json"
    if not os.path.exists(p): continue
    b = json.load(open(p))
    L = b.get("list") or []
    if len(L) < 100: continue
    start, end = ts(ev["online"]["begin_date"]), ts(ev["online"]["end_date"])
    dur = (end - start) / 86400
    wr = L[0]["score"]
    c = courses.get(ev["track"]["course_code"], {})
    car = st.mode(x["ranking_stats"]["car_code"] for x in L)
    # upper-bound reconstruction of WR at day d from final top-100 update times
    def best_by(day):
        s = [x["score"] for x in L if ts(x["update_time"]) <= start + day * 86400]
        return min(s) if s else None
    rows.append(dict(eid=eid, start=ev["online"]["begin_date"][:10], dur=dur, total=b["total"], wr=wr,
        p10=L[9]["score"] / wr - 1, p100=L[99]["score"] / wr - 1, course=c.get("Name", ev["track"]["course_code"]),
        cat=c.get("Category", "?"), car=cars.get(car, car), wr_day=(ts(L[0]["update_time"]) - start) / 86400,
        best={d: best_by(d) for d in range(1, 15)}, L=L, ongoing=b["fetched_at"] < ev["online"]["end_date"]))

done = [r for r in rows if not r["ongoing"]]
print("events with boards:", len(rows), "finished:", len(done))
print("date range:", rows[0]["start"], "->", rows[-1]["start"])
print("durations (days):", sorted(set(round(r["dur"]) for r in rows)))
print("categories:", {k: sum(r["cat"] == k for r in done) for k in set(r["cat"] for r in done)})
print("entrants: median %d  min %d  max %d" % (st.median(r["total"] for r in done), min(r["total"] for r in done), max(r["total"] for r in done)))
print("P100 gap %%: median %.2f  p10 %.2f  p90 %.2f" % tuple(100 * x for x in (st.median(r["p100"] for r in done),
      *[sorted(r["p100"] for r in done)[int(q * len(done))] for q in (0.1, 0.9)])))
print("day final WR set: median %.1f  quartiles %s" % (st.median(r["wr_day"] for r in done),
      [round(x, 1) for x in st.quantiles([r["wr_day"] for r in done], n=4)]))

# how much the (reconstructed) best time still drops after day d, by d
print("\nremaining improvement after day d (reconstructed best_by_d / final WR - 1), 14-day events")
print("day  median%  p90%   max%   share already final")
for d in (1, 2, 3, 5, 7, 10, 12):
    g = [r["best"][d] / r["wr"] - 1 for r in done if round(r["dur"]) == 14 and r["best"][d]]
    if g:
        g.sort()
        print(f"{d:>3}  {100*st.median(g):6.3f}  {100*g[int(.9*len(g))]:6.3f}  {100*g[-1]:6.3f}  {sum(x == 0 for x in g)/len(g):.0%}")

# drivers
drv = defaultdict(list)
for r in done:
    for x in r["L"]:
        drv[x["user"]["user_id"]].append((r["eid"], x["score"] / r["wr"] - 1, r["cat"]))
counts = sorted((len(v) for v in drv.values()), reverse=True)
print("\nunique top-100 drivers:", len(drv), " with >=10 appearances:", sum(c >= 10 for c in counts),
      " >=30:", sum(c >= 30 for c in counts))
names = {x["user"]["user_id"]: x["user"]["np_online_id"] for r in done for x in r["L"]}
top = sorted(((st.median(g for _, g, _ in v), len(v), k) for k, v in drv.items() if len(v) >= 15))[:15]
print("best median gap (>=15 events):")
for m, n, k in top: print(f"  {names[k]:<22} {n:>3} events  median gap {100*m:.3f}%")
for cat in ("circuit", "snow_dirt", "city", "original"):
    wins = defaultdict(int)
    for r in done:
        if r["cat"] == cat: wins[names[r["L"][0]["user"]["user_id"]]] += 1
    print(cat, "WR holders:", sorted(wins.items(), key=lambda kv: -kv[1])[:5])
json.dump([{k: v for k, v in r.items() if k != "L"} for r in rows], open(f"{ROOT}/data/summary.json", "w"), indent=1, default=str)
for r in rows[-8:]:
    print(r["eid"], r["start"], r["course"], "|", r["car"], "| entrants", r["total"], "| WR day %.1f" % r["wr_day"])
