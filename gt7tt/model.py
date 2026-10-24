"""Driver ratings, final world record / gold time prediction, entrant projection.

Prediction target: how much faster the final world record (WR) will be than
the best time on the board now, as a fraction: y = current_best / final_wr - 1.

Training samples come from finished events in two forms:
  * reconstructed - from each final top 100, the board as it looked on day d
    is approximated by the entries whose final time was set by day d. This
    overstates early gaps (earlier, slower laps are not visible) but exists
    for every historic event.
  * real - daily snapshots collected by the daily job.
The top-100 spread (how far P100 is behind P1) measures course difficulty.
Backtests show the *final* spread cuts early-event error by about a quarter,
but early in a live event the top 100 is still forming and is wider than it
will end up. So the spread is used through a calibration: once
MIN_CALIBRATION_EVENTS finished events have daily snapshots, the typical
final/live spread ratio for each day turns today's live spread into an
estimated final spread. Once MIN_REAL_EVENTS finished events have snapshots
the model is fitted on real snapshots directly.

A separate least-squares fit is made for each fraction-of-event bin, and the
likely range comes from leave-one-event-out residuals in that bin.
"""
import math
import statistics as st
from collections import defaultdict
from dataclasses import dataclass

import numpy as np

from .store import parse_time

GOLD = 1.03
N_BINS = 14  # one per day of a 14-day event
MIN_REAL_EVENTS = 15
MIN_CALIBRATION_EVENTS = 3
STRONG_DRIVERS = 25
MIN_APPEARANCES = 6
PRIOR_GAP, PRIOR_WEIGHT = 0.012, 2  # shrink sparse drivers towards a P100-ish gap

FEATURES_BASE = ("const", "strong")
FEATURES_WITH_SPREAD = ("const", "strong", "final_spread")
FEATURES_REAL = ("const", "strong", "spread100")


# ---------------------------------------------------------------- ratings

@dataclass
class Driver:
    user_id: str
    name: str
    appearances: int
    median_gap: float  # median % behind the WR when in the final top 100
    rating: float  # median gap shrunk towards PRIOR_GAP; lower is faster
    participation: float  # share of events entered (top 100) since first seen


def finished_events(store, events, at):
    """[(event, final_board)] for regular events that ended and have a full final board."""
    out = []
    for ev in sorted(events.values(), key=lambda e: e.start):
        if not ev.is_general or ev.end > at:
            continue
        b = store.final_board(ev)
        if b and len(b["list"]) >= 100:
            out.append((ev, b))
    return out


def rate_drivers(finished, exclude=None):
    gaps, names, first = defaultdict(list), {}, {}
    for i, (ev, b) in enumerate(finished):
        if ev.id == exclude:
            continue
        wr = b["list"][0]["score"]
        for x in b["list"]:
            uid = x["user"]["user_id"]
            gaps[uid].append(x["score"] / wr - 1)
            names[uid] = x["user"]["np_online_id"]
            first.setdefault(uid, i)
    n_events = len(finished)
    drivers = {}
    for uid, g in gaps.items():
        med = st.median(g)
        drivers[uid] = Driver(
            uid, names[uid], len(g), med,
            (len(g) * med + PRIOR_WEIGHT * PRIOR_GAP) / (len(g) + PRIOR_WEIGHT),
            len(g) / max(1, n_events - first[uid]),
        )
    return drivers


def strong_drivers(drivers):
    pool = [d for d in drivers.values() if d.appearances >= MIN_APPEARANCES]
    return {d.user_id: d for d in sorted(pool, key=lambda d: d.rating)[:STRONG_DRIVERS]}


# ---------------------------------------------------------------- features

def features(entries, strong):
    """Features of a board (entries sorted by score). Needs at least 1 entry."""
    scores = sorted(x["score"] for x in entries)
    best = scores[0]
    seen = sum(x["user"]["user_id"] in strong for x in entries)
    expected = sum(d.participation for d in strong.values()) or 1
    return {
        "const": 1.0,
        "strong": seen / expected,
        "spread100": scores[min(100, len(scores)) - 1] / best - 1,
        "best": best,
        "strong_seen": seen,
    }


def final_spread(board):
    return board["list"][99]["score"] / board["list"][0]["score"] - 1


def bin_of(fraction):
    return min(N_BINS - 1, max(0, int(fraction * N_BINS)))


def reconstructed_samples(ev, board, strong):
    wr = board["list"][0]["score"]
    out = []
    for b in range(N_BINS - 1):
        cutoff = ev.start.timestamp() + (b + 1) / N_BINS * ev.duration_days * 86400
        seen = [x for x in board["list"] if parse_time(x["update_time"]).timestamp() <= cutoff]
        if len(seen) >= 10:
            f = features(seen, strong)
            f["final_spread"] = final_spread(board)
            out.append((b, f, f["best"] / wr - 1))
    return out


def real_samples(ev, board, snapshots, strong):
    wr = board["list"][0]["score"]
    out = []
    for snap in snapshots:
        if not snap["list"]:
            continue
        frac = ev.elapsed_days(parse_time(snap["fetched_at"])) / ev.duration_days
        if 0 <= frac < 1:
            f = features(snap["list"], strong)
            out.append((bin_of(frac), f, f["best"] / wr - 1))
    return out


# ---------------------------------------------------------------- model

class Model:
    def __init__(self, samples_by_event, feature_names, kind, intervals=True):
        """samples_by_event: {event_id: [(bin, features, y)]}"""
        self.feature_names = feature_names
        self.kind = kind
        self.n_events = len(samples_by_event)
        self.fits = {}
        for b in range(N_BINS):
            rows = [(eid, f, y) for eid, s in samples_by_event.items() for bb, f, y in s if bb == b]
            if len(rows) < 8:
                continue
            X = np.array([[f[k] for k in feature_names] for _, f, _ in rows])
            y = np.array([y for _, _, y in rows])
            eids = np.array([eid for eid, _, _ in rows])
            w = np.linalg.lstsq(X, y, rcond=None)[0]
            resid = [] if intervals else [0.0]
            for eid in set(eids) if intervals else ():  # leave one event out
                m = eids != eid
                wl = np.linalg.lstsq(X[m], y[m], rcond=None)[0]
                resid.extend(y[~m] - X[~m] @ wl)
            self.fits[b] = (w, np.percentile(resid, 10), np.percentile(resid, 90), len(set(eids)))

    def predict(self, feats, fraction):
        """Return (y, y_low, y_high) or None if no fit is available near this point."""
        b = bin_of(fraction)
        candidates = [bb for bb in self.fits if abs(bb - b) <= 2]
        if not candidates:
            return None
        w, lo, hi, _ = self.fits[min(candidates, key=lambda bb: abs(bb - b))]
        y = float(np.array([feats[k] for k in self.feature_names]) @ w)
        y = max(0.0, y)
        return y, max(0.0, y + lo), max(0.0, y + hi)


def spread_calibration(store, finished):
    """{bin: median final/live top-100 spread ratio} from finished events' snapshots."""
    ratios = defaultdict(dict)
    for ev, b in finished:
        for snap in store.snapshots(ev.id):
            if len(snap["list"]) < 100:
                continue
            frac = ev.elapsed_days(parse_time(snap["fetched_at"])) / ev.duration_days
            live = features(snap["list"], {})["spread100"]
            if 0 <= frac < 1 and live > 0:
                ratios[bin_of(frac)][ev.id] = final_spread(b) / live
    return {k: st.median(v.values()) for k, v in ratios.items() if len(v) >= MIN_CALIBRATION_EVENTS}


class Predictor:
    """Chooses the best model the collected data supports and predicts from a live board."""

    def __init__(self, store, events, at):
        finished = finished_events(store, events, at)
        self.strong = strong_drivers(rate_drivers(finished))
        real = {}
        for ev, b in finished:
            s = real_samples(ev, b, store.snapshots(ev.id), self.strong)
            if s:
                real[ev.id] = s
        self.calibration = {}
        if len(real) >= MIN_REAL_EVENTS:
            self.model = Model(real, FEATURES_REAL, "real daily snapshots")
            self.spread_model = None
        else:
            recon = {ev.id: reconstructed_samples(ev, b, self.strong) for ev, b in finished}
            self.model = Model(recon, FEATURES_BASE, "history: time elapsed + top drivers")
            self.calibration = spread_calibration(store, finished)
            self.spread_model = (Model(recon, FEATURES_WITH_SPREAD, "history: time elapsed + top drivers"
                                       " + top-100 spread") if self.calibration else None)
        self.n_events = len(finished)
        self.n_snapshot_events = len(real)

    def predict(self, entries, fraction):
        """{y, low, high, method} for a live board, or None if no fit is near this point."""
        f = features(entries, self.strong)
        b = bin_of(fraction)
        near = [k for k in self.calibration if abs(k - b) <= 1]
        if self.spread_model and near and len(entries) >= 100:
            f["final_spread"] = f["spread100"] * self.calibration[min(near, key=lambda k: abs(k - b))]
            p = self.spread_model.predict(f, fraction)
            if p:
                return dict(zip(("y", "low", "high"), p), method=self.spread_model.kind)
        p = self.model.predict(f, fraction)
        return dict(zip(("y", "low", "high"), p), method=self.model.kind) if p else None


def gold_time(wr_ms):
    return math.floor(wr_ms * GOLD)


# ---------------------------------------------------------------- entrants

def entrant_projection(store, events, at, ev, total_now):
    """Projected final entrant count from real snapshots of finished events, or None."""
    frac_now = ev.elapsed_days(at) / ev.duration_days
    ratios = []
    for past, b in finished_events(store, events, at):
        best = None
        for snap in store.snapshots(past.id):
            frac = past.elapsed_days(parse_time(snap["fetched_at"])) / past.duration_days
            if best is None or abs(frac - frac_now) < abs(best[0] - frac_now):
                best = (frac, snap["total"] / b["total"])
        if best and abs(best[0] - frac_now) <= 1 / N_BINS:
            ratios.append(best[1])
    if len(ratios) < 3:
        return None
    r = st.median(ratios)
    lo, hi = (np.percentile(ratios, 90), np.percentile(ratios, 10)) if len(ratios) >= 5 else (max(ratios), min(ratios))
    return {"projected": round(total_now / r), "low": round(total_now / lo), "high": round(total_now / hi),
            "events": len(ratios)}


def historical_entrants(store, events, at):
    totals = [b["total"] for _, b in finished_events(store, events, at)]
    if not totals:
        return None
    return {"median": int(st.median(totals)), "p10": int(np.percentile(totals, 10)),
            "p90": int(np.percentile(totals, 90)), "events": len(totals)}


# ---------------------------------------------------------------- backtest

def backtest(store, events, at, feature_sets):
    """Leave-one-event-out error of the reconstructed-history model.

    Returns {feature_set: {bin: (median_abs_err, p90_abs_err, n)}} in fractions.
    Ratings and fits exclude the held-out event, so there is no leakage.
    """
    finished = finished_events(store, events, at)
    errs = {fs: defaultdict(list) for fs in feature_sets}
    for ev, b in finished:
        others = [(e, bb) for e, bb in finished if e.id != ev.id]
        strong = strong_drivers(rate_drivers(others))
        train = {e.id: reconstructed_samples(e, bb, strong) for e, bb in others}
        test = reconstructed_samples(ev, b, strong)
        for fs in feature_sets:
            m = Model(train, fs, "backtest", intervals=False)
            for bin_, f, y in test:
                if bin_ in m.fits:
                    w = m.fits[bin_][0]
                    pred = max(0.0, float(np.array([f[k] for k in fs]) @ w))
                    errs[fs][bin_].append(abs(pred - y))
    return {fs: {b: (float(np.median(v)), float(np.percentile(v, 90)), len(v)) for b, v in sorted(e.items())}
            for fs, e in errs.items()}
