// The website's screens in a phone-sized browser (Playwright): as a visitor; in the earlier apps (the app on main,
// which testers have once its .aab is on Google Play, and the first Play release), which must keep working with this
// website; and in this checkout's app, with audio cues. The apps are stand-ins for window.GT7App that record what
// the page asks of them. Run by tests/test_gt7tt.py (UiTest), which builds the site and serves it, and reads each
// app's bridge methods (name -> numbers of arguments) from its Java code:
//   node tests/test_ui.js <site url> <S-1 recording.csv> <4-lap S-1 recording.csv> <apps.json>
//   apps.json: { main, mainFrom, first, current }
const { chromium, devices } = require("playwright");
const assert = require("assert");
const fs = require("fs");
const { keysInCode, nonLiteralCalls, keysOnPage } = require("./i18n_keys.js");
const ES = require("../site/lang/es.js");

const [url, s1File, multiFile, appsJson] = process.argv.slice(2);
const s1 = fs.readFileSync(s1File, "utf8");
const APPS = JSON.parse(appsJson);

// window.GT7App with exactly an earlier app's bridge methods, each recording its call; cueState answers like the app
// (audio cues off), so an earlier app that has audio cues gets the checkbox and tab, unticked
function earlierApp({ methods, csv }) {
  window.__calls = [];
  const app = {};
  const state = JSON.stringify({ settings: {}, enabled: false, outputs: [], current: { key: "speaker", name: "Phone speaker", delay: 0 } });
  const answers = { version: () => "test", csv: () => csv, save: (c, name) => name, cueState: () => state };
  for (const name of Object.keys(methods)) {
    app[name] = (...a) => {
      window.__calls.push([name, ...a.filter(x => typeof x !== "string" || x.length < 200)]);
      return answers[name] ? answers[name](...a) : undefined;
    };
  }
  window.GT7App = app;
}

// window.GT7App as this checkout's app has it, with audio cues
function standIn({ withCues, csv }) {
  window.__calls = [];
  const call = (...a) => window.__calls.push(a);
  const app = { version: () => "test", start: ip => call("start", ip), stop: () => call("stop"), csv: () => csv,
    save: (c, name) => { call("save", name); return name; } };
  if (withCues) {
    const state = { settings: {}, enabled: false, outputs: [{ key: "speaker", name: "Phone speaker", type: "speaker",
      delay: 0, calibrated: false, current: true, start: 0 }], current: { key: "speaker", name: "Phone speaker", delay: 0 } };
    Object.assign(app, {
      cueState: () => JSON.stringify(state),
      saveCues: json => { call("saveCues", json); const c = JSON.parse(json); if ("enabled" in c) state.enabled = c.enabled;
        if (c.settings) state.settings = c.settings; },
      testSound: kind => call("testSound", kind),
      startWithCues: (ip, cues) => call("startWithCues", ip, cues),
      calibrate: ip => call("calibrate", ip),
    });
  }
  window.GT7App = app;
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const page = async (app, withRaces = false) => {
    const ctx = await browser.newContext({ ...devices["iPhone 13"] });
    if (withRaces) await races(ctx);
    if (app === "cues") await ctx.addInitScript(standIn, { withCues: true, csv: s1 });
    else if (app) await ctx.addInitScript(earlierApp, { methods: APPS[app], csv: s1 });
    const p = await ctx.newPage();
    p.on("pageerror", e => errors.push(`${app || "website"}: ${e.message}`));
    await p.goto(url + "#license");
    await p.waitForSelector(".license-file", { state: "attached" });
    return p;
  };
  const calls = p => p.evaluate(() => window.__calls);
  const coach = p => p.locator("#license-list .coach").first(); // Super License S-1
  const event = (p, ev) => p.evaluate(e => window.GT7AppEvent(e), ev);
  // a time trial with a reference lap (the first current event, given S-1's gold run in another car, as a free car
  // choice) and the daily races: race A with a reference lap, race B without one yet
  const races = async (ctx, free = true) => {
    await ctx.route("**/data.json", async route => {
      const data = await (await route.fetch()).json();
      Object.assign(data.current[0], { free_choice: free,
        reference: { lap_ms: 71809, driver: "Someone", url: "test-reference.json" } });
      await route.fulfill({ json: data });
    });
    await ctx.route("**/test-reference.json", async route => {
      const ref = await (await ctx.request.get(url + "license/S-1.json")).json();
      await route.fulfill({ json: { ...ref, car_code: ref.car_code + 1 } });
    });
    await ctx.route("**/daily.json", route => route.fulfill({ json: { races: [
      { id: "A", track: "High Speed Ring", car: "Gr.3", free_choice: true,
        reference: { lap_ms: 71809, url: "license/S-1.json", key: "daily-A", driver: "Fast_One", car: "Some car" } },
      { id: "B", track: "Monza", car: "Mazda Roadster", reference: null }] } }));
    // a Circuit Experience (the full lap, with medal times), given S-1's gold run as GT7's demonstration
    await ctx.route("**/circuits.json", route => route.fulfill({ json: { circuits: [
      { id: "high-speed-ring", track: "High Speed Ring", car: "Gr.4", gold: 73000, silver: 75200, bronze: 80700,
        reference: { lap_ms: 71809, url: "license/S-1.json", key: "circuit-high-speed-ring" } }] } }));
  };
  // Record on this phone on a card: the app is asked to start, a lap comes in, Stop and compare shows the comparison
  const recordLap = async (p, card, label, start = ["start", ""]) => {
    await card.locator(".record-btn").click();
    assert.deepStrictEqual((await calls(p)).at(-1), start, `${label}: recording started`);
    await event(p, { type: "connected", ip: "192.168.0.23" });
    await event(p, { type: "state", state: "driving" });
    await event(p, { type: "lap", lap: 1, ms: 78521, time: "1:18.521", replay: false, dropout: false });
    assert.match(await card.locator(".rec-laps").innerText(), /1:18\.521/, `${label}: the lap is listed`);
    await card.locator(".rec-stop").click();
    await card.locator(".coach-summary").waitFor();
    assert.match(await card.locator(".coach-summary").innerText(), /Your lap 1:18\.521/, `${label}: compared`);
    // against this card's event: a time trial's map key is gold pace, the others' the reference (the references are
    // the same lap here)
    assert.strictEqual(/within 3% of the reference/.test(await card.locator(".map-box .legend").innerText()), !label.endsWith("time trial"),
      `${label}: compared for this card's event`);
  };

  // 1. a visitor (no app): upload a recording; no recording or audio cue controls
  {
    const p = await page(null);
    assert.strictEqual(await p.locator(".record-btn").count(), 0, "website: no Record on this phone");
    assert.strictEqual(await p.locator(".cue-toggle").count(), 0, "website: no audio cues checkbox");
    assert.ok(await p.locator('nav a[data-tab="cues"]').isHidden(), "website: no Audio cues tab");
    await p.locator('input.license-file[data-i="0"]').setInputFiles(s1File);
    await coach(p).locator(".coach-summary").waitFor();
    assert.match(await coach(p).locator(".coach-summary").innerText(), /Your lap 1:18\.521/);
    assert.strictEqual(await coach(p).locator(".across").count(), 0, "one lap: no across-your-laps box");
    assert.match(await coach(p).locator(".themes").innerText(), /Where your time goes[\s\S]*Braking\s+[+−]\d/, "the lap's time by theme");
    // a corner's number opens the corner, with tips; a tap anywhere else on the track zooms in there, without tips
    const tapTrack = async f => {
      await coach(p).locator(".trackmap").scrollIntoViewIfNeeded();
      const [x, y] = await coach(p).locator(".trackmap").evaluate((svg, f) => {
        const base = svg.querySelector(".base"), pt = base.getPointAtLength(base.getTotalLength() * f);
        const s = new DOMPoint(pt.x, pt.y).matrixTransform(svg.getScreenCTM());
        return [s.x, s.y];
      }, f);
      await p.mouse.click(x, y);
    };
    await tapTrack(0.3);
    await coach(p).locator(".spot-head").waitFor();
    assert.match(await coach(p).locator(".spot-head").innerText(), /Track from \d+ to \d+ m[\s\S]*in corner \d+'s section/, "a stretch of track");
    assert.strictEqual(await coach(p).locator(".detail-body .tips").count(), 0, "no tips on a stretch");
    assert.ok(await coach(p).locator(".detail-body .corner-lines").count() && await coach(p).locator(".detail-body .pedal-chart").count(), "its line and charts");
    assert.strictEqual(await coach(p).locator(".trackmap .spot-pin").count(), 1, "a pin where it was tapped");
    const first = await coach(p).locator(".spot-head b").innerText();
    await coach(p).locator('.corner-detail [data-step="1"]').click();
    assert.notStrictEqual(await coach(p).locator(".spot-head b").innerText(), first, "Next moves along the track");
    await coach(p).locator('.trackmap .label[data-n="1"]').click();
    assert.match(await coach(p).locator(".corner-head").innerText(), /Corner 1/, "a corner's number opens the corner");
    assert.strictEqual(await coach(p).locator(".trackmap .spot-pin").count(), 0, "and the pin goes");
    // the first comparison explains itself until "Got it"; the next one doesn't
    assert.match(await coach(p).locator(".guide").innerText(), /How to read this/);
    await coach(p).locator(".guide-ok").click();
    assert.strictEqual(await p.locator(".guide").count(), 0, "Got it hides the guide");
    await p.locator('input.license-file[data-i="0"]').setInputFiles(s1File);
    await coach(p).locator(".coach-summary").waitFor();
    assert.strictEqual(await p.locator(".guide").count(), 0, "and it stays hidden");
    // the website's own wording: the recorder link, no app notes
    assert.ok(await p.locator("#tab-license .license-intro .web-only").isVisible(), "website: the recorder link");
    assert.ok(await p.locator("#tab-license .license-intro .app-only").isHidden(), "website: no app wording");
    await p.goto(url + "#howto");
    assert.match(await p.locator("#howto-guide").innerText(), /The map/, "How to use: how to read the comparison");
    // Circuit Experience: none recorded in the data yet, so it says they're coming (with one: see the apps below)
    await p.goto(url + "#circuits");
    if (!(await p.evaluate(() => fetch("circuits.json").then(r => r.json()))).circuits.length)
      await p.locator("#circuit-list", { hasText: "coming soon" }).waitFor();
    await p.goto(url + "#current");
    await p.locator("#current-list .stat").first().waitFor();
    assert.strictEqual(await p.locator("form.checker").count(), 0, "no Check my time");
    const rating = await p.locator('#current-list .stat:has(.label:text("Course difficulty")) .value').allInnerTexts();
    const days = await p.evaluate(() => fetch("data.json").then(r => r.json()).then(d => d.current.map(e => e.days_elapsed)));
    assert.ok(rating.length && rating.every((r, i) => (days[i] < 2 ? r === "TBD" : ["Easy", "Medium", "Hard", "V.hard"].includes(r))),
      `difficulty ratings: ${rating}, TBD before day 2 (days ${days})`);
    await p.context().close();
  }

  // 1b. languages: every text has a Spanish translation and none is left over; a Spanish phone gets Spanish
  // (Automatic), and the Settings tab switches language
  {
    const p = await page(null);
    assert.deepStrictEqual(nonLiteralCalls(), [], "tr() always starts with a plain string, so the texts can be listed");
    const keys = new Set([...keysInCode(), ...(await p.evaluate(`(${keysOnPage})()`))]);
    assert.deepStrictEqual([...keys].filter(k => !(k in ES)), [], "texts without a Spanish translation (site/lang/es.js)");
    assert.deepStrictEqual(Object.keys(ES).filter(k => !keys.has(k)), [], "Spanish translations of texts no longer used");
    // the other languages match the Spanish text for text (tests/lang_check.js, run by test_coach.js), and each is
    // loaded by the page and offered in Settings
    const files = require("./lang_check.js").languages();
    assert.deepStrictEqual((await p.evaluate(() => Object.keys(I18N.LANGS))).sort(), ["en", ...files].sort(), "every site/lang file is loaded");
    assert.strictEqual(await p.locator('nav a[data-tab="settings"]').innerText(), "Settings");
    await p.context().close();

    const ctx = await browser.newContext({ ...devices["iPhone 13"], locale: "es-ES" });
    await races(ctx);
    const es = await ctx.newPage();
    es.on("pageerror", e => errors.push(`Spanish: ${e.message}`));
    await es.goto(url + "#license");
    await es.waitForSelector(".license-file", { state: "attached" });
    assert.strictEqual(await es.evaluate(() => document.documentElement.lang), "es");
    assert.strictEqual(await es.locator('nav a[data-tab="current"]').innerText(), "Contrarrelojes", "a Spanish phone: Spanish");
    await es.locator('input.license-file[data-i="0"]').setInputFiles(s1File);
    await es.locator("#license-list .coach-summary").first().waitFor();
    assert.match(await es.locator("#license-list .coach-summary").first().innerText(), /Tu vuelta 1:18\.521/);
    // the corner's tips and charts too
    const panel = await es.locator("#license-list .detail-body").first().innerHTML();
    assert.ok(/Curva \d/.test(panel) && panel.includes("Velocidad km/h") && panel.includes("Ocultar la trazada de referencia"), "the corner panel in Spanish");
    for (const tab of ["current", "daily", "circuits", "past", "drivers", "howto", "about", "settings"]) {
      await es.evaluate(t => { location.hash = t; }, tab);
      await es.locator(`#tab-${tab}`).waitFor();
    }
    await es.locator("#current-list .stat").first().waitFor({ state: "attached" });
    assert.deepStrictEqual(await es.evaluate(() => I18N.missing), [], "texts shown in English on the Spanish site");
    // links and names keep their attributes; names from the game aren't machine-translated
    assert.strictEqual(await es.locator('#tab-about a[href="privacy.html"]').innerText(), "privacidad");
    assert.ok(await es.locator('#current-list h2 [translate="no"]').count() > 0, "track names are marked not to translate");
    // Settings: Automatic (Español) is chosen; English sticks after a reload, and Automatic comes back
    await es.evaluate(() => { location.hash = "settings"; });
    assert.strictEqual(await es.locator("#set-lang").inputValue(), "auto");
    assert.match(await es.locator('#set-lang option[value="auto"]').innerText(), /Español/);
    await Promise.all([es.waitForEvent("load"), es.selectOption("#set-lang", "en")]);
    await es.locator('nav a[data-tab="current"]').waitFor();
    assert.strictEqual(await es.locator('nav a[data-tab="current"]').innerText(), "Time trials", "English chosen in Settings");
    assert.strictEqual(await es.evaluate(() => document.documentElement.lang), "en");
    await Promise.all([es.waitForEvent("load"), es.selectOption("#set-lang", "auto")]);
    await es.locator('nav a[data-tab="current"]').waitFor();
    assert.strictEqual(await es.locator('nav a[data-tab="current"]').innerText(), "Contrarrelojes", "back to Automatic");
    await ctx.close();
  }

  // 2. the earlier apps: the app on main (what testers have, or will once its .aab is on Google Play) and the first
  // Play release. Each records and compares with this website, and gets audio cue controls only if it has them.
  console.log(`app on main read from ${APPS.mainFrom}`);
  for (const [app, label] of [["main", "app on main"], ["first", "first Play release"]]) {
    const has = name => name in APPS[app];
    const p = await page(app);
    assert.ok(await coach(p).locator(".record-btn").count(), `${label}: Record on this phone`);
    assert.strictEqual(await p.locator(".cue-toggle").count() > 0, has("cueState"), `${label}: audio cues checkbox only if it has them`);
    assert.strictEqual(await p.locator('nav a[data-tab="cues"]').isVisible(), has("cueState"), `${label}: Audio cues tab only if it has them`);
    assert.ok(await p.locator("#tab-license .license-intro .web-only").isHidden(), `${label}: no recorder link`);
    assert.ok(await p.locator("#tab-license .license-intro .app-only").isVisible(), `${label}: Record on this phone`);
    await coach(p).locator(".record-btn").click();
    assert.deepStrictEqual((await calls(p)).at(-1), ["start", ""], `${label}: recording started (audio cues off)`);
    await event(p, { type: "connected", ip: "192.168.0.23" });
    await event(p, { type: "state", state: "driving" });
    await event(p, { type: "lap", lap: 1, ms: 78521, time: "1:18.521", replay: false, dropout: false });
    assert.match(await coach(p).locator(".rec-laps").innerText(), /1:18\.521/);
    await coach(p).locator(".rec-stop").click();
    await coach(p).locator(".coach-summary").waitFor();
    assert.match(await coach(p).locator(".coach-summary").innerText(), /Your lap 1:18\.521/);
    await coach(p).locator(".save-btn").click();
    assert.strictEqual((await calls(p)).at(-1)[0], "save", `${label}: Save to Downloads`);
    if (has("cueState")) { // its Audio cues tab opens without asking for anything it doesn't have
      await p.goto(url + "#cues");
      await p.locator(".cue-test").first().waitFor();
    }
    const asked = new Set((await calls(p)).map(c => c[0]));
    for (const name of asked) assert.ok(has(name), `${label}: the website asked it for ${name}`);
    await p.context().close();
    // Record on this phone on a time trial and on a daily race too
    const q = await page(app, true);
    await q.goto(url + "#current");
    const trial = q.locator("#current-list .coach").first();
    await trial.locator(".record-btn").waitFor();
    await recordLap(q, trial, `${label}, time trial`);
    await q.goto(url + "#daily");
    const daily = q.locator("#daily-list .coach").first();
    await daily.locator(".record-btn").waitFor();
    await recordLap(q, daily, `${label}, daily race`);
    await q.goto(url + "#circuits");
    const circuit = q.locator("#circuit-list .coach").first();
    await circuit.locator(".record-btn").waitFor();
    await recordLap(q, circuit, `${label}, Circuit Experience`);
    assert.match(await circuit.locator(".medal-result").innerText(), /needs/, `${label}: the Circuit Experience's medals`);
    for (const name of new Set((await calls(q)).map(c => c[0]))) assert.ok(has(name), `${label}: the website asked it for ${name}`);
    await q.context().close();
  }

  // 3. this checkout's app: the stand-in only has methods the app really has
  {
    const stand = await (async () => {
      const ctx = await browser.newContext();
      await ctx.addInitScript(standIn, { withCues: true, csv: "" });
      const p = await ctx.newPage();
      await p.goto("about:blank");
      const keys = await p.evaluate(() => Object.keys(window.GT7App));
      await ctx.close();
      return keys;
    })();
    for (const name of stand) assert.ok(name in APPS.current, `stand-in method ${name} is in the app's bridge`);
  }
  // the checkbox, recording with cues, the status line, the Audio cues tab and calibration
  {
    const p = await page("cues");
    const box = coach(p).locator(".cue-toggle");
    const boxes = p.locator(".cue-toggle");
    assert.ok(await boxes.count() > 1, "a checkbox on every card");
    await box.check();
    assert.deepStrictEqual((await calls(p)).at(-1), ["saveCues", JSON.stringify({ enabled: true })]);
    assert.ok((await boxes.evaluateAll(b => b.map(x => x.checked))).every(Boolean), "ticking one ticks them all");
    await coach(p).locator(".record-btn").click();
    await p.waitForFunction(() => window.__calls.some(c => c[0] === "startWithCues"));
    const start = (await calls(p)).find(c => c[0] === "startWithCues");
    const cues = JSON.parse(start[2]);
    assert.ok(cues.x.length > 100 && cues.cues.some(q => q.kind === "brake"), "the reference's cue points sent to the app");
    await event(p, { type: "cues", output: "Phone speaker", delay: 0, calibrated: false });
    assert.match(await coach(p).locator(".rec-cues").innerText(), /Audio cues on \(Phone speaker.*brake cue on the reference's point\)/s);
    await coach(p).locator(".rec-cancel").click();
    // unticking turns them all off: the next recording has no audio cues
    await box.uncheck();
    assert.deepStrictEqual((await calls(p)).at(-1), ["saveCues", JSON.stringify({ enabled: false })]);
    assert.ok((await boxes.evaluateAll(b => b.map(x => x.checked))).every(c => !c), "unticking one unticks them all");
    await coach(p).locator(".record-btn").click();
    assert.deepStrictEqual((await calls(p)).at(-1), ["start", ""], "audio cues off: recording without them");
    await event(p, { type: "connected", ip: "192.168.0.23" });
    assert.strictEqual(await coach(p).locator(".rec-cues").innerText(), "", "no audio cue line");
    await coach(p).locator(".rec-cancel").click();
    await box.check(); // back on, for the Audio cues tab and the recording after it

    await p.goto(url + "#cues");
    await p.locator(".cue-test").first().waitFor();
    assert.ok(await p.locator('nav a[data-tab="cues"]').isVisible(), "the Audio cues tab");
    for (const b of await p.locator(".cue-test").all()) await b.click();
    assert.deepStrictEqual((await calls(p)).filter(c => c[0] === "testSound").map(c => c[1]), ["brake", "lift", "gas", "pip"]);
    const offsets = await p.locator('select[data-set="brakeEarly"] option').evaluateAll(o => o.map(x => x.value));
    assert.deepStrictEqual(offsets, ["0", "0.05", "0.1", "0.15", "0.2"]);
    await p.selectOption('select[data-set="brakeEarly"]', "0.15");
    assert.strictEqual(JSON.parse((await calls(p)).at(-1)[1]).settings.brakeEarly, 0.15, "the offset is saved in the app");
    const gas = await p.locator('select[data-set="gasAdjust"] option').evaluateAll(o => o.map(x => x.value));
    assert.deepStrictEqual(gas, ["-0.2", "-0.15", "-0.1", "-0.05", "0", "0.05", "0.1", "0.15", "0.2"]);
    await p.selectOption('select[data-set="gasAdjust"]', "-0.1");
    assert.strictEqual(JSON.parse((await calls(p)).at(-1)[1]).settings.gasAdjust, -0.1, "the gas offset is saved in the app");
    await p.locator(".cue-calibrate").click();
    assert.deepStrictEqual((await calls(p)).at(-1), ["calibrate", ""]);
    await event(p, { type: "connected", ip: "192.168.0.23" });
    for (let r = 1; r <= 6; r++) await event(p, { type: "calibrate", output: "Phone speaker", round: r, of: 6, pressed: r !== 3 });
    assert.match(await p.locator(".cue-cal-status").innerText(), /Countdown 6 of 6: ✓ ✓ – ✓ ✓ ✓/);
    await event(p, { type: "calibrate", output: "Phone speaker", done: true, ok: true, delay: 0.02, presses: 5, spread: 0.02 });
    assert.match(await p.locator(".cue-cal-status").innerText(), /Calibrated: Phone speaker plays cues 0\.02 s early/);
    // the next recording shows the offset it plays with
    await p.goto(url + "#license");
    await coach(p).locator(".record-btn").click();
    await p.waitForFunction(() => window.__calls.filter(c => c[0] === "startWithCues").length === 2);
    await event(p, { type: "cues", output: "Phone speaker", delay: 0, calibrated: true });
    assert.match(await coach(p).locator(".rec-cues").innerText(), /brake cue 0\.15 s early, gas beep 0\.10 s earlier/,
      "the recording shows the changed offsets");
    await coach(p).locator(".rec-cancel").click();
    await p.context().close();
  }

  // 4. several laps: the across-your-laps box, and the corner stays selected when switching laps
  {
    const p = await page(null);
    await p.locator('input.license-file[data-i="0"]').setInputFiles(multiFile);
    const c = coach(p);
    await c.locator(".across").waitFor();
    const across = await c.locator(".across").innerText();
    assert.match(across, /Across your 4 laps/);
    assert.match(across, /Least consistent/, "one lap was slower in one section");
    const n = await c.locator(".across .sh-corner").last().getAttribute("data-n");
    await c.locator(`.chip[data-n="${n}"]`).click();
    assert.ok(await c.locator(".corner-detail").evaluate(d => d.classList.contains("open")), "the corner's panel opens");
    const lap = () => c.locator(".sheet-laps span").innerText();
    const before = await lap();
    await c.locator('[data-lapstep="1"]').click();
    await c.locator(".coach-summary").waitFor();
    assert.notStrictEqual(await lap(), before, "another lap");
    assert.strictEqual(await c.locator(".chip.selected").getAttribute("data-n"), n, "the same corner, still selected");
    assert.ok(await c.locator(".corner-detail").evaluate(d => d.classList.contains("open")), "and its panel still open");
    await c.locator(".lap-btn").nth(0).click();
    await c.locator(".coach-summary").waitFor();
    assert.strictEqual(await c.locator(".chip.selected").getAttribute("data-n"), n, "choosing a lap at the top too");
    await p.context().close();
  }

  // the Daily races tab: a race with a free car choice and a reference lap in another car: compared with no warning
  {
    const ctx = await browser.newContext({ ...devices["iPhone 13"] });
    await races(ctx);
    const p = await ctx.newPage();
    p.on("pageerror", e => errors.push(`daily races: ${e.message}`));
    await p.goto(url + "#daily");
    const c = p.locator("#daily-list .coach").first();
    await c.waitFor(); // the races load after the page
    assert.match(await p.locator("#daily-list").innerText(), /your choice of car[\s\S]*Fast_One's lap of 1:11\.809 in the Some car[\s\S]*Reference lap coming soon/);
    await c.locator("input.daily-file").setInputFiles(s1File);
    await c.locator(".coach-summary").waitFor();
    assert.match(await c.locator(".coach-summary").innerText(), /Your lap 1:18\.521/);
    assert.match(await c.locator(".map-box .legend").innerText(), /within 3% of the reference/, "no medal wording for a daily race");
    await ctx.close();
  }

  // 5. a time trial: a lap in another car than the reference's gets a warning, unless the owner has flagged the event
  // as free car choice. The first current event is given S-1's gold run as its reference, in another car.
  for (const free of [false, true]) {
    const ctx = await browser.newContext({ ...devices["iPhone 13"] });
    await races(ctx, free);
    const p = await ctx.newPage();
    p.on("pageerror", e => errors.push(`time trial: ${e.message}`));
    await p.goto(url + "#current");
    const c = p.locator("#current-list .coach").first();
    await c.locator("input.lap-file").setInputFiles(s1File);
    await c.locator(".coach-summary").waitFor();
    assert.strictEqual(/different car/.test(await c.locator(".coach-summary").innerText()), !free,
      free ? "free car choice: no different-car warning" : "fixed car: the different-car warning");
    assert.strictEqual(/Your choice of car · record in the/.test(await p.locator("#current-list .event-head").first().innerText()), free,
      "free car choice: the card says so");
    await ctx.close();
  }

  await browser.close();
  assert.deepStrictEqual(errors, [], "no script errors");
  console.log("ui tests passed");
})().catch(e => { console.error(e); process.exit(1); });
