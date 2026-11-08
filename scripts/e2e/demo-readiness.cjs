// Demo-readiness checks against the PRODUCTION build (`npm run build && npx vite preview --port 4199`).
// Read-only: loads pages, clicks, drags; tampered graph/grounding responses exist only inside the browser
// (Playwright request interception). Nothing on disk is written except optional screenshots.
//   PLAYWRIGHT_MODULE=/path/to/node_modules/playwright node scripts/e2e/demo-readiness.cjs [screenshot-dir]
const path = require('path');

const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const ORIGIN = process.env.PREVIEW_ORIGIN || 'http://localhost:4199';
const E2E = `${ORIGIN}/?e2e`; // production builds expose the test handle only with this explicit flag
const SHOTS = process.argv[2] || null;
const P07 = '07-Schoen2025-StressTestingDeliberativeAlignment';
const P33 = '33-Guan2024-DeliberativeAlignment';

const problems = [];
const log = (...a) => console.log(...a);
const check = (ok, msg) => { log(`  ${ok ? '✓' : '✗'} ${msg}`); if (!ok) problems.push(msg); };
const shot = (page, name) => (SHOTS ? page.screenshot({ path: path.join(SHOTS, name) }) : Promise.resolve());
const text = async (page, sel) => ((await page.textContent(sel)) || '').replace(/\s+/g, ' ');

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const open = async (w = 1440, h = 900, init) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    if (init) await ctx.addInitScript(init);
    const page = await ctx.newPage();
    page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errors.push(`[${w}] ${m.type()}: ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`[${w}] pageerror: ${e.message}`));
    return { ctx, page };
  };
  const positions = (page) => page.evaluate(() => {
    const out = {};
    window.__cy.nodes().forEach((n) => { const p = n.position(); out[n.id()] = [Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100]; });
    return out;
  });
  const settle = async (page) => { await page.waitForFunction(() => window.__cy && window.__cy.nodes().length > 0); await page.waitForTimeout(400); };

  log('== production build specifics');
  let { ctx, page } = await open();
  await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.cy canvas');
  check(await page.evaluate(() => typeof window.__cy === 'undefined'), 'test handle NOT exposed in production without ?e2e');
  const integ = await (await page.request.get(`${ORIGIN}/graph-integrity.json`)).json();
  check(integ.match === true && /^[0-9a-f]{64}$/.test(integ.graphSha256), `build fingerprint served (graph ${integ.graphSha256.slice(0, 12)}…, match ${integ.match})`);
  check(!(await page.isVisible('.datanote')), 'no integrity warning for the shipped graph + grounding pair');
  await ctx.close();

  log('== reproducible layout (fresh browser contexts, same dataset and view)');
  const views = [['overview', '#/'], ['compare P07×P33', `#/compare/${P07}/${P33}`], ['paper P01', '#/paper/01-Greenblatt2024-AlignmentFaking'], ['entity alignment faking', '#/entity/alignment-faking'], ['topic search', '#/topic/sandbagging%20detection']];
  const first = {};
  for (const [name, hash] of views) {
    const runs = [];
    for (let k = 0; k < 2; k++) {
      ({ ctx, page } = await open());
      await page.goto(`${E2E}${hash}`, { waitUntil: 'networkidle' });
      await settle(page);
      runs.push(await positions(page));
      await ctx.close();
    }
    const ids = Object.keys(runs[0]);
    const same = ids.length > 0 && ids.length === Object.keys(runs[1]).length && ids.every((id) => JSON.stringify(runs[0][id]) === JSON.stringify(runs[1][id]));
    check(same, `${name}: ${ids.length} nodes at identical positions across reloads`);
    first[name] = runs[0];
  }
  const ov = Object.keys(first.overview);
  const cmp = first['compare P07×P33'];
  check(Object.keys(cmp).some((id) => first.overview[id] && JSON.stringify(first.overview[id]) !== JSON.stringify(cmp[id])), 'different views still get their own layout');

  log('== same layout after in-app navigation, and at a different window size');
  ({ ctx, page } = await open());
  await page.goto(`${E2E}#/`, { waitUntil: 'networkidle' });
  await settle(page);
  await page.goto(`${E2E}#/compare/${P07}/${P33}`, { waitUntil: 'networkidle' });
  await settle(page);
  await page.goBack();
  await settle(page);
  const back = await positions(page);
  check(ov.every((id) => JSON.stringify(back[id]) === JSON.stringify(first.overview[id])), 'overview identical after navigating away and back');
  await ctx.close();
  ({ ctx, page } = await open(390, 844));
  await page.goto(`${E2E}#/compare/${P07}/${P33}`, { waitUntil: 'networkidle' });
  await page.click('.mobiletabs button:has-text("Graph")');
  await settle(page);
  const mob = await positions(page);
  check(Object.keys(cmp).every((id) => JSON.stringify(mob[id]) === JSON.stringify(cmp[id])), 'compare layout identical at 390 px (model coordinates)');
  await ctx.close();

  log('== interaction preserved');
  ({ ctx, page } = await open());
  await page.goto(`${E2E}#/compare/${P07}/${P33}`, { waitUntil: 'networkidle' });
  await settle(page);
  const target = await page.evaluate(() => {
    const n = window.__cy.nodes().filter((x) => x.data('type') !== 'Paper')[0];
    const p = n.renderedPosition(); const b = window.__cy.container().getBoundingClientRect();
    return { id: n.id(), x: b.left + p.x, y: b.top + p.y };
  });
  await page.mouse.click(target.x, target.y);
  await page.waitForTimeout(300);
  check(await page.isVisible('.inspector-panel'), 'clicking a node opens the details panel');
  // the details panel just opened and resized the canvas: re-read the node's on-screen position before dragging
  await page.waitForTimeout(300);
  const drag = await page.evaluate(() => {
    const n = window.__cy.nodes().filter((x) => x.data('type') !== 'Paper')[1];
    const p = n.renderedPosition(); const b = window.__cy.container().getBoundingClientRect();
    return { id: n.id(), x: b.left + p.x, y: b.top + p.y, model: { ...n.position() } };
  });
  const before = drag.model;
  await page.mouse.move(drag.x, drag.y);
  await page.mouse.down();
  await page.mouse.move(drag.x + 60, drag.y + 40, { steps: 8 });
  await page.mouse.up();
  const after = await page.evaluate((id) => window.__cy.getElementById(id).position(), drag.id);
  check(Math.abs(after.x - before.x) > 5 || Math.abs(after.y - before.y) > 5, 'nodes can still be dragged');
  const z0 = await page.evaluate(() => window.__cy.zoom());
  await page.click('[aria-label="Zoom in"]');
  check((await page.evaluate(() => window.__cy.zoom())) > z0, 'zoom controls work');
  await ctx.close();

  log('== integrity: graph.json edited with identical node/edge counts (in-browser only)');
  ({ ctx, page } = await open());
  await page.route('**/graph.json', async (route) => {
    const res = await route.fetch();
    const body = (await res.text()).replace('Claude 3 Opus', 'Claude 3 Opvs');
    await route.fulfill({ response: res, body });
  });
  await page.goto(`${E2E}#/compare/${P07}/${P33}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  check(await page.isVisible('.datanote.stale'), 'stale strip shown for a same-count edit');
  check(/different version of the graph, so they are not shown/.test(await text(page, '.datanote')), 'strip explains the data is hidden');
  check((await page.$$('.cite')).length === 0, 'no citation rows');
  check(/not established from available data/.test(await text(page, '.summary')), 'summary: citation not established');
  await page.goto(`${E2E}#/entity/alignment-faking`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const tags = await page.$$eval('.inspector-panel .evmeta .tag, .inspector-panel .claimrow .tag', (els) => els.map((e) => e.textContent.trim()));
  check(!tags.some((t) => /Found in PDF|Not found in PDF|Approximate PDF match|^Review$/.test(t)), 'no PDF-match or review labels');
  await shot(page, 'ready-1-same-count-tamper.png');
  await ctx.close();

  log('== integrity without Web Crypto (non-secure context simulation)');
  ({ ctx, page } = await open(1440, 900, () => { Object.defineProperty(window.crypto, 'subtle', { value: undefined, configurable: true }); }));
  await page.goto(`${E2E}#/compare/${P07}/${P33}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  check(await page.evaluate(() => window.crypto.subtle === undefined), 'Web Crypto disabled in this context');
  check(!(await page.isVisible('.datanote')), 'portable SHA-256 establishes integrity: no warning');
  check((await page.$$('.cite')).length === 1, 'citation shown because the exact hash matched');
  await ctx.close();
  ({ ctx, page } = await open(1440, 900, () => { Object.defineProperty(window.crypto, 'subtle', { value: undefined, configurable: true }); }));
  await page.route('**/graph.json', async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, body: (await res.text()).replace('Claude 3 Opus', 'Claude 3 Opvs') });
  });
  await page.goto(`${E2E}#/compare/${P07}/${P33}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  check(await page.isVisible('.datanote.stale') && (await page.$$('.cite')).length === 0, 'without Web Crypto, a same-count edit is still caught');
  await ctx.close();

  log('== demo scenario timing (production, desktop)');
  ({ ctx, page } = await open());
  const t0 = Date.now();
  await page.goto(`${ORIGIN}/#/compare/${P07}/${P33}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.summary');
  log(`     cold load to comparison summary: ${Date.now() - t0} ms`);
  check(/P07 cites P33 \(matched in P07’s reference list/.test(await text(page, '.summary')), 'demo deep link shows the citation (no ?e2e needed)');
  await shot(page, 'ready-2-demo-deeplink.png');
  await ctx.close();

  log('\nconsole errors/warnings:', errors.length ? '\n' + errors.join('\n') : 'none');
  log(problems.length ? `FAILED ${problems.length}:\n - ${problems.join('\n - ')}` : 'ALL CHECKS PASSED');
  await browser.close();
  process.exit(problems.length ? 1 : 0);
})().catch((e) => { console.error('CRASH:', e.message); process.exit(1); });
