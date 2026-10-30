const { chromium } = require('playwright');
const fs = require('fs');
const SITE = 'https://gt7-timetrials.github.io/', out = process.argv[2], csv = fs.readFileSync(process.argv[3], 'utf8');
(async () => {
  const b = await chromium.launch(), errs = [];
  const ctx = await b.newContext({ viewport: { width: 360, height: 720 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
    colorScheme: process.argv[4] || 'light' });
  await ctx.addInitScript(c => { window.GT7App = { start() {}, stop() {}, csv: () => c, save: () => '', version: () => '0.1' }; }, csv);
  const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
  const shot = async n => { await p.waitForTimeout(400); await p.screenshot({ path: `${out}/${n}.png` }); };
  await p.goto(SITE + '#current'); await p.waitForTimeout(1200);
  await shot('1-current');
  const idx = await p.evaluate(() => [...document.querySelectorAll('article.event')].findIndex(a => a.textContent.includes('Barcelona')));
  // recording
  const btn = (await p.$$('.record-btn'))[await p.evaluate(i => [...document.querySelectorAll('.record-btn')].findIndex(b => b.closest('article') === document.querySelectorAll('article.event')[i]), idx)];
  await btn.scrollIntoViewIfNeeded(); await btn.tap(); await p.waitForTimeout(300);
  await p.evaluate(() => { GT7AppEvent({ type: 'connected', ip: '192.168.0.23' }); GT7AppEvent({ type: 'state', state: 'driving' });
    GT7AppEvent({ type: 'lap', lap: 1, time: '1:53.412' }); GT7AppEvent({ type: 'lap', lap: 2, time: '1:52.687' });
    GT7AppEvent({ type: 'state', state: 'driving' }); });
  await p.evaluate(() => { const r = document.querySelector('.rec-panel'); window.scrollTo(0, r.getBoundingClientRect().top + scrollY - 150); });
  await shot('2-recording');
  // stop and compare
  await p.evaluate(() => [...document.querySelectorAll('.rec-panel button')].find(b => /Stop/.test(b.textContent)).click());
  await p.waitForTimeout(2000);
  const R = `article.event:nth-of-type(${idx + 1}) .coach-result`;
  await p.evaluate(i => { const r = document.querySelectorAll('article.event')[i].querySelector('.coach-result');
    window.scrollTo(0, r.getBoundingClientRect().top + scrollY - 8); }, idx);
  await shot('3-result');
  await p.evaluate(i => { const r = document.querySelectorAll('article.event')[i].querySelector('.coach-result .trackmap');
    window.scrollTo(0, r.getBoundingClientRect().top + scrollY - 40); }, idx);
  await shot('4-map');
  await p.evaluate(i => document.querySelectorAll('article.event')[i].querySelector('.coach-result .chip[data-n="7"]').click(), idx);
  await p.waitForTimeout(900);
  await shot('5-corner');
  for (const [cls, n] of [['corner-widths', '6-widths'], ['corner-lines', '7-dots'], ['pedal-chart', '8-pedals']]) {
    await p.evaluate(([i, cls]) => { const a = document.querySelectorAll('article.event')[i];
      const body = a.querySelector('.corner-detail .detail-body'), f = body.querySelector('.' + cls);
      body.scrollTop += f.getBoundingClientRect().top - body.getBoundingClientRect().top - 4; }, [idx, cls]);
    await shot(n);
  }
  console.log('errors', errs); await b.close();
})();
