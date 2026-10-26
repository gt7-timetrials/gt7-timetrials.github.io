// Lap comparison (site/coach.js) on a real lap against the world record reference. Run: node tests/test_coach.js
const assert = require("assert"), fs = require("fs"), path = require("path");
const Coach = require("../site/coach.js");
const read = p => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

const ref = Coach.fastestLap(Coach.parseCsv(read("data/reference_laps/telemetry_20261025_214232.csv")));
const me = Coach.fastestLap(Coach.parseCsv(read("tests/fixtures/telemetry_lap.csv")));
assert.strictEqual(ref.lap_ms, 110133);
assert.strictEqual(me.lap_ms, 113057);
assert.ok(Math.abs(me.t[me.t.length - 1] - 113.057) < 0.02, "packet clock matches the game's lap time");

const r = Coach.analyse(ref, me);
assert.ok(!r.error, r.error);
assert.ok(r.corners.length >= 6, "finds the corners");
const total = r.corners.reduce((a, c) => a + c.lost, 0);
assert.ok(Math.abs(total - 2.924) < 0.001, "corner losses add up to the lap gap");
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
for (const [csv, json] of [["telemetry_20261025_214232.csv", ref], ["telemetry_20261025_224654.csv", null]]) {
  const raw = Coach.fastestLap(Coach.parseCsv(read("data/reference_laps/" + csv)));
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
// both braking points are in the picture, and the line thickness varies with the pedals
assert.strictEqual((closeUp.match(/cl-dot brake/g) || []).length, 2);
const widths = new Set([...closeUp.matchAll(/class="cl-me"[^>]*stroke-width:([\d.]+)/g)].map(m => m[1]));
assert.ok(widths.size > 5, "line thickness follows the pedals");
assert.ok(closeUp.includes('class="cl-toggle"'), "has the hide/show button for your line");
assert.ok(closeUp.includes('class="cl-legend"') && closeUp.includes("k-dot slow ref"), "legend grid for you and the WR");
// corner 2: your slowest point and full throttle are at the same spot, so the ring is drawn last, round the dot
const c2 = Coach.cornerDetail(r.corners[1], "WR", r);
assert.ok(c2.indexOf("cl-dot gas me") < c2.indexOf("cl-dot slow me"));

console.log("coach.js tests passed");
