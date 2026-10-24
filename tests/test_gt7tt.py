"""Run with: python -m unittest discover tests"""
import json
import os
import random
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

from gt7tt import model, report, site
from gt7tt.store import Store, slim_entry

FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures")
T0 = datetime(2026, 1, 1, 7, tzinfo=timezone.utc)


def iso(t):
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


def entry(rank, score, uid, at):
    return {"display_rank": rank, "score": score, "update_time": iso(at),
            "ranking_stats": {"car_code": 1}, "user": {"user_id": uid, "np_online_id": uid,
                                                       "country_code": "AU", "driver_rating": 5}}


def synthetic_store(root, n_events=20, seed=1):
    """Events where the WR keeps falling over 14 days and driver d0..d9 are fastest."""
    rng = random.Random(seed)
    store, params = Store(root), {}
    for i in range(n_events):
        start = T0 + timedelta(days=14 * i)
        end = start + timedelta(days=14) - timedelta(seconds=1)
        params[i + 1] = {"online": {"begin_date": iso(start), "end_date": iso(end), "ranking_id": f"b{i}"},
                         "event": {"event_title_key": "OnlineTA_General_Title"},
                         "track": {"course_code": 1}}
        base = 100_000
        drivers = [(f"d{j}", base * (1 + 0.0004 * j + rng.random() * 0.0005), rng.random() * 13)
                   for j in range(120)]
        drivers.sort(key=lambda d: d[1])
        lst = [entry(r + 1, round(s), uid, start + timedelta(days=day)) for r, (uid, s, day) in enumerate(drivers[:100])]
        store.save_board(i + 1, {"total": 1000, "list": lst}, end + timedelta(hours=1))
    store.save_events(params)
    return store


class ModelTest(unittest.TestCase):
    def test_gold_time_floors(self):
        self.assertEqual(model.gold_time(110146), 113450)

    def test_fmt(self):
        self.assertEqual(report.fmt_ms(113450), "1:53.450")
        self.assertEqual(report.fmt_ms(40520), "0:40.520")

    def test_slim_entry_keeps_needed_fields(self):
        with open(os.path.join(FIXTURES, "ranking_15000_get_top_list.json")) as f:
            x = json.load(f)["result"]["list"][0]
        s = slim_entry(x)
        self.assertEqual(s["score"], x["score"])
        self.assertEqual(s["user"]["user_id"], x["user"]["user_id"])

    def test_ratings_rank_fastest_first(self):
        with tempfile.TemporaryDirectory() as d:
            store = synthetic_store(d)
            fin = model.finished_events(store, store.events(), T0 + timedelta(days=400))
            strong = model.strong_drivers(model.rate_drivers(fin))
            self.assertIn("d0", strong)
            self.assertNotIn("d99", strong)

    def test_prediction_is_never_slower_than_current_wr(self):
        with tempfile.TemporaryDirectory() as d:
            store = synthetic_store(d)
            at = T0 + timedelta(days=400)
            p = model.Predictor(store, store.events(), at)
            self.assertIsNone(p.spread_model)  # no snapshots yet, so no spread calibration
            r = p.predict(store.board(1)["list"][50:], 2 / 14)
            self.assertGreaterEqual(r["y"], 0)
            self.assertLessEqual(r["low"], r["y"])
            self.assertGreaterEqual(r["high"], r["y"])

    def test_spread_calibration_switches_on_with_snapshots(self):
        with tempfile.TemporaryDirectory() as d:
            store = synthetic_store(d)
            for eid in (1, 2, 3):
                ev = store.events()[eid]
                board = store.board(eid)
                store.save_snapshot(eid, board, ev.start + timedelta(days=2, hours=3))
            p = model.Predictor(store, store.events(), T0 + timedelta(days=400))
            self.assertIn(2, p.calibration)
            r = p.predict(store.board(4)["list"], 2.2 / 14)
            self.assertIn("spread", r["method"])

    def test_report_builds(self):
        with tempfile.TemporaryDirectory() as d:
            store = synthetic_store(d)
            at = T0 + timedelta(days=14 * 19 + 3)  # day 3 of the last event
            board = store.board(20)
            board["list"] = [x for x in board["list"] if x["update_time"] <= iso(at)]
            rep = report.build(store, at, {20: board})
            self.assertEqual(len(rep["events"]), 1)
            e = rep["events"][0]
            self.assertIn("predicted", e)
            self.assertLessEqual(e["predicted"]["gold_ms"], e["gold_now_ms"])
            self.assertIn("Predicted gold", report.to_markdown(rep))


class SiteTest(unittest.TestCase):
    def test_wr_steps_only_record_improvements(self):
        with tempfile.TemporaryDirectory() as d:
            store = synthetic_store(d)
            ev = store.events()[1]
            steps = site.wr_steps(ev, store.board(1)["list"])
            self.assertEqual(steps[-1]["wr_ms"], min(x["score"] for x in store.board(1)["list"]))
            self.assertTrue(all(a["wr_ms"] > b["wr_ms"] for a, b in zip(steps, steps[1:])))
            self.assertTrue(all(a["day"] <= b["day"] for a, b in zip(steps, steps[1:])))

    def test_scorecard_compares_logged_predictions_with_final_gold(self):
        with tempfile.TemporaryDirectory() as d:
            store = synthetic_store(d)
            wr = store.board(1)["list"][0]["score"]
            store.log_prediction(1, {"date": "2026-01-02", "day": 1.1, "gold_ms": model.gold_time(wr) + 50,
                                     "gold_fast_ms": model.gold_time(wr) - 100, "gold_slow_ms": model.gold_time(wr) + 100})
            fin = model.finished_events(store, store.events(), T0 + timedelta(days=400))
            rows = site.scorecard(store, fin)
            self.assertEqual(len(rows), 1)
            self.assertIn(1, rows[0]["predictions"])
            self.assertNotIn(7, rows[0]["predictions"])
            self.assertTrue(rows[0]["predictions"][1]["in_range"])

    def test_event_detail_has_top10_record_steps_and_predictions(self):
        with tempfile.TemporaryDirectory() as d:
            store = synthetic_store(d)
            store.log_prediction(1, {"date": "2026-01-02", "day": 1.1, "final_wr_ms": 90000, "gold_ms": 92700})
            ev, board = store.events()[1], store.board(1)
            detail = site.event_detail(store, ev, board)
            self.assertEqual(len(detail["top10"]), 10)
            self.assertEqual(detail["top10"][0]["ms"], detail["wr_ms"])
            self.assertEqual(detail["wr_steps"][-1]["wr_ms"], detail["wr_ms"])
            self.assertEqual(len(detail["predictions"]), 1)

    def test_site_build_writes_a_page_per_finished_event(self):
        with tempfile.TemporaryDirectory() as d:
            store = synthetic_store(d)
            at = T0 + timedelta(days=400)
            out = os.path.join(d, "_site")
            site.build_site(store, at, report.build(store, at, {}), out)
            fin = model.finished_events(store, store.events(), at)
            self.assertEqual(len(os.listdir(os.path.join(out, "events"))), len(fin))

    def test_names_prefer_official_list(self):
        store = Store()  # real data/ref
        self.assertEqual(store.course(1340)[0], "SUGO International Racing Course")
        self.assertEqual(store.course(10)[0], "Suzuka Circuit")


if __name__ == "__main__":
    unittest.main()
