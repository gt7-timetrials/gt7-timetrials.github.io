import json, statistics as st
from datetime import datetime
import numpy as np
ts = lambda s: datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
S = json.load(open("data/summary.json"))
ev = json.load(open("data/events.json"))
rows = []
for s in S:
    if s["ongoing"] or round(s["dur"]) != 14: continue
    b = json.load(open(f"data/boards/{s['eid']}.json")); L = b["list"]
    start = ts(ev[str(s["eid"])]["online"]["begin_date"])
    rows.append((s, L, start))
# driver strength from all events (leave-one-out ignored for simplicity: small leakage)
from collections import defaultdict
gaps = defaultdict(list)
for s, L, _ in rows:
    for x in L: gaps[x["user"]["user_id"]].append(x["score"]/L[0]["score"]-1)
strong = {k for k, v in gaps.items() if len(v) >= 8 and st.median(v) < 0.004}
print("strong drivers:", len(strong), "events:", len(rows))
for d in (1, 2, 3, 5, 7):
    X, y = [], []
    for s, L, start in rows:
        seen = [x for x in L if ts(x["update_time"]) <= start + d*86400]
        if len(seen) < 10: continue
        sc = sorted(x["score"] for x in seen); best = sc[0]
        spread = sc[min(9, len(sc)-1)]/best - 1
        n_strong_in = sum(x["user"]["user_id"] in strong for x in seen)
        n_strong_tot = sum(x["user"]["user_id"] in strong for x in L)
        X.append([1, spread, n_strong_in/max(1, n_strong_tot)]); y.append(best/L[0]["score"] - 1)
    X, y = np.array(X), np.array(y)
    def loo(cols):
        err = []
        for i in range(len(y)):
            m = np.ones(len(y), bool); m[i] = False
            w, *_ = np.linalg.lstsq(X[m][:, cols], y[m], rcond=None)
            err.append(abs(X[i, cols] @ w - y[i]))
        return 100*np.median(err), 100*np.percentile(err, 90)
    print(f"day {d:>2} n={len(y):>2}  no-adjust err med/p90 {100*np.median(y):.3f}/{100*np.percentile(y,90):.3f}%  "
          f"time-only {loo([0])[0]:.3f}/{loo([0])[1]:.3f}  +spread {loo([0,1])[0]:.3f}/{loo([0,1])[1]:.3f}  "
          f"+spread+drivers {loo([0,1,2])[0]:.3f}/{loo([0,1,2])[1]:.3f}")
