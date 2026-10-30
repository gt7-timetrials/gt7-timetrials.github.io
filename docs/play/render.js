const { chromium } = require('playwright');
(async () => { const b = await chromium.launch();
  let p = await b.newPage({ viewport: { width: 512, height: 512 } }); await p.goto('file://' + __dirname + '/icon.html'); await p.screenshot({ path: 'icon-512.png' });
  p = await b.newPage({ viewport: { width: 1024, height: 500 } }); await p.goto('file://' + __dirname + '/feature.html'); await p.waitForTimeout(300); await p.screenshot({ path: 'feature-1024x500.png' });
  await b.close(); })();
