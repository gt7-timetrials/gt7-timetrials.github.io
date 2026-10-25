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

  // Same rule as gt7tt/telemetry.py: fastest complete lap, timed by packet number (60 a second).
  function fastestLap(rows) {
    const ups = [];
    for (let i = 1; i < rows.length; i++) {
      if (rows[i].lap === rows[i - 1].lap + 1 && rows[i].lap >= 1 && rows[i].speed_kmh > 30) ups.push(i);
    }
    let best = null;
    for (let k = 0; k + 1 < ups.length; k++) {
      const a = ups[k], b = ups[k + 1];
      if (rows[b].lap !== rows[a].lap + 1 || !(rows[b].last_lap_ms > 0)) continue;
      if (!best || rows[b].last_lap_ms < rows[best[1]].last_lap_ms) best = [a, b];
    }
    if (!best) return null;
    const lap = rows.slice(best[0], best[1] + 1), p0 = lap[0].packet_id;
    const out = { lap_ms: rows[best[1]].last_lap_ms, car_code: lap[0].car_code, t: lap.map(r => (r.packet_id - p0) / 60) };
    LAP_FIELDS.forEach(k => (out[k] = lap.map(r => (Number.isNaN(r[k]) ? 0 : r[k]))));
    return out;
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
      s.push(Math.max(ref.s[bj], s.length ? s[s.length - 1] : 0));
      off.push(Math.sqrt(best));
    }
    return { s, off };
  }

  // Every metre: time, speed, throttle (ignoring downshift blips while braking), brake, steering, rear wheelspin.
  function resample(lap, s, n) {
    const keep = [0];
    for (let i = 1; i < s.length; i++) if (s[i] > s[keep[keep.length - 1]]) keep.push(i);
    const xs = keep.map(i => s[i]), col = k => keep.map(i => lap[k][i]);
    const cols = { t: col("t"), v: col("speed_kmh"), thr: col("throttle_pct"), brk: col("brake_pct"),
      steer: col("steering_rad"), spin: keep.map(i => (lap.wheel_rl_kmh[i] + lap.wheel_rr_kmh[i]) / 2 - lap.speed_kmh[i]) };
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
      brakeAtTurnIn: turnIn === null ? 0 : L.brk[turnIn], minAt, minSpeed: L.v[minAt], onGas, fullGas, saw,
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
    if (me.exitSpeed <= ref.exitSpeed - 4) out.push(`Exit: you leave this section at ${r0(me.exitSpeed)} km/h vs ${r0(ref.exitSpeed)} km/h, and that costs time all the way down the next straight.`);
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
    const apexes = findApexes(R.v);
    const corners = apexes.map((apex, i) => {
      const z0 = i === 0 ? 0 : Math.round((apexes[i - 1] + apex) / 2);
      const z1 = i === apexes.length - 1 ? n : Math.round((apex + apexes[i + 1]) / 2);
      const lost = (i === apexes.length - 1 ? myLap.lap_ms / 1000 - refLap.lap_ms / 1000 : delta[z1]) - delta[z0];
      let peak = 0;
      for (let k = z0; k < z1; k++) peak = Math.max(peak, Math.abs(R.steer[k]));
      return { apex, z0, z1, lost, ref_m: cornerMetrics(R, z0, z1, apex, 0.3 * peak), me_m: cornerMetrics(M, z0, z1, apex, 0.3 * peak) };
    });
    const ratios = corners.filter(c => c.ref_m.maxSteerDeg >= 20).map(c => c.me_m.maxSteerDeg / c.ref_m.maxSteerDeg).sort((a, b) => a - b);
    const steerRatio = ratios.length >= 3 ? ratios[Math.floor(ratios.length / 2)] : null;
    return { ...result(corners, steerRatio, R, M, delta, who), lapMs: myLap.lap_ms, refMs: refLap.lap_ms, length: n, ref };
  }

  function result(corners, steerRatio, R, M, delta, who) {
    return { corners: corners.map(({ apex, z0, z1, lost, ref_m, me_m }, i) => {
      const t = tips(me_m, ref_m, lost, who, steerRatio);
      if (i === 0 && R.v[0] - M.v[0] >= 5) {
        t.unshift(`Start of the lap: you crossed the line at ${r0(M.v[0])} km/h vs ${r0(R.v[0])} km/h, which cost about ${delta[ref_m.top].toFixed(2)} s before the first braking point. That comes from your exit of the last corner on the lap before.`);
      }
      return { n: i + 1, apex, from: z0, to: z1, lost, colour: COLOURS.find(([lim]) => lost < lim)[1], me: me_m, ref: ref_m, tips: t };
    }) };
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
    const vb = [minX - pad, minZ - pad, maxX - minX + 2 * pad, maxZ - minZ + 2 * pad];
    const sw = vb[2] / 110; // line width relative to map size
    const path = (a, b) => {
      let d = "";
      for (let s = a; s <= b; s += 4) { const [x, z] = pts(s); d += (d ? "L" : "M") + x.toFixed(1) + "," + z.toFixed(1); }
      const [x, z] = pts(b); return d + "L" + x.toFixed(1) + "," + z.toFixed(1);
    };
    const zones = corners.map(c => `<g class="zone" data-n="${c.n}" tabindex="0" role="button" aria-label="Corner ${c.n}, ${fmtLost(c.lost)}">
        <path d="${path(c.from, c.to)}" class="hit" style="stroke-width:${sw * 5}"/>
        <path d="${path(c.from, c.to)}" class="seg ${c.colour}" style="stroke-width:${sw * 1.6}"/></g>`).join("");
    const labels = corners.map(c => {
      const [x, z] = pts(c.apex);
      // nudge the label off the line, towards the outside of the map's centre
      const cx = minX + (maxX - minX) / 2, cz = minZ + (maxZ - minZ) / 2, dx = x - cx, dz = z - cz, l = Math.hypot(dx, dz) || 1;
      const lx = x + (dx / l) * sw * 4.5, lz = z + (dz / l) * sw * 4.5;
      return `<g class="label" data-n="${c.n}"><circle cx="${lx.toFixed(1)}" cy="${lz.toFixed(1)}" r="${sw * 2.6}" class="${c.colour}"/>
        <text x="${lx.toFixed(1)}" y="${(lz + sw * 0.95).toFixed(1)}" style="font-size:${sw * 2.8}px">${c.n}</text></g>`;
    }).join("");
    const [sx, sz] = pts(0), [ax, az] = pts(12);
    const ang = Math.atan2(az - sz, ax - sx), nx = -Math.sin(ang), nz = Math.cos(ang);
    const start = `<line class="sf" x1="${sx + nx * sw * 3}" y1="${sz + nz * sw * 3}" x2="${sx - nx * sw * 3}" y2="${sz - nz * sw * 3}" style="stroke-width:${sw * 0.8}"/>`;
    const [bx, bz] = pts(70);
    const arrow = `<path class="arrow" d="M${-sw * 2},${-sw * 1.4}L${sw * 1.2},0L${-sw * 2},${sw * 1.4}" transform="translate(${bx.toFixed(1)},${bz.toFixed(1)}) rotate(${(Math.atan2(pts(74)[1] - bz, pts(74)[0] - bx) * 180 / Math.PI).toFixed(1)})"/>`;
    return `<svg class="trackmap" viewBox="${vb.map(v => v.toFixed(1)).join(" ")}" role="img" aria-label="Track map coloured by time lost">
      <path d="${path(0, result.length)}" class="base" style="stroke-width:${sw * 3}"/>${zones}${start}${arrow}${labels}</svg>`;
  }

  const fmtLost = s => `${s >= 0 ? "+" : "−"}${Math.abs(s).toFixed(2)} s`;
  const metres = (k, apex) => (k === null ? "—" : k <= apex ? `${apex - k} m before` : `${k - apex} m after`);
  const pct = v => `${Math.round(v)}%`;
  function cornerDetail(c, who) {
    const row = (label, f) => `<tr><th>${label}</th><td class="num">${f(c.me)}</td><td class="num">${f(c.ref)}</td></tr>`;
    return `<div class="corner-head"><b>Corner ${c.n}</b> <span class="pill ${c.colour}">${fmtLost(c.lost)}</span></div>
      <ul class="tips">${c.tips.map(t => `<li>${t}</li>`).join("")}</ul>
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

  return { parseCsv, fastestLap, analyse, trackMap, cornerDetail, cornerAt, fmtLost };
})();

if (typeof module !== "undefined") module.exports = Coach;
