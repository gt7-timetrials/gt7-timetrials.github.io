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
assert.ok(r.corners.some(c => c.tips.some(t => t.startsWith("Trail braking"))), "trail braking difference found");
assert.ok(Coach.trackMap(r).startsWith("<svg"));

const self = Coach.analyse(ref, ref);
assert.ok(self.corners.every(c => Math.abs(c.lost) < 1e-9 && c.colour === "good"), "a lap against itself loses nothing");

const other = { ...me, x: me.x.map(v => v + 500) };
assert.ok(Coach.analyse(ref, other).error, "a lap on another track is rejected");

assert.strictEqual(Coach.fastestLap(Coach.parseCsv(read("tests/fixtures/telemetry_lap.csv").split("\n").slice(0, 2000).join("\n"))), null,
  "no complete lap -> null");
console.log("coach.js tests passed");
