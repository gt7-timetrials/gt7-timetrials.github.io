// Lap comparison against a reference (world record) lap, from telemetry.py recordings.
// Runs in the browser; nothing is uploaded. Deterministic rules, no AI.
//
// 1. Take the fastest complete lap in the CSV (the game's lap counter going up twice).
// 2. Measure both laps by distance along the reference lap's line, every metre.
// 3. Split the track into corners at the reference's slowest points (apexes).
// 4. For each corner compare braking, trail braking, minimum speed, throttle and steering.

const Coach = (() => {
  // The language (site/i18n.js): the page's in the browser, English under Node unless a test chooses (useLanguage).
  // Each tip is { kind, text }, so the rules below that drop or replace tips don't depend on the wording.
  let tr = typeof I18N !== "undefined" ? I18N.t : require("./i18n.js").create("en").t;
  const useLanguage = t => { tr = t; };
  // who a lap is compared with: a driver's name as it is; the reference, in the page's language
  const named = who => ({ "the reference lap": tr("the reference lap"), "the WR": tr("the WR"), Reference: tr("Reference") })[who] ?? who;
  const tip = (kind, text, vars) => ({ kind, text: tr(text, vars) });
  const joinAnd = list => list.reduce((a, b) => tr("{a}, and {b}", { a, b }));
  const LAP_FIELDS = ["x", "z", "speed_kmh", "throttle_pct", "brake_pct", "steering_rad", "wheel_rl_kmh", "wheel_rr_kmh", "gear",
    "wheel_fl_kmh", "wheel_fr_kmh", "tcs_active"];
  // a section's colour: time lost as a share of the reference's time through it (within 3%, like gold in a time
  // trial; within 5%, like silver; more). Under 0.1 s stays green, so a short section can't go red on a small slip.
  const COLOURS = [[0.03, "good"], [0.05, "warn"], [Infinity, "bad"]];
  const GREEN_UNDER_S = 0.1;
  const colour = (lost, share) => (lost < GREEN_UNDER_S ? "good" : COLOURS.find(([lim]) => share < lim)[1]);

  function parseCsv(text) {
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return [];
    const head = lines[0].split(",");
    return lines.slice(1).map(l => {
      const v = l.split(","), r = {};
      head.forEach((h, i) => (r[h] = v[i] === "" || v[i] === undefined ? NaN : +v[i]));
      return r;
    });
  }

  // Same rule as gt7tt/telemetry.py: a complete lap is the lap counter going up by one, twice; laps are timed by
  // packet number (60 a second).
  function completeLaps(rows) {
    const ups = [];
    for (let i = 1; i < rows.length; i++) {
      if (rows[i].lap === rows[i - 1].lap + 1 && rows[i].lap >= 1 && rows[i].speed_kmh > 30) ups.push(i);
    }
    const out = [];
    for (let k = 0; k + 1 < ups.length; k++) {
      const a = ups[k], b = ups[k + 1];
      if (rows[b].lap === rows[a].lap + 1 && rows[b].last_lap_ms > 0) out.push({ number: rows[a].lap, a, b, lap_ms: rows[b].last_lap_ms });
    }
    return out;
  }

  function extractLap(rows, a, b) {
    const lap = rows.slice(a, b + 1), p0 = lap[0].packet_id;
    const out = { lap_ms: rows[b].last_lap_ms, car_code: lap[0].car_code, t: lap.map(r => (r.packet_id - p0) / 60) };
    // a field the recording doesn't have at all (steering, in GT7's older data format) stays empty (NaN), not 0
    LAP_FIELDS.forEach(k => (out[k] = lap.every(r => Number.isNaN(r[k])) ? lap.map(() => NaN) : lap.map(r => (Number.isNaN(r[k]) ? 0 : r[k]))));
    return out;
  }

  const pathLength = lap => {
    let d = 0;
    for (let i = 1; i < lap.x.length; i++) d += Math.hypot(lap.x[i] - lap.x[i - 1], lap.z[i] - lap.z[i - 1]);
    return d;
  };

  function fastestLap(rows) {
    const laps = completeLaps(rows);
    if (!laps.length) return null;
    const best = laps.reduce((x, y) => (y.lap_ms < x.lap_ms ? y : x));
    return extractLap(rows, best.a, best.b);
  }

  // Every complete lap in a recording, for choosing which one to compare. GT7 doesn't say whether a lap was valid, so
  // a lap noticeably shorter than the reference (by more than 1%, and at least 30 m) is marked as a likely cut corner:
  // a clean lap's line is within about 0.5% of the reference's. `pick` is the fastest lap that isn't marked (or the
  // fastest of all, if they all are).
  const CUT_SHARE = 0.01, CUT_MIN_M = 30;
  // A lap with a spin or crash (see SPIN_SPEED) is treated the same way: `incident` lists its corners.
  function lapChoices(rows, ref) {
    const refLength = pathLength(ref);
    const laps = completeLaps(rows).map(l => {
      const lap = extractLap(rows, l.a, l.b), short = refLength - pathLength(lap), res = analyse(ref, lap);
      return { number: l.number, lap_ms: l.lap_ms, lap, short: Math.round(short),
        cut: short > Math.max(CUT_MIN_M, CUT_SHARE * refLength),
        incident: res.error ? [] : res.corners.filter(c => c.incident).map(c => c.n) };
    });
    const by = list => list.reduce((x, y) => (y.lap_ms < x.lap_ms ? y : x), list[0]);
    const clean = laps.filter(l => !l.cut && !l.incident.length);
    const pick = laps.length ? laps.indexOf(by(clean.length ? clean : laps)) : -1;
    return { laps, pick, fastest: laps.length ? laps.indexOf(by(laps)) : -1 };
  }

  const interp = (xs, ys, x) => { // xs ascending
    let lo = 0, hi = xs.length - 1;
    if (x <= xs[0]) return ys[0];
    if (x >= xs[hi]) return ys[hi];
    while (hi - lo > 1) { const m = (lo + hi) >> 1; (xs[m] <= x ? (lo = m) : (hi = m)); }
    const f = (x - xs[lo]) / (xs[hi] - xs[lo] || 1);
    return ys[lo] + f * (ys[hi] - ys[lo]);
  };

  // Distance along the reference line for each sample of a lap, plus how far off the line it was.
  function project(ref, lap) {
    const s = [], off = [];
    let j = 0;
    for (let i = 0; i < lap.x.length; i++) {
      let best = Infinity, bj = j;
      for (let k = Math.max(0, j - 30); k < Math.min(ref.x.length, j + 400); k++) {
        const d = (ref.x[k] - lap.x[i]) ** 2 + (ref.z[k] - lap.z[i]) ** 2;
        if (d < best) { best = d; bj = k; }
      }
      j = bj;
      // the exact spot on the reference line: the nearer of the two segments either side of the nearest sample
      let along = ref.s[bj], dist = Math.sqrt(best);
      for (const a of [bj - 1, bj]) {
        if (a < 0 || a + 1 >= ref.x.length) continue;
        const sx = ref.x[a + 1] - ref.x[a], sz = ref.z[a + 1] - ref.z[a], len2 = sx * sx + sz * sz;
        if (!len2) continue;
        const f = Math.max(0, Math.min(1, ((lap.x[i] - ref.x[a]) * sx + (lap.z[i] - ref.z[a]) * sz) / len2));
        const d = Math.hypot(ref.x[a] + f * sx - lap.x[i], ref.z[a] + f * sz - lap.z[i]);
        if (d < dist) { dist = d; along = ref.s[a] + f * (ref.s[a + 1] - ref.s[a]); }
      }
      s.push(Math.max(along, s.length ? s[s.length - 1] : 0));
      off.push(dist);
    }
    return { s, off };
  }

  // Every metre: time, speed, throttle (ignoring downshift blips while braking), brake, steering, wheel slip (how much
  // faster the front and the rear wheels turn than the car moves, %), and traction control cutting in (0 to 1).
  function resample(lap, s, n) {
    const keep = [0];
    for (let i = 1; i < s.length; i++) if (s[i] > s[keep[keep.length - 1]]) keep.push(i);
    const xs = keep.map(i => s[i]), col = k => keep.map(i => (lap[k] ? lap[k][i] : NaN)); // NaN: not recorded
    const cols = { t: col("t"), v: col("speed_kmh"), thr: col("throttle_pct"), brk: col("brake_pct"),
      steer: col("steering_rad"),
      slipF: keep.map(i => (lap.wheel_fl_kmh ? (100 * ((lap.wheel_fl_kmh[i] + lap.wheel_fr_kmh[i]) / 2 - lap.speed_kmh[i])) / Math.max(30, lap.speed_kmh[i]) : NaN)),
      slipR: keep.map(i => (100 * ((lap.wheel_rl_kmh[i] + lap.wheel_rr_kmh[i]) / 2 - lap.speed_kmh[i])) / Math.max(30, lap.speed_kmh[i])),
      tcs: col("tcs_active"),
      x: col("x"), z: col("z"), ...(lap.gear ? { gear: col("gear") } : {}) };
    const g = {};
    for (const k in cols) g[k] = Array.from({ length: n }, (_, m) => interp(xs, cols[k], m));
    g.thr = g.thr.map((v, m) => (g.brk[m] > 10 ? 0 : v));
    return g;
  }

  // Apexes: the reference's slowest points, at least 10 km/h below the speeds either side.
  function findApexes(v) {
    const sm = v.map((_, i) => { let a = 0, c = 0; for (let k = i - 7; k <= i + 7; k++) if (v[k] !== undefined) { a += v[k]; c++; } return a / c; });
    const out = [];
    for (let i = 1; i < sm.length - 1; i++) {
      let isMin = true;
      for (let k = Math.max(0, i - 80); k <= Math.min(sm.length - 1, i + 80) && isMin; k++) if (sm[k] < sm[i]) isMin = false;
      if (!isMin || (out.length && i - out[out.length - 1] < 80)) continue;
      const left = Math.max(...sm.slice(Math.max(0, i - 400), i)), right = Math.max(...sm.slice(i + 1, i + 401));
      if (Math.min(left, right) - sm[i] >= 10) out.push(i);
    }
    return out;
  }

  // Heading of the reference line in radians, unwrapped so it changes smoothly round each bend.
  function headings(R) {
    const n = R.x.length, h = [];
    for (let k = 0; k < n; k++) { const a = Math.max(0, k - 5), b = Math.min(n - 1, k + 5); h.push(Math.atan2(R.z[b] - R.z[a], R.x[b] - R.x[a])); }
    for (let k = 1; k < n; k++) { while (h[k] - h[k - 1] > Math.PI) h[k] -= 2 * Math.PI; while (h[k] - h[k - 1] < -Math.PI) h[k] += 2 * Math.PI; }
    return h;
  }
  // How far the reference line turns over 150 m centred on each point, in degrees.
  const BEND = 75;
  function turning(R) {
    const h = headings(R), n = h.length;
    return h.map((_, k) => Math.abs(h[Math.min(n - 1, k + BEND)] - h[Math.max(0, k - BEND)]) * 180 / Math.PI);
  }
  // Where each section starts: just before the reference starts braking or lifting for the corner, or before you do
  // if that's earlier (up to 150 m), so your braking zone stays with its corner. With no braking or lifting, where
  // the bend starts to turn. So each section is a corner plus the straight after it, which its exit speed decides.
  function sectionStart(R, M, turn, from, apex) {
    const entry = L => {
      let top = from;
      for (let k = from; k <= apex; k++) if (L.v[k] > L.v[top]) top = k;
      return { top, at: firstFrom(L.thr, top, apex, (t, k) => t < 50 || L.brk[k] > 5) };
    };
    let at = entry(R).at;
    if (at === null) { at = apex; while (at > from && turn[at - 1] >= turn[apex] / 2) at--; }
    const me = entry({ ...M, v: M.v.map((v, k) => (k < at - 150 ? -1 : v)) });
    if (me.at !== null && me.at > me.top && me.at < at) at = me.at;
    return Math.max(from + 20, at - 10);
  }

  const mean = a => a.reduce((x, y) => x + y, 0) / (a.length || 1);

  function firstFrom(arr, from, to, test) {
    for (let k = from; k < to; k++) if (test(arr[k], k)) return k;
    return null;
  }

  function cornerMetrics(L, z0, z1, apex, steerThreshold) {
    let top = z0;
    for (let k = z0; k <= apex; k++) if (L.v[k] > L.v[top]) top = k;
    const brakeAt = firstFrom(L.brk, top, apex, b => b > 5);
    const liftAt = brakeAt === null ? firstFrom(L.thr, top, apex, t => t < 50) : null;
    let peakBrake = 0, fullBrake = 0, release = null;
    if (brakeAt !== null) {
      for (let k = brakeAt; k <= apex; k++) { peakBrake = Math.max(peakBrake, L.brk[k]); if (L.brk[k] >= 90) fullBrake++; }
      release = firstFrom(L.brk, brakeAt, z1, b => b <= 5);
    }
    const turnIn = firstFrom(L.steer, top, z1, s => Math.abs(s) > steerThreshold);
    const lo = Math.max(z0, apex - 50), hi = Math.min(z1 - 1, apex + 50);
    let minAt = lo;
    for (let k = lo; k <= hi; k++) if (L.v[k] < L.v[minAt]) minAt = k;
    // back on the throttle: the start of the run of >= 20% throttle around the apex
    const start = release ?? liftAt ?? top;
    let onGas = apex;
    if (L.thr[apex] >= 20) { while (onGas > start && L.thr[onGas - 1] >= 20) onGas--; }
    else { onGas = firstFrom(L.thr, apex, z1, t => t >= 20); }
    const fullGas = onGas === null ? null : firstFrom(L.thr, onGas, z1, t => t >= 95);
    let saw = 0;
    if (onGas !== null) {
      let peak = 0;
      for (let k = onGas; k < (fullGas ?? z1); k++) { if (L.thr[k] < peak - 25) { saw++; peak = L.thr[k]; } peak = Math.max(peak, L.thr[k]); }
    }
    let maxSteer = 0;
    for (let k = turnIn ?? top; k < z1; k++) maxSteer = Math.max(maxSteer, Math.abs(L.steer[k]));
    return { top, topSpeed: L.v[top], brakeAt, liftAt, peakBrake, fullBrake, release, turnIn,
      // averaged over the first 15 m of turning: the brake is often being released fast at this point
      brakeAtTurnIn: turnIn === null ? 0 : mean(L.brk.slice(turnIn, Math.min(z1, turnIn + 15))), minAt, minSpeed: L.v[minAt], onGas, fullGas, saw,
      maxSteerDeg: maxSteer * 180 / Math.PI, exitSpeed: L.v[z1 - 1], minThrottle: Math.min(...L.thr.slice(top, apex + 1)) };
  }

  const r0 = v => Math.round(v);
  function tips(me, ref, lost, who, steerRatio) {
    const out = [], W = { who, Who: cap(who) };
    const d = (a, b) => (a === null || b === null ? null : a - b);
    if (ref.brakeAt !== null && me.brakeAt !== null) {
      const db = d(me.brakeAt, ref.brakeAt);
      if (db <= -5) out.push(tip("brakingPoint", "Braking point: you brake {m} m earlier than {who}.", { ...W, m: -db }));
      else if (db >= 5) out.push(me.minSpeed < ref.minSpeed - 3
        ? tip("brakingPoint", "Braking point: you brake {m} m later than {who}, then have to slow down more: you may be overshooting the entry.", { ...W, m: db })
        : tip("brakingPoint", "Braking point: you brake {m} m later than {who}.", { ...W, m: db }));
      if (ref.fullBrake - me.fullBrake >= 15) out.push(tip("brakePressure", "Brake pressure: {who} stays above 90% brake for {ref} m; you do for {me} m. Brake hard at the start of the zone, then ease off.", { ...W, ref: ref.fullBrake, me: me.fullBrake }));
      if (ref.brakeAtTurnIn >= 15 && me.brakeAtTurnIn < ref.brakeAtTurnIn / 2) {
        const trail = ref.release !== null && ref.turnIn !== null ? ref.release - ref.turnIn : 0;
        const v = { ...W, ref: r0(ref.brakeAtTurnIn), me: r0(me.brakeAtTurnIn), m: trail };
        out.push(trail > 5
          ? tip("trail", "Trail braking: {who} is still at {ref}% brake when starting to turn and keeps easing it off for {m} m into the corner; you're at {me}%.", v)
          : tip("trail", "Trail braking: {who} is still at {ref}% brake when starting to turn; you're at {me}%.", v));
      } else if (me.brakeAtTurnIn >= 15 && me.brakeAtTurnIn > 2 * ref.brakeAtTurnIn) {
        out.push(tip("brakeRelease", "Brake release: you're still at {me}% brake when starting to turn; {who} is at {ref}%. Release more before turning in.", { ...W, me: r0(me.brakeAtTurnIn), ref: r0(ref.brakeAtTurnIn) }));
      }
    } else if (ref.brakeAt !== null && me.brakeAt === null) {
      out.push(tip("refBrakes", "{Who} brakes here (up to {p}%); you only lift off the throttle.", { ...W, p: r0(ref.peakBrake) }));
    } else if (ref.brakeAt === null && me.brakeAt !== null) {
      out.push(ref.minThrottle > 5
        ? tip("refNoBrake", "{Who} doesn't brake here, only easing to {t}% throttle; you brake to {p}%.", { ...W, t: r0(ref.minThrottle), p: r0(me.peakBrake) })
        : tip("refNoBrake", "{Who} doesn't brake here, just lifting off; you brake to {p}%.", { ...W, p: r0(me.peakBrake) }));
    } else if (ref.liftAt !== null && me.liftAt !== null && me.minThrottle < ref.minThrottle - 15) {
      out.push(tip("lift", "Lift: you come off the throttle to {me}%; {who} only to {ref}%.", { ...W, me: r0(me.minThrottle), ref: r0(ref.minThrottle) }));
    }
    const dv = me.minSpeed - ref.minSpeed, speeds = { me: r0(me.minSpeed), ref: r0(ref.minSpeed) };
    if (dv <= -3) out.push(tip("minSpeed", "Minimum speed: {me} km/h vs {ref} km/h. You're slowing the car more than you need to.", speeds));
    else if (dv >= 3 && lost > 0.1) out.push(tip("minSpeed", "Minimum speed: you carry {me} km/h vs {ref} km/h but lose time afterwards. Too fast on entry can mean a wide, slow exit.", speeds));
    const dg = d(me.onGas, ref.onGas), df = d(me.fullGas, ref.fullGas);
    if (dg !== null && dg >= 8) out.push(tip("throttle", "Throttle: you get back on the throttle {m} m later than {who}.", { ...W, m: dg }));
    if (df !== null && df >= 15) out.push(tip("fullThrottle", "Full throttle: you reach full throttle {m} m later than {who}.", { ...W, m: df }));
    if (me.saw >= 2 && ref.saw <= 1) out.push(tip("throttleControl", "Throttle control: your throttle goes on and off {n} times before full throttle; {who} squeezes it on smoothly. Smooth, progressive throttle keeps the car balanced.", { ...W, n: me.saw }));
    // Steering angles depend on the controller or wheel and its settings, so compare against the
    // ratio this driver typically uses over the lap rather than the reference's raw angle.
    if (steerRatio && ref.maxSteerDeg >= 20 && me.maxSteerDeg / ref.maxSteerDeg >= 1.3 * steerRatio) {
      out.push(tip("steering", "Steering: here you use {p}% more steering lock than you do elsewhere on the lap, compared with {who}. The front is sliding (understeer) or you're on a tighter line. Try a little less speed on entry, and unwind the wheel as you add throttle.", { ...W, p: Math.round(100 * (me.maxSteerDeg / ref.maxSteerDeg / steerRatio - 1)) }));
    }
    if (me.wheelspin) out.push(me.wheelspin);
    if (me.exitSpeed <= ref.exitSpeed - 4 && lost > 0) out.push(tip("exit", "Exit: you leave the corner at {me} km/h vs {ref} km/h, and that costs time all the way down the straight after it.", { me: r0(me.exitSpeed), ref: r0(ref.exitSpeed) }));
    if (!out.length) out.push(lost < 0.1 ? tip("close", "Close to {who} here.", W) : tip("noSingle", "No single big difference: small losses through the whole section."));
    return out;
  }
  const cap = s => s[0].toUpperCase() + s.slice(1);

  function analyse(refLap, myLap, who = "the WR") {
    who = named(who);
    const ref = { ...refLap, s: [0] };
    for (let i = 1; i < ref.x.length; i++) ref.s.push(ref.s[i - 1] + Math.hypot(ref.x[i] - ref.x[i - 1], ref.z[i] - ref.z[i - 1]));
    const n = Math.floor(ref.s[ref.s.length - 1]);
    const p = project(ref, myLap);
    const sorted = p.off.slice().sort((a, b) => a - b);
    if (sorted[Math.floor(sorted.length / 2)] > 25 || p.s[p.s.length - 1] < 0.9 * n) {
      return { error: tr("This lap doesn't follow the reference lap's track. Is it the same track and layout?") };
    }
    const R = resample(ref, ref.s, n), M = resample(myLap, p.s, n);
    const delta = M.t.map((t, i) => t - R.t[i]);
    // The game's lap times can include time the recordings don't, e.g. a license test's timer starting before the
    // car reaches the line. The corners use the recorded laps, so they always add up to the recorded gap.
    const recordedGap = myLap.t[myLap.t.length - 1] - refLap.t[refLap.t.length - 1];
    const turn = turning(R), apexes = findApexes(R.v);
    // the first section starts at the line; its corner part starts at the braking zone, like the others
    const entries = apexes.map((apex, i) => sectionStart(R, M, turn, i === 0 ? 0 : apexes[i - 1], apex));
    const starts = entries.map((k, i) => (i === 0 ? 0 : k));
    const corners = apexes.map((apex, i) => {
      const z0 = starts[i], z1 = i === apexes.length - 1 ? n : starts[i + 1];
      // the last section runs to the finish line, timed from the recordings (see recordedGap below)
      const lost = (i === apexes.length - 1 ? recordedGap : delta[z1]) - delta[z0];
      const refTime = (i === apexes.length - 1 ? refLap.t[refLap.t.length - 1] : R.t[z1]) - R.t[z0];
      let peak = 0;
      for (let k = z0; k < z1; k++) peak = Math.max(peak, Math.abs(R.steer[k]));
      const ref_m = cornerMetrics(R, z0, z1, apex, 0.3 * peak), me_m = cornerMetrics(M, z0, z1, apex, 0.3 * peak);
      // the corner ends 20 m after the reference reaches full throttle (or, if it's already flat out at the apex,
      // where the bend stops turning);
      // the rest of the section is the straight after it
      let exit = Math.min(z1 - 1, (ref_m.fullGas ?? apex + 40) + 20);
      if (ref_m.fullGas !== null && ref_m.fullGas <= apex) { exit = apex; while (exit < z1 - 1 && turn[exit + 1] >= turn[apex] / 2) exit++; }
      exit = Math.max(Math.min(apex + 20, z1 - 1), exit);
      ref_m.exitSpeed = R.v[exit]; me_m.exitSpeed = M.v[exit];
      const entry = i === 0 && entries[0] >= 150 ? entries[0] : z0;
      // a spin or crash: below SPIN_SPEED of the reference's speed at the same point (after the start, where a
      // standing start would be slow anyway)
      let incident = false;
      for (let k = Math.max(z0, SPIN_FROM); k < z1 && !incident; k++) incident = M.v[k] < SPIN_SPEED * R.v[k];
      return { apex, z0, z1, entry, exit, lost, incident, share: lost / refTime, approachLost: delta[entry] - delta[z0], cornerLost: delta[exit] - delta[entry], ref_m, me_m };
    });
    const ratios = corners.filter(c => c.ref_m.maxSteerDeg >= 20).map(c => c.me_m.maxSteerDeg / c.ref_m.maxSteerDeg).sort((a, b) => a - b);
    const steerRatio = ratios.length >= 3 ? ratios[Math.floor(ratios.length / 2)] : null;
    const out = { ...result(corners, steerRatio, R, M, delta, who), lapMs: myLap.lap_ms, refMs: refLap.lap_ms, length: n, ref,
      otherCar: myLap.car_code !== refLap.car_code,
      recordedGap, gameGap: (myLap.lap_ms - refLap.lap_ms) / 1000 };
    const split = themeSplit(R, M, delta, corners, recordedGap);
    out.themes = split.totals;
    // a tip's theme: by its kind, or for a lift, the theme its metres' time went to
    const themeOf = (c, j) => {
      const span = c.tipSpans[j];
      if (!span) return TIP_THEME[c.tipKinds[j]];
      const sum = Object.fromEntries(THEMES.map(t => [t, 0]));
      for (let k = span[0]; k < Math.min(span[1], split.per.length); k++) for (const t of THEMES) sum[t] += split.per[k][t];
      return THEMES.reduce((a, b) => (Math.abs(sum[b]) > Math.abs(sum[a]) ? b : a));
    };
    out.corners.forEach((c, i) => {
      c.themes = split.corners[i];
      c.tipThemes = c.tips.map((t, j) => themeOf(c, j));
      // the tips, most important first: by the size of their theme in this corner, then within a theme by TIP_RANK
      const size = th => Math.abs(c.themes.signed[th] ?? 0);
      const rank = j => TIP_RANK[c.tipKinds[j]] ?? 50;
      const order = c.tips.map((t, j) => j).sort((x, y) => size(c.tipThemes[y]) - size(c.tipThemes[x]) || rank(x) - rank(y) || x - y);
      for (const key of ["tips", "tipKinds", "tipThemes"]) c[key] = order.map(j => c[key][j]);
    });
    out.corners.forEach(c => {
      delete c.tipSpans;
      if (c.incident) return;
      const one = t => { c.tips = [t.text]; c.tipKinds = [t.kind]; c.tipThemes = [TIP_THEME[t.kind]]; };
      // a corner within 0.5% of the reference's time: no advice, like the bar
      if (c.themes.close) { one(tip("close", "Close to {who} here.", { who })); return; }
      // only tips about a theme that matters here: at least TIP_SHARE of the corner's split and TIP_MIN_S
      const sizes = THEMES.reduce((v, t) => v + Math.abs(c.themes.signed[t]), 0);
      const keep = c.tips.map((t, j) => {
        const th = c.tipThemes[j];
        return !th || (Math.abs(c.themes.signed[th]) >= TIP_SHARE * sizes && Math.abs(c.themes.parts[th]) >= TIP_MIN_S);
      });
      if (!keep.some(Boolean)) { one(tip("noSingle", "No single big difference: small losses through the whole section.")); return; }
      for (const key of ["tips", "tipKinds", "tipThemes"]) c[key] = c[key].filter((t, j) => keep[j]);
    });
    return out;
  }

  // Where the time goes, by theme. The physics works on stretches from one of the reference's braking points to the
  // next (the last runs over the line to the first), splitting each metre's loss into
  //   braking  - the loss from the braking point to the apex, and what your apex speed costs after it
  //   exit     - what the exit adds beyond that, to the corner exit and, through your exit speed, down the straight
  //   straight - the straight's loss beyond what your exit speed explains: lifting, braking, a slower car
  //   line     - time not explained by speed: the extra distance of a different line
  // using the reference lap's own physics, no fitted numbers. "The reference's way" from another speed: where the
  // reference is flat out, the car's flat-out acceleration at that speed (read from the reference lap: engine, gears,
  // drag); elsewhere (part throttle, grip-limited), the reference's acceleration at that point. Before the apex there's
  // no carry-over: arriving slower costs only the time until the reference slows to your speed (you'd brake less), and
  // that goes back to the stretch before. Then a stretch's net loss (or gain) is shared by the themes' sizes, all with
  // its sign: in a stretch slower than the reference, a quicker entry followed by a slow exit counts as time lost, not
  // as a gain. Each corner's section (the one its time and colour are for) adds up its metres; one within THEME_CLOSE
  // of the reference's time isn't split. The start of the lap counts as the last corner's (from your crossing speed).
  const THEMES = ["braking", "exit", "straight", "line"], THEME_CLOSE = 0.005;
  // a tip is shown only if its theme is at least this share of the corner's split and this many seconds
  const TIP_SHARE = 0.15, TIP_MIN_S = 0.03;
  // which theme each kind of tip is about
  const TIP_THEME = { brakingPoint: "braking", brakePressure: "braking", trail: "braking", brakeRelease: "braking", lock: "braking",
    refBrakes: "braking", refNoBrake: "braking", lift: "braking", minSpeed: "braking", steering: "braking",
    throttle: "exit", fullThrottle: "exit", throttleControl: "exit", wheelspin: "exit", exit: "exit",
    line: "line", lifts: "straight", extraBrake: "straight", extraLift: "straight", start: "straight" };
  // (a lift's tip takes the theme its own metres' time went to: see analyse)
  // Within a theme, the habits that usually cost most come first: from the analysis of the owner's and top drivers' laps
  // (gt7laps analysis/report.md, models_ref.py). Braking time: brake held over the reference's after its braking point
  // costs most (+1.5% of the section per typical spread), then braking early (+0.9), then wheel lock (+0.4); less brake
  // than the reference saves braking time (any cost shows on the exit), so those tips come last; minimum speed and
  // steering are results, in between. Exit time: the throttle shortfall carries it (+1.5); full throttle later and
  // wheelspin add about nothing once it's known.
  const TIP_RANK = {
    brakeRelease: 1, refNoBrake: 2, brakingPoint: 3, lock: 4, minSpeed: 5, steering: 6, lift: 7,
    brakePressure: 8, trail: 9, refBrakes: 10,
    throttle: 1, throttleControl: 2, extraLift: 3, extraBrake: 3, lifts: 3, exit: 4, fullThrottle: 5, wheelspin: 6,
    start: 9, line: 1 };
  function themeSplit(R, M, delta, corners, gap) {
    const n = delta.length - 1, sec = v => 1 / Math.max(1, v / 3.6);
    const bins = {};
    for (let k = 0; k + 1 < R.v.length; k++) if (R.thr[k] >= 95 && R.brk[k] < 5 && R.thr[k + 1] >= 95) (bins[Math.floor(R.v[k] / 5)] ||= []).push(R.v[k + 1] ** 2 - R.v[k] ** 2);
    const keys = Object.keys(bins).map(Number).filter(b => bins[b].length >= 5);
    const med = Object.fromEntries(keys.map(b => { const x = bins[b].sort((p, q) => p - q); return [b, x[x.length >> 1]]; }));
    const G = v => { if (!keys.length) return 0; const b = Math.floor(v / 5); let best = keys[0]; for (const k of keys) if (Math.abs(k - b) < Math.abs(best - b)) best = k; return med[best]; };
    const refWay = (ks, j, u) => {
      const out = [], slower = u < R.v[ks[j]];
      for (let i = j; i < ks.length; i++) {
        out.push(u);
        const k = ks[i], k2 = ks[i + 1] ?? k, flat = R.thr[k] >= 95 && R.brk[k] < 5;
        u = Math.sqrt(Math.max(1, u * u + (R.v[k2] ** 2 - R.v[k] ** 2) + (flat ? G(u) - G(R.v[k]) : 0)));
        u = slower ? Math.min(u, R.v[k2]) : Math.max(u, R.v[k2]);
      }
      return out;
    };
    // each metre's loss, by theme (and "carried": arriving slower at a braking point)
    const per = Array.from({ length: n }, () => ({ braking: 0, exit: 0, straight: 0, line: 0, carried: 0 }));
    for (let k = 0; k < n; k++) per[k].line = delta[k + 1] - delta[k] - (sec(M.v[k]) - sec(R.v[k])); // not speed: distance
    per[n - 1].line += gap - delta[n]; // the end of the lap, timed from the recordings like the last corner (recordedGap)
    const idx = corners.map((c, i) => i).filter(i => { const c = corners[i]; return c.ref_m.brakeAt !== null && c.ref_m.brakeAt < c.apex && c.exit > c.apex; });
    const stretches = idx.map((i, m) => {
      const c = corners[i], b = c.ref_m.brakeAt, a = c.apex, x = c.exit, last = m === idx.length - 1;
      const end = last ? n : corners[idx[m + 1]].ref_m.brakeAt, first = corners[idx[0]].ref_m.brakeAt;
      const ks = []; for (let k = b; k < end; k++) ks.push(k);
      if (last) for (let k = 0; k < first; k++) ks.push(k);
      const ja = a - b, jx = x - b, u0 = M.v[b];
      for (let j = 0; j < ja; j++) {
        const k = ks[j], L = sec(M.v[k]) - sec(R.v[k]);
        const cr = u0 < R.v[b] ? sec(Math.min(u0, R.v[k])) - sec(R.v[k]) : 0;
        per[k].carried += cr; per[k].braking += L - cr;
      }
      const fromApex = refWay(ks, ja, M.v[a]), fromExit = refWay(ks, jx, M.v[x]);
      // over the line (the last stretch): your speed there comes from the lap before's last exit, so the reference's
      // way from your crossing speed is the last corner's too (not exact: it was the lap before's)
      const jw = last ? n - b : ks.length, fromLine = last ? refWay(ks, jw, M.v[0]) : [];
      const dvx = M.v[x] - R.v[x], ca = fromApex[jx - ja] - R.v[x], own = dvx - ca;
      const shareB = Math.abs(dvx) < 0.5 ? (Math.abs(ca) + Math.abs(own) ? Math.abs(ca) / (Math.abs(ca) + Math.abs(own)) : 0.5)
        : Math.sign(ca) === Math.sign(own) ? ca / dvx : Math.abs(ca) / (Math.abs(ca) + Math.abs(own));
      for (let j = ja; j < ks.length; j++) {
        const k = ks[j], L = sec(M.v[k]) - sec(R.v[k]);
        if (j < jx) { const fb = sec(fromApex[j - ja]) - sec(R.v[k]); per[k].braking += fb; per[k].exit += L - fb; }
        else {
          const fx = sec(j < jw ? fromExit[j - jx] : fromLine[j - jw]) - sec(R.v[k]);
          per[k].braking += fx * shareB; per[k].exit += fx * (1 - shareB); per[k].straight += L - fx;
        }
      }
      const mix = Object.fromEntries(THEMES.map(t => [t, ks.reduce((v, k) => v + per[k][t], 0)]));
      return { ks, mix };
    });
    // arriving slower is the stretch before's doing: those metres' time goes to its themes, by their sizes
    stretches.forEach((st, m) => {
      const prev = stretches[(m - 1 + stretches.length) % stretches.length].mix, tot = THEMES.reduce((v, t) => v + Math.abs(prev[t]), 0);
      for (const k of st.ks) {
        if (!per[k].carried) continue;
        if (tot > 0) for (const t of THEMES) per[k][t] += per[k].carried * Math.abs(prev[t]) / tot;
        else per[k].braking += per[k].carried;
        per[k].carried = 0;
      }
    });
    // each corner's section (as its time and colour), shared by the themes' sizes, all with its sign
    const totals = { braking: 0, exit: 0, straight: 0, line: 0 };
    const out = corners.map(c => {
      const signed = { braking: 0, exit: 0, straight: 0, line: 0 };
      let refTime = 0;
      for (let k = c.z0; k < Math.min(c.z1, n); k++) { for (const t of THEMES) signed[t] += per[k][t]; refTime += sec(R.v[k]); }
      const net = THEMES.reduce((v, t) => v + signed[t], 0), size = THEMES.reduce((v, t) => v + Math.abs(signed[t]), 0);
      const parts = Object.fromEntries(THEMES.map(t => [t, size > 0 ? net * Math.abs(signed[t]) / size : 0]));
      for (const t of THEMES) totals[t] += parts[t];
      return { lost: net, signed, parts, refTime, close: Math.abs(net) < THEME_CLOSE * refTime };
    });
    return { corners: out, totals, per };
  }

  // Where you are across the track compared with the reference: metres to the outside of the reference's line
  // (+, wider) or the inside (−, tighter), using the corner's direction of turn. Real positions, not distance.
  function direction(R, k) {
    const a = Math.max(0, k - 3), b = Math.min(R.x.length - 1, k + 3);
    const dx = R.x[b] - R.x[a], dz = R.z[b] - R.z[a], l = Math.hypot(dx, dz) || 1;
    return [dx / l, dz / l];
  }
  function lineUse(R, M, z0, z1, apex, ref_m) {
    const n = R.x.length, clamp = k => Math.max(0, Math.min(n - 1, Math.round(k)));
    const turnIn = clamp(ref_m.turnIn ?? apex - 30);
    const exit = clamp(Math.min(z1 - 1, (ref_m.fullGas ?? apex + 40) + 20));
    const [ax, az] = direction(R, clamp(Math.min(turnIn, apex - 10) - 10)), [bx, bz] = direction(R, clamp(Math.max(exit, apex + 10)));
    const cross = ax * bz - az * bx; // > 0: turning right (clockwise on the map)
    const turnDeg = Math.abs(Math.asin(Math.max(-1, Math.min(1, cross)))) * 180 / Math.PI;
    const outside = cross > 0 ? -1 : 1; // the normal (−dz, dx) points to the right of travel
    const wide = k => {
      let sum = 0, cnt = 0;
      for (let j = clamp(k - 5); j <= clamp(k + 5); j++) {
        const [dx, dz] = direction(R, j);
        sum += ((M.x[j] - R.x[j]) * -dz + (M.z[j] - R.z[j]) * dx) * outside; cnt++;
      }
      return sum / cnt;
    };
    return { turnIn, exit, turnDeg, right: cross > 0, atTurnIn: wide(turnIn), atApex: wide(apex), atExit: wide(exit), wide };
  }

  function lineTip(L, who) {
    if (L.turnDeg < 15) return null; // a kink: inside and outside mean little
    const m = v => Math.abs(v).toFixed(1), parts = [], advice = [];
    if (L.atTurnIn <= -1.5) { parts.push(tr("at turn-in you're {m} m tighter than {who}, who starts the turn from further out", { m: m(L.atTurnIn), who })); advice.push(tr("start the turn from the outside edge")); }
    else if (L.atTurnIn >= 1.5) parts.push(tr("at turn-in you're {m} m wider than {who}", { m: m(L.atTurnIn), who }));
    if (L.atApex >= 1.5) { parts.push(tr("at the apex you're {m} m wide of {who}'s line", { m: m(L.atApex), who })); advice.push(tr("get closer to the apex")); }
    else if (L.atApex <= -1.5) parts.push(tr("at the apex you're {m} m tighter than {who}", { m: m(L.atApex), who }));
    if (L.atExit <= -1.5) { parts.push(tr("on exit {who} runs {m} m wider than you", { m: m(L.atExit), who })); advice.push(tr("let the car run out to the edge on exit")); }
    else if (L.atExit >= 1.5) parts.push(tr("on exit you run {m} m wider than {who}", { m: m(L.atExit), who }));
    if (!parts.length) return null;
    return tip("line", "Track use: {parts}.{advice}", { parts: parts.join("; "),
      advice: advice.length ? " " + tr("Use more of the track: {list}.", { list: joinAnd(advice) }) : "" });
  }

  // A spin or crash: your speed under half the reference's at the same point. Every clean lap recorded so far (time
  // trials, daily races, other drivers' replays, an overshoot) stays above 60%; spins and crashes go to 0-36%.
  const SPIN_SPEED = 0.5, SPIN_FROM = 100; // share of the reference's speed; metres from the line
  const FASTER = 0.05; // s: a section this much quicker than the reference, or closer than this to it, gets no advice
  function result(corners, steerRatio, R, M, delta, who) {
    const lifts = extraLifts(corners, R, M, delta), spin = wheelspin(R, M);
    return { grid: { R, M, delta, spinM: spin.me, spinR: spin.ref, lockM: spin.lockM, lockR: spin.lockR }, lifts, corners: corners.map(({ apex, z0, z1, entry, exit, lost, incident, share, approachLost, cornerLost, ref_m, me_m }, i) => {
      me_m.wheelspin = spinTip(spin, R, M, z0, z1, apex, who);
      let t = tips(me_m, ref_m, lost, who, steerRatio);
      // lock-up says what "Brake release" would, from the wheels themselves: it takes its place
      const lock = lockTip(spin, R, M, z0, z1, apex, who);
      const quiet = x => x.kind !== "noSingle" && x.kind !== "close";
      if (lock) {
        const at = t.findIndex(x => x.kind === "brakeRelease");
        if (at >= 0) t[at] = lock; else t.splice(t.findIndex(x => x.kind === "brakingPoint") + 1, 0, lock);
        t = t.filter(quiet);
      }
      const line = lineUse(R, M, z0, z1, apex, ref_m), lt = lineTip(line, who);
      if (lt) t.push(lt);
      const mine = lifts.filter(z => z.corner === i);
      if (mine.some(z => z.kind === "brake")) t = t.filter(x => x.kind !== "refNoBrake"); // said more precisely below
      if (mine.length >= 3) t.push(liftsTip(mine, apex, who)); else mine.forEach(z => t.push(liftTip(z, apex, who)));
      // (where the time goes: the stretch's theme bar shows it, above the tips)
      if (t.length > 1) t = t.filter(quiet);
      // faster than the reference here (as shown, so a "−0.05 s" chip counts), or within 0.05 s of it: no advice; at
      // that level the charts show the differences
      const shown = Math.round(lost * 100); // hundredths, as the chip shows it
      if (shown <= -FASTER * 100) t = [tip("faster", "You're {s} s faster than {who} here.", { s: (-lost).toFixed(2), who })];
      else if (Math.abs(shown) < FASTER * 100) t = [tip("close", "Close to {who} here.", { who })];
      else if (i === 0 && R.v[0] - M.v[0] >= 5) {
        t.unshift(tip("start", "Start of the lap: you crossed the line at {me} km/h vs {ref} km/h, which cost about {s} s before the first braking point. That comes from your exit of the last corner on the lap before.",
          { me: r0(M.v[0]), ref: r0(R.v[0]), s: delta[ref_m.top].toFixed(2) }));
      }
      // a spin or crash: everything else in the corner follows from it, so no advice
      if (incident) t = [tip("incident", "You spin out or crash on this corner.")];
      return { n: i + 1, apex, from: z0, to: z1, entry, exit, lost, incident, share, approachLost, cornerLost, colour: colour(lost, share), me: me_m, ref: ref_m, tips: t.map(x => x.text), tipKinds: t.map(x => x.kind), tipSpans: t.map(x => x.span ?? null), lifts: mine, line };
    }) };
  }

  // Lifts and braking the reference doesn't do: anywhere outside the reference's own braking-to-full-throttle
  // part of each corner, you're on the brake, or below 90% throttle and 20 points under the reference, for 10 m
  // or more. Stretches that run straight into or out of that part are early braking or a late exit, which the
  // corner's own tips already cover. Only stretches costing 0.03 s or more are kept.
  // Wheelspin: the driven wheels turning clearly faster than the car is moving. Which wheels are driven is read from
  // each lap (under power the driven pair slips a little; the others roll at the car's speed), so it works for front,
  // rear and four-wheel drive. Some slip is normal, and the fastest laps use it, so it counts against the reference
  // at the same point: at least SPIN_SLIP % and SPIN_OVER points more than the reference's, on the throttle. Traction
  // control cutting in where the reference's doesn't counts too: it stops the spin by taking power away.
  const SPIN_SLIP = 10, SPIN_OVER = 5, SPIN_MIN = 10; // %, points, metres in a section for a tip
  function drivenAxle(L) {
    let f = 0, b = 0, n = 0;
    for (let k = 0; k < L.v.length; k++) {
      if (L.thr[k] > 80 && L.v[k] > 50 && Number.isFinite(L.slipF[k]) && Number.isFinite(L.slipR[k])) { f += L.slipF[k]; b += L.slipR[k]; n++; }
    }
    if (n < 50) return null;
    return f / n > b / n + 1 ? "front" : b / n > f / n + 1 ? "rear" : "all";
  }
  const slipOf = (L, axle, k) => (axle === "front" ? L.slipF[k] : axle === "rear" ? L.slipR[k] : axle ? Math.max(L.slipF[k], L.slipR[k]) : NaN);
  // runs of set metres, gaps of up to 5 m closed, runs under 5 m dropped
  function cleanRuns(flags) {
    const runs = [];
    for (let k = 0; k < flags.length; k++) {
      if (!flags[k]) continue;
      const last = runs[runs.length - 1];
      if (last && k - last[1] <= 5) last[1] = k + 1; else runs.push([k, k + 1]);
    }
    const kept = runs.filter(([a, b]) => b - a >= 5), out = new Uint8Array(flags.length);
    for (const [a, b] of kept) out.fill(1, a, b);
    return { runs: kept, flags: out };
  }
  function wheelspin(R, M) {
    const n = R.v.length, axleR = drivenAxle(R), axle = drivenAxle(M);
    const me = new Uint8Array(n), ref = new Uint8Array(n), why = new Uint8Array(n); // why: 1 slip, 2 traction control
    for (let k = 0; k < n; k++) {
      const sM = slipOf(M, axle, k), sR = slipOf(R, axleR, k), tM = M.tcs[k] > 0.5, tR = R.tcs[k] > 0.5;
      if (M.thr[k] >= 30 && M.v[k] > 30) {
        if (sM >= SPIN_SLIP && !(sR > sM - SPIN_OVER)) { me[k] = 1; why[k] = 1; } else if (tM && !tR) { me[k] = 1; why[k] = 2; }
      }
      if (R.thr[k] >= 30 && R.v[k] > 30 && (sR >= SPIN_SLIP || tR)) ref[k] = 1;
    }
    const m = cleanRuns(me);
    return { me: m.flags, runs: m.runs, ref: cleanRuns(ref).flags, why, axle, axleR, ...lockups(R, M) };
  }
  // Lock-up, the same under braking: a wheel pair turning clearly slower than the car. Hard braking in a straight line
  // slows the front wheels 13-19% for everyone (ABS stops a full lock), so it counts against the other lap at the same
  // point: at least LOCK_SLIP % slower and LOCK_OVER points more. It shows braking hard while turning in.
  const LOCK_SLIP = 10, LOCK_OVER = 5;
  const lockOf = (L, k) => Math.min(Number.isFinite(L.slipF[k]) ? L.slipF[k] : 0, L.slipR[k]);
  function lockups(R, M) {
    const n = R.v.length, me = new Uint8Array(n), ref = new Uint8Array(n);
    for (let k = 0; k < n; k++) {
      const lM = lockOf(M, k), lR = lockOf(R, k);
      if (M.brk[k] > 5 && M.v[k] > 30 && lM <= -LOCK_SLIP && lM <= lR - LOCK_OVER) me[k] = 1;
      if (R.brk[k] > 5 && R.v[k] > 30 && lR <= -LOCK_SLIP && lR <= lM - LOCK_OVER) ref[k] = 1;
    }
    const m = cleanRuns(me);
    return { lockM: m.flags, lockRuns: m.runs, lockR: cleanRuns(ref).flags };
  }
  function lockTip(spin, R, M, z0, z1, apex, who) {
    const runs = spin.lockRuns.map(([a, b]) => [Math.max(a, z0), Math.min(b, z1)]).filter(([a, b]) => b > a);
    if (runs.reduce((t, [a, b]) => t + b - a, 0) < SPIN_MIN) return null;
    let worst = runs[0][0];
    for (const [from, to] of runs) for (let k = from; k < to; k++) if (lockOf(M, k) < lockOf(M, worst)) worst = k;
    const wheels = !Number.isFinite(M.slipF[worst]) ? tr("wheels") : M.slipF[worst] <= M.slipR[worst] ? tr("front wheels") : tr("rear wheels");
    const turning = Math.abs((M.steer[worst] * 180) / Math.PI) >= 15; // false without steering in the recording
    const where = runs[0][0] < apex ? tr("on entry") : tr("after the apex");
    return tip("lock", "Lock-up {where}: your {wheels} lock more than {who}'s. More brake than the tyres can take{steering}: see the bold brake line.",
      { where, wheels, who, steering: turning ? " " + tr("with the steering") : "" });
  }
  // The tip for a section with SPIN_MIN metres or more of wheelspin: short, since the charts show it
  function spinTip(spin, R, M, z0, z1, apex, who) {
    const runs = spin.runs.map(([a, b]) => [Math.max(a, z0), Math.min(b, z1)]).filter(([a, b]) => b > a);
    const total = runs.reduce((t, [a, b]) => t + b - a, 0);
    if (total < SPIN_MIN) return null;
    const a = runs[0][0], where = a >= apex - 10 ? tr("on exit") : tr("before the apex");
    let bySlip = 0;
    for (const [from, to] of runs) for (let k = from; k < to; k++) if (spin.why[k] === 1) bySlip++;
    const why = tr("More throttle or steering than the tyres can take: see the bold throttle line.");
    if (bySlip >= total / 2) {
      const wheels = spin.axle === "front" ? tr("front wheels") : spin.axle === "rear" ? tr("rear wheels") : tr("wheels");
      return tip("wheelspin", "Wheelspin {where}: your {wheels} spin more than {who}'s. {why}", { where, wheels, who, why });
    }
    return tip("wheelspin", "Traction control {where}: yours cuts in, {who}'s doesn't. {why}", { where, who, why });
  }

  function extraLifts(corners, R, M, delta) {
    const n = R.v.length, busy = new Uint8Array(n);
    for (const c of corners) {
      // from the reference's first lift or braking after its top speed, to its full throttle after the apex
      const a = firstFrom(R.thr, c.ref_m.top, c.apex + 1, (t, k) => t < 50 || R.brk[k] > 5);
      if (a === null) continue;
      for (let k = a; k <= (c.ref_m.fullGas ?? c.z1) && k < n; k++) busy[k] = 1;
    }
    const nearBusy = (from, to) => { for (let k = Math.max(0, from); k < Math.min(n, to); k++) if (busy[k]) return true; return false; };
    const off = k => !busy[k] && R.brk[k] <= 5 && (M.brk[k] > 5 || (M.thr[k] < 90 && M.thr[k] < R.thr[k] - 20));
    const runs = [];
    for (let k = 0; k < n; k++) {
      if (!off(k)) continue;
      const last = runs[runs.length - 1];
      if (last && k - last[1] <= 5) last[1] = k + 1; else runs.push([k, k + 1]);
    }
    const out = [];
    for (const [a, b] of runs) {
      if (b - a < 10 || nearBusy(b, b + 10) || nearBusy(a - 10, a)) continue; // early braking or a late exit
      let back = b;
      while (back < n - 1 && back < b + 100 && (M.thr[back] < 95 || M.brk[back] > 5)) back++;
      const cost = delta[back] - delta[a];
      if (cost < 0.03) continue;
      let peakBrake = 0;
      for (let k = a; k < b; k++) peakBrake = Math.max(peakBrake, M.brk[k]);
      const thr = mean(M.thr.slice(a, b)), refThr = mean(R.thr.slice(a, b));
      const corner = Math.max(0, corners.findIndex(c => a >= c.z0 && a < c.z1));
      out.push({ from: a, to: b, length: b - a, cost, kind: peakBrake > 5 ? "brake" : "lift", peakBrake, thr, refThr, corner });
    }
    return out;
  }

  // Each section is a corner plus the straight after it (the first one also has the run from the start line):
  // when they're long, say which part the time went in.
  function liftsTip(zs, apex, who) {
    const braking = zs.filter(z => z.kind === "brake").length;
    const t = tip("lifts", "Lifts: {n} times in this section you come off the throttle{brake} where {who} doesn't, for {m} m in all (starting {where} the apex). Together that costs about {s} s. Stay flat out until the braking point.", {
      n: zs.length, brake: braking ? " " + tr("or brake") : "", who, m: zs.reduce((a, z) => a + z.length, 0),
      where: zs.map(z => metres(z.from, apex)).join(", "), s: zs.reduce((a, z) => a + z.cost, 0).toFixed(2) });
    t.span = [Math.min(...zs.map(z => z.from)), Math.max(...zs.map(z => z.to))];
    return t;
  }

  function liftTip(z, apex, who) {
    const where = z.from < apex - 300 ? tr("{m} m after the start line", { m: z.from })
      : z.from <= apex ? tr("{m} m before the apex", { m: apex - z.from }) : tr("{m} m after the apex", { m: z.from - apex });
    const v = { p: r0(z.peakBrake), m: z.length, where, who, ref: r0(z.refThr), me: r0(z.thr), s: z.cost.toFixed(2) };
    const t = z.kind === "brake"
      ? tip("extraBrake", "Extra braking: you brake (up to {p}%) for {m} m, starting {where}, where {who} doesn't brake and averages {ref}% throttle. That costs about {s} s.", v)
      : tip("extraLift", "Lift: you average {me}% throttle for {m} m, starting {where}, where {who} averages {ref}%. That costs about {s} s.", v);
    t.span = [z.from, z.to]; // its theme is the one its metres' time went to
    return t;
  }

  // --- drawing ---
  const SVGNS = "http://www.w3.org/2000/svg";
  function trackMap(result) {
    const { ref, corners } = result;
    const pts = s => { // reference point at distance s
      const x = interp(ref.s, ref.x, s), z = interp(ref.s, ref.z, s);
      return [x, z];
    };
    const minX = Math.min(...ref.x), maxX = Math.max(...ref.x), minZ = Math.min(...ref.z), maxZ = Math.max(...ref.z);
    const pad = 0.06 * Math.max(maxX - minX, maxZ - minZ);
    const sw = (maxX - minX + 2 * pad) / 110; // line width relative to map size
    // corner numbers sit just off the line, away from the map's centre
    const cx = minX + (maxX - minX) / 2, cz = minZ + (maxZ - minZ) / 2;
    const spots = corners.map(c => {
      const [x, z] = pts(c.apex), dx = x - cx, dz = z - cz, l = Math.hypot(dx, dz) || 1;
      return [x + (dx / l) * sw * 4.5, z + (dz / l) * sw * 4.5];
    });
    // map area: the track plus the numbers, so none are cut off at the edges
    const r = sw * 2.6, edge = sw * 1.5;
    const x0 = Math.min(minX - pad, ...spots.map(p => p[0] - r - edge)), x1 = Math.max(maxX + pad, ...spots.map(p => p[0] + r + edge));
    const z0 = Math.min(minZ - pad, ...spots.map(p => p[1] - r - edge)), z1 = Math.max(maxZ + pad, ...spots.map(p => p[1] + r + edge));
    const vb = [x0, z0, x1 - x0, z1 - z0];
    const path = (a, b) => {
      let d = "";
      for (let s = a; s <= b; s += 4) { const [x, z] = pts(s); d += (d ? "L" : "M") + x.toFixed(1) + "," + z.toFixed(1); }
      const [x, z] = pts(b); return d + "L" + x.toFixed(1) + "," + z.toFixed(1);
    };
    const zones = corners.map(c => `<g class="zone" data-n="${c.n}" tabindex="0" role="button" aria-label="${tr("Corner {n}, {lost}", { n: c.n, lost: fmtLost(c.lost) })}">
        <path d="${path(c.from, c.to)}" class="hit" style="stroke-width:${sw * 5}"/>
        <path d="${path(c.from, c.to)}" class="seg ${c.colour}" style="stroke-width:${sw * 1.6}"/></g>`).join("");
    const labels = corners.map((c, i) => {
      const [lx, lz] = spots[i];
      return `<g class="label" data-n="${c.n}"><circle cx="${lx.toFixed(1)}" cy="${lz.toFixed(1)}" r="${r}" class="${c.colour}"/>
        <text x="${lx.toFixed(1)}" y="${(lz + sw * 0.95).toFixed(1)}" style="font-size:${sw * 2.8}px">${c.n}</text></g>`;
    }).join("");
    // extra lifts and braking: a short dark band over the track
    const lifts = (result.lifts || []).map(z => `<path d="${path(z.from, z.to)}" class="lift" style="stroke-width:${sw * 0.9}"/>`).join("");
    const [sx, sz] = pts(0), [ax, az] = pts(12);
    const ang = Math.atan2(az - sz, ax - sx), nx = -Math.sin(ang), nz = Math.cos(ang);
    const start = `<line class="sf" x1="${sx + nx * sw * 3}" y1="${sz + nz * sw * 3}" x2="${sx - nx * sw * 3}" y2="${sz - nz * sw * 3}" style="stroke-width:${sw * 0.8}"/>`;
    const [bx, bz] = pts(70);
    const arrow = `<path class="arrow" d="M${-sw * 2},${-sw * 1.4}L${sw * 1.2},0L${-sw * 2},${sw * 1.4}" transform="translate(${bx.toFixed(1)},${bz.toFixed(1)}) rotate(${(Math.atan2(pts(74)[1] - bz, pts(74)[0] - bx) * 180 / Math.PI).toFixed(1)})"/>`;
    return `<svg class="trackmap" viewBox="${vb.map(v => v.toFixed(1)).join(" ")}" role="img" aria-label="${tr("Track map coloured by time lost")}">
      <path d="${path(0, result.length)}" class="base" style="stroke-width:${sw * 3}"/>${zones}${lifts}${start}${arrow}${labels}</svg>`;
  }

  const fmtLost = s => `${s > -0.005 ? "+" : "−"}${Math.abs(s).toFixed(2)} s`; // no "−0.00"
  const fmtShare = f => (f > -0.0005 ? tr("{p}% slower", { p: Math.abs(f * 100).toFixed(1) }) : tr("{p}% faster", { p: Math.abs(f * 100).toFixed(1) }));
  const metres = (k, apex) => (k === null ? "—" : k <= apex ? tr("{m} m before", { m: apex - k }) : tr("{m} m after", { m: k - apex }));
  const pct = v => `${Math.round(v)}%`;
  // Brake and throttle (you vs the reference) and the time gap building up, in metres from where the reference
  // starts braking (or lifting) for this corner.
  function pedalChart(result, c, who) {
    who = named(who);
    const { R, M, delta } = result.grid, n = R.v.length;
    const anchor = c.ref.brakeAt ?? c.apex;
    const anchorName = c.ref.brakeAt !== null ? tr("{who} brakes", { who }) : tr("apex");
    let x0 = Math.min(anchor - 100, (c.me.brakeAt ?? c.me.liftAt ?? anchor) - 30);
    let x1 = Math.max(c.ref.fullGas ?? c.to, c.me.fullGas ?? c.to) + 30;
    // include extra lifts, but never so far back that the corner itself drops out of the chart
    for (const z of c.lifts) { x0 = Math.min(x0, Math.max(z.from - 20, anchor - 300)); x1 = Math.max(x1, z.to + 20); }
    // and the section's wheelspin, to its end
    for (let k = c.from; k < c.to; k++) if (result.grid.spinM && result.grid.spinM[k]) x1 = Math.max(x1, k + 10);
    x0 = Math.max(0, x0); x1 = Math.min(n - 1, x1, x0 + 700);
    let braking = false;
    for (let k = x0; k <= x1 && !braking; k++) braking = R.brk[k] > 5 || M.brk[k] > 5;
    const W = 360, L = 30, Rt = 8, H1 = 62, gap = 18, H2 = 70, H3 = 54, top = 12;
    const kinds = braking ? [[tr("Brake %"), "brk", "brake"], [tr("Throttle %"), "thr", "throttle"]] : [[tr("Throttle %"), "thr", "throttle"]];
    // steering, below the pedals: degrees of steering wheel turn, clockwise (right) up; GT7 records right as negative.
    // Only for laps recorded with it (older recordings and the "A" data format don't have it).
    const deg = v => (-v * 180) / Math.PI;
    const has = arr => { for (let k = x0; k <= x1; k++) if (Number.isFinite(arr[k])) return true; return false; };
    const steerR = has(R.steer), steerM = has(M.steer), steering = steerR || steerM;
    const stTop = top + kinds.length * (H1 + gap);
    let dLo = 0, dHi = 0;
    for (let k = x0; k <= x1; k++) for (const v of [steerR ? R.steer[k] : NaN, steerM ? M.steer[k] : NaN]) {
      if (Number.isFinite(v)) { dLo = Math.min(dLo, deg(v)); dHi = Math.max(dHi, deg(v)); }
    }
    // round out to 30°, ignoring a small swing the other way (under 10°) so the scale stays on the corner's side
    dLo = dLo < -10 ? Math.floor(dLo / 30) * 30 : 0; dHi = dHi > 10 ? Math.ceil(dHi / 30) * 30 : 0;
    if (dHi - dLo < 60) { if (dHi > -dLo) dHi = dLo + 60; else dLo = dHi - 60; }
    const yD = v => stTop + H1 - ((deg(v) - dLo) / (dHi - dLo)) * H1, yDdeg = d => stTop + H1 - ((d - dLo) / (dHi - dLo)) * H1;
    const sTop = stTop + (steering ? H1 + gap : 0); // speed, below the steering
    const gTop = sTop + H2 + gap, axisY = gTop + H3 + 4, H = axisY + 34;
    const x = k => L + ((k - x0) / (x1 - x0)) * (W - L - Rt);
    const g = [];
    for (let k = x0; k <= x1; k++) g.push(delta[k] - delta[x0]);
    const gLo = Math.min(0, ...g), gHi = Math.max(0.05, ...g), gPad = 0.12 * (gHi - gLo);
    const yP = (t0, v) => t0 + H1 - (Math.max(0, Math.min(100, v)) / 100) * H1;
    const yG = v => gTop + H3 - ((v - gLo + gPad) / (gHi - gLo + 2 * gPad)) * H3;
    // speed: both laps on one scale, rounded out to 10 km/h
    let vLo = Infinity, vHi = -Infinity;
    for (let k = x0; k <= x1; k++) { vLo = Math.min(vLo, R.v[k], M.v[k]); vHi = Math.max(vHi, R.v[k], M.v[k]); }
    vLo = Math.floor(vLo / 10) * 10; vHi = Math.max(vLo + 20, Math.ceil(vHi / 10) * 10);
    const yS = v => sTop + H2 - ((v - vLo) / (vHi - vLo)) * H2;
    const line = (arr, y) => { let d = ""; for (let k = x0; k <= x1; k++) d += (d ? "L" : "M") + x(k).toFixed(1) + "," + y(arr[k]).toFixed(1); return d; };
    const secs = v => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)} s`;
    // bold stretches: where the wheels spin or traction control cuts in (yours against the reference's: see wheelspin)
    const { spinM, spinR } = result.grid;
    const bold = (arr, flags, y) => {
      let d = "", on = false;
      for (let k = x0; k <= x1; k++) {
        if (!flags || !flags[k] || arr[k] < 30) { on = false; continue; } // on the pedal only
        d += (on ? "L" : "M") + x(k).toFixed(1) + "," + y(arr[k]).toFixed(1);
        on = true;
      }
      return d;
    };
    let spinShown = false;
    const { lockM, lockR } = result.grid;
    const strips = kinds.map(([label, key, cls], i) => {
      const t0 = top + i * (H1 + gap);
      let spins = "";
      const [fR, fM] = key === "thr" ? [spinR, spinM] : [lockR, lockM];
      const dR = bold(R[key], fR, v => yP(t0, v)), dM = bold(M[key], fM, v => yP(t0, v));
      spins = (dR ? `<path class="pc-ref spin" d="${dR}"/>` : "") + (dM ? `<path class="pc-me ${cls} spin" d="${dM}"/>` : "");
      if (dR || dM) spinShown = true;
      return `<text class="pc-title" x="${L}" y="${t0 - 4}">${label}</text>
        <line class="pc-grid" x1="${L}" x2="${W - Rt}" y1="${yP(t0, 100)}" y2="${yP(t0, 100)}"/>
        <line class="pc-axis" x1="${L}" x2="${W - Rt}" y1="${yP(t0, 0)}" y2="${yP(t0, 0)}"/>
        <text class="pc-tick" x="${L - 4}" y="${yP(t0, 100) + 3}" text-anchor="end">100</text>
        <text class="pc-tick" x="${L - 4}" y="${yP(t0, 0) + 3}" text-anchor="end">0</text>
        <path class="pc-ref" d="${line(R[key], v => yP(t0, v))}"/>
        <path class="pc-me ${cls}" d="${line(M[key], v => yP(t0, v))}"/>${spins}`;
    }).join("");
    // a line with gaps where the recording has no value
    const gappy = (arr, y) => { let d = "", on = false; for (let k = x0; k <= x1; k++) { if (!Number.isFinite(arr[k])) { on = false; continue; } d += (on ? "L" : "M") + x(k).toFixed(1) + "," + y(arr[k]).toFixed(1); on = true; } return d; };
    const dTicks = [[dHi, `${dHi}°`], [dLo, `${dLo}°`.replace("-", "−")]];
    if (dHi > 0 && dLo < 0 && yDdeg(0) - yDdeg(dHi) > 10 && yDdeg(dLo) - yDdeg(0) > 10) dTicks.push([0, "0"]);
    const steer = !steering ? "" : `<text class="pc-title" x="${L}" y="${stTop - 4}">${tr("Steering °, clockwise up")}${steerR ? "" : " " + tr("({who}'s recording has none)", { who })}${steerM ? "" : " " + tr("(your recording has none)")}</text>
        <line class="pc-axis" x1="${L}" x2="${W - Rt}" y1="${yDdeg(0)}" y2="${yDdeg(0)}"/>
        ${dTicks.map(([v, t]) => `<text class="pc-tick" x="${L - 4}" y="${yDdeg(v) + 3}" text-anchor="end">${t}</text>`).join("")}
        ${steerR ? `<path class="pc-ref" d="${gappy(R.steer, yD)}"/>` : ""}
        ${steerM ? `<path class="pc-me steer" d="${gappy(M.steer, yD)}"/>` : ""}`;
    const speed = `<text class="pc-title" x="${L}" y="${sTop - 4}">${tr("Speed km/h")}</text>
        <line class="pc-grid" x1="${L}" x2="${W - Rt}" y1="${yS(vHi)}" y2="${yS(vHi)}"/>
        <line class="pc-axis" x1="${L}" x2="${W - Rt}" y1="${yS(vLo)}" y2="${yS(vLo)}"/>
        <text class="pc-tick" x="${L - 4}" y="${yS(vHi) + 3}" text-anchor="end">${vHi}</text>
        <text class="pc-tick" x="${L - 4}" y="${yS(vLo) + 3}" text-anchor="end">${vLo}</text>
        <path class="pc-ref" d="${line(R.v, yS)}"/>
        <path class="pc-me speed" d="${line(M.v, yS)}"/>`;
    let gd = "";
    g.forEach((v, i) => (gd += (i ? "L" : "M") + x(x0 + i).toFixed(1) + "," + yG(v).toFixed(1)));
    const ticks = [];
    for (let m = Math.ceil((x0 - anchor) / 50) * 50; m <= x1 - anchor; m += 50) {
      ticks.push(`<line class="pc-tickline" x1="${x(anchor + m)}" x2="${x(anchor + m)}" y1="${axisY}" y2="${axisY + 3}"/>
        <text class="pc-tick" x="${x(anchor + m)}" y="${axisY + 12}" text-anchor="middle">${m > 0 ? "+" + m : m}</text>`);
    }
    // vertical markers, named under the distance labels so they never sit on a line
    const marks = [[anchor, anchorName]];
    if (anchor !== c.apex) marks.push([c.apex, tr("apex")]);
    const markers = marks.filter(([k]) => k >= x0 && k <= x1).map(([k, label], i, all) => {
      const close = i > 0 && Math.abs(x(k) - x(all[i - 1][0])) < 40; // keep two close labels apart
      return `<line class="pc-mark" x1="${x(k)}" x2="${x(k)}" y1="${top - 2}" y2="${axisY}"/>
        <text class="pc-marktext" x="${x(k)}" y="${axisY + 24}" text-anchor="${close ? "start" : "middle"}">${close ? "  " : ""}${label}</text>`;
    }).join("");
    const bands = c.lifts.map(z => `<rect class="pc-lift" x="${x(z.from)}" y="${top - 2}" width="${Math.max(1, x(z.to) - x(z.from))}" height="${axisY - top + 2}"/>`).join("");
    const gTicks = [[0, "0"], [gHi, gHi.toFixed(2)]];
    if (yG(gLo) - yG(0) > 10) gTicks.push([gLo, gLo.toFixed(2).replace("-", "−")]); // only when clear of the 0
    return `<figure class="pedal-chart">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${tr("Pedals, speed and time gap through corner {n}, you against {who}", { n: c.n, who })}">
        ${bands}${strips}${steer}${speed}
        <text class="pc-title" x="${L}" y="${gTop - 4}">${tr('Time gap: <tspan class="pc-gapval">{gap}</tspan> over this stretch', { gap: secs(g[g.length - 1]) })}</text>
        <line class="pc-axis" x1="${L}" x2="${W - Rt}" y1="${yG(0)}" y2="${yG(0)}"/>
        ${gTicks.map(([v, t]) => `<text class="pc-tick" x="${L - 4}" y="${yG(v) + 3}" text-anchor="end">${t}</text>`).join("")}
        <path class="pc-me gap" d="${gd}"/>
        ${markers}${ticks.join("")}
      </svg>
      <figcaption class="pc-legend"><span><i class="k-me"></i>${tr("You")}</span><span><i class="k-ref"></i>${who}</span>
        <span>${c.ref.brakeAt === null ? tr("metres from the apex (no braking here)") : tr("metres from where {who} starts braking", { who })}</span>
        ${c.lifts.length ? `<span><i class="k-lift"></i>${tr("extra lift or braking")}</span>` : ""}
        ${spinShown ? `<span><i class="k-spin"></i>${tr("bold: wheel lock or spin")}</span>` : ""}
        ${steering && result.otherCar ? `<span>${tr("Steering: another car than {who}'s, and cars have different steering lock", { who })}</span>` : ""}</figcaption>
    </figure>`;
  }

  // Close-up 1: the corner drawn to scale with both racing lines, the same way round as the lap map. Line thickness shows
  // the pedals: brake pressure from the braking point until the throttle is pressed again, throttle everywhere else
  // (thin = none, full thickness = 100%).
  // Across a recording's clean laps (3 or more): where the time goes on average, where it varies most from lap to
  // lap, and the "ideal lap" from each section's best time. Sections are the reference's, so they line up.
  function acrossLaps(refLap, laps, who) {
    const runs = laps.filter(l => !l.cut && !l.incident?.length).map(l => analyse(refLap, l.lap, who)).filter(r => !r.error);
    if (runs.length < 3 || runs.some(r => r.corners.length !== runs[0].corners.length)) return null;
    const sections = runs[0].corners.map((c, i) => {
      const lost = runs.map(r => r.corners[i].lost), avg = mean(lost);
      const sd = Math.sqrt(mean(lost.map(v => (v - avg) ** 2)));
      return { n: c.n, avg, sd, best: Math.min(...lost) };
    });
    const top = (key, min) => sections.filter(x => x[key] >= min).sort((a, b) => b[key] - a[key]).slice(0, 3);
    const refMs = runs[0].refMs;
    return {
      laps: runs.length,
      gain: top("avg", 0.05),
      varies: top("sd", 0.05),
      idealMs: Math.round(refMs + 1000 * sections.reduce((a, x) => a + x.best, 0)),
      bestMs: Math.min(...runs.map(r => r.lapMs)),
    };
  }

  // Where the time goes across a recording's clean laps (no cut corner, spin or crash), averaged per lap: null with
  // fewer than 2
  function themesAcross(refLap, laps) {
    const runs = laps.filter(l => !l.cut && !l.incident?.length).map(l => analyse(refLap, l.lap)).filter(r => !r.error && r.themes);
    if (runs.length < 2) return null;
    return { laps: runs.length, parts: Object.fromEntries(THEMES.map(k => [k, mean(runs.map(r => r.themes[k]))])) };
  }

  // Audio cues (the app): where the reference starts braking (dabs too), lifts without braking, and gets back on the
  // throttle after braking, plus its line every 2 m so the app can tell where the car is. Distances are along the
  // reference line; t is the reference's time there, which the app uses to keep cues from piling up in chicanes.
  function cuePoints(refLap) {
    const ref = { ...refLap, s: [0] };
    for (let i = 1; i < ref.x.length; i++) ref.s.push(ref.s[i - 1] + Math.hypot(ref.x[i] - ref.x[i - 1], ref.z[i] - ref.z[i - 1]));
    const n = Math.floor(ref.s[ref.s.length - 1]), R = resample(ref, ref.s, n);
    const cues = [], add = (k, kind) => cues.push({ s: k, t: +R.t[k].toFixed(3), kind });
    let releasedAt = -Infinity; // when the reference last came off the brake
    for (let k = 1; k < n; k++) {
      if (R.brk[k] > 5 && R.brk[k - 1] <= 5) {
        if (R.t[k] - releasedAt >= 0.1) {
          add(k, "brake");
          // back on the gas: throttle at 20%+ that stays on (0.3 s, or until full), not a blip on a downshift
          const gas = firstFrom(R.thr, k, n, (t, j) => {
            if (t < 20 || R.brk[j] > 5) return false;
            for (let m = j; m < n && R.t[m] - R.t[j] < 0.3; m++) { if (R.thr[m] >= 90) return true; if (R.thr[m] < 20) return false; }
            return true;
          });
          if (gas !== null) add(gas, "gas");
        }
      }
      if (R.brk[k] <= 5 && R.brk[k - 1] > 5) releasedAt = R.t[k];
      // a lift: from full throttle to below 50% for at least 0.1 s, with no brake while it's down
      if (R.thr[k] < 50 && R.thr[k - 1] >= 50 && R.brk[k] <= 5) {
        let b = k, braked = false;
        while (b < n && R.thr[b] < 50) { if (R.brk[b] > 5) braked = true; b++; }
        // coming from steady full throttle (90%+ for at least 0.3 s), not a blip on a downshift or an exit
        let before = k - 1;
        while (before > 0 && R.t[k] - R.t[before] < 0.3 && R.thr[before] < 90) before--;
        let full = before;
        while (full > 0 && R.thr[full - 1] >= 90) full--;
        const steady = R.thr[before] >= 90 && R.t[before] - R.t[full] >= 0.3;
        // a lift with braking straight after (within 0.5 s) is part of the braking: that gets the brake cue only
        const brakeAfter = firstFrom(R.brk, k, n, v => v > 5);
        const soonBraked = brakeAfter !== null && R.t[brakeAfter] - R.t[k] < 0.5;
        // a gear change, not a lift: drivers who shift by hand come off the throttle for a moment on each upshift.
        // Short (back on within 0.65 s), and the gear goes up during it, or (references recorded before the gear was
        // kept) hardly any speed is lost. A real lift can end with an upshift too, but lasts longer.
        const end = Math.min(b + 10, n - 1);
        const short = R.t[Math.min(b, n - 1)] - R.t[k] < 0.65;
        const shift = short && (R.gear ? R.gear[end] > R.gear[Math.max(0, k - 10)] + 0.5
          : R.v[k] - Math.min(...R.v.slice(k, end + 1)) < 2);
        if (!braked && !soonBraked && !shift && steady && R.t[Math.min(b, n - 1)] - R.t[k] >= 0.1) add(k, "lift");
      }
    }
    cues.sort((a, b) => a.s - b.s);
    const unique = cues.filter((c, i) => !cues.slice(0, i).some(o => o.kind === c.kind && o.s === c.s)); // two brakes, one gas
    const x = [], z = [];
    for (let k = 0; k < n; k += 2) { x.push(+R.x[k].toFixed(1)); z.push(+R.z[k].toFixed(1)); }
    const loop = Math.hypot(R.x[0] - R.x[n - 1], R.z[0] - R.z[n - 1]) < 30;
    return { length: n, step: 2, loop, x, z, cues: unique };
  }

  function cornerWidths(result, c, who) {
    who = named(who);
    const { R, M } = result.grid, n = R.x.length;
    const starts = [c.ref.brakeAt, c.me.brakeAt, c.ref.liftAt, c.me.liftAt, c.line.turnIn, c.me.turnIn].filter(k => k !== null);
    let a = Math.max(0, Math.min(...starts) - 15), b = Math.min(n - 1, c.line.exit + 25);
    if (b - a > 450) a = Math.max(0, b - 450);
    const xs = [], zs = [];
    for (let k = a; k <= b; k++) xs.push(R.x[k], M.x[k]), zs.push(R.z[k], M.z[k]);
    const pad = 8, minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad, minZ = Math.min(...zs) - pad, maxZ = Math.max(...zs) + pad;
    const W = 360, scale = Math.min(W / (maxX - minX), 340 / (maxZ - minZ));
    const w = Math.round((maxX - minX) * scale), H = Math.round((maxZ - minZ) * scale) + 22;
    const X = x => ((x - minX) * scale).toFixed(1), Y = z => ((z - minZ) * scale).toFixed(1);
    const THIN = 1, FULL = 5.5;
    // the brake from the braking point until the throttle is first pressed again (20%), the throttle before and after:
    // one switch each way, so a brake-and-throttle overlap doesn't flicker between the two
    const backOn = m => (m.brakeAt === null ? null : firstFrom(m === c.me ? M.thr : R.thr, m.brakeAt, n, t => t >= 20) ?? n);
    const onR = backOn(c.ref), onM = backOn(c.me);
    const pedal = (L, m, k) => {
      const on = m === c.me ? onM : onR;
      return m.brakeAt !== null && k >= m.brakeAt && k < on ? L.brk[k] : L.thr[k];
    };
    // hatched where your wheels lock or spin, or traction control cuts in (see wheelspin and lockups)
    const { spinM, lockM } = result.grid;
    let hatched = false;
    const line = (L, m, cls) => {
      let out = "";
      for (let k = a; k < b; k += 2) {
        const e = Math.min(b, k + 2), width = THIN + ((FULL - THIN) * Math.max(0, Math.min(100, pedal(L, m, k)))) / 100;
        const seg = `d="M${X(L.x[k])},${Y(L.z[k])}L${X(L.x[e])},${Y(L.z[e])}" style="stroke-width:${width.toFixed(2)}"`;
        out += `<path class="${cls}" ${seg}/>`;
        if (cls === "cw-me" && ((spinM && spinM[k]) || (lockM && lockM[k]))) { out += `<path class="cw-spin" stroke="url(#cw-hatch)" ${seg}/>`; hatched = true; }
      }
      return out;
    };
    const meLine = line(M, c.me, "cw-me");
    const dot = (L, k, cls, r = 4) => (k === null || k < a || k > b ? "" :
      `<circle class="cw-dot ${cls}" cx="${X(L.x[k])}" cy="${Y(L.z[k])}" r="${r}"/>`);
    // the slowest-point ring goes last and a little larger, so it still shows round a dot at the same spot
    const dots = (L, m, who2) => dot(L, m.brakeAt, `brake ${who2}`) + dot(L, m.fullGas, `gas ${who2}`) + dot(L, m.minAt, `slow ${who2}`, 5);
    const shows = key => [c.ref[key], c.me[key]].some(k => k !== null && k >= a && k <= b);
    // direction arrow at the start, scale bar in the bottom corner
    const k2 = Math.min(b, a + 8), ang = (Math.atan2(R.z[k2] - R.z[a], R.x[k2] - R.x[a]) * 180) / Math.PI;
    const ten = 10 * scale, sy = H - 8;
    return `<figure class="corner-widths">
      <button type="button" class="cw-toggle" aria-pressed="true">${tr("Hide your line")}</button>
      <svg viewBox="0 0 ${Math.max(w, 80)} ${H}" role="img" aria-label="${tr("Corner {n} drawn to scale with your line and {who}'s line", { n: c.n, who })}">
        <defs><pattern id="cw-hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect class="cw-hatch-bg" width="4" height="4"/><rect class="cw-hatch-fg" width="2" height="4"/></pattern></defs>
        <g>${line(R, c.ref, "cw-ref")}</g><g class="cw-me-line">${meLine}</g>
        ${dots(R, c.ref, "ref")}${dots(M, c.me, "me")}
        <path class="cw-arrow" d="M-7,-5L5,0L-7,5Z" transform="translate(${X(R.x[a])},${Y(R.z[a])}) rotate(${ang.toFixed(1)})"/>
        <line class="cw-scale" x1="4" x2="${(4 + ten).toFixed(1)}" y1="${sy}" y2="${sy}"/>
        <text class="cw-scaletext" x="${(8 + ten).toFixed(1)}" y="${sy + 3}">10 m</text>
      </svg>
      <table class="cw-legend">
        <thead><tr><th></th>${shows("brakeAt") ? `<th>${tr("braking starts")}</th>` : ""}${shows("minAt") ? `<th>${tr("slowest point")}</th>` : ""}
          ${shows("fullGas") ? `<th>${tr("full throttle")}</th>` : ""}</tr></thead>
        <tbody>${[["me", tr("You")], ["ref", who]].map(([k, name]) => `<tr><th><i class="k-line ${k}"></i>${name}</th>
          ${shows("brakeAt") ? `<td><i class="k-dot brake ${k}"></i></td>` : ""}${shows("minAt") ? `<td><i class="k-dot slow ${k}"></i></td>` : ""}
          ${shows("fullGas") ? `<td><i class="k-dot gas ${k}"></i></td>` : ""}</tr>`).join("")}</tbody>
      </table>
      <p class="hint">${tr(`Drawn to scale, the same way round as the lap map. Line thickness: the brake from the braking point
        until the throttle is pressed again, the throttle everywhere else (thin = none, full = 100%).`)}${hatched
          ? " " + tr("Hatched: your wheels lock or spin, or traction control cuts in, more than the reference's.") : ""}</p>
    </figure>`;
  }

  // Close-up 2: the corner drawn to scale, the same way round as the lap map. The reference's line is thin and plain; yours is a
  // dot every 3 m or more (so they don't overlap on long corners) showing how your pedals differ from the reference's at that point: the brake wherever either of you
  // is braking, the throttle everywhere else. Filled = more than the reference, ring = less, size = how much.
  // Letter badges mark the first brake (B), back on the gas (G) and full throttle (F) on both lines.
  const DOT_STEP = 3, SAME = 10; // points of pedal travel that count as the same
  const dotSize = d => (d < 30 ? 2.2 : d < 60 ? 3.3 : 4.6);
  function pedalDiff(R, M, k) {
    const braking = R.brk[k] > 5 || M.brk[k] > 5;
    return { pedal: braking ? "brk" : "gas", d: braking ? M.brk[k] - R.brk[k] : M.thr[k] - R.thr[k] };
  }
  // Where a lap changes gear (down, or up: some drivers shift up mid-corner for stability) between metres a and b:
  // [{ k, gear }], the new gear. The gear is resampled every metre with interpolation, so it's rounded; 0 (reverse or
  // no gear) is ignored.
  function gearShifts(L, a, b) {
    const out = [];
    if (!L.gear) return out;
    for (let k = Math.max(1, a); k <= b; k++) {
      const g0 = Math.round(L.gear[k - 1]), g1 = Math.round(L.gear[k]);
      if (g0 >= 1 && g1 >= 1 && g0 !== g1) out.push({ k, gear: g1 });
    }
    return out;
  }

  function cornerLines(result, c, label) {
    const plain = label === "Reference", who = plain ? tr("the reference") : named(label); // a license test's gold run reads as a name otherwise
    // the badges' letters: first brake, back on the gas, full throttle
    const B = tr("B"), G = tr("G"), F = tr("F");
    const { R, M } = result.grid, n = R.x.length;
    const starts = [c.ref.brakeAt, c.me.brakeAt, c.ref.liftAt, c.me.liftAt, c.line.turnIn, c.me.turnIn].filter(k => k !== null);
    let a = Math.max(0, Math.min(...starts) - 15), b = Math.min(n - 1, c.line.exit + 25);
    if (b - a > 450) a = Math.max(0, b - 450);
    const xs = [], zs = [];
    for (let k = a; k <= b; k++) xs.push(R.x[k], M.x[k]), zs.push(R.z[k], M.z[k]);
    const pad = 12, minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad, minZ = Math.min(...zs) - pad, maxZ = Math.max(...zs) + pad;
    const W = 360, scale = Math.min(W / (maxX - minX), 340 / (maxZ - minZ));
    const w = Math.round((maxX - minX) * scale), H = Math.round((maxZ - minZ) * scale) + 22;
    const sx = x => (x - minX) * scale, sz = z => (z - minZ) * scale;
    const X = x => sx(x).toFixed(1), Y = z => sz(z).toFixed(1);
    let ref = "";
    for (let k = a; k <= b; k += 2) ref += (ref ? "L" : "M") + X(R.x[k]) + "," + Y(R.z[k]);
    const step = Math.max(DOT_STEP, Math.ceil(9 / scale)); // at least 9 px apart
    let dots = "";
    for (let k = a; k <= b; k += step) {
      const { pedal, d } = pedalDiff(R, M, k), m = Math.abs(d);
      dots += m < SAME ? `<circle class="cl-same" cx="${X(M.x[k])}" cy="${Y(M.z[k])}" r="1.2"/>`
        : `<circle class="cl-diff ${pedal} ${d > 0 ? "more" : "less"}" cx="${X(M.x[k])}" cy="${Y(M.z[k])}" r="${dotSize(m)}"/>`;
    }
    // letter badges, set off to either side of the line (you on one side, the reference on the other) so they don't
    // cover each other or the dots
    const badge = (L, k, letter, who2, side) => {
      if (k === null || k < a || k > b) return "";
      const [dx, dz] = direction(R, k), px = sx(L.x[k]), py = sz(L.z[k]);
      const bx = px - dz * side * 11, by = py + dx * side * 11;
      return `<g class="cl-badge ${who2}"><line x1="${px.toFixed(1)}" y1="${py.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}"/>
        <circle cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="6"/><text x="${bx.toFixed(1)}" y="${(by + 3).toFixed(1)}">${letter}</text></g>`;
    };
    const badges = (L, m, who2, side) => badge(L, m.brakeAt, B, who2, side) + badge(L, m.onGas, G, who2, side) + badge(L, m.fullGas, F, who2, side);
    // gear shifts: a square with the new gear, further out than the letters. Shifts closer than 12 px on the drawing
    // share one square (at the first, showing the last gear) so the numbers stay readable.
    const shifts = (L, who2, side) => {
      let out = "", last = null;
      const draw = sh => {
        const [dx, dz] = direction(R, sh.k), px = sx(L.x[sh.k]), py = sz(L.z[sh.k]);
        const bx = px - dz * side * 24, by = py + dx * side * 24;
        out += `<g class="cl-shift ${who2}"><line x1="${px.toFixed(1)}" y1="${py.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}"/>
        <rect x="${(bx - 5.5).toFixed(1)}" y="${(by - 5.5).toFixed(1)}" width="11" height="11" rx="2"/><text x="${bx.toFixed(1)}" y="${(by + 3).toFixed(1)}">${sh.gear}</text></g>`;
      };
      for (const sh of gearShifts(L, a, b)) {
        if (last && Math.hypot(sx(L.x[sh.k]) - sx(L.x[last.k]), sz(L.z[sh.k]) - sz(L.z[last.k])) < 12) last.gear = sh.gear;
        else { if (last) draw(last); last = { ...sh }; }
      }
      if (last) draw(last);
      return out;
    };
    // direction arrow at the start, scale bar in the bottom corner
    const k2 = Math.min(b, a + 8), ang = (Math.atan2(R.z[k2] - R.z[a], R.x[k2] - R.x[a]) * 180) / Math.PI;
    const ten = 10 * scale, sy = H - 8;
    const key = (cls, r) => `<svg class="k-dot" viewBox="-6 -6 12 12" aria-hidden="true"><circle class="${cls}" r="${r}"/></svg>`;
    return `<figure class="corner-lines">
      <button type="button" class="cl-toggle" aria-pressed="true">${plain ? tr("Hide the reference line") : tr("Hide {who}'s line", { who })}</button>
      <svg viewBox="0 0 ${Math.max(w, 80)} ${H}" role="img" aria-label="${tr("Corner {n} drawn to scale: your line coloured by how your pedals differ from {who}'s", { n: c.n, who })}">
        <g class="cl-ref-line"><path class="cl-ref" d="${ref}"/>${shifts(R, "ref", -1)}${badges(R, c.ref, "ref", -1)}</g>
        ${dots}${shifts(M, "me", 1)}${badges(M, c.me, "me", 1)}
        <path class="cl-arrow" d="M-7,-5L5,0L-7,5Z" transform="translate(${X(R.x[a])},${Y(R.z[a])}) rotate(${ang.toFixed(1)})"/>
        <line class="cl-scale" x1="4" x2="${(4 + ten).toFixed(1)}" y1="${sy}" y2="${sy}"/>
        <text class="cl-scaletext" x="${(8 + ten).toFixed(1)}" y="${sy + 3}">10 m</text>
      </svg>
      <div class="cl-legend">
        <span>${key("cl-diff brk more", 4)}${tr("more brake than {who}", { who })}</span><span>${key("cl-diff brk less", 4)}${tr("less brake")}</span>
        <span>${key("cl-diff gas more", 4)}${tr("more throttle")}</span><span>${key("cl-diff gas less", 4)}${tr("less throttle")}</span>
        <span>${key("cl-same", 1.6)}${tr("about the same")}</span>
      </div>
      <div class="cl-legend">
        <span><b class="cl-key-badge me">${B}</b><b class="cl-key-badge ref">${B}</b>${tr("first brake")}</span>
        <span><b class="cl-key-badge me">${G}</b><b class="cl-key-badge ref">${G}</b>${tr("back on the gas")}</span>
        <span><b class="cl-key-badge me">${F}</b><b class="cl-key-badge ref">${F}</b>${tr("full throttle")}</span>
        ${R.gear || M.gear ? `<span><b class="cl-key-shift me">3</b><b class="cl-key-shift ref">3</b>${tr("gear shift to that gear")}</span>` : ""}
        <span>${tr('<b class="cl-key-badge me"></b>you, <b class="cl-key-badge ref"></b>{who}', { who })}</span>
      </div>
      <p class="hint">${tr(`Drawn to scale, the same way round as the lap map. Your line is a dot every {step} m comparing your pedals
        with {who}'s at the same point: the brake wherever either of you is braking, the throttle everywhere else. Bigger
        dots = bigger difference ({same}–30, 30–60, 60+ points of pedal travel).`, { step, who, same: SAME })}</p>
    </figure>`;
  }

  // The themes as a bar (widths by size) with their times: for the lap, and for a corner's section in its panel
  function themeBar(parts) {
    const names = { braking: tr("Braking"), exit: tr("Exit"), straight: tr("Straight"), line: tr("Line") };
    const size = THEMES.reduce((t, k) => t + Math.abs(parts[k]), 0) || 1;
    return `<div class="th-bar" aria-hidden="true">${THEMES.map(k => `<i class="th-${k}" style="width:${(100 * Math.abs(parts[k]) / size).toFixed(1)}%"></i>`).join("")}</div>
      <div class="th-legend">${THEMES.map(k => `<span><i class="th-key th-${k}"></i>${names[k]} <b>${fmtLost(parts[k])}</b></span>`).join("")}</div>`;
  }
  function cornerThemes(c, who) {
    if (!c.themes) return "";
    const t = c.themes;
    return `<div class="th-corner">${t.close ? `<p class="hint">${tr("Within 0.5% of {who}'s time in this section, so it isn't split into themes.", { who })}</p>`
      : themeBar(t.parts)}</div>`;
  }

  function cornerDetail(c, who, result) {
    const label = named(who);
    const row = (name, f) => `<tr><th>${name}</th><td class="num">${f(c.me)}</td><td class="num">${f(c.ref)}</td></tr>`;
    return `<div class="corner-head"><b>${tr("Corner {n}", { n: c.n })}</b> <span class="pill ${c.colour}">${fmtLost(c.lost)}</span>
      <span class="muted">${tr("{share} in this section", { share: fmtShare(c.share) })}</span></div>
      ${c.incident ? "" : cornerThemes(c, who === "Reference" ? tr("the reference") : label)}
      <ul class="tips">${c.tips.map(t => `<li>${t}</li>`).join("")}</ul>
      ${result ? cornerWidths(result, c, who) + cornerLines(result, c, who) + pedalChart(result, c, who) : ""}
      <table class="corner-table"><thead><tr><th>${tr("Distances from the apex")}</th><th class="num">${tr("You")}</th><th class="num">${label}</th></tr></thead><tbody>
        ${row(tr("Braking point"), m => (m.brakeAt === null ? (m.liftAt === null ? tr("no braking") : tr("lift only")) : metres(m.brakeAt, c.apex)))}
        ${row(tr("Peak brake"), m => (m.brakeAt === null ? "—" : pct(m.peakBrake)))}
        ${row(tr("Brake when turning in"), m => pct(m.brakeAtTurnIn))}
        ${row(tr("Slowest speed"), m => `${Math.round(m.minSpeed)} km/h`)}
        ${row(tr("Back on throttle"), m => metres(m.onGas, c.apex))}
        ${row(tr("Full throttle"), m => metres(m.fullGas, c.apex))}
        ${row(tr("Steering lock"), m => `${Math.round(m.maxSteerDeg)}°`)}
        ${row(tr("Exit speed"), m => `${Math.round(m.exitSpeed)} km/h`)}
      </tbody></table>`;
  }

  // The corner whose section of track is nearest to a point on the map (map units), or null if
  // the point is further than maxDist from the track. Lets a tap anywhere near the line select it.
  function cornerAt(result, x, z, maxDist) {
    const { ref, corners } = result;
    let best = Infinity, bi = 0;
    for (let i = 0; i < ref.x.length; i++) {
      const d = (ref.x[i] - x) ** 2 + (ref.z[i] - z) ** 2;
      if (d < best) { best = d; bi = i; }
    }
    if (Math.sqrt(best) > maxDist) return null;
    const s = ref.s[bi];
    return corners.find(c => s >= c.from && s < c.to) || corners[corners.length - 1];
  }

  // Does this text start like a telemetry.py recording? (The column headings it always writes.)
  const NEEDED = ["packet_id", "lap", "last_lap_ms", "x", "z", "speed_kmh", "throttle_pct", "brake_pct"];
  function isRecording(text) {
    const head = text.slice(0, 2000).split(/\r?\n/)[0].split(",").map(h => h.trim());
    return NEEDED.every(h => head.includes(h));
  }

  return { parseCsv, fastestLap, lapChoices, analyse, acrossLaps, cuePoints, trackMap, cornerDetail, cornerAt, isRecording, fmtLost, useLanguage, themeBar, themesAcross };
})();

if (typeof module !== "undefined") module.exports = Coach;
