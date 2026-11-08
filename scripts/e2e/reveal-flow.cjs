// Browser checks for the Research Connection Reveal against the PRODUCTION build
// (`npm run build && npx vite preview --port 4199`). Read-only: loads pages and clicks; the stale-data case
// intercepts /grounding.json inside the browser only. Screenshots only if a directory is given.
//   PLAYWRIGHT_MODULE=/path/to/node_modules/playwright node scripts/e2e/reveal-flow.cjs [screenshot-dir]
const path = require('path');
const fs = require('fs');

const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const ORIGIN = process.env.PREVIEW_ORIGIN || 'http://localhost:4199';
const E2E = `${ORIGIN}/?e2e`;
const SHOTS = process.argv[2] || null;
const G = JSON.parse(fs.readFileSync(path.join(__dirname, '../../public/grounding.json'), 'utf8'));
const P07 = '07-Schoen2025-StressTestingDeliberativeAlignment';
const P33 = '33-Guan2024-DeliberativeAlignment';
const P01 = '01-Greenblatt2024-AlignmentFaking';
const P25 = 'Simple-probes-can-catch-sleeper-agents-Anthropic';
const P24 = '24-Taylor2025-AuditingGamesSandbagging';

const problems = [];
const log = (...a) => console.log(...a);
const check = (ok, msg) => { log(`  ${ok ? '✓' : '✗'} ${msg}`); if (!ok) problems.push(msg); };
const shot = (page, name) => (SHOTS ? page.screenshot({ path: path.join(SHOTS, name) }) : Promise.resolve());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const open = async (w = 1440, h = 900, extra = {}) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, ...extra });
    const page = await ctx.newPage();
    page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errors.push(`[${w}] ${m.type()}: ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`[${w}] pageerror: ${e.message}`));
    return { ctx, page };
  };
  const ready = async (page, hash) => {
    await page.goto(`${E2E}${hash}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__cy && window.__cy.nodes().length > 0);
    await page.waitForTimeout(300);
  };
  const title = (page) => page.$eval('.revealbar .rv-step .rv-title', (e) => e.textContent.trim()).catch(() => null);
  const rvCount = (page) => page.evaluate(() => window.__cy.elements('.rv-hidden, .rv-past, .rv-focus, .rv-on, .rv-rest').length);
  const positions = (page) => page.evaluate(() => window.__cy.nodes().map((n) => `${n.id()}@${n.position('x').toFixed(2)},${n.position('y').toFixed(2)}`).sort().join('|'));
  /** record the sequence of step titles until the reveal finishes */
  const record = async (page, maxMs = 30000) => {
    const seen = [];
    const t0 = Date.now();
    while (Date.now() - t0 < maxMs) {
      if (await page.isVisible('.revealbar .rv-list')) break;
      const t = await title(page);
      if (t && seen[seen.length - 1] !== t) seen.push(t);
      await sleep(120);
    }
    return seen;
  };

  log('== P07 × P33: full reveal on the production build');
  let { ctx, page } = await open();
  await ready(page, `#/compare/${P07}/${P33}`);
  const layoutBefore = await positions(page);
  check(await page.isVisible('.reveal-cta'), '"Reveal connections" button in the existing Compare panel');
  const tClick = Date.now();
  await page.click('.reveal-cta');
  await page.waitForSelector('.revealbar');
  log(`     click → reveal bar: ${Date.now() - tClick} ms`);
  const dots = await page.$$eval('.revealbar .rv-dot', (els) => els.length);
  check((await title(page))?.startsWith('P07'), 'step 1 shows paper A (P07)');
  const hidden = await page.evaluate((a) => ({
    a: window.__cy.getElementById(`paper:${a}`).classes().join(' '),
    others: window.__cy.nodes().filter((n) => n.id() !== `paper:${a}`).every((n) => n.hasClass('rv-hidden')),
  }), P07);
  check(/rv-focus|rv-on/.test(hidden.a) && hidden.others, 'only P07 visible at first; everything else dimmed');
  await shot(page, 'reveal-1-paperA.png');
  const seq1 = [(await title(page))].concat((await record(page)).filter((t, i) => i > 0 || !t.startsWith('P07')));
  log(`     sequence: ${seq1.join('  →  ')}`);
  check(seq1.length === dots, `every step shown once, in order (${seq1.length} of ${dots})`);
  check(seq1[1]?.startsWith('P33') && seq1[2] === 'P07 cites P33', 'then paper B, then the citation (P07 → P33)');
  check(seq1.slice(3).every((t) => /^(Shared|Linked by a claim|Studied together)/.test(t)), 'then graph-evidence connections only');
  await page.waitForSelector('.revealbar .rv-list');
  const listCount = await page.$$eval('.revealbar .rv-list li', (els) => els.length);
  check(listCount === dots - 2, `finished: static list of all ${listCount} connections`);
  const doneState = await page.evaluate((ids) => ({
    hidden: window.__cy.elements('.rv-hidden').length,
    papersOn: ids.every((id) => window.__cy.getElementById(id).hasClass('rv-on')),
  }), [`paper:${P07}`, `paper:${P33}`]);
  check(doneState.hidden === 0 && doneState.papersOn, 'finished: nothing left hidden; both papers fully visible');
  const tags = await page.$$eval('.revealbar .rv-list .rv-tag', (els) => els.map((e) => e.textContent.trim()));
  check(tags[0] === 'Citation · reference-list match' && tags.slice(1).every((t) => t === 'Graph evidence'), 'citation labelled separately from graph evidence');
  check(/does not mean the papers agree, disagree, or that one causes the other/.test(await page.textContent('.revealbar')), 'proximity caveat shown');
  check((await positions(page)) === layoutBefore, 'layout untouched by the reveal (deterministic positions preserved)');
  await shot(page, 'reveal-2-done.png');

  log('== evidence after the reveal');
  await page.locator('.revealbar .rv-list li', { hasText: 'P07 cites P33' }).locator('.rv-evbtn').click();
  await page.waitForTimeout(300);
  check(/Matched automatically in the citing paper’s reference list/.test(await page.textContent('.inspector-panel')), 'citation evidence opens in the inspector (reference-list match note)');
  await page.locator('.revealbar .rv-list li').nth(1).locator('.rv-evbtn', { hasText: 'P07' }).click();
  await page.waitForTimeout(300);
  const srcs = await page.$$eval('.inspector-panel .evidence > li .evmeta > span:first-child', (els) => els.map((e) => e.textContent.trim()));
  check(srcs.length > 0 && srcs.every((s) => s.startsWith('P07')), `shared-concept evidence shows P07’s own quotes (${srcs.length})`);

  log('== replay consistency (twice)');
  for (const k of [1, 2]) {
    await page.click('.revealbar [aria-label="Replay"]');
    await page.waitForTimeout(150);
    const again = [(await title(page))].concat(await record(page));
    const dedup = again.filter((t, i) => t && again.indexOf(t) === i);
    check(JSON.stringify(dedup) === JSON.stringify(seq1), `replay ${k}: identical sequence`);
  }
  await ctx.close();

  log('== pause / resume / skip, evidence during the reveal');
  ({ ctx, page } = await open());
  await ready(page, `#/compare/${P07}/${P33}`);
  await page.click('.reveal-cta');
  await page.waitForFunction(() => document.querySelector('.revealbar .rv-title')?.textContent.includes('cites'), null, { timeout: 8000 });
  await page.click('.revealbar [aria-label="Pause"]');
  const held = await title(page);
  await sleep(3500);
  check((await title(page)) === held, `pause holds the current step (“${held}”)`);
  await page.click('.revealbar [aria-label="Resume"]');
  await page.waitForFunction((h) => document.querySelector('.revealbar .rv-title')?.textContent.trim() !== h, held, { timeout: 5000 }).catch(() => {});
  check((await title(page)) !== held, 'resume continues to the next step');
  await page.waitForFunction(() => document.querySelector('.revealbar .rv-title')?.textContent.startsWith('Shared'), null, { timeout: 6000 });
  await page.locator('.revealbar .rv-step .rv-evbtn').first().click();
  await page.waitForTimeout(300);
  check(await page.isVisible('.inspector-panel'), 'evidence clicked during the reveal opens the inspector');
  check(await page.isVisible('.revealbar [aria-label="Resume"]'), 'opening evidence pauses the reveal');
  const focusIds = await page.evaluate(() => window.__cy.elements('.rv-focus').map((e) => e.id()));
  check(focusIds.length > 0, `one connection highlighted (${focusIds.length} elements in focus)`);
  await page.click('.revealbar [aria-label="Skip animation"]');
  check(await page.isVisible('.revealbar .rv-list'), 'skip shows the finished state immediately');
  await ctx.close();

  log('== cancellation: navigate away / change pair during the animation');
  ({ ctx, page } = await open());
  await ready(page, `#/compare/${P07}/${P33}`);
  await page.click('.reveal-cta');
  await sleep(1500);
  await page.click('[aria-label="Overview"]');
  await page.waitForTimeout(400);
  check(!(await page.isVisible('.revealbar')), 'leaving Compare removes the reveal');
  check((await rvCount(page)) === 0, 'no reveal styling left on the graph');
  await sleep(4000);
  check((await rvCount(page)) === 0 && !(await page.isVisible('.revealbar')), 'no timers fire afterwards');
  await page.goBack();
  await page.waitForTimeout(600);
  check(!(await page.isVisible('.revealbar')), 'returning does not auto-restart the reveal');
  await page.click('.reveal-cta');
  await sleep(1200);
  await page.click('.swap');
  await page.waitForTimeout(500);
  check(!(await page.isVisible('.revealbar')) && (await rvCount(page)) === 0, 'changing the pair cancels the reveal');
  await ctx.close();

  log('== empty, ambiguous and stale cases');
  ({ ctx, page } = await open());
  await ready(page, `#/compare/${P01}/${P25}`);
  await page.click('.reveal-cta');
  await page.click('.revealbar [aria-label="Skip animation"]');
  const emptyTxt = await page.textContent('.revealbar');
  check(/No supported connection in the graph/.test(emptyTxt) && /not proof that the research is unrelated/.test(emptyTxt), 'P01 × P25: elegant empty state, nothing invented');
  await shot(page, 'reveal-3-empty.png');
  await ready(page, `#/compare/${P24}/${P33}`);
  await page.click('.reveal-cta');
  await page.click('.revealbar [aria-label="Skip animation"]');
  check(!/cites/.test(await page.textContent('.revealbar .rv-list')), 'P24 × P33 (ambiguous only): no citation in the reveal');
  await ctx.close();
  ({ ctx, page } = await open());
  await page.route('**/grounding.json', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...G, graphSha256: '0'.repeat(64) }) }));
  await ready(page, `#/compare/${P07}/${P33}`);
  await page.click('.reveal-cta');
  await page.click('.revealbar [aria-label="Skip animation"]');
  const staleTxt = await page.textContent('.revealbar .rv-list');
  check(!/cites|reference-list/i.test(staleTxt) && /Shared/.test(staleTxt), 'stale grounding: no citation step; graph-evidence steps remain');
  check(await page.isVisible('.datanote.stale'), 'stale strip still shown');
  await ctx.close();

  log('== reduced motion');
  ({ ctx, page } = await open(1440, 900, { reducedMotion: 'reduce' }));
  await ready(page, `#/compare/${P07}/${P33}`);
  await page.click('.reveal-cta');
  await page.waitForTimeout(150);
  check(await page.isVisible('.revealbar .rv-list'), 'reduced motion: static list immediately, no animation');
  check(await page.evaluate(() => window.__cy.elements('.rv-instant').length > 0), 'reduced motion: graph transitions disabled');
  await ctx.close();

  log('== mobile 390');
  ({ ctx, page } = await open(390, 844));
  await page.goto(`${E2E}#/compare/${P07}/${P33}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.click('.reveal-cta');
  await page.waitForSelector('.revealbar');
  check(await page.isVisible('.stage'), '390: reveal switches to the graph pane');
  await page.waitForTimeout(300);
  const inView = await page.evaluate((ids) => {
    const cy = window.__cy;
    const w = cy.width(), h = cy.height();
    return ids.every((id) => { const p = cy.getElementById(id).renderedPosition(); return p.x >= 0 && p.x <= w && p.y >= 0 && p.y <= h; });
  }, [`paper:${P07}`, `paper:${P33}`]);
  check(inView, '390: both papers are inside the visible graph area');
  check(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), '390: no horizontal overflow');
  await sleep(1200);
  await shot(page, 'reveal-4-mobile.png');
  await page.click('.revealbar [aria-label="Skip animation"]');
  check(await page.isVisible('.revealbar .rv-list'), '390: controls work');
  await page.locator('.revealbar .rv-list .rv-evbtn').first().click();
  await page.waitForTimeout(400);
  check(await page.isVisible('.inspector-panel'), '390: evidence opens');
  await ctx.close();

  log('== existing Compare panel unchanged');
  ({ ctx, page } = await open());
  await ready(page, `#/compare/${P07}/${P33}`);
  const sections = await page.$$eval('.compare .section > summary', (els) => els.map((e) => e.textContent.replace(/\d+/g, '').trim()));
  check(JSON.stringify(sections) === JSON.stringify(['Citation', 'How they connect', 'Shared concepts', 'Methods & models', 'Findings', 'Differences', 'Gaps & coverage']), `same sections (${sections.join(', ')})`);
  check(!(await page.isVisible('.revealbar')), 'no reveal until the user asks for it');
  await ctx.close();

  log('\nconsole errors/warnings:', errors.length ? '\n' + errors.join('\n') : 'none');
  log(problems.length ? `FAILED ${problems.length}:\n - ${problems.join('\n - ')}` : 'ALL CHECKS PASSED');
  await browser.close();
  process.exit(problems.length ? 1 : 0);
})().catch((e) => { console.error('CRASH:', e.message); process.exit(1); });
