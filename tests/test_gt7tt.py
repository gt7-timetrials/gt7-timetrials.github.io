"""Run with: python -m unittest discover tests"""
import csv
import json
import sys
import os
import random
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

import shutil
import socket
import struct
import subprocess
import time

from gt7tt import model, report, site, telemetry
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

    def test_free_car_choice(self):
        """A flagged time trial: the reference is matched whatever its car, and the page knows."""
        with tempfile.TemporaryDirectory() as d:
            store = synthetic_store(d)
            ev = store.events()[20]
            at = ev.start + timedelta(days=5)
            board = json.loads(json.dumps(store.board(20)))
            # the reference's car (3590) isn't the record's, nor anywhere in the top 100
            store.save_snapshot(20, board, at)
            os.makedirs(os.path.join(d, "reference_laps"))
            shutil.copy(TelemetryTest.REF, os.path.join(d, "reference_laps", "ref.csv"))
            rep = report.build(store, at, {20: board})
            self.assertEqual(site.current_references(store, rep), {}, "fixed car: the record's car only")
            self.assertFalse(site.site_data(store, at, rep)["current"][0]["free_choice"])
            with open(os.path.join(d, "free_choice.json"), "w") as f:
                json.dump({"events": [20]}, f)
            self.assertEqual(list(site.current_references(store, rep)), [20], "free choice: any car")
            self.assertTrue(site.site_data(store, at, rep)["current"][0]["free_choice"])

    def test_daily_races(self):
        """The Daily races tab: the week's races, each with its reference lap if there is one."""
        with tempfile.TemporaryDirectory() as d:
            store = Store(d)
            os.makedirs(os.path.join(d, "daily", "laps"))
            with open(os.path.join(d, "daily", "races.json"), "w") as f:
                json.dump({"races": [{"id": "A", "track": "Suzuka", "car": "Gr.3", "free_choice": True, "driver": "Fast_One"},
                                     {"id": "B", "track": "Monza", "car": "Mazda Roadster"}]}, f)
            shutil.copy(TelemetryTest.REF, os.path.join(d, "daily", "laps", "A.csv"))
            out = os.path.join(d, "_site")
            daily = site.daily_races(store, out)
            a, b = daily["races"]
            self.assertEqual(a["reference"]["lap_ms"], 110133)
            self.assertEqual(a["reference"]["driver"], "Fast_One")
            self.assertIn("car", a["reference"], "free choice: the reference's car is named")
            self.assertTrue(a["free_choice"])
            self.assertTrue(os.path.exists(os.path.join(out, "daily", "A.json")))
            self.assertIsNone(b["reference"], "no lap yet")
            self.assertEqual(site.daily_races(Store(os.path.join(d, "none")), out), {"races": []})

    def test_names_prefer_official_list(self):
        store = Store()  # real data/ref
        self.assertEqual(store.course(1340)[0], "SUGO International Racing Course")
        self.assertEqual(store.course(10)[0], "Suzuka Circuit")


class RecorderTest(unittest.TestCase):
    """tools/telemetry.py, the script players download."""
    @classmethod
    def setUpClass(cls):
        import importlib.util
        path = os.path.join(os.path.dirname(__file__), "..", "tools", "telemetry.py")
        spec = importlib.util.spec_from_file_location("recorder", path)
        cls.rec = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.rec)

    def test_scans_the_home_network(self):
        c = self.rec.candidates("192.168.1.40")
        self.assertEqual(c[0], "192.168.1.1")
        self.assertEqual(len(c), 253)  # .1 to .254 without this computer
        self.assertNotIn("192.168.1.40", c)
        self.assertEqual(self.rec.candidates(None), [])

    def test_finds_the_playstation_by_the_discovery_broadcast(self):
        # a fake PS5 that only answers the Remote Play discovery request (from 127.0.0.1) and the heartbeat sent
        # to 127.0.0.1; the "computer" is 127.0.0.1, so the sweep (127.0.0.2-254) can't find it
        import threading
        console = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        console.bind(("127.0.0.1", self.rec.SEND_PORT))
        asks = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        asks.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        asks.bind(("", 9302))
        answer = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        answer.bind(("127.0.0.1", 0))
        for s in (console, asks):
            s.settimeout(10)
        p = bytearray(0x13C)
        p[0:4] = (0x47375330).to_bytes(4, "little")
        nonce = (5 ^ 0xDEADBEEF).to_bytes(4, "little") + (5).to_bytes(4, "little")
        enc = bytearray(self.rec.salsa20(self.rec.KEY, nonce, bytes(p)))
        enc[0x40:0x44] = (5).to_bytes(4, "little")

        def play():
            try:
                q, addr = asks.recvfrom(512)
                if q.startswith(b"SRCH"):
                    answer.sendto(b"HTTP/1.1 620 Server Standby\nhost-type:PS5\n", addr)
                beat, addr = console.recvfrom(16)
                for _ in range(20):
                    console.sendto(bytes(enc), (addr[0], self.rec.RECV_PORT))
                    time.sleep(0.01)
            except OSError:
                pass

        t = threading.Thread(target=play, daemon=True)
        t.start()
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.bind(("0.0.0.0", self.rec.RECV_PORT))
        sock.settimeout(0.5)
        local_ip, self.rec.local_ip = self.rec.local_ip, lambda: "127.0.0.1"
        try:
            result = []  # find_console keeps searching until it finds one: give it 15 s
            finder = threading.Thread(target=lambda: result.append(self.rec.find_console(sock)), daemon=True)
            finder.start()
            finder.join(15)
            self.assertEqual(result, [("127.0.0.1", b"B")])
        finally:
            self.rec.local_ip = local_ip
            for s in (sock, console, asks, answer):
                s.close()

    def fake_packet(self, fmt, iv):
        """An encrypted GT7 packet in format "A" (no steering) or "B"."""
        length, xor = self.rec.FORMATS[fmt]
        p = bytearray(length)
        p[0:4] = (0x47375330).to_bytes(4, "little")
        nonce = (iv ^ xor).to_bytes(4, "little") + iv.to_bytes(4, "little")
        enc = bytearray(self.rec.salsa20(self.rec.KEY, nonce, bytes(p)))
        enc[0x40:0x44] = iv.to_bytes(4, "little")
        return bytes(enc)

    def slow_console(self, answers_b):
        """A fake PS5 at 127.0.0.1 that ignores "B" heartbeats until it has had an "A" one (GT7 slow to start), then
        sends the format of the latest heartbeat; or that never sends "B". Returns what find_console chose."""
        import threading
        console = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        console.bind(("127.0.0.1", self.rec.SEND_PORT))
        console.settimeout(0.2)
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.bind(("0.0.0.0", self.rec.RECV_PORT))
        sock.settimeout(0.5)
        mode, stop = [None], threading.Event()

        def play():
            seen_a, iv = False, 1
            while not stop.is_set():
                try:
                    beat, addr = console.recvfrom(16)
                    if beat == b"A":
                        seen_a, mode[0] = True, b"A"
                    elif beat == b"B" and seen_a and answers_b:
                        mode[0] = b"B"
                except socket.timeout:
                    pass
                except OSError:
                    return
                if mode[0]:
                    for _ in range(10):
                        iv += 1
                        console.sendto(self.fake_packet(mode[0], iv), ("127.0.0.1", self.rec.RECV_PORT))

        t = threading.Thread(target=play, daemon=True)
        t.start()
        try:
            result = []
            finder = threading.Thread(target=lambda: result.append(self.rec.find_console(sock, "127.0.0.1")), daemon=True)
            finder.start()
            finder.join(20)
            return result
        finally:
            stop.set()
            t.join(2)
            for s in (sock, console):
                s.close()

    def test_steering_kept_after_a_slow_start(self):
        # GT7 doesn't answer "B" (with the steering angle) at first, so the search falls back to "A"; then it asks for
        # "B" again and gets it. Before, the whole recording was "A", without steering.
        self.assertEqual(self.slow_console(answers_b=True), [("127.0.0.1", b"B")])
        # a console that only ever sends "A": recorded as "A"
        self.assertEqual(self.slow_console(answers_b=False), [("127.0.0.1", b"A")])

    def test_lap_time_format(self):
        self.assertEqual(self.rec.fmt_lap(113057), "1:53.057")
        self.assertEqual(self.rec.fmt_lap(76684), "1:16.684")

    def test_decrypts_what_it_encrypts(self):
        p = bytearray(0x13C)
        p[0:4] = (0x47375330).to_bytes(4, "little")
        iv1 = 0x1234ABCD
        nonce = (iv1 ^ 0xDEADBEEF).to_bytes(4, "little") + iv1.to_bytes(4, "little")
        enc = bytearray(self.rec.salsa20(self.rec.KEY, nonce, bytes(p)))
        enc[0x40:0x44] = iv1.to_bytes(4, "little")
        out = self.rec.decrypt(bytes(enc), 0xDEADBEEF)
        self.assertIsNotNone(out)
        self.assertIsNone(self.rec.decrypt(bytes(enc), 0xDEADBEAF))  # wrong format: rejected


@unittest.skipUnless(shutil.which("javac") and shutil.which("node"), "javac or node not installed")
class AndroidRecorderTest(unittest.TestCase):
    """The Android app's recorder (android/.../Telemetry.java, Recorder.java), compiled and run off the phone."""
    HERE = os.path.dirname(__file__)

    @classmethod
    def setUpClass(cls):
        RecorderTest.setUpClass()
        cls.rec = RecorderTest.rec
        cls.tmp = tempfile.mkdtemp()
        src = os.path.join(cls.HERE, "..", "android", "app", "src", "main", "java", "io", "github", "gt7timetrials")
        subprocess.run(["javac", "-d", cls.tmp, os.path.join(src, "Telemetry.java"), os.path.join(src, "Recorder.java"),
                        os.path.join(src, "Cues.java"), os.path.join(src, "Feed.java"), os.path.join(src, "Calibrator.java"),
                        os.path.join(src, "CueDefaults.java"),
                        os.path.join(cls.HERE, "android", "RecorderCheck.java"),
                        os.path.join(cls.HERE, "android", "CueCheck.java")], check=True, capture_output=True)

    def java(self, *args):
        return subprocess.run(["java", "-cp", self.tmp, "io.github.gt7timetrials.RecorderCheck", *args],
                              check=True, capture_output=True, text=True, timeout=120).stdout

    def test_reads_packets_like_the_computer_recorder(self):
        rng = random.Random(7)
        packets, expected = b"", []
        for i in range(3):
            p = bytearray(rng.randbytes(0x13C))
            p[0:4] = (0x47375330).to_bytes(4, "little")
            for off in range(0x04, 0x13C, 4):  # sensible floats everywhere, then the integer fields
                if off != 0x40:
                    p[off:off + 4] = struct.pack("<f", rng.uniform(-500, 500))
            p[0x70:0x74], p[0x74:0x76], p[0x7C:0x80] = (1000 + i).to_bytes(4, "little"), (i).to_bytes(2, "little"), (75000 + i).to_bytes(4, "little")
            p[0x8E:0x90], p[0x90:0x93] = (0x801).to_bytes(2, "little"), bytes([0x34, 200, 17])
            iv1 = rng.getrandbits(32)
            nonce = (iv1 ^ 0xDEADBEEF).to_bytes(4, "little") + iv1.to_bytes(4, "little")
            enc = bytearray(self.rec.salsa20(self.rec.KEY, nonce, bytes(p)))
            enc[0x40:0x44] = iv1.to_bytes(4, "little")
            packets += bytes(enc)
            expected.append(self.rec.parse(self.rec.decrypt(bytes(enc), 0xDEADBEEF), 0))
        path = os.path.join(self.tmp, "packets.bin")
        with open(path, "wb") as f:
            f.write(packets)
        for line, want in zip(self.java("decrypt", path).splitlines(), expected):
            got = dict(zip(self.rec.FIELDS, line.split(",")))
            for k in self.rec.FIELDS[1:]:
                self.assertAlmostEqual(float(got[k]), float(want[k]), places=1, msg=k)

    def test_finds_the_playstation_without_its_address(self):
        lap = os.path.join(self.HERE, "fixtures", "telemetry_lap.csv")
        for how in ("discover", "sweep"):  # it answers the Remote Play discovery broadcast, or only the network sweep
            events = [json.loads(line) for line in self.java("find", how, lap).splitlines()]
            self.assertIn({"type": "connected", "ip": "127.0.0.1"}, events, how)

    def test_steering_kept_after_a_slow_start(self):
        # GT7 doesn't answer "B" (with the steering angle) at first: the app falls back to "A", asks for "B" again and
        # records the steering; before, the whole recording was "A", without it
        head, last = self.java("slowstart", os.path.join(self.HERE, "fixtures", "telemetry_lap.csv")).splitlines()[-2:]
        row = dict(zip(head.split(","), last.split(",")))
        self.assertNotEqual(row["steering_rad"], "", "the last row has the steering angle")

    def cue_file(self, reference):
        """The reference's cue points from the website's Coach.cuePoints, in CueCheck's text format."""
        path = os.path.join(self.tmp, os.path.basename(reference) + ".cues")
        subprocess.run(["node", "-e", """
const fs = require("fs"), C = require(process.argv[1]);
const c = C.cuePoints(C.fastestLap(C.parseCsv(fs.readFileSync(process.argv[2], "utf8"))));
fs.writeFileSync(process.argv[3], [`${c.loop} ${c.step}`, c.x.join(" "), c.z.join(" "),
  ...c.cues.map(q => `${q.s} ${q.t} ${q.kind}`)].join("\\n"));""",
                        os.path.abspath(os.path.join(self.HERE, "..", "site", "coach.js")), reference, path], check=True)
        return path

    def cue_check(self, *args):
        return subprocess.run(["java", "-cp", self.tmp, "io.github.gt7timetrials.CueCheck", *args],
                              check=True, capture_output=True, text=True, timeout=120).stdout.splitlines()

    def test_audio_cues_play_on_time(self):
        cues = self.cue_file(os.path.join(self.HERE, "fixtures", "reference_barcelona.csv"))
        for lap in ("reference_barcelona.csv", "telemetry_lap.csv"):  # the reference itself, and a slower lap
            sounds = [l.split() for l in self.cue_check(cues, os.path.join(self.HERE, "fixtures", lap), "timing", "0.2")]
            main = [float(s[3]) for s in sounds if s[1] in ("brake", "lift")]
            gas = [float(s[3]) for s in sounds if s[1] == "gas"]
            self.assertGreaterEqual(len(main), 7, lap)
            # each brake or lift BEEP plays the delay (0.2 s) before the car reaches the point
            self.assertTrue(all(abs(t - 0.2) < 0.03 for t in main[:-1] if t < 5), (lap, main))
            # the gas beep 0.5 s before (plus the delay), within 0.05 s though the car is braking and turning in
            self.assertTrue(all(abs(t - 0.7) < 0.05 for t in gas if t < 5), (lap, gas))
            # with the brake cue set 0.15 s earlier: brake BEEPs 0.35 s before, lift BEEPs and gas beeps unchanged
            early = [l.split() for l in self.cue_check(cues, os.path.join(self.HERE, "fixtures", lap), "timing", "0.2", "0.15")]
            brake = [float(s[3]) for s in early if s[1] == "brake"]
            self.assertTrue(brake and all(abs(t - 0.35) < 0.03 for t in brake[:-1] if t < 5), (lap, brake))
            lift = [float(s[3]) for s in early if s[1] == "lift"]
            self.assertTrue(all(abs(t - 0.2) < 0.03 for t in lift if t < 5), (lap, lift))

    def edge(self, how, *more):
        cues = self.cue_file(os.path.join(self.HERE, "fixtures", "reference_barcelona.csv"))
        out = self.cue_check(cues, os.path.join(self.HERE, "fixtures", "reference_barcelona.csv"), "edge", how, *more)
        window = next((tuple(map(float, l.split()[1:])) for l in out if l.startswith("window")), None)
        played = [(l.split()[1], float(l.split()[2])) for l in out if l.startswith("played")]
        return window, played

    def test_audio_cues_in_unusual_driving(self):
        _, normal = self.edge("none")
        main = lambda played: [n for n, _ in played if n in ("brake", "lift", "gas")]
        self.assertGreaterEqual(len(main(normal)), 15)
        # 40 m off the line for 10 s (an excursion, or a different track): silent, then back to normal
        (a, b), played = self.edge("offline")
        self.assertFalse([p for p in played if a <= p[1] < b + 0.5], "no cues while off the line")
        self.assertEqual(main(played), [n for n, t in normal if not (a <= t < b + 0.5) and n in ("brake", "lift", "gas")])
        # 3 s of reversing: silent while going backwards, nothing played twice when driving on over the same stretch
        (a, b), played = self.edge("reverse")
        self.assertFalse([p for p in played if a < p[1] <= b], "no cues while reversing")
        self.assertEqual(main(played), main(normal))
        # a restart: back on the start line, and every cue plays again on the new lap
        (a, _), played = self.edge("restart")
        again = [n for n, t in played if t > a and n in ("brake", "lift", "gas")]
        self.assertGreaterEqual(len(again), len([n for n, t in normal if 7.7 < t and n in ("brake", "lift", "gas")]) - 1)
        # no packets for 30 s (paused, or Wi-Fi dropped): no burst of stale cues when they come back
        (a, b), played = self.edge("pause")
        self.assertFalse([p for p in played if a <= p[1] < b], "nothing while there were no packets")
        self.assertEqual(main(played), main(normal))
        self.assertFalse([p for p in played if b <= p[1] < b + 1], "no catching up all at once")
        # a point-to-point track (no lap back to the start): the same cues
        _, played = self.edge("none", "p2p")
        self.assertEqual(main(played), main(normal))

    def test_starting_delays(self):
        out = dict((tuple(l.split()[:-1]), l.split()[-1]) for l in self.cue_check("defaults"))
        self.assertEqual(out[("start", "speaker")], "0.00")
        self.assertEqual(out[("start", "wired")], "0.00")
        self.assertEqual(out[("start", "bluetooth")], "0.33")
        # an uncalibrated output still on the first beta's starting value moves; calibrated or set by hand stays
        self.assertEqual(out[("now", "speaker", "0.10", "false")], "0.00")
        self.assertEqual(out[("now", "bluetooth", "0.25", "false")], "0.33")
        self.assertEqual(out[("now", "wired", "0.08", "false")], "0.00")
        self.assertEqual(out[("now", "bluetooth", "0.25", "true")], "0.25")
        self.assertEqual(out[("now", "speaker", "0.17", "false")], "0.17")

    def test_calibration_measures_the_delay(self):
        for true in (0.25, 0.08):  # Bluetooth-like and speaker-like delays
            out = self.cue_check("calibrate", str(true), "2", "4")  # round 3 missed, round 5 pressed 0.4 s late
            rounds = [l.split() for l in out if l.startswith("round")]
            self.assertEqual([r[3] for r in rounds], ["true", "true", "false", "true", "true", "true"])
            done = out[-1].split()
            self.assertEqual(done[0], "done")
            self.assertAlmostEqual(float(done[1]), true, delta=0.03)  # the late press is left out
            self.assertEqual((done[2], done[3]), ("4", "true"))
            self.assertLess(float(done[4]), 0.03, "steady presses: a small spread")
        out = self.cue_check("calibrate", "0.2", "0", "1")  # two of six pressed badly: missed and way off
        self.assertIn(" 4 true ", out[-1])

    def test_records_a_lap_from_a_fake_playstation(self):
        out = os.path.join(self.tmp, "phone.csv")
        events = [json.loads(line) for line in self.java("replay", os.path.join(self.HERE, "fixtures", "telemetry_lap.csv"), out).splitlines()]
        self.assertEqual([e["type"] for e in events][:2], ["searching", "connected"])
        self.assertIn({"type": "lap", "lap": 1, "ms": 113057, "time": "1:53.057", "replay": False, "dropout": False}, events)
        lap = telemetry.fastest_lap(telemetry.read_csv(out))
        self.assertEqual(lap["lap_ms"], 113057)
        self.assertGreater(len(lap["t"]), 6000)


def node_has_playwright():
    if not shutil.which("node"):
        return False
    r = subprocess.run(["node", "-e", "require('playwright')"], capture_output=True, env=node_env())
    return r.returncode == 0


def node_env():
    env = dict(os.environ)
    try:  # a global install (as on the build machine) as well as a local one
        root = subprocess.run(["npm", "root", "-g"], capture_output=True, text=True).stdout.strip()
        env["NODE_PATH"] = os.pathsep.join(p for p in (env.get("NODE_PATH"), root) if p)
    except OSError:
        pass
    return env


BRIDGE = "android/app/src/main/java/io/github/gt7timetrials/MainActivity.java"
# The app the first Google Play releases had (up to release 16, 31 October 2026): recording only, no audio cues.
FIRST_PLAY_APP = {"version": [0], "start": [0, 1], "stop": [0], "csv": [0], "save": [2]}


def bridge_methods(java):
    """What the website can ask the app to do: the @JavascriptInterface methods, name -> numbers of arguments."""
    import re
    out = {}
    for name, params in re.findall(r"@JavascriptInterface\s+public\s+(?:synchronized\s+)?\w+\s+(\w+)\(([^)]*)\)", java):
        out.setdefault(name, []).append(len([p for p in params.split(",") if p.strip()]))
    return out


def main_app_methods(root):
    """The app on main: what testers have once its .aab is on Google Play. Compared with beta's website before a
    merge. GT7_MAIN_REF picks another commit instead (for example the one a Play release was built from). Falls back
    to this checkout's app (with a note) where main can't be read, e.g. outside git."""
    ref = os.environ.get("GT7_MAIN_REF", "origin/main")
    try:
        java = subprocess.run(["git", "show", f"{ref}:{BRIDGE}"], cwd=root, capture_output=True, text=True,
                              check=True).stdout
        return bridge_methods(java), ref
    except (subprocess.CalledProcessError, FileNotFoundError):
        with open(os.path.join(root, BRIDGE)) as f:
            return bridge_methods(f.read()), "this checkout (main not found)"


class BridgeTest(unittest.TestCase):
    """Reading the app's bridge methods, for the screen tests' stand-in apps."""

    def test_bridge_methods(self):
        java = """
            @JavascriptInterface
            public String version() {
            @JavascriptInterface
            public synchronized void start(String ip) {
            @JavascriptInterface
            public void start() {
            @JavascriptInterface
            public String save(String csv, String name) {
            public void notForThePage(String x) {"""
        self.assertEqual(bridge_methods(java), {"version": [0], "start": [1, 0], "save": [2]})
        root = os.path.join(os.path.dirname(__file__), "..")
        with open(os.path.join(root, BRIDGE)) as f:
            now = bridge_methods(f.read())
        for name in FIRST_PLAY_APP:  # the app never drops what the first release could do
            self.assertIn(name, now)


@unittest.skipUnless(node_has_playwright(), "Playwright not installed")
class UiTest(unittest.TestCase):
    """The website's screens in a browser: as a visitor; in the app on main (what testers have, or will once its .aab
    is on Google Play) and in the first Play release, both built from their bridge methods; and in this checkout's
    app, with audio cues."""
    HERE = os.path.dirname(__file__)

    def test_screens(self):
        import http.server
        import threading
        tmp = tempfile.mkdtemp()
        site = os.path.join(tmp, "site")
        subprocess.run([sys.executable, "-m", "gt7tt", "site", "--out", site], check=True, capture_output=True,
                       cwd=os.path.join(self.HERE, ".."))
        handler = lambda *a, **k: http.server.SimpleHTTPRequestHandler(*a, directory=site, **k)
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
        handler_log = http.server.SimpleHTTPRequestHandler.log_message
        http.server.SimpleHTTPRequestHandler.log_message = lambda *a: None
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            s1 = os.path.join(self.HERE, "fixtures", "license_s1_attempt.csv")
            multi = os.path.join(tmp, "s1_four_laps.csv")
            four_laps(s1, multi)
            root = os.path.join(self.HERE, "..")
            main, where = main_app_methods(root)
            if os.environ.get("GITHUB_ACTIONS"):  # on GitHub, main must be there: otherwise this checks nothing
                self.assertNotIn("not found", where, "the Tests workflow should fetch main")
            with open(os.path.join(root, BRIDGE)) as f:
                current = bridge_methods(f.read())
            apps = json.dumps({"main": main, "mainFrom": where, "first": FIRST_PLAY_APP, "current": current})
            r = subprocess.run(["node", os.path.join(self.HERE, "test_ui.js"), f"http://127.0.0.1:{server.server_port}/",
                                s1, multi, apps], capture_output=True, text=True, timeout=300, env=node_env())
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        finally:
            server.shutdown()
            server.server_close()
            http.server.SimpleHTTPRequestHandler.log_message = handler_log


def four_laps(src, dst):
    """The S-1 attempt driven four times in a row; the third time 0.33 s slower over a stretch of the run."""
    with open(src, newline="") as f:
        rows = list(csv.DictReader(f))
    fields = list(rows[0].keys())
    first = next(i for i, r in enumerate(rows) if r["lap"] == "1")
    after = next(i for i, r in enumerate(rows) if r["lap"] == "2")
    lap = rows[first:after]
    p0, n = int(lap[0]["packet_id"]), len(lap)
    out, offset, last_ms = [dict(r) for r in rows[:first]], 0, -1
    for k in range(4):
        extra = 20 if k == 2 else 0  # a third of a second lost over 60 packets, half way round
        for i, r in enumerate(lap):
            r = dict(r)
            slow = min(extra, max(0, (i - n // 2) // 3)) if extra else 0
            r["packet_id"] = str(int(r["packet_id"]) + offset + slow)
            r["lap"], r["last_lap_ms"] = str(1 + k), str(last_ms)
            r["time_s"] = f"{(int(r['packet_id']) - p0) / 60:.3f}"
            out.append(r)
        last_ms = round((n + extra) * 1000 / 60)
        offset += n + extra
    for r in rows[after:]:
        r = dict(r)
        r["packet_id"] = str(int(r["packet_id"]) - int(rows[after]["packet_id"]) + p0 + offset)
        r["lap"], r["last_lap_ms"] = "5", str(last_ms)
        out.append(r)
    with open(dst, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(out)


class TelemetryTest(unittest.TestCase):
    REF = os.path.join(os.path.dirname(__file__), "fixtures", "reference_barcelona.csv")
    LAP = os.path.join(os.path.dirname(__file__), "fixtures", "telemetry_lap.csv")

    def test_fastest_lap_timed_by_packets(self):
        lap = telemetry.fastest_lap(telemetry.read_csv(self.REF))
        self.assertEqual(lap["lap_ms"], 110133)
        self.assertEqual(lap["car_code"], 3590)
        self.assertAlmostEqual(lap["t"][-1], 110.133, places=2)
        self.assertEqual(len(lap["x"]), len(lap["t"]))
        self.assertIsNone(telemetry.fastest_lap(telemetry.read_csv(self.LAP)[:1000]))

    def test_steering_left_out_when_not_recorded(self):
        # GT7's older data format has no steering angle: the lap has no steering field (not zeros, which would
        # draw a flat line on the website's steering chart)
        rows = telemetry.read_csv(self.REF)
        lap = telemetry.fastest_lap(rows)
        for k in ("steering_rad", "wheel_fl_kmh", "wheel_fr_kmh", "wheel_rl_kmh", "wheel_rr_kmh", "tcs_active"):
            self.assertIn(k, lap)  # the website's wheelspin reads all four wheels and traction control
        blank = [{**r, "steering_rad": ""} for r in rows]
        lap = telemetry.fastest_lap(blank)
        self.assertNotIn("steering_rad", lap)
        self.assertEqual(lap["lap_ms"], 110133)

    def test_reference_matched_to_event_by_car_and_closest_record(self):
        lap = telemetry.fastest_lap(telemetry.read_csv(self.REF))
        entries = [{"score": 110133, "user": {"np_online_id": "Fast_One"}}]
        current = [(1, {3590}, 140000, []), (2, {3590}, 110200, entries), (3, {999}, 110133, entries)]
        refs = telemetry.match_references([lap], current)
        self.assertEqual(list(refs), [2])
        self.assertEqual(refs[2]["driver"], "Fast_One")
        # free car choice (None): any car, but an event in the lap's own car comes first
        self.assertEqual(list(telemetry.match_references([lap], [(4, None, 110100, entries)])), [4])
        self.assertEqual(list(telemetry.match_references([lap], [(4, None, 110133, entries), (5, {3590}, 115000, [])])), [5])
        self.assertEqual(telemetry.match_references([lap], [(4, {999}, 110100, entries)]), {})
        # the driver has since beaten it, so the time isn't on the board: the name noted when the lap was added
        self.assertEqual(telemetry.match_references([{**lap, "driver": "Noted"}], [(2, {3590}, 110000, [])])[2]["driver"], "Noted")

    @unittest.skipUnless(shutil.which("node"), "node not installed")
    def test_browser_lap_comparison(self):
        js = os.path.join(os.path.dirname(__file__), "test_coach.js")
        subprocess.run(["node", js], check=True, capture_output=True)


if __name__ == "__main__":
    unittest.main()
