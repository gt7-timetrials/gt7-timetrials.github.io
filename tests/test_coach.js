// Lap comparison (site/coach.js) on a real lap against the world record reference. Run: node tests/test_coach.js
const assert = require("assert"), fs = require("fs"), path = require("path");
const Coach = require("../site/coach.js");
const read = p => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

const ref = Coach.fastestLap(Coach.parseCsv(read("tests/fixtures/reference_barcelona.csv")));
const me = Coach.fastestLap(Coach.parseCsv(read("tests/fixtures/telemetry_lap.csv")));
assert.strictEqual(ref.lap_ms, 110133);
assert.strictEqual(me.lap_ms, 113057);
assert.ok(Math.abs(me.t[me.t.length - 1] - 113.057) < 0.02, "packet clock matches the game's lap time");

const r = Coach.analyse(ref, me);
assert.ok(!r.error, r.error);
assert.ok(r.corners.length >= 6, "finds the corners");
const total = r.corners.reduce((a, c) => a + c.lost, 0);
assert.ok(Math.abs(total - r.recordedGap) < 1e-9, "corner losses add up to the recorded gap");
assert.ok(Math.abs(r.gameGap - 2.924) < 1e-9 && Math.abs(r.recordedGap - r.gameGap) < 0.01, "time trial laps: game and recording agree");
assert.ok(r.corners.every(c => c.tips.length), "every corner gets advice");
assert.ok(r.corners[0].tips[0].startsWith("Start of the lap"), "slow start-line speed is called out");
assert.ok(r.corners[6].tips.some(t => t.startsWith("Brake pressure")), "corner 7: WR holds full brake longer");
assert.ok(Coach.trackMap(r).startsWith("<svg"));
// the long fast left after turn 1: 34% throttle where the WR averages 80%; early braking into a corner isn't a "lift"
assert.strictEqual(r.lifts.length, 1);
assert.ok(r.corners[1].tips.some(t => /^Lift: you average 3\d% throttle for 6\d m/.test(t)), r.corners[1].tips.join(" | "));
const chart = Coach.cornerDetail(r.corners[6], "WR", r);
["Brake %", "Throttle %", "Time gap:", "WR brakes"].forEach(t => assert.ok(chart.includes(t), "chart shows " + t));
const liftChart = Coach.cornerDetail(r.corners[1], "WR", r); // no braking at corner 2: no brake strip, apex as 0
assert.ok(!liftChart.includes("Brake %") && liftChart.includes("the apex (no braking here)"));

// The site's reference files store rounded values; the same lap from its CSV must still match itself.
for (const [csv, json] of [["reference_barcelona.csv", ref], ["reference_sugo.csv", null]]) {
  const raw = Coach.fastestLap(Coach.parseCsv(read("tests/fixtures/" + csv)));
  const site = json ? roundLike(json) : roundLike(raw);
  const res = Coach.analyse(site, raw);
  assert.ok(!res.error, res.error);
  res.corners.forEach(c => assert.deepStrictEqual(c.tips, ["Close to the reference here."], `${csv} corner ${c.n}: ${c.tips}`));
}
function roundLike(lap) { // as gt7tt/telemetry.py writes it
  const digits = { x: 2, z: 2, speed_kmh: 1, throttle_pct: 0, brake_pct: 0, steering_rad: 3, wheel_rl_kmh: 1, wheel_rr_kmh: 1 };
  const out = { ...lap, t: lap.t.map(v => Math.round(v * 1000) / 1000) };
  for (const [k, d] of Object.entries(digits)) out[k] = lap[k].map(v => Math.round(v * 10 ** d) / 10 ** d);
  return out;
}

const self = Coach.analyse(ref, ref);
assert.ok(self.corners.every(c => Math.abs(c.lost) < 1e-9 && c.colour === "good"), "a lap against itself loses nothing");

const other = { ...me, x: me.x.map(v => v + 500) };
assert.ok(Coach.analyse(ref, other).error, "a lap on another track is rejected");

assert.strictEqual(Coach.fastestLap(Coach.parseCsv(read("tests/fixtures/telemetry_lap.csv").split("\n").slice(0, 2000).join("\n"))), null,
  "no complete lap -> null");
// Track use: a 90° corner driven 3 m further out reads as 3 m wider, for right- and left-handers
function cornerLap(wider, mirror) {
  const P = [], r = 50 + wider;
  for (let z = 300; z > 0; z -= 0.5) P.push([-wider, z]);
  for (let a = Math.PI; a > Math.PI / 2; a -= 0.005) P.push([50 + r * Math.cos(a), -r * Math.sin(a)]);
  for (let x = 50; x < 350; x += 0.5) P.push([x, -r]);
  const n = P.length, v = P.map((_, i) => 100 + 200 * Math.abs(i / n - 0.5));
  const x = P.map(p => (mirror ? -p[0] : p[0])), z = P.map(p => p[1]), t = [0];
  for (let i = 1; i < n; i++) t.push(t[i - 1] + Math.hypot(x[i] - x[i - 1], z[i] - z[i - 1]) / (v[i] / 3.6));
  return { lap_ms: Math.round(t[n - 1] * 1000), car_code: 1, t, x, z, speed_kmh: v, throttle_pct: v.map(s => (s > 190 ? 100 : 30)),
    brake_pct: P.map(() => 0), steering_rad: P.map((_, i) => (i > 600 && i < n - 600 ? 1 : 0)), wheel_rl_kmh: v, wheel_rr_kmh: v };
}
for (const mirror of [false, true]) {
  const c = Coach.analyse(cornerLap(0, mirror), cornerLap(3, mirror)).corners[0];
  assert.strictEqual(c.line.right, !mirror);
  for (const k of ["atTurnIn", "atApex", "atExit"]) assert.ok(Math.abs(c.line[k] - 3) < 0.1, `${k} ${c.line[k]}`);
  assert.ok(c.tips.some(t => t.startsWith("Track use: at turn-in you're 3.0 m wider")));
}
// on the real lap: turning in from further inside at corner 7, and a close-up drawing
assert.ok(r.corners[6].tips.some(t => /^Track use: at turn-in you're 2\.\d m tighter/.test(t)), r.corners[6].tips.join(" | "));
const closeUp = Coach.cornerDetail(r.corners[6], "WR", r);
assert.ok(closeUp.includes('class="corner-lines"'));
// both first-brake badges are in the picture; you brake 20 m earlier than the WR, so there are big filled red dots
// (more brake) before the WR's braking point
assert.strictEqual((closeUp.match(/class="cl-badge (me|ref)">[\s\S]*?>B<\/text>/g) || []).length, 2);
assert.ok(/cl-diff brk more"[^>]*r="4.6"/.test(closeUp), "early braking shows as large filled red dots");
assert.ok(closeUp.includes("Hide WR's line"), "the button hides the reference's line");
assert.ok(closeUp.includes('class="cl-legend"') && !closeUp.includes("slowest"), "legend; no slowest-point marker");
// the WR lap against itself: every dot is "about the same"
const selfClose = Coach.cornerDetail(self.corners[6], "WR", self);
assert.ok(selfClose.includes("cl-same") && !/<circle class="cl-diff[^>]*cx=/.test(selfClose), "the WR against itself: all the same");

// Several laps in one recording: the fastest is compared, unless it's noticeably shorter than the reference (a cut
// corner). Built from the Barcelona lap: the same lap three more times, one of them cutting ~200 m off (10 s of
// driving through the turn 5–6 area replaced by a straight line) and faster.
{
  const rows = Coach.parseCsv(read("tests/fixtures/telemetry_lap.csv"));
  const ups = rows.map((r, i) => (i && r.lap === rows[i - 1].lap + 1 ? i : -1)).filter(i => i > 0);
  const one = rows.slice(ups[0], ups[1]); // lap 1, without the row that ends it
  const pid = { n: rows[rows.length - 1].packet_id };
  // copy(n, ms, cut): lap n; its first row carries lap n-1's time (ms), as the game does
  const copy = (lapNo, ms, cut) => one.filter((_, i) => !cut || i < 2040 || i >= 2640).map((r, i) => ({
    ...r, lap: lapNo, packet_id: ++pid.n, last_lap_ms: i === 0 ? ms : r.last_lap_ms }));
  const more = [...rows.slice(0, ups[1]),
    ...copy(2, 113057, true), ...copy(3, 111500), ...copy(4, 113900), ...copy(5, 114000)];
  more.forEach((r, i) => { if (i && r.lap === more[i - 1].lap) r.last_lap_ms = more[i - 1].last_lap_ms; });
  const ch = Coach.lapChoices(more, ref);
  assert.deepStrictEqual(ch.laps.map(l => [l.number, l.lap_ms, l.cut]),
    [[1, 113057, false], [2, 111500, true], [3, 113900, false], [4, 114000, false]], JSON.stringify(ch.laps.map(l => [l.number, l.lap_ms, l.short])));
  assert.strictEqual(ch.fastest, 1); // the cut lap is the fastest...
  assert.strictEqual(ch.pick, 0);    // ...so the fastest clean lap is compared
  assert.ok(ch.laps[1].short > 200);
  // the real recordings: one complete lap each, not marked as cut (a clean S-1 lap is ~22 m shorter than the gold run's)
  const gold = Coach.fastestLap(Coach.parseCsv(read("data/license/laps/S-1.csv")));
  for (const [f, r] of [["tests/fixtures/telemetry_lap.csv", ref], ["tests/fixtures/license_s1_attempt.csv", gold]]) {
    const c = Coach.lapChoices(Coach.parseCsv(read(f)), r);
    assert.ok(c.laps.length === 1 && !c.laps[0].cut && c.pick === 0, f);
  }
}

// only telemetry.py recordings are accepted; anything else gets its own message
assert.ok(Coach.isRecording(read("tests/fixtures/telemetry_lap.csv")));
["", "hello\nworld", "Time,Speed,Throttle\n0,100,50", "\u0089PNG\r\n\u001a\n"].forEach(t => assert.ok(!Coach.isRecording(t), JSON.stringify(t)));

// Super License S-1: your bronze attempt against the gold reference
const s1ref = Coach.fastestLap(Coach.parseCsv(read("data/license/laps/S-1.csv")));
const s1me = Coach.fastestLap(Coach.parseCsv(read("tests/fixtures/license_s1_attempt.csv")));
assert.strictEqual(s1ref.lap_ms, 71809);
assert.strictEqual(s1me.lap_ms, 78521);
const s1 = Coach.analyse(s1ref, s1me, "the reference lap");
assert.ok(!s1.error, s1.error);
assert.ok(Math.abs(s1.corners.reduce((a, c) => a + c.lost, 0) - s1.recordedGap) < 1e-9);
assert.ok(Math.abs(s1.gameGap - 6.712) < 1e-9);
// High Speed Ring: each section is a corner plus the straight after it, with the time split between the two
assert.deepStrictEqual(s1.corners.map(c => c.apex), [1779, 2481, 2705, 3605]);
s1.corners.slice(1).forEach(c => assert.ok(c.from < c.ref.brakeAt && c.ref.brakeAt - c.from <= 10 + 150, `corner ${c.n} starts at its braking zone`));
assert.ok(/^Where the time goes: \+0\.74 s in the corner, \+1\.40 s on the 712 m straight after it to the finish line: you leave the corner 17 km\/h slower/
  .test(s1.corners[3].tips[0]), s1.corners[3].tips[0]);
assert.ok(/^Where the time goes: \+1\.64 s on the 1500 m from the start line to the braking zone, \+1\.04 s in the corner, \+0\.33 s/
  .test(s1.corners[0].tips[0]), s1.corners[0].tips[0]);
assert.ok(s1.corners[0].tips.some(t => t.includes("517 m, starting 573 m after the start line")), "the coast before corner 1");
assert.ok(s1.corners[2].tips.some(t => t.startsWith("Lifts: 5 times")), "several lifts are one tip");
assert.ok(!s1.corners[2].tips.some(t => t.startsWith("Exit:")), "the straight tip says it instead");
assert.strictEqual((Coach.trackMap(s1).match(/class="seg /g) || []).length, 4, "one colour per section");

// "Start here": at most 3, biggest first after weighting by difficulty; nothing when the lap is the reference itself
{
  const items = Coach.startHere(s1, "the reference lap");
  assert.ok(items.length === 3 && items[0].n === 1 && /lift off for 517 m/.test(items[0].text), JSON.stringify(items));
  assert.ok(items.every((it, i) => !i || it.score <= items[i - 1].score));
  assert.deepStrictEqual(Coach.startHere(self, "WR"), []);
}

console.log("coach.js tests passed");
