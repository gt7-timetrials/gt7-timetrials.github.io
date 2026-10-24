const MEDALS = [["Gold", 1.03, "gold"], ["Silver", 1.05, "silver"], ["Bronze", 1.10, "bronze"]];
const PAGE = 25;

const fmt = ms => {
  const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000), r = Math.round(ms % 1000);
  return `${m}:${String(s).padStart(2, "0")}.${String(r).padStart(3, "0")}`;
};
const secs = ms => (ms / 1000).toFixed(3) + " s";
const num = n => n.toLocaleString();
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const medalTime = (wr, factor) => Math.floor(wr * factor); // as in the game: WR + 3% / 5% / 10%
const localTime = iso => new Date(iso).toLocaleString(undefined, {
  weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit",
});
function countdown(iso) {
  const ms = new Date(iso) - Date.now();
  if (ms <= 0) return "ended";
  const d = Math.floor(ms / 86400000), h = Math.floor((ms % 86400000) / 3600000);
  return d ? `${d}d ${h}h left` : `${h}h ${Math.floor((ms % 3600000) / 60000)}m left`;
}

// "1:53.4", "1.53.450", "113.4", "1:53:450" -> milliseconds
function parseLap(text) {
  const t = text.trim().replace(/,/g, ".");
  let m = t.match(/^(\d+)[:.](\d{1,2})[.:](\d{1,3})$/);
  if (m) return (+m[1] * 60 + +m[2]) * 1000 + +m[3].padEnd(3, "0");
  m = t.match(/^(\d+)(?:\.(\d{1,3}))?$/);
  if (m) return +m[1] * 1000 + +(m[2] || "0").padEnd(3, "0");
  return null;
}

function showTab(name) {
  document.querySelectorAll(".tab").forEach(t => (t.hidden = t.id !== `tab-${name}`));
  document.querySelectorAll("nav a").forEach(a => a.classList.toggle("active", a.dataset.tab === name));
}
window.addEventListener("hashchange", () => showTab(location.hash.slice(1) || "current"));
showTab(location.hash.slice(1) || "current");

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
      <thead><tr><th></th><th class="num">Today</th><th class="num">At finish</th>
        <th class="num">Safe target</th></tr></thead>
      <tbody>${rows}</tbody></table>
    <p class="hint">Medal times are the world record + 3% (gold), 5% (silver) and 10% (bronze), so they get harder as the
      record falls. "Safe target" beats the fast end of the predicted range, which 9 out of 10 past events stayed within.</p>`;
}

function checker(e, i) {
  return `<form class="checker" data-i="${i}" autocomplete="off">
      <label for="lap-${i}">Check my time</label>
      <div class="row"><input id="lap-${i}" inputmode="decimal" placeholder="e.g. 1:53.250">
        <button type="submit">Check</button></div>
      <div class="result" aria-live="polite"></div>
    </form>`;
}

function medalFor(lap, wr) {
  for (const [name, f] of MEDALS) if (lap <= medalTime(wr, f)) return name;
  return null;
}

function checkResult(e, lap) {
  const p = e.predicted;
  const now = medalFor(lap, e.wr_ms);
  const lines = [`<b>Today:</b> ${now ? `${now}` : "no medal yet"}` +
    (now !== "Gold" ? ` — ${nextGap(lap, e.wr_ms, now)}` : "")];
  if (p) {
    const atEnd = medalFor(lap, p.final_wr_ms), worst = medalFor(lap, p.final_wr_fast_ms);
    let verdict = `<b>At the finish (predicted):</b> ${atEnd || "no medal"}`;
    if (atEnd && worst === atEnd) verdict += ", and you should keep it.";
    else if (atEnd) verdict += `, but it could slip to ${worst ? worst.toLowerCase() : "no medal"} if the record drops a lot.`;
    lines.push(verdict);
    const target = worst === "Gold" ? null : MEDALS.find(([n]) => n === nextUp(worst));
    if (target) {
      const need = lap - medalTime(p.final_wr_fast_ms, target[1]);
      lines.push(`To be safe for ${target[0].toLowerCase()}, find <b>${secs(need)}</b> (aim for ${fmt(medalTime(p.final_wr_fast_ms, target[1]))}).`);
    }
  }
  return lines.map(l => `<div>${l}</div>`).join("");
}
const nextUp = medal => ({ null: "Bronze", Bronze: "Silver", Silver: "Gold", Gold: "Gold" })[medal];
function nextGap(lap, wr, medal) {
  const [name, f] = MEDALS.find(([n]) => n === nextUp(medal));
  return `${secs(lap - medalTime(wr, f))} off ${name.toLowerCase()}`;
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
  const y = v => T + ((Math.min(Math.max(v, lo), hi) - lo) / span) * (H - T - B); // faster at the top, clipped
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
  // gridlines as gaps from today's gold time
  const step = span <= 3000 ? 500 : span <= 6000 ? 1000 : 2000;
  const yTicks = [];
  for (let k = Math.ceil((lo - e.gold_now_ms) / step); e.gold_now_ms + k * step <= hi; k++) {
    const v = e.gold_now_ms + k * step;
    const label = k === 0 ? "today" : `${k < 0 ? "−" : "+"}${(Math.abs(k * step) / 1000).toFixed(1)} s`;
    yTicks.push(`<line class="grid${k === 0 ? " zero" : ""}" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>
     <text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${label}</text>`);
  }
  const xTicks = [...Array(Math.floor(total) + 1).keys()].filter(d => d % 2 === 0).map(d =>
    `<text x="${x(d)}" y="${H - 9}" text-anchor="middle">${d}</text>`).join("");
  return `<figure class="chart"><svg viewBox="0 0 ${W} ${H}" height="${H}" role="img"
      aria-label="Gold time over the event and predicted final gold">
      ${yTicks.join("")}${xTicks}
      ${offScale ? `<text x="${L + 6}" y="${H - B - 6}" class="offscale">↓ earlier times off scale</text>` : ""}
      <line class="now" x1="${x(e.days_elapsed)}" x2="${x(e.days_elapsed)}" y1="${T}" y2="${H - B}"/>
      ${band ? `<path d="${band}" class="band"/>` : ""}
      <path d="${path}" class="gold-day"/>
      ${predLine ? `<path d="${predLine}" class="pred"/>` : ""}
      ${preds.map(r => `<circle class="pred-dot" cx="${x(r.day).toFixed(1)}" cy="${y(r.gold_ms).toFixed(1)}" r="3"/>`).join("")}
      ${endBar}
    </svg>
    <figcaption class="legend"><span><i class="k-day"></i>Gold time on the day</span>
      <span><i class="k-pred"></i>Predicted final gold (and likely range)</span>
      <span>Gap to today's gold · faster at the top · day of event along the bottom</span></figcaption></figure>`;
}

let DATA;
function renderCurrent() {
  const el = document.getElementById("current-list");
  if (!DATA.current.length) {
    el.innerHTML = `<p class="muted">No time trials are running right now.</p>`;
    return;
  }
  el.innerHTML = DATA.current.map((e, i) => {
    const total = e.days_elapsed + e.days_left;
    const p = e.predicted;
    const pr = e.entrants_projection, h = DATA.historical_entrants;
    const entrantsNote = pr ? `projected final ${num(pr.projected)}`
      : h ? `past events finished with ${num(h.p10)}–${num(h.p90)}` : "";
    const headline = p
      ? `<div class="headline"><div class="label">Gold target at the finish</div>
          <div class="big">${fmt(p.gold_ms)}</div>
          <div>Aim for <b>${fmt(p.gold_fast_ms)}</b> to be safe · gold today is ${fmt(e.gold_now_ms)}</div></div>`
      : `<div class="headline"><div class="label">Gold today</div><div class="big">${fmt(e.gold_now_ms)}</div>
          <div>Not enough history yet to predict the finish.</div></div>`;
    return `<article class="event">
      <div class="event-head">
        <div><h2>${esc(e.track)}${e.regular_event ? "" : '<span class="tag">special event</span>'}</h2>
          <div class="meta">${esc(e.car)}</div></div>
        <a class="official" href="${e.leaderboard_url}" target="_blank" rel="noopener">Official leaderboard ↗</a>
      </div>
      <div class="meta">${countdown(e.ends)} · ends ${localTime(e.ends)} · day ${e.days_elapsed.toFixed(1)} of ${Math.round(total)}</div>
      <div class="progress"><div style="width:${Math.min(100, (100 * e.days_elapsed) / total)}%"></div></div>
      <div class="top-grid">${headline}<div>${checker(e, i)}</div></div>
      ${targets(e)}
      <div class="stats">
        ${stat("World record", fmt(e.wr_ms), esc(e.wr_holder))}
        ${stat("Entrants so far", num(e.entrants), entrantsNote)}
        ${stat("Course difficulty", e.top100_spread_pct.toFixed(2) + "%", "100th place behind the record")}
        ${stat("Top-rated drivers who've set a time", `${e.strong_drivers_posted.length} of ${e.strong_drivers_total}`,
               "fewer means more time likely to come off")}
      </div>
      ${chart(e)}
    </article>`;
  }).join("");
  el.querySelectorAll("form.checker").forEach(f => f.addEventListener("submit", ev => {
    ev.preventDefault();
    const e = DATA.current[+f.dataset.i];
    const lap = parseLap(f.querySelector("input").value);
    f.querySelector(".result").innerHTML = lap
      ? checkResult(e, lap) : `<div class="muted">Enter a lap time like 1:53.250</div>`;
  }));
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
    el.innerHTML = `<p class="muted">Predictions started on 24 Oct 2026. The first results will appear here after the
      current events finish${next ? ` (first one ${localTime(next)})` : ""}.</p>`;
    return;
  }
  const cell = c => c ? `${fmt(c.gold_ms)} <span class="${c.in_range ? "ok" : "miss"}">${c.error_pct > 0 ? "+" : ""}${c.error_pct.toFixed(2)}%</span>` : "—";
  el.innerHTML = `<div class="table-scroll"><table><thead><tr><th>Event</th><th class="num">Actual gold</th>
      <th class="num">Predicted day 1</th><th class="num">Day 3</th><th class="num">Day 7</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td>${esc(r.track)}</td><td class="num">${fmt(r.actual_gold_ms)}</td>
        <td class="num">${cell(r.predictions[1])}</td><td class="num">${cell(r.predictions[3])}</td>
        <td class="num">${cell(r.predictions[7])}</td></tr>`).join("")}
      </tbody></table></div>
    <p class="hint">Green means the actual gold time landed inside the predicted range.</p>`;
}

function renderPast() {
  const list = document.getElementById("past-list");
  const more = document.getElementById("past-more");
  let shown = PAGE, query = "";
  const draw = () => {
    const q = query.trim().toLowerCase();
    const rows = DATA.past.filter(p => !q || [p.track, p.car, p.wr_holder].some(s => String(s).toLowerCase().includes(q)));
    list.innerHTML = rows.slice(0, shown).map(p => `<tr>
        <td class="date" data-label="Start">${p.start}</td>
        <td class="track" data-label="Track">${esc(p.track)}<div class="sub-car">${esc(p.car)}</div></td>
        <td class="num" data-label="Entrants">${num(p.entrants)}</td>
        <td class="num" data-label="Record">${fmt(p.wr_ms)}<div class="sub-car">${esc(p.wr_holder)}</div></td>
        <td class="num" data-label="Gold">${fmt(p.gold_ms)}</td>
        <td class="num" data-label="Difficulty">${p.top100_spread_pct.toFixed(2)}%</td></tr>`).join("");
    more.hidden = rows.length <= shown;
    more.textContent = `Show more (${rows.length - shown} left)`;
  };
  document.getElementById("past-filter").addEventListener("input", ev => { query = ev.target.value; shown = PAGE; draw(); });
  more.addEventListener("click", () => { shown += PAGE; draw(); });
  draw();
}

function renderDrivers() {
  document.querySelector("#driver-table tbody").innerHTML = DATA.drivers.map((d, i) =>
    `<tr><td class="num">${i + 1}</td><td>${esc(d.name)}${d.tracked ? " ★" : ""}</td><td>${esc(d.country || "")}</td>
      <td class="num">${d.events}</td><td class="num">${d.median_gap_pct.toFixed(2)}%</td>
      <td class="num">${d.wins}</td><td class="num">${d.top10}</td></tr>`).join("");
}

let resizeTimer;
fetch("data.json")
  .then(r => r.json())
  .then(data => {
    DATA = data;
    renderCurrent();
    renderScorecard();
    renderPast();
    renderDrivers();
    let lastWidth = window.innerWidth;
    window.addEventListener("resize", () => {
      if (window.innerWidth === lastWidth) return; // e.g. the on-screen keyboard opening
      lastWidth = window.innerWidth;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(redrawCharts, 150);
    });
    document.getElementById("n-history").textContent = data.history_events;
    document.getElementById("footer").textContent =
      `Last updated ${localTime(data.generated_at)}. Times are shown in your time zone. ${data.history_events} past events.`;
  })
  .catch(() => {
    document.getElementById("current-list").innerHTML = `<p class="muted">Could not load data.</p>`;
  });
