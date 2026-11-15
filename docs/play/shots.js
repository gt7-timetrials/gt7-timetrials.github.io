const { chromium } = require('playwright');
const fs = require('fs');
const SITE = 'https://gt7-timetrials.github.io/', out = process.argv[2], csv = fs.readFileSync(process.argv[3], 'utf8');
(async () => {
  const b = await chromium.launch(), errs = [];
  const ctx = await b.newContext({ viewport: { width: 360, height: 720 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
    colorScheme: 'light' });
  // the app's bridge, with audio cues (calibrated on the phone speaker)
  await ctx.addInitScript(c => {
    const state = { settings: {}, enabled: true, outputs: [{ key: 'speaker', name: 'Phone speaker', type: 'speaker', delay: 0.02, calibrated: true, current: true, start: 0 }],
      current: { key: 'speaker', name: 'Phone speaker', delay: 0.02 } };
    window.GT7App = { start() {}, stop() {}, csv: () => c, save: () => '', version: () => '0.1',
      cueState: () => JSON.stringify(state), saveCues: j => { const s = JSON.parse(j); if (s.settings) state.settings = s.settings; },
      testSound() {}, startWithCues() {}, calibrate() {} };
    try { localStorage.setItem('guide-seen', '1'); } catch (e) {}
  }, csv);
  const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
  const shot = async n => { await p.waitForTimeout(500); await p.screenshot({ path: `${out}/${n}.png` }); };
  const fuji = 'article.event:has-text("Fuji")';
  await p.goto(SITE + '#current'); await p.waitForTimeout(1500);
  await shot('1-time-trials');
  await p.goto(SITE + '#daily'); await p.waitForTimeout(1500);
  await shot('2-daily');
  await p.goto(SITE + '#current'); await p.waitForTimeout(1500);
  const btn = p.locator(`${fuji} .record-btn`);
  await btn.scrollIntoViewIfNeeded(); await btn.tap(); await p.waitForTimeout(300);
  await p.evaluate(() => { GT7AppEvent({ type: 'connected', ip: '192.168.0.23' }); GT7AppEvent({ type: 'cues', output: 'Phone speaker', delay: 0.02, calibrated: true });
    GT7AppEvent({ type: 'state', state: 'driving' });
    for (const [l, t] of [[1, '1:44.161'], [2, '1:43.844'], [3, '1:43.385']]) GT7AppEvent({ type: 'lap', lap: l, time: t }); });
  await p.evaluate(() => { const r = document.querySelector('.rec-panel'); window.scrollTo(0, r.getBoundingClientRect().top + scrollY - 170); });
  await shot('3-recording');
  await p.evaluate(() => [...document.querySelectorAll('.rec-panel button')].find(b => /Stop/.test(b.textContent)).click());
  await p.locator(`${fuji} .coach-summary`).waitFor(); await p.waitForTimeout(1500);
  await p.evaluate(() => { const r = [...document.querySelectorAll('article.event')].find(a => a.textContent.includes('Fuji')).querySelector('.coach-summary');
    window.scrollTo(0, r.getBoundingClientRect().top + scrollY - 12); });
  await shot('4-result');
  await p.locator(`${fuji} .coach-result .chip[data-n="8"]`).click(); await p.waitForTimeout(1000);
  await shot('5-corner');
  for (const [cls, n, off] of [['pedal-chart', '6-charts', 4], ['corner-widths', '7-line', 4]]) {
    await p.evaluate(([cls, off]) => { const a = [...document.querySelectorAll('article.event')].find(a => a.textContent.includes('Fuji'));
      const body = a.querySelector('.corner-detail .detail-body'), f = body.querySelector('.' + cls);
      body.scrollTop += f.getBoundingClientRect().top - body.getBoundingClientRect().top - off; }, [cls, off]);
    await shot(n);
  }
  await p.goto(SITE + '#cues'); await p.waitForTimeout(1200); await p.evaluate(() => window.scrollTo(0, 0));
  await shot('8-cues');
  console.log('errors', errs); await b.close();
})();
