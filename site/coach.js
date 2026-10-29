// Lap comparison against a reference (world record) lap, from telemetry.py recordings.
// Runs in the browser; nothing is uploaded. Deterministic rules, no AI.
//
// 1. Take the fastest complete lap in the CSV (the game's lap counter going up twice).
// 2. Measure both laps by distance along the reference lap's line, every metre.
// 3. Split the track into corners at the reference's slowest points (apexes).
// 4. For each corner compare braking, trail braking, minimum speed, throttle and steering.

const Coach = (() => {
  const LAP_FIELDS = ["x", "z", "speed_kmh", "throttle_pct", "brake_pct", "steering_rad", "wheel_rl_kmh", "wheel_rr_kmh"];
  const COLOURS = [[0.2, "good"], [0.4, "warn"], [Infinity, "bad"]]; // time lost (s) -> colour class

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
    LAP_FIELDS.forEach(k => (out[k] = lap.map(r => (Number.isNaN(r[k]) ? 0 : r[k]))));
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
  function lapChoices(rows, ref) {
    const refLength = pathLength(ref);
    const laps = completeLaps(rows).map(l => {
      const lap = extractLap(rows, l.a, l.b), short = refLength - pathLength(lap);
      return { number: l.number, lap_ms: l.lap_ms, lap, short: Math.round(short),
        cut: short > Math.max(CUT_MIN_M, CUT_SHARE * refLength) };
    });
    const by = list => list.reduce((x, y) => (y.lap_ms < x.lap_ms ? y : x), list[0]);
    const clean = laps.filter(l => !l.cut);
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

  // Every metre: time, speed, throttle (ignoring downshift blips while braking), brake, steering, rear wheelspin.
  function resample(lap, s, n) {
    const keep = [0];
    for (let i = 1; i < s.length; i++) if (s[i] > s[keep[keep.length - 1]]) keep.push(i);
    const xs = keep.map(i => s[i]), col = k => keep.map(i => lap[k][i]);
    const cols = { t: col("t"), v: col("speed_kmh"), thr: col("throttle_pct"), brk: col("brake_pct"),
      steer: col("steering_rad"), spin: keep.map(i => (lap.wheel_rl_kmh[i] + lap.wheel_rr_kmh[i]) / 2 - lap.speed_kmh[i]),
      x: col("x"), z: col("z") };
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
    let maxSteer = 0, spin = 0;
    for (let k = turnIn ?? top; k < z1; k++) maxSteer = Math.max(maxSteer, Math.abs(L.steer[k]));
    for (let k = apex; k < z1; k++) if (L.thr[k] > 50) spin = Math.max(spin, L.spin[k]);
    return { top, topSpeed: L.v[top], brakeAt, liftAt, peakBrake, fullBrake, release, turnIn,
      // averaged over the first 15 m of turning: the brake is often being released fast at this point
      brakeAtTurnIn: turnIn === null ? 0 : mean(L.brk.slice(turnIn, Math.min(z1, turnIn + 15))), minAt, minSpeed: L.v[minAt], onGas, fullGas, saw,
      maxSteerDeg: maxSteer * 180 / Math.PI, spin, exitSpeed: L.v[z1 - 1], minThrottle: Math.min(...L.thr.slice(top, apex + 1)) };
  }

  const r0 = v => Math.round(v);
  function tips(me, ref, lost, who, steerRatio) {
    const out = [];
    const d = (a, b) => (a === null || b === null ? null : a - b);
    if (ref.brakeAt !== null && me.brakeAt !== null) {
      const db = d(me.brakeAt, ref.brakeAt);
      if (db <= -5) out.push(`Braking point: you brake ${-db} m earlier than ${who}.`);
      else if (db >= 5) out.push(`Braking point: you brake ${db} m later than ${who}` +
        (me.minSpeed < ref.minSpeed - 3 ? `, then have to slow down more: you may be overshooting the entry.` : "."));
      if (ref.fullBrake - me.fullBrake >= 15) out.push(`Brake pressure: ${who} stays above 90% brake for ${ref.fullBrake} m; you do for ${me.fullBrake} m. Brake hard at the start of the zone, then ease off.`);
      if (ref.brakeAtTurnIn >= 15 && me.brakeAtTurnIn < ref.brakeAtTurnIn / 2) {
        const trail = ref.release !== null && ref.turnIn !== null ? ref.release - ref.turnIn : 0;
        out.push(`Trail braking: ${who} is still at ${r0(ref.brakeAtTurnIn)}% brake when starting to turn` +
          (trail > 5 ? ` and keeps easing it off for ${trail} m into the corner` : "") + `; you're at ${r0(me.brakeAtTurnIn)}%.`);
      } else if (me.brakeAtTurnIn >= 15 && me.brakeAtTurnIn > 2 * ref.brakeAtTurnIn) {
        out.push(`Brake release: you're still at ${r0(me.brakeAtTurnIn)}% brake when starting to turn; ${who} is at ${r0(ref.brakeAtTurnIn)}%. Release more before turning in.`);
      }
    } else if (ref.brakeAt !== null && me.brakeAt === null) {
      out.push(`${cap(who)} brakes here (up to ${r0(ref.peakBrake)}%); you only lift off the throttle.`);
    } else if (ref.brakeAt === null && me.brakeAt !== null) {
      out.push(`${cap(who)} doesn't brake here` + (ref.minThrottle > 5 ? `, only easing to ${r0(ref.minThrottle)}% throttle` : `, just lifting off`) +
        `; you brake to ${r0(me.peakBrake)}%.`);
    } else if (ref.liftAt !== null && me.liftAt !== null && me.minThrottle < ref.minThrottle - 15) {
      out.push(`Lift: you come off the throttle to ${r0(me.minThrottle)}%; ${who} only to ${r0(ref.minThrottle)}%.`);
    }
    const dv = me.minSpeed - ref.minSpeed;
    if (dv <= -3) out.push(`Minimum speed: ${r0(me.minSpeed)} km/h vs ${r0(ref.minSpeed)} km/h. You're slowing the car more than you need to.`);
    else if (dv >= 3 && lost > 0.1) out.push(`Minimum speed: you carry ${r0(me.minSpeed)} km/h vs ${r0(ref.minSpeed)} km/h but lose time afterwards. Too fast on entry can mean a wide, slow exit.`);
    const dg = d(me.onGas, ref.onGas), df = d(me.fullGas, ref.fullGas);
    if (dg !== null && dg >= 8) out.push(`Throttle: you get back on the throttle ${dg} m later than ${who}.`);
    if (df !== null && df >= 15) out.push(`Full throttle: you reach full throttle ${df} m later than ${who}.`);
    if (me.saw >= 2 && ref.saw <= 1) out.push(`Throttle control: your throttle goes on and off ${me.saw} times before full throttle; ${who} squeezes it on smoothly. Smooth, progressive throttle keeps the car balanced.`);
    // Steering angles depend on the controller or wheel and its settings, so compare against the
    // ratio this driver typically uses over the lap rather than the reference's raw angle.
    if (steerRatio && ref.maxSteerDeg >= 20 && me.maxSteerDeg / ref.maxSteerDeg >= 1.3 * steerRatio) {
      out.push(`Steering: here you use ${Math.round(100 * (me.maxSteerDeg / ref.maxSteerDeg / steerRatio - 1))}% more steering lock than you do elsewhere on the lap, compared with ${who}. The front is sliding (understeer) or you're on a tighter line. Try a little less speed on entry, and unwind the wheel as you add throttle.`);
    }
    if (me.spin >= 8 && me.spin >= ref.spin + 5) out.push(`Wheelspin: your rear wheels turn up to ${r0(me.spin)} km/h faster than the car on exit. That's too much throttle too early.`);
    if (me.exitSpeed <= ref.exitSpeed - 4) out.push(`Exit: you leave the corner at ${r0(me.exitSpeed)} km/h vs ${r0(ref.exitSpeed)} km/h, and that costs time all the way down the straight after it.`);
    if (!out.length) out.push(lost < 0.1 ? "Close to the reference here." : "No single big difference: small losses through the whole section.");
    return out;
  }
  const cap = s => s[0].toUpperCase() + s.slice(1);

  function analyse(refLap, myLap, who = "the WR") {
    const ref = { ...refLap, s: [0] };
    for (let i = 1; i < ref.x.length; i++) ref.s.push(ref.s[i - 1] + Math.hypot(ref.x[i] - ref.x[i - 1], ref.z[i] - ref.z[i - 1]));
    const n = Math.floor(ref.s[ref.s.length - 1]);
    const p = project(ref, myLap);
    const sorted = p.off.slice().sort((a, b) => a - b);
    if (sorted[Math.floor(sorted.length / 2)] > 25 || p.s[p.s.length - 1] < 0.9 * n) {
      return { error: "This lap doesn't follow the reference lap's track. Is it the same track and layout?" };
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
      return { apex, z0, z1, entry, exit, lost, approachLost: delta[entry] - delta[z0], cornerLost: delta[exit] - delta[entry], ref_m, me_m };
    });
    const ratios = corners.filter(c => c.ref_m.maxSteerDeg >= 20).map(c => c.me_m.maxSteerDeg / c.ref_m.maxSteerDeg).sort((a, b) => a - b);
    const steerRatio = ratios.length >= 3 ? ratios[Math.floor(ratios.length / 2)] : null;
    return { ...result(corners, steerRatio, R, M, delta, who), lapMs: myLap.lap_ms, refMs: refLap.lap_ms, length: n, ref,
      recordedGap, gameGap: (myLap.lap_ms - refLap.lap_ms) / 1000 };
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
    if (L.atTurnIn <= -1.5) { parts.push(`at turn-in you're ${m(L.atTurnIn)} m tighter than ${who}, who starts the turn from further out`); advice.push("start the turn from the outside edge"); }
    else if (L.atTurnIn >= 1.5) parts.push(`at turn-in you're ${m(L.atTurnIn)} m wider than ${who}`);
    if (L.atApex >= 1.5) { parts.push(`at the apex you're ${m(L.atApex)} m wide of ${who}'s line`); advice.push("get closer to the apex"); }
    else if (L.atApex <= -1.5) parts.push(`at the apex you're ${m(L.atApex)} m tighter than ${who}`);
    if (L.atExit <= -1.5) { parts.push(`on exit ${who} runs ${m(L.atExit)} m wider than you`); advice.push("let the car run out to the edge on exit"); }
    else if (L.atExit >= 1.5) parts.push(`on exit you run ${m(L.atExit)} m wider than ${who}`);
    if (!parts.length) return null;
    return `Track use: ${parts.join("; ")}.${advice.length ? ` Use more of the track: ${advice.join(", and ")}.` : ""}`;
  }

  function result(corners, steerRatio, R, M, delta, who) {
    const lifts = extraLifts(corners, R, M, delta);
    return { grid: { R, M, delta }, lifts, corners: corners.map(({ apex, z0, z1, entry, exit, lost, approachLost, cornerLost, ref_m, me_m }, i) => {
      let t = tips(me_m, ref_m, lost, who, steerRatio);
      const line = lineUse(R, M, z0, z1, apex, ref_m), lt = lineTip(line, who);
      if (lt) t.push(lt);
      const mine = lifts.filter(z => z.corner === i);
      if (mine.some(z => z.kind === "brake")) t = t.filter(x => !x.startsWith(`${cap(who)} doesn't brake`)); // said more precisely below
      if (mine.length >= 3) t.push(liftsTip(mine, apex, who)); else mine.forEach(z => t.push(liftTip(z, apex, who)));
      const after = straightTip(entry - z0, approachLost, cornerLost, z1 - exit, lost - cornerLost - approachLost, me_m, ref_m,
        mine.some(z => z.from >= exit), i === corners.length - 1);
      if (after) { t = t.filter(x => !x.startsWith("Exit:")); t.unshift(after); }
      if (t.length > 1) t = t.filter(x => !x.startsWith("No single big difference") && !x.startsWith("Close to the reference"));
      if (i === 0 && R.v[0] - M.v[0] >= 5) {
        t.unshift(`Start of the lap: you crossed the line at ${r0(M.v[0])} km/h vs ${r0(R.v[0])} km/h, which cost about ${delta[ref_m.top].toFixed(2)} s before the first braking point. That comes from your exit of the last corner on the lap before.`);
      }
      return { n: i + 1, apex, from: z0, to: z1, entry, exit, lost, approachLost, cornerLost, colour: COLOURS.find(([lim]) => lost < lim)[1], me: me_m, ref: ref_m, tips: t, lifts: mine, line };
    }) };
  }

  // "Start here": the 2-3 differences most worth working on first. Each candidate gets the time it costs (from the
  // time gap over its stretch of track) and a rough difficulty; easy fixes count in full, harder ones less, so a
  // newer driver sees "stop coasting" before "trail brake deeper". Only one "through the corner" item per corner.
  const EASE = { easy: 1, medium: 0.6, harder: 0.35 };
  function startHere(res, who) {
    const { delta } = res.grid, n = delta.length, at = k => delta[Math.max(0, Math.min(n - 1, k))];
    const items = [];
    for (const c of res.corners) {
      const me = c.me, ref = c.ref, add = (ease, cost, text) => cost >= 0.05 && items.push({ n: c.n, ease, cost, text });
      for (const z of c.lifts) {
        add("easy", z.cost, z.kind === "brake" ? `you brake for ${z.length} m where ${who} stays on the throttle`
          : `you lift off for ${z.length} m where ${who} stays on the throttle`);
      }
      let counted = 0;
      if (me.brakeAt !== null && ref.brakeAt !== null && ref.brakeAt - me.brakeAt >= 10) {
        const cost = at(ref.brakeAt) - at(me.brakeAt);
        counted += Math.max(0, cost);
        add("easy", cost, `you brake ${ref.brakeAt - me.brakeAt} m earlier than ${who}`);
      }
      if (me.fullGas !== null && ref.fullGas !== null && me.fullGas - ref.fullGas >= 15) {
        const cost = at(me.fullGas) - at(ref.fullGas);
        counted += Math.max(0, cost);
        add("easy", cost, `you reach full throttle ${me.fullGas - ref.fullGas} m later than ${who}`);
      }
      // what's left of the time lost through the corner itself
      const rest = c.cornerLost - counted;
      if (me.minSpeed <= ref.minSpeed - 5) add("medium", rest, `carry more speed: your slowest is ${r0(me.minSpeed)} km/h, ${who}'s ${r0(ref.minSpeed)} km/h`);
      else if (c.tips.some(t => t.startsWith("Trail braking") || t.startsWith("Brake pressure"))) add("harder", rest, "brake harder at first, then ease off into the turn (trail braking)");
      else if (c.tips.some(t => t.startsWith("Track use"))) add("medium", rest, "use more of the track (see the line in the close-up)");
      // a slow exit costs time all the way down the straight after the corner
      const straight = c.lost - c.cornerLost - c.approachLost
        - c.lifts.filter(z => z.from >= c.exit).reduce((a, z) => a + z.cost, 0); // lifts there are listed on their own
      if (c.to - c.exit >= 150 && me.exitSpeed <= ref.exitSpeed - 3) {
        add("medium", straight, `a faster exit: you leave the corner ${r0(ref.exitSpeed - me.exitSpeed)} km/h slower, and lose it down the straight`);
      }
    }
    items.forEach(i => (i.score = i.cost * EASE[i.ease]));
    return items.sort((a, b) => b.score - a.score).slice(0, 3);
  }

  // Lifts and braking the reference doesn't do: anywhere outside the reference's own braking-to-full-throttle
  // part of each corner, you're on the brake, or below 90% throttle and 20 points under the reference, for 10 m
  // or more. Stretches that run straight into or out of that part are early braking or a late exit, which the
  // corner's own tips already cover. Only stretches costing 0.03 s or more are kept.
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
  function straightTip(before, onApproach, inCorner, length, onStraight, me, ref, lifted, last) {
    if (length < 150) { inCorner += onStraight; onStraight = 0; }
    if ((!before || Math.abs(onApproach) < 0.1) && (length < 150 || Math.abs(onStraight) < 0.1)) return null;
    const why = [];
    if (me.exitSpeed <= ref.exitSpeed - 2) why.push(`you leave the corner ${r0(ref.exitSpeed - me.exitSpeed)} km/h slower (${r0(me.exitSpeed)} vs ${r0(ref.exitSpeed)} km/h), and that carries all the way down the straight`);
    if (lifted) why.push(`you lift on the straight (below)`);
    const parts = [];
    if (before) parts.push(`${fmtLost(onApproach)} on the ${before} m from the start line to the braking zone`);
    parts.push(`${fmtLost(inCorner)} in the corner`);
    if (length >= 150) parts.push(`${fmtLost(onStraight)} on the ${length} m straight after it${last ? " to the finish line" : ""}`);
    return `Where the time goes: ${parts.join(", ")}` + (why.length && length >= 150 ? `: ${why.join(", and ")}.` : ".");
  }

  function liftsTip(zs, apex, who) {
    const where = z => (z.from <= apex ? `${apex - z.from} m before` : `${z.from - apex} m after`);
    const braking = zs.filter(z => z.kind === "brake").length;
    return `Lifts: ${zs.length} times in this section you come off the throttle${braking ? ` or brake` : ""} where ${who} doesn't, ` +
      `for ${zs.reduce((a, z) => a + z.length, 0)} m in all (starting ${zs.map(where).join(", ")} the apex). ` +
      `Together that costs about ${zs.reduce((a, z) => a + z.cost, 0).toFixed(2)} s. Stay flat out until the braking point.`;
  }

  function liftTip(z, apex, who) {
    const where = z.from < apex - 300 ? `${z.from} m after the start line`
      : z.from <= apex ? `${apex - z.from} m before the apex` : `${z.from - apex} m after the apex`;
    return z.kind === "brake"
      ? `Extra braking: you brake (up to ${r0(z.peakBrake)}%) for ${z.length} m, starting ${where}, where ${who} doesn't brake and averages ${r0(z.refThr)}% throttle. That costs about ${z.cost.toFixed(2)} s.`
      : `Lift: you average ${r0(z.thr)}% throttle for ${z.length} m, starting ${where}, where ${who} averages ${r0(z.refThr)}%. That costs about ${z.cost.toFixed(2)} s.`;
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
    const zones = corners.map(c => `<g class="zone" data-n="${c.n}" tabindex="0" role="button" aria-label="Corner ${c.n}, ${fmtLost(c.lost)}">
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
    return `<svg class="trackmap" viewBox="${vb.map(v => v.toFixed(1)).join(" ")}" role="img" aria-label="Track map coloured by time lost">
      <path d="${path(0, result.length)}" class="base" style="stroke-width:${sw * 3}"/>${zones}${lifts}${start}${arrow}${labels}</svg>`;
  }

  const fmtLost = s => `${s > -0.005 ? "+" : "−"}${Math.abs(s).toFixed(2)} s`; // no "−0.00"
  const metres = (k, apex) => (k === null ? "—" : k <= apex ? `${apex - k} m before` : `${k - apex} m after`);
  const pct = v => `${Math.round(v)}%`;
  // Brake and throttle (you vs the reference) and the time gap building up, in metres from where the reference
  // starts braking (or lifting) for this corner.
  function pedalChart(result, c, who) {
    const { R, M, delta } = result.grid, n = R.v.length;
    const anchor = c.ref.brakeAt ?? c.apex;
    const anchorName = c.ref.brakeAt !== null ? `${who} brakes` : "apex";
    let x0 = Math.min(anchor - 100, (c.me.brakeAt ?? c.me.liftAt ?? anchor) - 30);
    let x1 = Math.max(c.ref.fullGas ?? c.to, c.me.fullGas ?? c.to) + 30;
    // include extra lifts, but never so far back that the corner itself drops out of the chart
    for (const z of c.lifts) { x0 = Math.min(x0, Math.max(z.from - 20, anchor - 300)); x1 = Math.max(x1, z.to + 20); }
    x0 = Math.max(0, x0); x1 = Math.min(n - 1, x1, x0 + 700);
    let braking = false;
    for (let k = x0; k <= x1 && !braking; k++) braking = R.brk[k] > 5 || M.brk[k] > 5;
    const W = 360, L = 30, Rt = 8, H1 = 62, gap = 18, H3 = 54, top = 12;
    const kinds = braking ? [["Brake %", "brk", "brake"], ["Throttle %", "thr", "throttle"]] : [["Throttle %", "thr", "throttle"]];
    const gTop = top + kinds.length * (H1 + gap), axisY = gTop + H3 + 4, H = axisY + 34;
    const x = k => L + ((k - x0) / (x1 - x0)) * (W - L - Rt);
    const g = [];
    for (let k = x0; k <= x1; k++) g.push(delta[k] - delta[x0]);
    const gLo = Math.min(0, ...g), gHi = Math.max(0.05, ...g), gPad = 0.12 * (gHi - gLo);
    const yP = (t0, v) => t0 + H1 - (Math.max(0, Math.min(100, v)) / 100) * H1;
    const yG = v => gTop + H3 - ((v - gLo + gPad) / (gHi - gLo + 2 * gPad)) * H3;
    const line = (arr, y) => { let d = ""; for (let k = x0; k <= x1; k++) d += (d ? "L" : "M") + x(k).toFixed(1) + "," + y(arr[k]).toFixed(1); return d; };
    const secs = v => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)} s`;
    const strips = kinds.map(([label, key, cls], i) => {
      const t0 = top + i * (H1 + gap);
      return `<text class="pc-title" x="${L}" y="${t0 - 4}">${label}</text>
        <line class="pc-grid" x1="${L}" x2="${W - Rt}" y1="${yP(t0, 100)}" y2="${yP(t0, 100)}"/>
        <line class="pc-axis" x1="${L}" x2="${W - Rt}" y1="${yP(t0, 0)}" y2="${yP(t0, 0)}"/>
        <text class="pc-tick" x="${L - 4}" y="${yP(t0, 100) + 3}" text-anchor="end">100</text>
        <text class="pc-tick" x="${L - 4}" y="${yP(t0, 0) + 3}" text-anchor="end">0</text>
        <path class="pc-ref" d="${line(R[key], v => yP(t0, v))}"/>
        <path class="pc-me ${cls}" d="${line(M[key], v => yP(t0, v))}"/>`;
    }).join("");
    let gd = "";
    g.forEach((v, i) => (gd += (i ? "L" : "M") + x(x0 + i).toFixed(1) + "," + yG(v).toFixed(1)));
    const ticks = [];
    for (let m = Math.ceil((x0 - anchor) / 50) * 50; m <= x1 - anchor; m += 50) {
      ticks.push(`<line class="pc-tickline" x1="${x(anchor + m)}" x2="${x(anchor + m)}" y1="${axisY}" y2="${axisY + 3}"/>
        <text class="pc-tick" x="${x(anchor + m)}" y="${axisY + 12}" text-anchor="middle">${m > 0 ? "+" + m : m}</text>`);
    }
    // vertical markers, named under the distance labels so they never sit on a line
    const marks = [[anchor, anchorName]];
    if (anchor !== c.apex) marks.push([c.apex, "apex"]);
    const markers = marks.filter(([k]) => k >= x0 && k <= x1).map(([k, label], i, all) => {
      const close = i > 0 && Math.abs(x(k) - x(all[i - 1][0])) < 40; // keep two close labels apart
      return `<line class="pc-mark" x1="${x(k)}" x2="${x(k)}" y1="${top - 2}" y2="${axisY}"/>
        <text class="pc-marktext" x="${x(k)}" y="${axisY + 24}" text-anchor="${close ? "start" : "middle"}">${close ? "  " : ""}${label}</text>`;
    }).join("");
    const bands = c.lifts.map(z => `<rect class="pc-lift" x="${x(z.from)}" y="${top - 2}" width="${Math.max(1, x(z.to) - x(z.from))}" height="${axisY - top + 2}"/>`).join("");
    const gTicks = [[0, "0"], [gHi, gHi.toFixed(2)]];
    if (yG(gLo) - yG(0) > 10) gTicks.push([gLo, gLo.toFixed(2).replace("-", "−")]); // only when clear of the 0
    return `<figure class="pedal-chart">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${braking ? "Brake, throttle" : "Throttle"} and time gap through corner ${c.n}, you against ${who}">
        ${bands}${strips}
        <text class="pc-title" x="${L}" y="${gTop - 4}">Time gap: <tspan class="pc-gapval">${secs(g[g.length - 1])}</tspan> over this stretch</text>
        <line class="pc-axis" x1="${L}" x2="${W - Rt}" y1="${yG(0)}" y2="${yG(0)}"/>
        ${gTicks.map(([v, t]) => `<text class="pc-tick" x="${L - 4}" y="${yG(v) + 3}" text-anchor="end">${t}</text>`).join("")}
        <path class="pc-me gap" d="${gd}"/>
        ${markers}${ticks.join("")}
      </svg>
      <figcaption class="pc-legend"><span><i class="k-me"></i>You</span><span><i class="k-ref"></i>${who}</span>
        <span>metres from ${anchorName === "apex" ? "the apex (no braking here)" : `where ${who} starts braking`}</span>
        ${c.lifts.length ? `<span><i class="k-lift"></i>extra lift or braking</span>` : ""}
        ${braking ? "" : ""}</figcaption>
    </figure>`;
  }

  // Close-up 1: the corner drawn to scale with both racing lines, the same way round as the lap map. Line thickness shows
  // the pedals: brake pressure from the braking point to the slowest point, throttle everywhere else
  // (thin = none, full thickness = 100%).
  function cornerWidths(result, c, who) {
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
    const pedal = (L, m, k) => (m.brakeAt !== null && k >= m.brakeAt && k < m.minAt ? L.brk[k] : L.thr[k]);
    const line = (L, m, cls) => {
      let out = "";
      for (let k = a; k < b; k += 2) {
        const e = Math.min(b, k + 2), width = THIN + ((FULL - THIN) * Math.max(0, Math.min(100, pedal(L, m, k)))) / 100;
        out += `<path class="${cls}" d="M${X(L.x[k])},${Y(L.z[k])}L${X(L.x[e])},${Y(L.z[e])}" style="stroke-width:${width.toFixed(2)}"/>`;
      }
      return out;
    };
    const dot = (L, k, cls, r = 4) => (k === null || k < a || k > b ? "" :
      `<circle class="cw-dot ${cls}" cx="${X(L.x[k])}" cy="${Y(L.z[k])}" r="${r}"/>`);
    // the slowest-point ring goes last and a little larger, so it still shows round a dot at the same spot
    const dots = (L, m, who2) => dot(L, m.brakeAt, `brake ${who2}`) + dot(L, m.fullGas, `gas ${who2}`) + dot(L, m.minAt, `slow ${who2}`, 5);
    const shows = key => [c.ref[key], c.me[key]].some(k => k !== null && k >= a && k <= b);
    // direction arrow at the start, scale bar in the bottom corner
    const k2 = Math.min(b, a + 8), ang = (Math.atan2(R.z[k2] - R.z[a], R.x[k2] - R.x[a]) * 180) / Math.PI;
    const ten = 10 * scale, sy = H - 8;
    return `<figure class="corner-widths">
      <button type="button" class="cw-toggle" aria-pressed="true">Hide your line</button>
      <svg viewBox="0 0 ${Math.max(w, 80)} ${H}" role="img" aria-label="Corner ${c.n} drawn to scale with your line and ${who}'s line">
        <g>${line(R, c.ref, "cw-ref")}</g><g class="cw-me-line">${line(M, c.me, "cw-me")}</g>
        ${dots(R, c.ref, "ref")}${dots(M, c.me, "me")}
        <path class="cw-arrow" d="M-7,-5L5,0L-7,5Z" transform="translate(${X(R.x[a])},${Y(R.z[a])}) rotate(${ang.toFixed(1)})"/>
        <line class="cw-scale" x1="4" x2="${(4 + ten).toFixed(1)}" y1="${sy}" y2="${sy}"/>
        <text class="cw-scaletext" x="${(8 + ten).toFixed(1)}" y="${sy + 3}">10 m</text>
      </svg>
      <table class="cw-legend">
        <thead><tr><th></th>${shows("brakeAt") ? "<th>braking starts</th>" : ""}${shows("minAt") ? "<th>slowest point</th>" : ""}
          ${shows("fullGas") ? "<th>full throttle</th>" : ""}</tr></thead>
        <tbody>${[["me", "You"], ["ref", who]].map(([k, name]) => `<tr><th><i class="k-line ${k}"></i>${name}</th>
          ${shows("brakeAt") ? `<td><i class="k-dot brake ${k}"></i></td>` : ""}${shows("minAt") ? `<td><i class="k-dot slow ${k}"></i></td>` : ""}
          ${shows("fullGas") ? `<td><i class="k-dot gas ${k}"></i></td>` : ""}</tr>`).join("")}</tbody>
      </table>
      <p class="hint">Drawn to scale, the same way round as the lap map. Line thickness: brake pressure from the braking
        point to the slowest point, then throttle before braking and after the slowest point (thin = none, full = 100%).
        It doesn't show throttle used in the braking zone, or braking outside it: the pedal chart below shows all of it.
        The track edges aren't in the data: where the grey line uses the whole width, it shows roughly where
        they are.</p>
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
  function cornerLines(result, c, label) {
    const who = label === "Reference" ? "the reference" : label; // a license test's gold run reads as a name otherwise
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
    const badges = (L, m, who2, side) => badge(L, m.brakeAt, "B", who2, side) + badge(L, m.onGas, "G", who2, side) + badge(L, m.fullGas, "F", who2, side);
    // direction arrow at the start, scale bar in the bottom corner
    const k2 = Math.min(b, a + 8), ang = (Math.atan2(R.z[k2] - R.z[a], R.x[k2] - R.x[a]) * 180) / Math.PI;
    const ten = 10 * scale, sy = H - 8;
    const key = (cls, r) => `<svg class="k-dot" viewBox="-6 -6 12 12" aria-hidden="true"><circle class="${cls}" r="${r}"/></svg>`;
    return `<figure class="corner-lines">
      <button type="button" class="cl-toggle" aria-pressed="true">Hide ${label === "Reference" ? "the reference" : who + "'s"} line</button>
      <svg viewBox="0 0 ${Math.max(w, 80)} ${H}" role="img" aria-label="Corner ${c.n} drawn to scale: your line coloured by how your pedals differ from ${who}'s">
        <g class="cl-ref-line"><path class="cl-ref" d="${ref}"/>${badges(R, c.ref, "ref", -1)}</g>
        ${dots}${badges(M, c.me, "me", 1)}
        <path class="cl-arrow" d="M-7,-5L5,0L-7,5Z" transform="translate(${X(R.x[a])},${Y(R.z[a])}) rotate(${ang.toFixed(1)})"/>
        <line class="cl-scale" x1="4" x2="${(4 + ten).toFixed(1)}" y1="${sy}" y2="${sy}"/>
        <text class="cl-scaletext" x="${(8 + ten).toFixed(1)}" y="${sy + 3}">10 m</text>
      </svg>
      <div class="cl-legend">
        <span>${key("cl-diff brk more", 4)}more brake than ${who}</span><span>${key("cl-diff brk less", 4)}less brake</span>
        <span>${key("cl-diff gas more", 4)}more throttle</span><span>${key("cl-diff gas less", 4)}less throttle</span>
        <span>${key("cl-same", 1.6)}about the same</span>
      </div>
      <div class="cl-legend">
        <span><b class="cl-key-badge me">B</b><b class="cl-key-badge ref">B</b>first brake</span>
        <span><b class="cl-key-badge me">G</b><b class="cl-key-badge ref">G</b>back on the gas</span>
        <span><b class="cl-key-badge me">F</b><b class="cl-key-badge ref">F</b>full throttle</span>
        <span>dark = you, grey = ${who}</span>
      </div>
      <p class="hint">Drawn to scale, the same way round as the lap map. Your line is a dot every ${step} m comparing your pedals
        with ${who}'s at the same point: the brake wherever either of you is braking, the throttle everywhere else. Bigger
        dots = bigger difference (${SAME}–30, 30–60, 60+ points of pedal travel). The track edges aren't in the data: where
        the grey line uses the whole width, it shows roughly where they are.</p>
    </figure>`;
  }

  function cornerDetail(c, who, result) {
    const row = (label, f) => `<tr><th>${label}</th><td class="num">${f(c.me)}</td><td class="num">${f(c.ref)}</td></tr>`;
    return `<div class="corner-head"><b>Corner ${c.n}</b> <span class="pill ${c.colour}">${fmtLost(c.lost)}</span></div>
      <ul class="tips">${c.tips.map(t => `<li>${t}</li>`).join("")}</ul>
      ${result ? cornerWidths(result, c, who) + cornerLines(result, c, who) + pedalChart(result, c, who) : ""}
      <table class="corner-table"><thead><tr><th>Distances from the apex</th><th class="num">You</th><th class="num">${who}</th></tr></thead><tbody>
        ${row("Braking point", m => (m.brakeAt === null ? (m.liftAt === null ? "no braking" : "lift only") : metres(m.brakeAt, c.apex)))}
        ${row("Peak brake", m => (m.brakeAt === null ? "—" : pct(m.peakBrake)))}
        ${row("Brake when turning in", m => pct(m.brakeAtTurnIn))}
        ${row("Slowest speed", m => `${Math.round(m.minSpeed)} km/h`)}
        ${row("Back on throttle", m => metres(m.onGas, c.apex))}
        ${row("Full throttle", m => metres(m.fullGas, c.apex))}
        ${row("Steering lock", m => `${Math.round(m.maxSteerDeg)}°`)}
        ${row("Exit speed", m => `${Math.round(m.exitSpeed)} km/h`)}
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

  return { parseCsv, fastestLap, lapChoices, analyse, startHere, trackMap, cornerDetail, cornerAt, isRecording, fmtLost };
})();

if (typeof module !== "undefined") module.exports = Coach;
