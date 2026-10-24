const fmt = ms => {
  const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000), r = ms % 1000;
  return `${m}:${String(s).padStart(2, "0")}.${String(r).padStart(3, "0")}`;
};
const num = n => n.toLocaleString("en-AU");
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const dateAU = iso => new Date(iso).toLocaleString("en-AU", {
  weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Australia/Melbourne",
});

function showTab(name) {
  document.querySelectorAll(".tab").forEach(t => (t.hidden = t.id !== `tab-${name}`));
  document.querySelectorAll("nav a").forEach(a => a.classList.toggle("active", a.dataset.tab === name));
}
window.addEventListener("hashchange", () => showTab(location.hash.slice(1) || "current"));
showTab(location.hash.slice(1) || "current");

function stat(label, value, note, key) {
  return `<div class="stat${key ? " key" : ""}"><div class="label">${label}</div>
    <div class="value">${value}</div>${note ? `<div class="note">${note}</div>` : ""}</div>`;
}

function chart(e) {
  const rows = e.history.filter(r => r.gold_now_ms);
  if (!rows.length) return "";
  const total = e.days_elapsed + e.days_left;
  const W = 640, H = 200, L = 64, R = 12, T = 12, B = 26;
  const vals = rows.flatMap(r => [r.gold_now_ms, r.gold_fast_ms, r.gold_slow_ms].filter(Boolean));
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = Math.max((hi - lo) * 0.15, 150);
  lo -= pad; hi += pad;
  const x = d => L + (d / total) * (W - L - R);
  const y = v => T + ((v - lo) / (hi - lo)) * (H - T - B); // faster (lower) times at the top
  const line = (key) => rows.filter(r => r[key]).map((r, i) => `${i ? "L" : "M"}${x(r.day).toFixed(1)},${y(r[key]).toFixed(1)}`).join("");
  const band = rows.filter(r => r.gold_fast_ms);
  const bandPath = band.length
    ? "M" + band.map(r => `${x(r.day).toFixed(1)},${y(r.gold_fast_ms).toFixed(1)}`).join("L")
      + "L" + band.slice().reverse().map(r => `${x(r.day).toFixed(1)},${y(r.gold_slow_ms).toFixed(1)}`).join("L") + "Z"
    : "";
  const dots = key => rows.filter(r => r[key]).map(r => `<circle cx="${x(r.day).toFixed(1)}" cy="${y(r[key]).toFixed(1)}" r="3"/>`).join("");
  const ticks = [lo + pad, (lo + hi) / 2, hi - pad].map(v =>
    `<text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${fmt(Math.round(v))}</text>`).join("");
  const days = [...Array(Math.floor(total) + 1).keys()].filter(d => d % 2 === 0).map(d =>
    `<text x="${x(d)}" y="${H - 8}" text-anchor="middle">${d}</text>`).join("");
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Gold time by day of event">
      <line class="axis" x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/>
      ${ticks}${days}
      ${bandPath ? `<path d="${bandPath}" fill="var(--gold-band)"/>` : ""}
      <path d="${line("gold_now_ms")}" fill="none" stroke="var(--wr)" stroke-width="2"/>
      <g fill="var(--wr)">${dots("gold_now_ms")}</g>
      <path d="${line("gold_ms")}" fill="none" stroke="var(--gold)" stroke-width="2" stroke-dasharray="5 4"/>
      <g fill="var(--gold)">${dots("gold_ms")}</g>
    </svg>
    <div class="legend"><span><i style="background:var(--wr)"></i>Gold time on the day</span>
      <span><i style="background:var(--gold)"></i>Predicted final gold</span>
      <span><i style="background:var(--gold-band);height:8px"></i>Likely range</span>
      <span>Day of event →</span></div></div>`;
}

function renderCurrent(data) {
  const el = document.getElementById("current-list");
  if (!data.current.length) {
    el.innerHTML = `<p class="muted">No time trials are running right now.</p>`;
    return;
  }
  el.innerHTML = data.current.map(e => {
    const total = e.days_elapsed + e.days_left;
    const p = e.predicted;
    const pr = e.entrants_projection, h = data.historical_entrants;
    const entrantsNote = pr ? `projected final ${num(pr.projected)}`
      : h ? `past events finish with ${num(h.p10)}–${num(h.p90)}` : "";
    return `<article class="event">
      <h2>${esc(e.track)}${e.regular_event ? "" : '<span class="tag">special event</span>'}</h2>
      <div class="meta">${esc(e.car)} · ends ${dateAU(e.ends)} · day ${e.days_elapsed.toFixed(1)} of ${Math.round(total)}</div>
      <div class="progress"><div style="width:${Math.min(100, (100 * e.days_elapsed) / total)}%"></div></div>
      <div class="stats">
        ${p ? stat("Predicted final gold", fmt(p.gold_ms), `likely ${fmt(p.gold_fast_ms)} – ${fmt(p.gold_slow_ms)}`, true)
            : stat("Predicted final gold", "—", "not enough history yet", true)}
        ${stat("Gold now", fmt(e.gold_now_ms), "world record + 3%")}
        ${stat("World record", fmt(e.wr_ms), esc(e.wr_holder))}
        ${stat("Entrants", num(e.entrants), entrantsNote)}
        ${stat("Top-100 spread", e.top100_spread_pct.toFixed(2) + "%", "P100 behind the WR")}
        ${stat("Top drivers in", `${e.strong_drivers_posted.length} / ${e.strong_drivers_total}`,
               esc(e.strong_drivers_posted.slice(0, 4).join(", ")))}
      </div>
      ${chart(e)}
    </article>`;
  }).join("");
}

function renderPast(data) {
  const body = document.querySelector("#past-table tbody");
  const draw = q => {
    q = q.trim().toLowerCase();
    body.innerHTML = data.past
      .filter(p => !q || [p.track, p.car, p.wr_holder].some(s => String(s).toLowerCase().includes(q)))
      .map(p => `<tr><td>${p.start}</td><td>${esc(p.track)}</td><td>${esc(p.car)}</td>
        <td class="num">${num(p.entrants)}</td><td class="num">${fmt(p.wr_ms)}</td><td>${esc(p.wr_holder)}</td>
        <td class="num">${fmt(p.gold_ms)}</td><td class="num">${p.top100_spread_pct.toFixed(2)}%</td></tr>`)
      .join("");
  };
  document.getElementById("past-filter").addEventListener("input", ev => draw(ev.target.value));
  draw("");
}

function renderDrivers(data) {
  document.querySelector("#driver-table tbody").innerHTML = data.drivers.map((d, i) =>
    `<tr><td class="num">${i + 1}</td><td>${esc(d.name)}${d.tracked ? " ★" : ""}</td><td>${esc(d.country || "")}</td>
      <td class="num">${d.events}</td><td class="num">${d.median_gap_pct.toFixed(2)}%</td>
      <td class="num">${d.wins}</td><td class="num">${d.top10}</td></tr>`).join("");
}

fetch("data.json")
  .then(r => r.json())
  .then(data => {
    renderCurrent(data);
    renderPast(data);
    renderDrivers(data);
    document.getElementById("n-history").textContent = data.history_events;
    document.getElementById("footer").textContent =
      `Last updated ${dateAU(data.generated_at)} (Melbourne time). ${data.history_events} past events.`;
  })
  .catch(() => {
    document.getElementById("current-list").innerHTML = `<p class="muted">Could not load data.</p>`;
  });
