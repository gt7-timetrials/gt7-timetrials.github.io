I18N.translatePage(); // the page's own text, before anything below shows or hides parts of it
const MEDALS = [[tr("Gold"), 1.03, "gold"], [tr("Silver"), 1.05, "silver"], [tr("Bronze"), 1.10, "bronze"]];
const PAGE = 25;

const fmt = ms => {
  const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000), r = Math.round(ms % 1000);
  return `${m}:${String(s).padStart(2, "0")}.${String(r).padStart(3, "0")}`;
};
const fmtTenths = ms => `${Math.floor(ms / 60000)}:${((ms % 60000) / 1000).toFixed(1).padStart(4, "0")}`;
const secs = ms => (ms / 1000).toFixed(3) + " s";
// the Android app (android/) adds window.GT7App, for recording on the phone
const APP = window.GT7App;
// audio cues: app versions from November 2026
const CUES = !!APP && typeof APP.cueState === "function";
const cueState = () => { try { return JSON.parse(APP.cueState()); } catch (err) { return {}; } };
const num = n => n.toLocaleString(I18N.locale);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const medalTime = (wr, factor) => Math.floor(wr * factor); // as in the game: WR + 3% / 5% / 10%
const localTime = iso => new Date(iso).toLocaleString(I18N.locale, {
  weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit",
});
function countdown(iso) {
  const ms = new Date(iso) - Date.now();
  if (ms <= 0) return tr("ended");
  const d = Math.floor(ms / 86400000), h = Math.floor((ms % 86400000) / 3600000);
  return d ? tr("{d}d {h}h left", { d, h }) : tr("{h}h {m}m left", { h, m: Math.floor((ms % 3600000) / 60000) });
}

// #current, #past, #drivers, #about, or #past/<event id> for one finished event
const TITLE = document.title;
let shownEvent = null;
function route() {
  const [name, id] = (location.hash.slice(1) || "current").split("/");
  const tab = name === "past" && id ? "event" : name;
  document.querySelectorAll(".tab").forEach(t => (t.hidden = t.id !== `tab-${tab}`));
  document.querySelectorAll("nav a").forEach(a => a.classList.toggle("active", a.dataset.tab === name));
  if (tab === "event") showEvent(id);
  else document.title = TITLE;
}
window.addEventListener("hashchange", route);
route();

function stat(label, value, note) {
  return `<div class="stat"><div class="label">${label}</div><div class="value">${value}</div>
    ${note ? `<div class="note">${note}</div>` : ""}</div>`;
}

function targets(e) {
  const p = e.predicted;
  const rows = MEDALS.map(([name, f, cls]) => `<tr>
      <th class="medal ${cls}">${name}</th>
      <td class="num">${fmt(medalTime(e.wr_ms, f))}</td>
      <td class="num">${p ? fmt(medalTime(p.final_wr_ms, f)) : "—"}</td>
      <td class="num strong">${p ? fmt(medalTime(p.final_wr_fast_ms, f)) : "—"}</td></tr>`).join("");
  return `<table class="targets">
      <thead><tr><th></th><th class="num">${tr("Today")}</th><th class="num">${tr("At finish")}</th>
        <th class="num">${tr("Safe target")}</th></tr></thead>
      <tbody>${rows}</tbody></table>
    <p class="hint">${tr(`Medal times are the world record + 3% (gold), 5% (silver) and 10% (bronze), so they get harder as the
      record falls. "Safe target" beats the fast end of the predicted range, which 9 out of 10 past events stayed within.`)}</p>`;
}

// Course difficulty: how far 100th place is behind the world record, rated against all past events: easy below the
// 25th percentile, medium below the 70th, hard below the 90th, very hard above.
let SPREADS = [];
// In the first days the top 100 is still filling with slower first attempts, so it's wider than it will end up (Blue
// Moon Bay: 1.18% on day 0.6, Hard; 1.07% on day 1.6 and about 0.92% after, Medium). Rated from day 2.
const RATE_FROM_DAY = 2;
function difficulty(spread) {
  if (!SPREADS.length) return `${spread.toFixed(2)}%`;
  const at = q => SPREADS[Math.min(SPREADS.length - 1, Math.floor(q * SPREADS.length))];
  return spread < at(0.25) ? tr("Easy") : spread < at(0.7) ? tr("Medium") : spread < at(0.9) ? tr("Hard") : tr("V.hard");
}

function chart(e) {
  const total = e.days_elapsed + e.days_left;
  const steps = e.wr_steps.length ? e.wr_steps : [{ day: e.days_elapsed, gold_ms: e.gold_now_ms }];
  const preds = e.history.filter(r => r.gold_ms);
  const W = Math.max(300, Math.round(document.getElementById("current-list").clientWidth - 38));
  const H = W < 500 ? 190 : 230, L = 52, R = 14, T = 14, B = 28;
  const p = e.predicted;
  // Fixed window: 2 s, or 1.5% of the lap for long laps, so slopes compare across events.
  // It is placed to keep today's gold and the predicted finish in view; earlier slow times go off the bottom.
  const need = [e.gold_now_ms, ...preds.flatMap(r => [r.gold_fast_ms, r.gold_slow_ms])];
  if (p) need.push(p.gold_fast_ms, p.gold_slow_ms);
  let span = Math.max(2000, 0.015 * e.wr_ms);
  const margin = 0.1 * span;
  const needLo = Math.min(...need), needHi = Math.max(...need);
  span = Math.max(span, needHi - needLo + 2 * margin);
  const lo = needLo - margin, hi = lo + span;
  const x = d => L + (Math.min(Math.max(d, 0), total) / total) * (W - L - R);
  const y = v => T + ((hi - Math.min(Math.max(v, lo), hi)) / span) * (H - T - B); // faster lower, clipped
  const offScale = steps.some(s => s.gold_ms > hi);
  // gold on the day: a step line that holds each value until the record falls, up to now
  let path = "";
  steps.forEach((s, i) => {
    path += i ? `H${x(s.day).toFixed(1)}V${y(s.gold_ms).toFixed(1)}` : `M${x(s.day).toFixed(1)},${y(s.gold_ms).toFixed(1)}`;
  });
  path += `H${x(e.days_elapsed).toFixed(1)}`;
  const predLine = preds.map((r, i) => `${i ? "L" : "M"}${x(r.day).toFixed(1)},${y(r.gold_ms).toFixed(1)}`).join("");
  const band = preds.length > 1
    ? "M" + preds.map(r => `${x(r.day).toFixed(1)},${y(r.gold_fast_ms).toFixed(1)}`).join("L")
      + "L" + preds.slice().reverse().map(r => `${x(r.day).toFixed(1)},${y(r.gold_slow_ms).toFixed(1)}`).join("L") + "Z"
    : "";
  const endBar = p ? `<g class="endbar">
      <line x1="${x(total)}" x2="${x(total)}" y1="${y(p.gold_fast_ms)}" y2="${y(p.gold_slow_ms)}"/>
      <line x1="${x(total) - 5}" x2="${x(total) + 5}" y1="${y(p.gold_fast_ms)}" y2="${y(p.gold_fast_ms)}"/>
      <line x1="${x(total) - 5}" x2="${x(total) + 5}" y1="${y(p.gold_slow_ms)}" y2="${y(p.gold_slow_ms)}"/>
      <circle cx="${x(total)}" cy="${y(p.gold_ms)}" r="4"/></g>` : "";
  return `<figure class="chart"><svg viewBox="0 0 ${W} ${H}" height="${H}" role="img"
      aria-label="${tr("Gold time over the event and predicted final gold")}">
      ${axes(lo, hi, span, total, x, y, { W, H, L, R, B })}
      ${offScale ? `<text x="${L + 6}" y="${T + 10}" class="offscale">${tr("↑ earlier times off scale")}</text>` : ""}
      <line class="now" x1="${x(e.days_elapsed)}" x2="${x(e.days_elapsed)}" y1="${T}" y2="${H - B}"/>
      ${band ? `<path d="${band}" class="band"/>` : ""}
      <path d="${path}" class="gold-day"/>
      ${predLine ? `<path d="${predLine}" class="pred"/>` : ""}
      ${preds.map(r => `<circle class="pred-dot" cx="${x(r.day).toFixed(1)}" cy="${y(r.gold_ms).toFixed(1)}" r="3"/>`).join("")}
      ${endBar}
    </svg>
    <figcaption class="legend"><span><i class="k-day"></i>${tr("Gold time on the day")}</span>
      <span><i class="k-pred"></i>${tr("Predicted final gold (and likely range)")}</span>
      <span>${tr("Lower is faster · day of event along the bottom")}</span></figcaption></figure>`;
}

// Gridlines on round times, every 0.5 s (1 s or 2 s for long laps), and every other day along the bottom.
function axes(lo, hi, span, total, x, y, { W, H, L, R }) {
  const step = span <= 3000 ? 500 : span <= 6000 ? 1000 : 2000;
  let out = "";
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    out += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>
     <text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${fmtTenths(v)}</text>`;
  }
  return out + [...Array(Math.floor(total) + 1).keys()].filter(d => d % 2 === 0).map(d =>
    `<text x="${x(d)}" y="${H - 9}" text-anchor="middle">${d}</text>`).join("");
}

let DATA;
function renderCurrent() {
  const el = document.getElementById("current-list");
  if (!DATA.current.length) {
    el.innerHTML = `<p class="muted">${tr("No time trials are running right now.")}</p>`;
    return;
  }
  el.innerHTML = DATA.current.map((e, i) => {
    const total = e.days_elapsed + e.days_left;
    const p = e.predicted;
    const pr = e.entrants_projection;
    const entrantsNote = pr ? tr("projected final {n}", { n: num(pr.projected) }) : "";
    const headline = p
      ? `<div class="headline"><div class="label">${tr("Gold target at the finish")}</div>
          <div class="big">${fmt(p.gold_ms)}</div>
          <div>${tr("Aim for <b>{safe}</b> to be safe · gold today is {now}", { safe: fmt(p.gold_fast_ms), now: fmt(e.gold_now_ms) })}</div></div>`
      : `<div class="headline"><div class="label">${tr("Gold today")}</div><div class="big">${fmt(e.gold_now_ms)}</div>
          <div>${tr("Not enough history yet to predict the finish.")}</div></div>`;
    return `<article class="event">
      <div class="event-head">
        <div><h2><span translate="no">${esc(e.track)}</span>${e.regular_event ? "" : `<span class="tag">${tr("special event")}</span>`}</h2>
          <div class="meta">${e.free_choice ? tr("Your choice of car · record in the {car}", { car: gameName(e.car) }) : gameName(e.car)}</div></div>
        <a class="official" href="${e.leaderboard_url}" target="_blank" rel="noopener">${tr("Official leaderboard ↗")}</a>
      </div>
      <div class="meta">${countdown(e.ends)} · ${tr("ends {when} · day {day} of {days}", { when: localTime(e.ends), day: e.days_elapsed.toFixed(1), days: Math.round(total) })}</div>
      <div class="progress"><div style="width:${Math.min(100, (100 * e.days_elapsed) / total)}%"></div></div>
      ${headline}
      ${targets(e)}
      <div class="stats">
        ${stat(tr("World record"), fmt(e.wr_ms), gameName(e.wr_holder))}
        ${stat(tr("Entrants so far"), num(e.entrants), entrantsNote)}
        ${e.days_elapsed < RATE_FROM_DAY
          ? stat(tr("Course difficulty"), tr("TBD"), tr("rated from day {day}, once the top 100 settles · 100th place {pct}% behind now", { day: RATE_FROM_DAY, pct: e.top100_spread_pct.toFixed(2) }))
          : stat(tr("Course difficulty"), difficulty(e.top100_spread_pct), tr("100th place {pct}% behind the record", { pct: e.top100_spread_pct.toFixed(2) }))}
        ${stat(tr("Top-rated drivers who've set a time"), tr("{n} of {total}", { n: e.strong_drivers_posted.length, total: e.strong_drivers_total }),
               tr("fewer means more time likely to come off"))}
      </div>
      ${chart(e)}
      ${coachSection(e, i)}
    </article>`;
  }).join("");
  el.querySelectorAll("input.lap-file").forEach(inp => inp.addEventListener("change", () => {
    if (inp.files[0]) compareLap(DATA.current[+inp.dataset.i], inp.files[0], inp.closest(".coach").querySelector(".coach-result"));
    inp.value = ""; // allow choosing the same file again
  }));
}

// The recorder for a computer, ready to run (built from tools/telemetry.py by recorder.yml); the Python script is
// telemetry.py on the site, linked from How to record.
const RECORDER = "https://github.com/gt7-timetrials/gt7-timetrials.github.io/releases/download/recorder/";

// --- lap comparison (coach.js does the analysis, in the browser) ---
// A reference is a time trial's top lap (key = event id, with its driver's name; the record may have moved on since) or a license test's
// gold-medal run (key = test id, with medal times).
// a name from the game (driver, car, track): as it is, and never machine-translated
const gameName = s => `<span translate="no">${esc(s)}</span>`;
const refKey = e => e.reference.key ?? e.event_id;
// a time trial's or daily race's reference is a top lap, named by its driver; without a name, "the reference lap"
const tipWho = e => (e.medals ? "the reference lap" : e.reference.driver || "the reference lap"); // in the tips
const shortWho = e => (e.medals ? "Reference" : e.reference.driver ? esc(e.reference.driver) : "Reference"); // labels
function coachSection(e, i) {
  const r = e.reference;
  const v = r && { driver: gameName(r.driver), time: fmt(r.lap_ms), file: APP ? "" : " " + tr("Your file stays on your device."),
    how: APP ? tr("Tap Record on this phone and drive as many laps as you like: there's no need to restart between them. Then tap Stop and compare")
      : tr("Record your laps with the free recorder (as many as you like, no need to restart between them), then upload the file") };
  return `<section class="coach">
      <h3>${tr("Compare your laps with the reference lap")}</h3>
      <p class="hint">${!r ? tr("No reference lap for this event yet. You can already record your laps with the recorder.")
        : r.driver ? tr("{how} to see where you lose time against {driver}'s {time}, corner by corner. Your fastest lap is shown first, and you can switch to any other.{file}", v)
        : tr("{how} to see where you lose time against the reference lap's {time}, corner by corner. Your fastest lap is shown first, and you can switch to any other.{file}", v)}</p>
      <div class="coach-actions">
        ${APP ? (r ? recordButton("event", i) : "") : `<a class="button-link" href="${RECORDER}gt7-recorder-windows.exe">${tr("Recorder for Windows")}</a>
        <a class="button-link" href="${RECORDER}gt7-recorder-mac.zip">${tr("Recorder for Mac")}</a>
        <a class="button-link" href="telemetry.py" download>${tr("Python script (telemetry.py)")}</a>
        <a class="button-link" href="readme.txt" target="_blank" rel="noopener">${tr("How to record")}</a>`}
        ${r ? `<label class="button-link${APP ? "" : " primary"}">${tr("Upload your lap (.csv)")}<input type="file" accept=".csv,text/csv" class="lap-file" data-i="${i}" hidden></label>` : ""}
      </div>
      <div class="coach-result" aria-live="polite"></div>
    </section>`;
}

const refCache = {};
// save: for a recording made in the app, { csv, name } so the result line can offer "Save to Downloads"
async function compareLap(e, file, out, save) {
  out.innerHTML = `<p class="muted">${tr("Reading {file}…", { file: esc(file.name) })}</p>`;
  try {
    const [text, ref] = await Promise.all([file.text(),
      refCache[refKey(e)] ??= fetch(e.reference.url).then(r => (r.ok ? r.json() : Promise.reject()))]);
    if (!Coach.isRecording(text)) {
      out.innerHTML = `<p class="miss">${tr(`This doesn't look like a recording from the recorder. Upload the CSV file the recorder
        saved (named like telemetry_20261025_214804.csv).`)}</p>`;
      return;
    }
    const choices = Coach.lapChoices(Coach.parseCsv(text), ref);
    if (!choices.laps.length) {
      out.innerHTML = `<p class="miss">${tr(`No complete lap found in this file. Start recording before you cross the start line
        and stop after crossing it again.`)}</p>`;
      return;
    }
    out._corner = null; // a new recording: start from its worst corner
    const across = Coach.acrossLaps(ref, choices.laps, tipWho(e)); // with 3+ clean laps
    const themesAll = Coach.themesAcross(ref, choices.laps); // with 2+ clean laps
    // the fastest lap that doesn't look like a cut corner, unless the player picks another one
    const show = i => {
      const lap = choices.laps[i].lap, res = Coach.analyse(ref, lap, tipWho(e));
      if (res.error) { out.innerHTML = `<p class="miss">${res.error}</p>`; return; }
      // a time trial with free car choice: another car than the reference's is normal, so no warning
      renderComparison(out, res, e, !e.free_choice && lap.car_code !== ref.car_code, { ...choices, chosen: i, show, across, themesAll }, save);
    };
    show(choices.pick);
  } catch (err) {
    delete refCache[refKey(e)]; // let the next try fetch the reference again
    out.innerHTML = `<p class="miss">${tr("Couldn't read that file. Is it a CSV saved by the recorder?")}</p>`;
  }
}

// --- recording on the phone, in the Android app: GT7App records GT7's telemetry like telemetry.py and reports
// progress through window.GT7AppEvent ---
const recordButton = (kind, i) => `<button type="button" class="button-link primary record-btn" data-kind="${kind}" data-i="${i}">${tr("Record on this phone")}</button>${CUES
  ? `<label class="cue-check"><input type="checkbox" class="cue-toggle"${cueState().enabled ? " checked" : ""}> ${tr("Audio cues")}</label>` : ""}`;
let recording = null; // { e, out, laps }

const REC_STATES = {
  paused: tr("Paused."),
  menus: tr("Connected. Waiting for the car to move: start driving, or play a replay."),
  driving: tr("Recording: you're driving. Every complete lap is saved: keep going for as many as you like, then tap Stop and compare."),
  replay: tr("Recording a replay."),
};
// A typed-in PlayStation address on another network than the phone's (mesh Wi-Fi, extenders, guest networks): the
// heartbeat may get there, but the data comes back to the router in between, not to the phone.
const net3 = ip => (/^\d+\.\d+\.\d+\.\d+$/.test(ip || "") ? ip.split(".").slice(0, 3).join(".") : null);
function otherNetwork(phone, ps) {
  const a = net3(phone), b = net3(ps);
  if (!a || !b || a === b) return null;
  return tr(`This phone ({phone}) and the PlayStation ({ps}) are on different networks: the first three numbers must match.
    That's common with mesh Wi-Fi or a range extender, or a guest network. Connect the phone and the PlayStation to the same
    Wi-Fi name, or set the mesh to access point mode (also called bridge mode), then try again.`, { phone, ps });
}
window.GT7AppEvent = ev => {
  if (calibrating) { calibrationEvent(ev); return; }
  if (!recording) return;
  const status = recording.out.querySelector(".rec-status"), laps = recording.out.querySelector(".rec-laps");
  const say = (text, cls = "") => { status.textContent = text; status.className = "rec-status " + cls; };
  if (ev.type === "searching") {
    const other = otherNetwork(ev.phone, ev.network);
    if (other) say(other, "miss");
    else say(tr("Looking for your PlayStation at {network}. Make sure GT7 is running…", { network: ev.network }));
  } else if (ev.type === "slow") {
    const prefix = ev.phone ? ev.phone.split(".").slice(0, 3).join(".") : "";
    const seen = ev.consoles || [];
    if (seen.length) recording.out.querySelector(".rec-ip-form input").value ||= seen[0];
    say(otherNetwork(ev.phone, ev.network) || (seen.length ? tr(`Found your PlayStation at {ip}, but no data from GT7
      yet. Check that GT7 is running (not just the home screen), and that no other telemetry app is running at the same time (the computer recorder, SimHub, Sim Racing
      Telemetry…): GT7 only sends to one of them.`, { ip: seen.join(", ") })
      : null) || tr(`Still looking. Check that GT7 is running on the PlayStation (not just the home screen),
      and that no other telemetry app is running at the same time (the computer recorder, SimHub, Sim Racing Telemetry…).`) + (prefix ? " " + tr(`This phone's address starts {prefix}: if the
      PlayStation's doesn't, they're on different networks. That's common with mesh Wi-Fi or a range extender: connect both to the
      same Wi-Fi name, or set the mesh to access point mode.`, { prefix }) : "") + " " + tr("Or type in the PlayStation's address below."), "miss");
    recording.out.querySelector(".rec-ip").open = true;
    recording.out.querySelector(".rec-debug").textContent = tr("This phone: {phone} · searched {network} ({tried} addresses) · {errors} failed sends · {heard} replies · PlayStations seen: {seen}", {
      phone: ev.phone || tr("no Wi-Fi address"), network: ev.network, tried: ev.tried, errors: ev.sendErrors, heard: ev.heard, seen: (ev.consoles || []).length });
  }
  else if (ev.type === "cues") {
    const set = recording.cueSet || {};
    const offsets = [set.brakeEarly ? tr("brake cue {s} s early", { s: set.brakeEarly.toFixed(2) }) : tr("brake cue on the reference's point"),
      set.gas && set.gasAdjust ? (set.gasAdjust > 0 ? tr("gas beep {s} s later", { s: set.gasAdjust.toFixed(2) })
        : tr("gas beep {s} s earlier", { s: (-set.gasAdjust).toFixed(2) })) : ""];
    recording.out.querySelector(".rec-cues").innerHTML = tr("Audio cues on ({output}, {delay} s delay{start}; {offsets}).", {
      output: esc(ev.output), delay: ev.delay.toFixed(2), offsets: offsets.filter(Boolean).join(", "),
      start: ev.calibrated ? "" : tr(', the starting value: calibrate on the <a href="#cues">Audio cues</a> tab for the best timing') });
  }
  else if (ev.type === "connected") say(tr("Connected to your PlayStation at {ip}.", { ip: ev.ip }) + " " + REC_STATES.menus);
  else if (ev.type === "state") say(REC_STATES[ev.state] || "");
  else if (ev.type === "silent") say(tr("No data for {s} s. Is GT7 still running? Still trying…", { s: ev.seconds }), "miss");
  else if (ev.type === "dropout") say(tr("The connection dropped for {s} s. The lap in progress may be incomplete.", { s: ev.seconds }), "miss");
  else if (ev.type === "error") { say(ev.message, "miss"); finishRecording(false); }
  else if (ev.type === "lap") {
    recording.laps++;
    laps.insertAdjacentHTML("beforeend", `<li>${tr("Lap {n}: <b>{time}</b>", { n: ev.lap, time: ev.time })}${ev.replay ? " " + tr("(replay)") : ""}${ev.dropout
      ? " · " + tr("the connection dropped during it") : ""}</li>`);
    say(tr("Lap saved. Keep going for another, or tap Stop and compare."));
  }
};

function startRecording(e, out, ip) {
  if (recording) finishRecording(false);
  recording = { e, out, laps: 0 };
  out.innerHTML = `<div class="rec-panel">
      <p class="rec-status">${tr("Starting…")}</p>
      <ul class="rec-laps"></ul>
      <p class="hint rec-cues"></p>
      <p class="hint">${tr("Recording carries on with the phone locked. Your fastest complete lap is compared first.")}</p>
      <div class="coach-actions"><button type="button" class="button-link primary rec-stop">${tr("Stop and compare")}</button>
        <button type="button" class="button-link rec-cancel">${tr("Cancel")}</button></div>
      <details class="rec-ip"><summary>${tr("Not finding your PlayStation? Type in its address")}</summary>
        <p class="hint">${tr(`PS5: Settings &gt; Network &gt; Connection Status &gt; View Connection Status (IPv4 address).
          The computer recorder also shows it when it connects ("Connected to your PlayStation at …").`)}</p>
        <form class="rec-ip-form"><input inputmode="decimal" placeholder="192.168.1.23" value="${esc(ip || "")}">
          <button class="button-link">${tr("Try this address")}</button></form>
        <p class="hint rec-debug"></p>
      </details>
    </div>`;
  out.querySelector(".rec-stop").addEventListener("click", () => finishRecording(true));
  out.querySelector(".rec-cancel").addEventListener("click", () => { finishRecording(false); out.innerHTML = ""; });
  out.querySelector(".rec-ip-form").addEventListener("submit", ev => {
    ev.preventDefault();
    const typed = out.querySelector(".rec-ip-form input").value.trim();
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(typed)) startRecording(e, out, typed);
  });
  startApp(e, out, ip);
}

async function startApp(e, out, ip) {
  if (CUES && cueState().enabled) {
    try {
      const ref = await (refCache[refKey(e)] ??= fetch(e.reference.url).then(r => (r.ok ? r.json() : Promise.reject())));
      if (recording?.out !== out) return; // cancelled while the reference loaded
      recording.cueSet = cueSettings(); // what the app reads now: changes on the tab apply from the next recording
      APP.startWithCues(ip || "", JSON.stringify(Coach.cuePoints(ref)));
      return;
    } catch (err) {
      out.querySelector(".rec-cues").textContent = tr("Audio cues: couldn't load the reference lap, so recording without them.");
    }
  }
  try { APP.start(ip || ""); } catch (err) { APP.start(); } // the first app version takes no address
}

async function finishRecording(compare) {
  const r = recording;
  recording = null;
  APP.stop();
  if (!r || !compare) return;
  const name = `phone_${new Date().toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "_")}.csv`;
  const csv = APP.csv();
  await compareLap(r.e, new File([csv], name, { type: "text/csv" }), r.out, { csv, name });
}

document.addEventListener("click", ev => {
  const b = ev.target.closest(".record-btn");
  if (!b) return;
  const e = b.dataset.kind === "license" ? licenseEvent(+b.dataset.i)
    : b.dataset.kind === "daily" ? dailyEvent(+b.dataset.i) : DATA.current[+b.dataset.i];
  startRecording(e, b.closest(".coach").querySelector(".coach-result"));
});

// --- Audio cues (app only) ---
const CUE_DEFAULTS = { ticks: 2, spacing: 0.5, lift: true, gas: true, chicane: false, brakeEarly: 0, gasAdjust: 0 };
const range = (from, to, step) => Array.from({ length: Math.round((to - from) / step) + 1 }, (_, i) => +(from + i * step).toFixed(2));
const cueSettings = () => {
  const set = { ...CUE_DEFAULTS, ...(cueState().settings || {}) };
  set.gasAdjust = Math.max(-0.2, Math.min(0.2, set.gasAdjust)); // the first versions went to ±0.5 s
  return set;
};

document.addEventListener("change", ev => {
  if (!ev.target.matches(".cue-toggle")) return;
  APP.saveCues(JSON.stringify({ enabled: ev.target.checked }));
  document.querySelectorAll(".cue-toggle").forEach(c => (c.checked = ev.target.checked));
});

function renderCues() {
  const panel = document.getElementById("cues-panel");
  const st = cueState(), set = cueSettings();
  const select = (key, values, label) => `<select data-set="${key}">${values.map(v =>
    `<option value="${v}"${v === set[key] ? " selected" : ""}>${label(v)}</option>`).join("")}</select>`;
  const check = (key, text) => `<label class="cue-opt"><input type="checkbox" data-set="${key}"${set[key] ? " checked" : ""}> ${text}</label>`;
  const s = v => `${v.toFixed(1)} s`;
  panel.innerHTML = `
    <h2>${tr("Audio cues")}</h2>
    <p>${tr(`Tick <b>Audio cues</b> next to Record on this phone, and while you record the app plays a countdown to each point
      where the reference lap brakes or lifts, and a chirp half a second before it starts to apply throttle. It works
      with the phone locked.`)}</p>
    <h3>${tr("Hear the sounds")}</h3>
    <p class="hint">${tr(`Listen here so you know what they sound like in the game. They play through what the phone is using
      now: {output}.`, { output: esc(st.current?.name || tr("this output")) })}</p>
    <p class="cue-row cue-tests">
      <button type="button" class="button-link cue-test" data-kind="brake">${tr("Brake: tock, tock, BEEP")}</button>
      <button type="button" class="button-link cue-test" data-kind="lift">${tr("Lift: tick, tick, BEEP")}</button>
      <button type="button" class="button-link cue-test" data-kind="gas">${tr("Gas: chirp")}</button>
      <button type="button" class="button-link cue-test" data-kind="pip">${tr("Chicane: pip")}</button></p>
    <p class="hint">${tr(`Gas chirp: half a second before the reference starts to apply throttle. Start squeezing it on, not
      flat out.`)}</p>
    <h3>${tr("Cue settings")}</h3>
    <p class="hint">${tr(`The countdown before each brake or lift, which cues play, and when they play. Changes apply from
      the next recording.`)}</p>
    <h4>${tr("Countdown")}</h4>
    <p class="cue-row"><span>${tr("Beeps before brake")}</span>${select("ticks", [0, 1, 2, 3], v => (v ? tr("{n} before the BEEP", { n: v }) : tr("just the BEEP")))}</p>
    <p class="cue-row"><span>${tr("Beep timing")}</span>${select("spacing", range(0.3, 1, 0.1), v => tr("{s} apart", { s: s(v) }))}</p>
    <h4>${tr("Which cues")}</h4>
    <p class="cue-row">${check("lift", tr("Lift beeps: where the reference comes off the throttle without braking"))}</p>
    <p class="cue-row">${check("gas", tr("Gas chirp: half a second before the reference starts to apply throttle (start squeezing it on, not flat out)"))}</p>
    <p class="cue-row">${check("chicane", tr("Chicane beep: one short pip for a brake or lift that comes too soon after the last one for its own countdown (otherwise it gets no sound)"))}</p>
    <h4>${tr("Timing")}</h4>
    <p class="cue-row"><span>${tr("Brake cue earlier than the reference")}</span>${select("brakeEarly", range(0, 0.2, 0.05), v => (v ? tr("{s} s earlier", { s: v.toFixed(2) }) : tr("on the reference's point")))}</p>
    <p class="cue-row"><span>${tr("Gas beep")}</span>${select("gasAdjust", range(-0.2, 0.2, 0.05), v => (v > 0 ? tr("{s} s later", { s: v.toFixed(2) }) : v < 0 ? tr("{s} s earlier", { s: (-v).toFixed(2) }) : tr("as is")))}</p>
    <h3>${tr("Sound delay")}</h3>
    <p class="hint">${tr(`Sound takes a moment to reach your ears, especially over Bluetooth, so every cue plays early by this
      much. The starting values were tested on the developer's phone and headphones and might not match yours: if the
      cues seem early or late, calibrate.`)}</p>
    <div class="cue-cal">
      <p>${tr(`<b>Calibrate {output}</b>: in GT7, sit in the car on track (standing still is
        fine, for example at the start of a time trial). Tap Calibrate, then press the brake firmly on each BEEP:
        6 countdowns, 3 seconds apart, about 20 seconds.`, { output: esc(st.current?.name || tr("this output")) })}</p>
      <p class="cue-row"><button type="button" class="button-link primary cue-calibrate">${tr("Calibrate")}</button>
        <button type="button" class="button-link cue-cal-stop" hidden>${tr("Stop")}</button></p>
      <p class="cue-cal-status" aria-live="polite"></p>
    </div>
    <table class="cue-outputs"><tbody>${(st.outputs || []).map(o => `<tr>
      <th>${esc(o.name)}${o.current ? ` <span class="muted">${tr("(now)")}</span>` : ""}</th>
      <td class="num"><button type="button" class="nav-btn cue-delay" data-key="${esc(o.key)}" data-step="-0.01" aria-label="${tr("Less delay")}">−</button>
        <b>${o.delay.toFixed(2)} s</b>
        <button type="button" class="nav-btn cue-delay" data-key="${esc(o.key)}" data-step="0.01" aria-label="${tr("More delay")}">+</button></td>
      <td>${o.calibrated ? `${tr("calibrated")}${o.spread != null ? ` <span class="muted">(±${o.spread.toFixed(2)} s)</span>` : ""}${o.spread > SPREAD_OK
        ? `<br><span class="miss">${tr("Too uneven for reliable cues: the phone speaker or wired headphones work better.")}</span>` : ""}`
        : `<span class="muted">${Math.abs(o.delay - o.start) < 0.005 ? tr("starting value") : tr("set by hand")}</span>`}</td>
      <td><button type="button" class="nav-btn cue-reset" data-key="${esc(o.key)}" aria-label="${tr("Back to the starting value")}">${tr("Reset")}</button></td></tr>`).join("")}</tbody></table>`;
  const save = change => { APP.saveCues(JSON.stringify(change)); renderCues(); };
  panel.querySelectorAll("[data-set]").forEach(el => el.addEventListener("change", () => {
    const v = el.type === "checkbox" ? el.checked : +el.value;
    save({ settings: { ...cueSettings(), [el.dataset.set]: v } });
  }));
  panel.querySelectorAll(".cue-delay").forEach(b => b.addEventListener("click", () => {
    const o = (cueState().outputs || []).find(x => x.key === b.dataset.key);
    if (o) save({ delay: { key: o.key, delay: +(o.delay + +b.dataset.step).toFixed(3) } });
  }));
  panel.querySelectorAll(".cue-reset").forEach(b => b.addEventListener("click", () => save({ reset: b.dataset.key })));
  panel.querySelectorAll(".cue-test").forEach(b => b.addEventListener("click", () => {
    try { APP.testSound(b.dataset.kind); } catch (err) { APP.testSound(); }
  }));
  panel.querySelector(".cue-calibrate").addEventListener("click", startCalibration);
  panel.querySelector(".cue-cal-stop").addEventListener("click", () => { APP.stop(); endCalibration(tr("Stopped.")); });
  if (!APP.calibrate) panel.querySelector(".cue-cal").hidden = true; // an app version without it
}

// calibration: the app plays 6 brake countdowns and times the player's brake presses on the BEEPs
let calibrating = null;
const SPREAD_OK = 0.05; // presses varying more than this (standard deviation, s): cues on this output won't be reliable
function calibrationStatus(text, cls = "") {
  const el = document.querySelector(".cue-cal-status");
  if (el) { el.textContent = text; el.className = "cue-cal-status " + cls; }
}
function startCalibration() {
  if (recording) finishRecording(false);
  calibrating = { rounds: [] };
  document.querySelector(".cue-calibrate").hidden = true;
  document.querySelector(".cue-cal-stop").hidden = false;
  calibrationStatus(tr("Looking for your PlayStation. Make sure GT7 is running…"));
  APP.calibrate("");
}
function endCalibration(text, cls) {
  calibrating = null;
  renderCues();
  calibrationStatus(text, cls);
}
function calibrationEvent(ev) {
  const c = calibrating;
  if (ev.type === "slow") calibrationStatus(tr(`Still looking for your PlayStation. Check that GT7 is running (on track, not just
    the menus) and that the phone is on the same Wi-Fi. If Record on this phone can't find it either, see the tips there.`), "miss");
  else if (ev.type === "connected") calibrationStatus(tr("Connected. First countdown in a moment: press the brake firmly on each BEEP."));
  else if (ev.type === "calibrate" && !ev.done) {
    c.rounds.push(ev.pressed);
    calibrationStatus(tr("Countdown {n} of {of}: {marks}", { n: ev.round, of: ev.of, marks: c.rounds.map(p => (p ? "✓" : "–")).join(" ") }));
  } else if (ev.type === "calibrate") {
    endCalibration(ev.ok ? tr("Calibrated: {output} plays cues {delay} s early (from {presses} presses, which varied by ±{spread} s{uneven}).", {
      output: ev.output, delay: ev.delay.toFixed(2), presses: ev.presses, spread: (ev.spread ?? 0).toFixed(2),
      uneven: ev.spread > SPREAD_OK ? tr(": too uneven for reliable cues; the phone speaker or wired headphones work better") : "" })
      : tr("Not enough steady presses ({n} of 6 agreed). Try again, pressing firmly right on each BEEP.", { n: ev.presses }), ev.ok ? "" : "miss");
  } else if (ev.type === "error") endCalibration(ev.message, "miss");
  else if (ev.type === "stopped" && calibrating) endCalibration(tr("Stopped before the end. Try again."), "miss");
}
// How to read a comparison: shown above the first ones, until "Got it". The same steps are on the How to use tab.
const GUIDE_SEEN = "guide-seen";
const GUIDE_STEPS = `<ol>
    <li>${tr("<b>The top line</b> is your lap against the reference, and the total time between them.")}</li>
    <li>${tr(`<b>The map</b> colours each section by how much slower you are there than the reference: green is close, yellow
      and red are where the time goes. Start with the red ones.`)}</li>
    <li>${tr(`<b>Where your time goes</b> splits your gap to the reference into four parts: <b>braking</b>, the speed you
      lose from the braking point to the apex and what that costs you afterwards; <b>exit</b>, the speed you lose from the
      apex out and down the straight after it; <b>straight</b>, lifting or braking on the straight (or a slower car); and
      <b>line</b>, the extra distance of a different line. The bar at the top is for your recorded laps, then there are
      bars for each lap and corner below.`)}</li>
    <li>${tr(`<b>Tap a corner</b> on the map, or its number under the map, to see why: tips first, then your line, pedals and
      steering drawn against the reference's.`)}</li>
    <li>${tr(`<b>More than one lap?</b> Choose a lap at the top, or step through laps with ‹ › in the corner's panel to see
      the same corner on each. With 3 or more laps, <b>Across your laps</b> shows where you lose most on average and
      where you're least consistent.`)}</li>
  </ol>`;
function guide() {
  try { if (localStorage.getItem(GUIDE_SEEN)) return ""; } catch (err) { /* no storage: show it */ }
  return `<div class="guide"><h4>${tr("How to read this")}</h4>${GUIDE_STEPS}
    <button type="button" class="button-link guide-ok">${tr("Got it")}</button></div>`;
}

// the website or the app: the License intro and About page say different things
document.querySelectorAll(APP ? ".web-only" : ".app-only").forEach(el => (el.hidden = true));
document.querySelectorAll(APP ? ".app-only" : ".web-only").forEach(el => (el.hidden = false));
document.getElementById("howto-guide").innerHTML = GUIDE_STEPS;

if (CUES) {
  document.querySelector('nav a[data-tab="cues"]').hidden = false;
  window.addEventListener("hashchange", () => { if (location.hash === "#cues") renderCues(); });
  if (location.hash === "#cues") renderCues();
}

// --- Settings tab: the language, for now. Kept on this device (in the app too); a change reloads the page. ---
function renderSettings() {
  const opt = (v, label) => `<option value="${v}"${I18N.pref === v ? " selected" : ""}>${label}</option>`;
  const panel = document.getElementById("settings-panel");
  panel.innerHTML = `<h2>${tr("Settings")}</h2>
    <h3><label for="set-lang">${tr("Language")}</label></h3>
    <p class="cue-row"><select id="set-lang">${opt("auto", tr("Automatic ({lang})", { lang: I18N.LANGS[I18N.automatic()] }))}${
      Object.entries(I18N.LANGS).map(([code, label]) => opt(code, label)).join("")}</select></p>
    <p class="hint">${tr(`Automatic follows your phone's or browser's language if the site has it, otherwise English. The
      translations are new: if something reads wrong, please say so.`)}</p>
`;
  panel.querySelector("#set-lang").addEventListener("change", ev => {
    I18N.setPref(ev.target.value);
    location.reload();
  });
}
renderSettings();

// --- Super License tab ---
const MEDAL_KEYS = [["gold", tr("Gold")], ["silver", tr("Silver")], ["bronze", tr("Bronze")]];
function medalLine(ms, medals) {
  const won = MEDAL_KEYS.find(([k]) => ms <= medals[k]);
  const better = MEDAL_KEYS.filter(([k]) => ms > medals[k]).slice(-1)[0]; // the next medal up
  return `<span class="medal-result">${won ? `<b class="medal ${won[0]}">${won[1]}</b>` : `<b>${tr("No medal")}</b>`}${better
    ? ". " + tr("{medal} needs {time}, {gap} faster.", { medal: better[1], time: fmt(medals[better[0]]), gap: secs(ms - medals[better[0]]) }) : "."}</span>`;
}

let LICENSE;
const licenseEvent = i => {
  const t = LICENSE.tests[i];
  return { reference: t.reference, medals: { gold: t.gold, silver: t.silver, bronze: t.bronze } };
};
function renderLicense() {
  const el = document.getElementById("license-list");
  el.innerHTML = LICENSE.tests.map((t, i) => {
    const medals = t.gold ? `<div class="license-medals">${MEDAL_KEYS.map(([k, name]) =>
      `<span><b class="medal ${k}">${name}</b> ${fmt(t[k])}</span>`).join("")}</div>`
      : `<p class="muted">${tr("Medal times and a reference run coming soon.")}</p>`;
    return `<article class="event license-test">
      <div class="license-head"><span class="license-id">${esc(t.id)}</span>
        <div><h2>${gameName(t.track)}</h2><div class="meta">${gameName(t.car)}</div></div></div>
      ${medals}
      ${t.reference ? `<section class="coach">
        <p class="hint">${tr("Reference: a gold-medal run of {time}.", { time: fmt(t.reference.lap_ms) })}</p>
        <div class="coach-actions">${APP ? recordButton("license", i) : ""}<label class="button-link${APP ? "" : " primary"}">${tr("Upload your run (.csv)")}<input type="file"
          accept=".csv,text/csv" class="license-file" data-i="${i}" hidden></label></div>
        <div class="coach-result" aria-live="polite"></div></section>` : ""}
    </article>`;
  }).join("");
  el.querySelectorAll("input.license-file").forEach(inp => inp.addEventListener("change", () => {
    if (inp.files[0]) compareLap(licenseEvent(+inp.dataset.i), inp.files[0], inp.closest(".coach").querySelector(".coach-result"));
    inp.value = "";
  }));
}

// --- Daily races tab: a fast lap for each of the week's daily races (data/daily/races.json), to compare with ---
let DAILY;
const dailyEvent = i => {
  const r = DAILY.races[i];
  return { reference: r.reference, daily: true, free_choice: !!r.free_choice };
};
function renderDaily() {
  const el = document.getElementById("daily-list");
  if (!DAILY.races.length) {
    el.innerHTML = `<p class="muted">${tr("This week's daily races are coming soon.")}</p>`;
    return;
  }
  el.innerHTML = DAILY.races.map((r, i) => `<article class="event license-test">
      <div class="license-head"><span class="license-id">${esc(r.id)}</span>
        <div><h2>${gameName(r.track)}</h2><div class="meta">${gameName(r.car)}${r.free_choice ? " · " + tr("your choice of car") : ""}</div></div></div>
      ${r.reference ? `<section class="coach">
        <p class="hint">${r.reference.driver ? tr("Reference: {driver}'s lap of {time}", { driver: gameName(r.reference.driver), time: fmt(r.reference.lap_ms) })
          : tr("Reference: a lap of {time}", { time: fmt(r.reference.lap_ms) })}${
          r.reference.car && r.free_choice ? " " + tr("in the {car}", { car: gameName(r.reference.car) }) : ""}.</p>
        <div class="coach-actions">${APP ? recordButton("daily", i) : ""}<label class="button-link${APP ? "" : " primary"}">${tr("Upload your lap (.csv)")}<input type="file"
          accept=".csv,text/csv" class="daily-file" data-i="${i}" hidden></label></div>
        <div class="coach-result" aria-live="polite"></div></section>` : `<p class="muted">${tr("Reference lap coming soon.")}</p>`}
    </article>`).join("");
  el.querySelectorAll("input.daily-file").forEach(inp => inp.addEventListener("change", () => {
    if (inp.files[0]) compareLap(dailyEvent(+inp.dataset.i), inp.files[0], inp.closest(".coach").querySelector(".coach-result"));
    inp.value = "";
  }));
}

// Phones: corner details slide up from the bottom when a corner is tapped. Wider screens: beside the map.
const phone = () => matchMedia("(max-width: 760px)").matches;

// Which lap of the recording is compared: a button per complete lap when there's more than one, and a note when a
// lap looks like it cut a corner (noticeably shorter than the reference).
function lapPicker(p) {
  if (!p) return "";
  const chosen = p.laps[p.chosen], fastest = p.laps[p.fastest];
  const note = l => tr("{m} m shorter than the reference lap, so it probably cut a corner", { m: l.short });
  let html = "";
  if (p.laps.length > 1) {
    html += `<div class="lap-pick" role="group" aria-label="${tr("Lap to compare")}"><span class="muted">${tr("Laps:")}</span>
      ${p.laps.map((l, i) => `<button type="button" class="lap-btn${i === p.chosen ? " chosen" : ""}${l.cut || l.incident?.length ? " cut" : ""}"
        data-lap="${i}" aria-pressed="${i === p.chosen}">${tr("Lap {n}", { n: l.number })} <b>${fmt(l.lap_ms)}</b>${i === p.fastest ? " · " + tr("fastest") : ""}${l.cut
        ? " · " + tr("⚠ short") : ""}${l.incident?.length ? " · " + tr("⚠ spin or crash") : ""}</button>`).join("")}</div>`;
  }
  if (chosen.cut) html += `<p class="hint miss">${tr("This lap is {note}. The comparison may be misleading.", { note: note(chosen) })}</p>`;
  if (chosen.incident?.length) html += `<p class="hint miss">${tr("This lap has a spin or crash (corner {n}), so it's left out of Across your laps.",
    { n: chosen.incident.join(", ") })}</p>`;
  else if (fastest.cut && p.chosen === p.pick) html += `<p class="hint">${tr(`Lap {n} ({time}) was faster,
    but it's {note}. Comparing lap {chosen} instead: tap lap {n} to compare it anyway.`, { n: fastest.number, time: fmt(fastest.lap_ms), note: note(fastest), chosen: chosen.number })}</p>`;
  return html;
}

// With 3 or more clean laps: where the time goes on average, where it varies most, and the best sections added up.
function acrossLaps(a) {
  if (!a) return "";
  const corner = n => `<button type="button" class="sh-corner" data-n="${n}">${tr("Corner {n}", { n })}</button>`;
  const list = (items, text) => `<ul>${items.map(x => `<li>${corner(x.n)} ${text(x)}</li>`).join("")}</ul>`;
  return `<div class="across"><h4>${tr("Across your {n} laps", { n: a.laps })}</h4>
    ${a.gain.length ? `<p class="across-head">${tr("Most time to gain")}</p>${list(a.gain, x => tr("you lose {s} s on average", { s: x.avg.toFixed(2) }))}` : ""}
    ${a.varies.length ? `<p class="across-head">${tr("Least consistent")}</p>${list(a.varies, x => tr("your time here varies by ±{s} s", { s: x.sd.toFixed(2) }))}` : ""}
    <p class="hint">${tr("Your best time in each section adds up to <b>{ideal}</b>{faster}. Laps that look cut, or with a spin or crash, are left out.", { ideal: fmt(a.idealMs),
      faster: a.idealMs < a.bestMs ? tr(", {gap} faster than your best lap ({best})", { gap: secs(a.bestMs - a.idealMs), best: fmt(a.bestMs) }) : "" })}</p></div>`;
}

// Where the time goes, by theme (coach.js themeSplit): averaged over the recording's clean laps, then for the lap
// being compared (just the bar: the description is above it, or under it with one lap). Not for a lap with a spin.
const THEMES_ABOUT = () => tr(`<b>Braking</b> is the speed you lose from the braking point to the apex and what it costs
  after, <b>exit</b> what you lose from the apex out and down the straight after it, <b>straight</b> lifting or a slower car
  on the straight, <b>line</b> the extra distance of a different line.`);
function themesAcrossBox(all) {
  if (!all) return "";
  return `<div class="themes"><h4>${tr("Where your time goes: average over your {n} laps", { n: all.laps })}</h4>${Coach.themeBar(all.parts)}
    <p class="hint">${THEMES_ABOUT()}</p></div>`;
}
function themesLapBox(res, withAbout) {
  if (!res.themes || res.corners.some(c => c.incident)) return "";
  return `<div class="themes themes-lap"><h4>${tr("Where your time goes on this lap")}</h4>${Coach.themeBar(res.themes)}
    ${withAbout ? `<p class="hint">${THEMES_ABOUT()}</p>` : ""}</div>`;
}

function renderComparison(out, res, e, otherCar, picker, save) {
  const total = (res.lapMs - res.refMs) / 1000;
  const worst = res.corners.reduce((a, c) => (c.lost > a.lost ? c : a), res.corners[0]);
  out.innerHTML = `
    ${themesAcrossBox(picker?.themesAll)}
    ${lapPicker(picker)}
    <p class="coach-summary">${tr("Your lap <b>{lap}</b> vs {ref}: <b>{gap}</b>.", { lap: fmt(res.lapMs), ref: fmt(res.refMs), gap: Coach.fmtLost(total) })}${save
      ? ` <span class="rec-save">${save.saved ? `<span class="muted">${tr("Saved to Downloads as {file}.", { file: esc(save.saved) })}</span>`
        : `<button type="button" class="save-btn">${tr("Save to Downloads")}</button>`}</span>` : ""}
      ${e.medals ? medalLine(res.lapMs, e.medals) : ""}
      ${otherCar ? `<span class="miss">${tr("This lap is in a different car from the reference.")}</span>` : ""}</p>
    ${Math.abs(res.gameGap - res.recordedGap) > 0.1 ? `<p class="hint">${tr(`The game's times include
      {s} s that isn't in the recorded laps (in a license test the timer can
      start before the car reaches the line), so the corners below add up to {total}.`, { s: Math.abs(res.gameGap - res.recordedGap).toFixed(2), total: Coach.fmtLost(res.recordedGap) })}</p>` : ""}
    ${themesLapBox(res, !picker?.themesAll)}
    ${guide()}
    ${acrossLaps(picker?.across)}
    <p class="hint tap-hint">${phone() ? tr("Tap a corner to see where you lose time.") : tr("Hover over or click a corner on the map.")}</p>
    <div class="coach-grid">
      <div class="map-box">${Coach.trackMap(res)}
        <div class="legend">${e.medals || e.daily
          ? `<span><i class="k good"></i>${tr("within 3% of the reference")}</span><span><i class="k warn"></i>${tr("3–5% slower")}</span>
            <span><i class="k bad"></i>${tr("over 5% slower")}</span>`
          : `<span><i class="k good"></i>${tr("gold pace (within 3%)")}</span><span><i class="k warn"></i>${tr("silver pace (3–5%)")}</span>
            <span><i class="k bad"></i>${tr("slower than silver")}</span>`}</div>
        <p class="hint">${tr("The colours compare your time through each section with the reference's.")}</p>
        <div class="chips">${res.corners.map(c => `<button class="chip ${c.colour}" data-n="${c.n}">${c.n}<small>${Coach.fmtLost(c.lost)}</small></button>`).join("")}</div>
      </div>
      <div class="corner-detail" role="region" aria-label="${tr("Corner details")}">
        <div class="sheet-nav">
          <button class="nav-btn" data-step="-1" aria-label="${tr("Previous corner")}">${tr("‹ Prev")}</button>
          <button class="nav-btn" data-step="1" aria-label="${tr("Next corner")}">${tr("Next ›")}</button>
          <button class="nav-btn close" aria-label="${tr("Close")}">✕</button>
        </div>${picker && picker.laps.length > 1 ? `
        <div class="sheet-laps"><button class="nav-btn" data-lapstep="-1" aria-label="${tr("Previous lap")}">‹</button>
          <span>${tr("Lap {n}", { n: picker.laps[picker.chosen].number })} · ${fmt(picker.laps[picker.chosen].lap_ms)}${picker.laps[picker.chosen].cut ? " · " + tr("⚠ short") : ""}${picker.laps[picker.chosen].incident?.length ? " · " + tr("⚠ spin or crash") : ""}</span>
          <button class="nav-btn" data-lapstep="1" aria-label="${tr("Next lap")}">›</button></div>` : ""}
        <div class="detail-body"></div>
      </div>
    </div>
    <p class="hint">${tr(`Distances are measured along the reference lap. Steering angles depend on your controller or wheel
      settings, so the steering tip compares each corner with your own lap.`)}</p>`;
  const detail = out.querySelector(".corner-detail"), body = detail.querySelector(".detail-body");
  const svg = out.querySelector(".trackmap");
  const who = shortWho(e);
  // the corner being looked at stays selected when another lap is chosen, so laps can be compared corner by corner
  const kept = out._corner && res.corners.some(c => c.n === out._corner.n) ? out._corner : null;
  let pinned = kept ? kept.n : worst.n;
  let hideRef = false; // the close-ups' buttons, kept while moving between corners: the reference's line in the dots
  let hideMine = false; // close-up, your line in the line-width close-up
  const applyHide = () => {
    body.querySelectorAll(".corner-widths").forEach(f => {
      f.classList.toggle("hide-mine", hideMine);
      const b = f.querySelector(".cw-toggle");
      b.textContent = hideMine ? tr("Show your line") : tr("Hide your line");
      b.setAttribute("aria-pressed", String(!hideMine));
    });
    applyHideRef();
  };
  const applyHideRef = () => body.querySelectorAll(".corner-lines").forEach(f => {
    f.classList.toggle("hide-ref", hideRef);
    const b = f.querySelector(".cl-toggle");
    b.textContent = who === "Reference" ? (hideRef ? tr("Show the reference line") : tr("Hide the reference line"))
      : hideRef ? tr("Show {who}'s line", { who }) : tr("Hide {who}'s line", { who });
    b.setAttribute("aria-pressed", String(!hideRef));
  });
  body.addEventListener("click", ev => {
    if (ev.target.closest(".cw-toggle")) { hideMine = !hideMine; applyHide(); }
    if (!ev.target.closest(".cl-toggle")) return;
    hideRef = !hideRef;
    applyHide();
  });
  const show = n => {
    body.innerHTML = Coach.cornerDetail(res.corners[n - 1], who, res);
    applyHide();
    out.querySelectorAll("[data-n]").forEach(el => el.classList.toggle("selected", +el.dataset.n === n));
    svg.classList.add("has-selection");
  };
  const select = (n, scroll = true) => {
    pinned = n;
    out._corner = { n, open: phone() };
    show(n);
    if (phone()) {
      detail.classList.add("open");
      document.body.classList.add("sheet-open");
      body.scrollTop = 0;
      if (!scroll) return;
      // scroll so the selected corner sits in the middle of the space above the sheet
      const mark = svg.querySelector(`.label[data-n="${n}"]`).getBoundingClientRect();
      const visible = innerHeight - detail.getBoundingClientRect().height;
      window.scrollBy({ top: mark.top + mark.height / 2 - visible / 2, behavior: "smooth" });
    }
  };
  const close = () => {
    detail.classList.remove("open");
    document.body.classList.remove("sheet-open");
    if (out._corner) out._corner.open = false;
  };
  out.querySelectorAll(".zone, .label, .chip").forEach(el => {
    const n = +el.dataset.n;
    el.addEventListener("mouseenter", () => { if (!phone()) show(n); });
    el.addEventListener("mouseleave", () => { if (!phone()) show(pinned); });
    el.addEventListener("keydown", ev => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); select(n); } });
  });
  out.querySelectorAll(".chip, .sh-corner").forEach(el => el.addEventListener("click", () => select(+el.dataset.n)));
  // a click or tap anywhere near the track selects the nearest corner's section
  svg.addEventListener("click", ev => {
    const pt = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(svg.getScreenCTM().inverse());
    const vb = svg.viewBox.baseVal;
    const c = Coach.cornerAt(res, pt.x, pt.y, 0.08 * Math.max(vb.width, vb.height));
    if (c) select(c.n);
  });
  detail.querySelectorAll("[data-step]").forEach(b => b.addEventListener("click", () => {
    const n = ((pinned - 1 + +b.dataset.step + res.corners.length) % res.corners.length) + 1;
    select(n);
  }));
  detail.querySelector(".close").addEventListener("click", close);
  out._keys?.abort(); // one Escape handler per comparison, even after choosing another lap
  out._keys = new AbortController();
  document.addEventListener("keydown", ev => { if (ev.key === "Escape") close(); }, { signal: out._keys.signal });
  out.querySelector(".guide-ok")?.addEventListener("click", () => {
    try { localStorage.setItem(GUIDE_SEEN, "1"); } catch (err) { /* shown again next time */ }
    document.querySelectorAll(".guide").forEach(g => g.remove());
  });
  out.querySelector(".save-btn")?.addEventListener("click", () => {
    const saved = APP.save(save.csv, save.name); // remembered, so choosing another lap still shows it's saved
    if (saved) save.saved = saved;
    out.querySelector(".rec-save").innerHTML = saved ? `<span class="muted">${tr("Saved to Downloads as {file}.", { file: esc(saved) })}</span>`
      : `<span class="miss">${tr("Couldn't save the file.")}</span>`;
  });
  out.querySelectorAll(".lap-btn").forEach(b => b.addEventListener("click", () => picker.show(+b.dataset.lap)));
  // in the corner's panel: step through the laps on the same corner
  detail.querySelectorAll("[data-lapstep]").forEach(b => b.addEventListener("click", () => {
    out._corner = { n: pinned, open: phone() };
    picker.show((picker.chosen + +b.dataset.lapstep + picker.laps.length) % picker.laps.length);
  }));
  // Wider screens: hovering swaps the panel's contents, so give it the height of the tallest corner. Otherwise a
  // shorter corner shrinks the page, the browser scrolls, and the button under the pointer moves away.
  if (!phone()) {
    let tallest = 0;
    for (const c of res.corners) { show(c.n); tallest = Math.max(tallest, detail.offsetHeight); }
    detail.style.minHeight = `${tallest}px`;
  }
  if (kept?.open && phone()) select(pinned, false); // the corner's sheet was open: keep it open, where it was
  else show(pinned);
}

// Only the charts depend on the width; leave the rest (and anything being typed) alone.
function redrawCharts() {
  document.querySelectorAll("#current-list figure.chart").forEach((fig, i) => (fig.outerHTML = chart(DATA.current[i])));
}

function renderScorecard() {
  const el = document.getElementById("scorecard");
  const rows = DATA.scorecard;
  if (!rows.length) {
    const next = DATA.current.map(e => e.ends).sort()[0];
    el.innerHTML = `<p class="muted">${tr(`Predictions started on 24 Oct 2026. The first results will appear here after the
      current events finish{first}.`, { first: next ? " " + tr("(first one {when})", { when: localTime(next) }) : "" })}</p>`;
    return;
  }
  const cell = c => c ? `${fmt(c.gold_ms)} <span class="${c.in_range ? "ok" : "miss"}">${c.error_pct > 0 ? "+" : ""}${c.error_pct.toFixed(2)}%</span>` : "—";
  el.innerHTML = `<div class="table-scroll"><table><thead><tr><th>${tr("Event")}</th><th class="num">${tr("Actual gold")}</th>
      <th class="num">${tr("Predicted day 1")}</th><th class="num">${tr("Day 3")}</th><th class="num">${tr("Day 7")}</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td><a href="#past/${r.event_id}" translate="no">${esc(r.track)}</a></td><td class="num">${fmt(r.actual_gold_ms)}</td>
        <td class="num">${cell(r.predictions[1])}</td><td class="num">${cell(r.predictions[3])}</td>
        <td class="num">${cell(r.predictions[7])}</td></tr>`).join("")}
      </tbody></table></div>
    <p class="hint">${tr("Green means the actual gold time landed inside the predicted range.")}</p>`;
}

function renderPast() {
  const list = document.getElementById("past-list");
  const more = document.getElementById("past-more");
  let shown = PAGE, query = "";
  const draw = () => {
    const q = query.trim().toLowerCase();
    const rows = DATA.past.filter(p => !q || [p.track, p.car, p.wr_holder].some(s => String(s).toLowerCase().includes(q)));
    list.innerHTML = rows.slice(0, shown).map(p => `<tr>
        <td class="date" data-label="${tr("Start")}">${p.start}</td>
        <td class="track" data-label="${tr("Track")}"><a href="#past/${p.event_id}" translate="no">${esc(p.track)}</a><div class="sub-car" translate="no">${esc(p.car)}</div></td>
        <td class="num" data-label="${tr("Entrants")}">${num(p.entrants)}</td>
        <td class="num" data-label="${tr("Record")}">${fmt(p.wr_ms)}<div class="sub-car" translate="no">${esc(p.wr_holder)}</div></td>
        <td class="num" data-label="${tr("Gold")}">${fmt(p.gold_ms)}</td>
        <td class="num" data-label="${tr("Difficulty")}">${difficulty(p.top100_spread_pct)}<div class="sub-car">${p.top100_spread_pct.toFixed(2)}%</div></td></tr>`).join("");
    more.hidden = rows.length <= shown;
    more.textContent = tr("Show more ({n} left)", { n: rows.length - shown });
  };
  document.getElementById("past-filter").addEventListener("input", ev => { query = ev.target.value; shown = PAGE; draw(); });
  more.addEventListener("click", () => { shown += PAGE; draw(); });
  draw();
}

// World record over a finished event, on the same fixed window as the current-event charts.
function recordChart(d, width) {
  const total = d.days, steps = d.wr_steps, preds = d.predictions;
  const W = Math.max(300, Math.round(width)), H = W < 500 ? 190 : 230, L = 52, R = 14, T = 14, B = 28;
  const need = [d.wr_ms, ...preds.map(r => r.final_wr_ms)];
  let span = Math.max(2000, 0.015 * d.wr_ms);
  const margin = 0.1 * span;
  const needLo = Math.min(...need), needHi = Math.max(...need);
  span = Math.max(span, needHi - needLo + 2 * margin);
  const lo = needLo - margin, hi = lo + span;
  const x = v => L + (Math.min(Math.max(v, 0), total) / total) * (W - L - R);
  const y = v => T + ((hi - Math.min(Math.max(v, lo), hi)) / span) * (H - T - B);
  let path = "";
  steps.forEach((s, i) => {
    path += i ? `H${x(s.day).toFixed(1)}V${y(s.wr_ms).toFixed(1)}` : `M${x(s.day).toFixed(1)},${y(s.wr_ms).toFixed(1)}`;
  });
  path += `H${x(total).toFixed(1)}`;
  const predLine = preds.map((r, i) => `${i ? "L" : "M"}${x(r.day).toFixed(1)},${y(r.final_wr_ms).toFixed(1)}`).join("");
  return `<figure class="chart"><svg viewBox="0 0 ${W} ${H}" height="${H}" role="img"
      aria-label="${tr("World record over the event")}">
      ${axes(lo, hi, span, total, x, y, { W, H, L, R, B })}
      ${steps.some(s => s.wr_ms > hi) ? `<text x="${L + 6}" y="${T + 10}" class="offscale">${tr("↑ earlier times off scale")}</text>` : ""}
      <path d="${path}" class="gold-day"/>
      ${steps.map(s => `<circle class="wr-dot" cx="${x(s.day).toFixed(1)}" cy="${y(s.wr_ms).toFixed(1)}" r="2.5"/>`).join("")}
      ${predLine ? `<path d="${predLine}" class="pred"/>` : ""}
      ${preds.map(r => `<circle class="pred-dot" cx="${x(r.day).toFixed(1)}" cy="${y(r.final_wr_ms).toFixed(1)}" r="3"/>`).join("")}
    </svg>
    <figcaption class="legend"><span><i class="k-day"></i>${tr("World record")}</span>
      ${preds.length ? `<span><i class="k-pred"></i>${tr("Predicted final record on the day")}</span>` : ""}
      <span>${tr("Lower is faster · day of event along the bottom")}</span></figcaption></figure>`;
}

const dayOf = day => Math.max(0, day).toFixed(1);
const dateRange = (a, b) => {
  const o = { day: "numeric", month: "short", year: "numeric" };
  return `${new Date(a).toLocaleDateString(I18N.locale, o)} – ${new Date(b).toLocaleDateString(I18N.locale, o)}`;
};

function renderEvent(d) {
  const el = document.getElementById("event-detail");
  const top10 = d.top10.map(r => `<tr><td class="num">${r.rank}</td>
      <td class="name" translate="no">${esc(r.name)}<div class="sub-car">${[r.country, d.multi_car && r.car].filter(Boolean).map(esc).join(" · ")}</div></td>
      <td class="num">${fmt(r.ms)}</td>
      <td class="num">${r.rank === 1 ? "—" : "+" + ((r.ms - d.wr_ms) / 1000).toFixed(3)}</td></tr>`).join("");
  const progression = d.wr_steps.slice().reverse().map((s, i, a) => `<tr><td class="num">${dayOf(s.day)}</td>
      <td class="num">${fmt(s.wr_ms)}</td><td class="name" translate="no">${esc(s.holder)}</td>
      <td class="num">${a[i + 1] ? "−" + ((a[i + 1].wr_ms - s.wr_ms) / 1000).toFixed(3) : "—"}</td></tr>`).join("");
  el.innerHTML = `<article class="event">
      <div class="event-head">
        <div><h2>${gameName(d.track)}${d.regular_event ? "" : `<span class="tag">${tr("special event")}</span>`}</h2>
          <div class="meta">${gameName(d.car)}${d.multi_car ? " " + tr("and others") : ""}</div></div>
        <a class="official" href="${d.leaderboard_url}" target="_blank" rel="noopener">${tr("Official leaderboard ↗")}</a>
      </div>
      <div class="meta">${dateRange(d.starts, d.ends)} · ${tr("{n} days · finished", { n: d.days })}</div>
      <table class="targets"><thead><tr><th></th><th class="num">${tr("Final time")}</th></tr></thead><tbody>
        ${MEDALS.map(([name, f, cls]) => `<tr><th class="medal ${cls}">${name}</th>
          <td class="num">${fmt(medalTime(d.wr_ms, f))}</td></tr>`).join("")}
      </tbody></table>
      <p class="hint">${tr("The medal times when the event closed: the final world record + 3%, 5% and 10%.")}</p>
      <div class="stats">
        ${stat(tr("World record"), fmt(d.wr_ms), gameName(d.wr_holder))}
        ${stat(tr("Entrants"), num(d.entrants), DATA ? tr("median for past events {n}", { n: num(DATA.median_entrants) }) : "")}
        ${stat(tr("Course difficulty"), difficulty(d.top100_spread_pct), tr("100th place {pct}% behind the record", { pct: d.top100_spread_pct.toFixed(2) }))}
        ${stat(tr("100th place"), fmt(d.p100_ms), "+" + secs(d.p100_ms - d.wr_ms))}
      </div>
      <h3>${tr("How the world record fell")}</h3>
      <div class="record-chart"></div>
      <p class="hint">${tr(`Rebuilt from when each final top-100 lap was set. Only each driver's best lap is kept, so a record
        that driver later beat themselves doesn't show.`)}</p>
    </article>
    <h2 class="section">${tr("Record progression")}</h2>
    <div class="table-scroll"><table class="compact"><thead><tr><th class="num">${tr("Day")}</th><th class="num">${tr("Record")}</th>
      <th>${tr("Driver")}</th><th class="num">${tr("Gain (s)")}</th></tr></thead>
      <tbody>${progression}</tbody></table></div>
    <h2 class="section">${tr("Top 10")}</h2>
    <div class="table-scroll"><table class="compact"><thead><tr><th class="num">#</th><th>${tr("Driver")}</th>
      <th class="num">${tr("Time")}</th><th class="num">${tr("Gap (s)")}</th></tr></thead>
      <tbody>${top10}</tbody></table></div>`;
  drawRecordChart();
}

function drawRecordChart() {
  const box = document.querySelector("#event-detail .record-chart");
  if (box && shownEvent) box.innerHTML = recordChart(shownEvent, box.clientWidth);
}

function showEvent(id) {
  window.scrollTo(0, 0);
  if (shownEvent && String(shownEvent.event_id) === id) {
    document.title = `${shownEvent.track} · ${TITLE}`;
    return;
  }
  const el = document.getElementById("event-detail");
  el.innerHTML = `<p class="muted">${tr("Loading…")}</p>`;
  shownEvent = null;
  fetch(`events/${encodeURIComponent(id)}.json`)
    .then(r => (r.ok ? r.json() : Promise.reject()))
    .then(d => {
      if (location.hash !== `#past/${id}`) return; // moved on while loading
      shownEvent = d;
      renderEvent(d);
      document.title = `${d.track} · ${TITLE}`;
    })
    .catch(() => { el.innerHTML = `<p class="muted">${tr("Could not load this event.")}</p>`; });
}

function renderDrivers() {
  document.querySelector("#driver-table tbody").innerHTML = DATA.drivers.map((d, i) =>
    `<tr><td class="num">${i + 1}</td><td translate="no">${esc(d.name)}${d.tracked ? " ★" : ""}</td><td>${esc(d.country || "")}</td>
      <td class="num">${d.events}</td><td class="num">${d.median_gap_pct.toFixed(2)}%</td>
      <td class="num">${d.wins}</td><td class="num">${d.top10}</td></tr>`).join("");
}

let resizeTimer;
fetch("data.json")
  .then(r => r.json())
  .then(data => {
    DATA = data;
    SPREADS = data.past.map(p => p.top100_spread_pct).sort((a, b) => a - b);
    renderCurrent();
    renderScorecard();
    renderPast();
    renderDrivers();
    fetch("daily.json").then(r => r.json()).then(d => { DAILY = d; renderDaily(); })
      .catch(() => { document.getElementById("daily-list").innerHTML = `<p class="muted">${tr("Could not load the daily races.")}</p>`; });
    fetch("license.json").then(r => r.json()).then(d => { LICENSE = d; renderLicense(); })
      .catch(() => { document.getElementById("license-list").innerHTML = `<p class="muted">${tr("Could not load the tests.")}</p>`; });
    if (shownEvent) renderEvent(shownEvent); // opened by a direct link before data.json arrived
    let lastWidth = window.innerWidth;
    window.addEventListener("resize", () => {
      if (window.innerWidth === lastWidth) return; // e.g. the on-screen keyboard opening
      lastWidth = window.innerWidth;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { redrawCharts(); drawRecordChart(); }, 150);
    });
    document.getElementById("n-history").textContent = data.history_events;
    document.getElementById("footer").innerHTML = tr("Last updated {when}. Times are shown in your time zone. {n} past events.",
      { when: localTime(data.generated_at), n: data.history_events }) + ` <a href="privacy.html">${tr("Privacy")}</a>`;
  })
  .catch(() => {
    document.getElementById("current-list").innerHTML = `<p class="muted">${tr("Could not load data.")}</p>`;
  });
