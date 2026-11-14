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
// colours: time lost as a share of the reference's time through the section (3% gold-like, 5% silver-like)
assert.deepStrictEqual(r.corners.map(c => c.colour), ["warn", "good", "good", "good", "good", "good", "warn", "good", "good"],
  "a lap 2.7% off the reference is mostly green");
assert.ok(r.corners.every(c => c.colour === (c.lost < 0.1 ? "good" : c.share < 0.03 ? "good" : c.share < 0.05 ? "warn" : "bad")));
assert.ok(Math.abs(r.corners[6].share - 0.045) < 0.002, "corner 7: 0.43 s of about 9.6 s");
assert.ok(Coach.cornerDetail(r.corners[6], "the reference", r).includes("4.5% slower in this section"));
assert.ok(r.corners[0].tips[0].startsWith("Start of the lap"), "slow start-line speed is called out");
assert.ok(r.corners[6].tips.some(t => t.startsWith("Brake pressure")), "corner 7: WR holds full brake longer");
assert.ok(Coach.trackMap(r).startsWith("<svg"));
// the long fast left after turn 1: 34% throttle where the WR averages 80%; early braking into a corner isn't a "lift"
assert.strictEqual(r.lifts.length, 1);
assert.ok(r.corners[1].tips.some(t => /^Lift: you average 3\d% throttle for 6\d m/.test(t)), r.corners[1].tips.join(" | "));
const chart = Coach.cornerDetail(r.corners[6], "WR", r);
["Brake %", "Throttle %", "Time gap:", "WR brakes"].forEach(t => assert.ok(chart.includes(t), "chart shows " + t));
// speed under the pedals, both laps on one scale, then the time gap
assert.ok(chart.indexOf("Throttle %") < chart.indexOf("Speed km/h") && chart.indexOf("Speed km/h") < chart.indexOf("Time gap:"));
assert.ok(chart.includes('class="pc-me speed"') && /Speed km\/h[\s\S]*class="pc-ref"/.test(chart), "your speed and the reference's");
const [, vHi, vLo] = chart.match(/text-anchor="end">(\d+)<\/text>\s*<text[^>]*text-anchor="end">(\d+)<\/text>\s*<path class="pc-ref"[^>]*\/>\s*<path class="pc-me speed"/).map(Number);
assert.ok(vHi > vLo && vHi % 10 === 0 && vLo % 10 === 0, `speed scale ${vLo}-${vHi}`);
const liftChart = Coach.cornerDetail(r.corners[1], "WR", r); // no braking at corner 2: no brake strip, apex as 0
assert.ok(!liftChart.includes("Brake %") && liftChart.includes("the apex (no braking here)"));

// The site's reference files store rounded values; the same lap from its CSV must still match itself.
for (const [csv, json] of [["reference_barcelona.csv", ref], ["reference_sugo.csv", null]]) {
  const raw = Coach.fastestLap(Coach.parseCsv(read("tests/fixtures/" + csv)));
  const site = json ? roundLike(json) : roundLike(raw);
  const res = Coach.analyse(site, raw);
  assert.ok(!res.error, res.error);
  res.corners.forEach(c => assert.deepStrictEqual(c.tips, ["Close to the WR here."], `${csv} corner ${c.n}: ${c.tips}`));
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
const dots = closeUp.slice(closeUp.indexOf('class="corner-lines"'));
assert.ok(dots.includes('class="cl-legend"') && !dots.includes("slowest"), "legend; no slowest-point marker");
// the line-width close-up comes first: both lines, thickness following the pedals, both braking points, its own button
const widthsUp = closeUp.slice(closeUp.indexOf('class="corner-widths"'), closeUp.indexOf('class="corner-lines"'));
assert.ok(closeUp.indexOf('class="corner-widths"') >= 0 && closeUp.indexOf('class="corner-widths"') < closeUp.indexOf('class="corner-lines"'));
assert.strictEqual((widthsUp.match(/cw-dot brake/g) || []).length, 2);
assert.ok(new Set([...widthsUp.matchAll(/class="cw-me"[^>]*stroke-width:([\d.]+)/g)].map(m => m[1])).size > 5, "line thickness follows the pedals");
assert.ok(widthsUp.includes('class="cw-toggle"') && widthsUp.includes("Hide your line"));
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
  // across the clean laps: one of them 0.4 s slower from turn 7 on (a mistake there), so turn 7 varies most, and the
  // ideal lap uses each section's best
  const laps = ch.laps.map(l => ({ ...l, lap: { ...l.lap, t: l.lap.t.slice() } }));
  const slow = laps[3].lap, at = slow.t.findIndex(t => t > 79);
  for (let i = at; i < slow.t.length; i++) slow.t[i] += 0.4 * Math.min(1, (i - at) / 60);
  slow.lap_ms += 400;
  const across = Coach.acrossLaps(ref, laps, "the WR");
  assert.strictEqual(across.laps, 3, "the cut lap is left out");
  assert.strictEqual(across.varies[0].n, 7, JSON.stringify(across.varies));
  assert.ok(across.varies[0].sd > 0.1 && across.varies.every(v => [6, 7].includes(v.n)), "only where the slow lap lost time");
  assert.ok(across.gain.length >= 1 && across.gain[0].avg >= across.gain[across.gain.length - 1].avg);
  assert.ok(Math.abs(across.idealMs - 113057) <= 15, `ideal ${across.idealMs}: the unchanged laps' sections`);
  assert.strictEqual(across.bestMs, 113057);
  assert.strictEqual(Coach.acrossLaps(ref, laps.slice(0, 3), "the WR"), null, "needs 3 clean laps");
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

// The advice, word for word, for the two real comparisons above (Barcelona against the WR, the S-1 bronze attempt
// against the gold run): every section's time, colour and tips, as the site shows them. It's deterministic, so any
// change to the advice shows up here. After a deliberate change, rewrite the file and read its diff:
//   UPDATE_ADVICE=1 node tests/test_coach.js
{
  const file = path.join(__dirname, "fixtures", "expected_advice.json");
  const advice = res => res.corners.map(c => ({ section: c.n, lost: (c.lost > 0 ? "+" : "") + c.lost.toFixed(2) + " s",
    colour: c.colour, tips: c.tips }));
  const now = { "Barcelona, your lap against the WR": advice(r), "S-1, your bronze attempt against the gold run": advice(s1) };
  if (process.env.UPDATE_ADVICE) fs.writeFileSync(file, JSON.stringify(now, null, 2) + "\n");
  const expected = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const lap of Object.keys(expected)) {
    assert.strictEqual(now[lap].length, expected[lap].length, `${lap}: number of sections`);
    now[lap].forEach((c, i) => assert.deepStrictEqual(c, expected[lap][i], `${lap}, section ${c.section}: the advice changed`));
  }
  assert.deepStrictEqual(Object.keys(now), Object.keys(expected));
  console.log("expected advice ok");
}

// Steering (between throttle and speed, degrees clockwise up) and turn-in (T): where the steering starts to wind on,
// at about 10% of the lap's own peak steering in the section
{
  const chart7 = Coach.cornerDetail(r.corners[6], "the WR", r);
  assert.ok(chart7.indexOf("Throttle %") < chart7.indexOf("Steering °") && chart7.indexOf("Steering °") < chart7.indexOf("Speed km/h"),
    "steering after throttle, before speed");
  assert.ok(chart7.includes('class="pc-me steer"') && /Steering °[\s\S]*class="pc-ref"/.test(chart7), "your steering and the reference's");
  for (const c of r.corners) for (const [L, m] of [[r.grid.R, c.ref], [r.grid.M, c.me]]) {
    if (m.turnStart === null) continue;
    let own = 0;
    for (let k = c.from; k < c.to; k++) own = Math.max(own, Math.abs(L.steer[k]));
    // where it passes 10% (or changes direction, or at the top speed before the corner if it's already turning there)
    assert.ok(m.turnStart < c.apex && Math.abs(L.steer[m.turnStart]) > 0.1 * own && (m.turnStart === m.top
      || Math.abs(L.steer[m.turnStart - 1]) <= 0.1 * own || Math.sign(L.steer[m.turnStart - 1]) !== Math.sign(L.steer[m.turnStart])),
      `corner ${c.n}: turn-in where the steering passes 10%`);
  }
  assert.ok(r.corners.filter(c => c.ref.turnStart !== null && c.me.turnStart !== null).length >= 6, "turn-in found in most corners");
  // a left-hander reads below zero, a right-hander above
  const scale = html => [...html.matchAll(/>(−?\d+)°</g)].map(m => +m[1].replace("−", "-"));
  const turnDeg = c => -r.grid.R.steer[c.apex] * 180 / Math.PI;
  for (const c of [r.corners[0], r.corners[6]]) {
    const ticks = scale(Coach.cornerDetail(c, "the WR", r));
    assert.ok(turnDeg(c) > 0 ? Math.max(...ticks) > 0 : Math.min(...ticks) < 0, `corner ${c.n}: ${ticks}`);
  }
  // turn-in is marked on the steering chart only, not as a badge on the line close-up
  assert.strictEqual((chart7.match(/<g class="cl-badge (me|ref)"><line[^>]*\/>\s*<circle[^>]*\/><text[^>]*>T<\/text>/g) || []).length, 0);
  assert.strictEqual((chart7.match(/<g class="pc-t (me|ref)">/g) || []).length, 2, "T on the steering chart, both laps");
  // a reference recorded without steering (GT7's older data format): your steering only, and says so
  const blank = lap => ({ ...lap, steering_rad: lap.steering_rad.map(() => NaN) });
  const noRef = Coach.analyse(blank(ref), me, "Someone"), h = Coach.cornerDetail(noRef.corners[6], "Someone", noRef);
  assert.ok(h.includes("(Someone's recording has none)") && h.includes('class="pc-me steer"'));
  assert.strictEqual(noRef.corners[6].ref.turnStart, null);
  assert.deepStrictEqual(noRef.corners.map(c => c.tips), r.corners.map(c => c.tips.map(t => t.replace(/the WR/g, "Someone"))).map((t, i) => noRef.corners[i].tips),
    "the tips don't depend on it");
  const none = Coach.analyse(blank(ref), blank(me), "Someone"), h2 = Coach.cornerDetail(none.corners[6], "Someone", none);
  assert.ok(!h2.includes("Steering °") && !h2.includes(">T</text>"), "neither recorded it: no steering chart, no T");
  // an uploaded recording without steering keeps it empty, not a flat line at 0
  const lines = read("tests/fixtures/telemetry_lap.csv").split("\n"), col = lines[0].split(",").indexOf("steering_rad");
  const noSteerCsv = lines.map((l, i) => (i && l ? l.split(",").map((v, j) => (j === col ? "" : v)).join(",") : l)).join("\n");
  assert.ok(Coach.fastestLap(Coach.parseCsv(noSteerCsv)).steering_rad.every(Number.isNaN));
  console.log("steering ok");
}

console.log("coach.js tests passed");

// audio cue points (the app): where the reference brakes (dabs too), lifts without braking, and gets back on the gas
{
  const c = Coach.cuePoints(ref);
  const kinds = k => c.cues.filter(q => q.kind === k);
  assert.ok(c.loop && c.step === 2 && c.x.length === Math.ceil(c.length / 2), "the line every 2 m, a closed loop");
  assert.deepStrictEqual(kinds("brake").map(q => q.s), [729, 1619, 2026, 2453, 3356, 3645, 3661, 4162]);
  // a real lift at 2783 (1 s off, ending with an upshift); a flick off the throttle just before braking at 2437 is
  // part of the braking
  assert.deepStrictEqual(kinds("lift").map(q => q.s), [2783], "a flick before braking isn't a lift");
  // a driver who lifts for every upshift (0.3 s off the throttle, the gear going up): gear changes, not lifts
  const shifty = { ...ref, throttle_pct: ref.throttle_pct.slice(), gear: ref.gear.slice() };
  const at = ref.t.findIndex(t => t > 30.2); // on the straight before turn 4, at full throttle
  for (let i = at; i < at + 18; i++) shifty.throttle_pct[i] = 0;
  for (let i = at + 6; i < ref.t.length; i++) shifty.gear[i] += 1;
  const lifts = c2 => c2.cues.filter(q => q.kind === "lift").map(q => q.s);
  assert.deepStrictEqual(lifts(Coach.cuePoints(shifty)), [2783], "an upshift lift isn't cued");
  assert.deepStrictEqual(lifts(Coach.cuePoints({ ...shifty, gear: undefined })), [2783], "nor without the gear, from the speed");
  // ...but the same 0.3 s off the throttle without a gear change is a lift
  assert.strictEqual(lifts(Coach.cuePoints({ ...shifty, gear: ref.gear })).length, 2);
  assert.strictEqual(kinds("gas").length, 7, "one gas point after each braking, the double brake sharing one");
  assert.ok(c.cues.every((q, i) => i === 0 || q.s >= c.cues[i - 1].s), "in order along the lap");
  const sugo = Coach.cuePoints(Coach.fastestLap(Coach.parseCsv(read("tests/fixtures/reference_sugo.csv"))));
  assert.ok(sugo.cues.some(q => q.kind === "lift") && sugo.cues.filter(q => q.kind === "brake").length >= 8);
}
console.log("cue points ok");

// Faster than the reference in a section (here the roles swapped: the reference lap against the slower lap): no
// advice, just how much faster; and an exit never "costs time" in a section that gains time.
{
  const swapped = Coach.analyse(me, ref, "Someone");
  const faster = swapped.corners.filter(c => Math.round(c.lost * 100) <= -5);
  assert.ok(faster.length >= 3, "the swapped lap is faster in several sections");
  for (const c of faster) assert.deepStrictEqual(c.tips, [`You're ${(-c.lost).toFixed(2)} s faster than Someone here.`]);
  // within 0.05 s either way (as shown): close to the reference, no advice
  for (const r of [swapped, Coach.analyse(ref, me, "Someone")]) {
    for (const c of r.corners.filter(c => Math.abs(Math.round(c.lost * 100)) < 5)) assert.deepStrictEqual(c.tips, ["Close to Someone here."]);
  }
  for (const c of swapped.corners.filter(c => c.lost <= 0)) assert.ok(!c.tips.some(x => /costs time/.test(x)), c.tips.join(" | "));
  console.log("faster sections ok");
}
