// The website's screens in a phone-sized browser (Playwright), as a visitor, in the Google Play app as testers have
// it (no audio cues), and in the current app (audio cues). The apps are stand-ins for window.GT7App that record what
// the page asks of them. Run by tests/test_gt7tt.py (UiTest), which builds the site and serves it:
//   node tests/test_ui.js <site url> <S-1 recording.csv> <4-lap S-1 recording.csv>
const { chromium, devices } = require("playwright");
const assert = require("assert");
const fs = require("fs");

const [url, s1File, multiFile] = process.argv.slice(2);
const s1 = fs.readFileSync(s1File, "utf8");

// window.GT7App as the Play app had it before audio cues, and as the current app has it
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
      saveCues: json => { call("saveCues", json); const c = JSON.parse(json); if ("enabled" in c) state.enabled = c.enabled; },
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
  const page = async (app) => {
    const ctx = await browser.newContext({ ...devices["iPhone 13"] });
    if (app) await ctx.addInitScript(standIn, { withCues: app === "cues", csv: s1 });
    const p = await ctx.newPage();
    p.on("pageerror", e => errors.push(`${app || "website"}: ${e.message}`));
    await p.goto(url + "#license");
    await p.waitForSelector(".license-file", { state: "attached" });
    return p;
  };
  const calls = p => p.evaluate(() => window.__calls);
  const coach = p => p.locator("#license-list .coach").first(); // Super License S-1
  const event = (p, ev) => p.evaluate(e => window.GT7AppEvent(e), ev);

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
    await p.context().close();
  }

  // 2. the Google Play app testers have (no audio cues): records and compares as before, no cue controls
  {
    const p = await page("old");
    assert.ok(await coach(p).locator(".record-btn").count(), "old app: Record on this phone");
    assert.strictEqual(await p.locator(".cue-toggle").count(), 0, "old app: no audio cues checkbox");
    assert.ok(await p.locator('nav a[data-tab="cues"]').isHidden(), "old app: no Audio cues tab");
    await coach(p).locator(".record-btn").click();
    assert.deepStrictEqual((await calls(p)).at(-1), ["start", ""], "old app: recording started the old way");
    await event(p, { type: "connected", ip: "192.168.0.23" });
    await event(p, { type: "state", state: "driving" });
    await event(p, { type: "lap", lap: 1, ms: 78521, time: "1:18.521", replay: false, dropout: false });
    assert.match(await coach(p).locator(".rec-laps").innerText(), /1:18\.521/);
    await coach(p).locator(".rec-stop").click();
    await coach(p).locator(".coach-summary").waitFor();
    assert.match(await coach(p).locator(".coach-summary").innerText(), /Your lap 1:18\.521/);
    await coach(p).locator(".save-btn").click();
    assert.strictEqual((await calls(p)).at(-1)[0], "save", "old app: Save to Downloads");
    await p.context().close();
  }

  // 3. the current app: the checkbox, recording with cues, the status line, the Audio cues tab and calibration
  {
    const p = await page("cues");
    const box = coach(p).locator(".cue-toggle");
    await box.check();
    assert.deepStrictEqual((await calls(p)).at(-1), ["saveCues", JSON.stringify({ enabled: true })]);
    await coach(p).locator(".record-btn").click();
    await p.waitForFunction(() => window.__calls.some(c => c[0] === "startWithCues"));
    const start = (await calls(p)).find(c => c[0] === "startWithCues");
    const cues = JSON.parse(start[2]);
    assert.ok(cues.x.length > 100 && cues.cues.some(q => q.kind === "brake"), "the reference's cue points sent to the app");
    await event(p, { type: "cues", output: "Phone speaker", delay: 0, calibrated: false });
    assert.match(await coach(p).locator(".rec-cues").innerText(), /Audio cues on \(Phone speaker/);
    await coach(p).locator(".rec-cancel").click();

    await p.goto(url + "#cues");
    await p.locator(".cue-test").first().waitFor();
    assert.ok(await p.locator('nav a[data-tab="cues"]').isVisible(), "the Audio cues tab");
    for (const b of await p.locator(".cue-test").all()) await b.click();
    assert.deepStrictEqual((await calls(p)).filter(c => c[0] === "testSound").map(c => c[1]), ["brake", "lift", "gas", "pip"]);
    const offsets = await p.locator('select[data-set="brakeEarly"] option').evaluateAll(o => o.map(x => x.value));
    assert.deepStrictEqual(offsets, ["0", "0.05", "0.1", "0.15", "0.2"]);
    await p.locator(".cue-calibrate").click();
    assert.deepStrictEqual((await calls(p)).at(-1), ["calibrate", ""]);
    await event(p, { type: "connected", ip: "192.168.0.23" });
    for (let r = 1; r <= 6; r++) await event(p, { type: "calibrate", output: "Phone speaker", round: r, of: 6, pressed: r !== 3 });
    assert.match(await p.locator(".cue-cal-status").innerText(), /Countdown 6 of 6: ✓ ✓ – ✓ ✓ ✓/);
    await event(p, { type: "calibrate", output: "Phone speaker", done: true, ok: true, delay: 0.02, presses: 5, spread: 0.02 });
    assert.match(await p.locator(".cue-cal-status").innerText(), /Calibrated: Phone speaker plays cues 0\.02 s early/);
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

  await browser.close();
  assert.deepStrictEqual(errors, [], "no script errors");
  console.log("ui tests passed");
})().catch(e => { console.error(e); process.exit(1); });
