// Browser check for the final credibility pass (read-only: loads pages, clicks, optional screenshots).
//   PLAYWRIGHT_MODULE=/path/to/node_modules/playwright node scripts/e2e/credibility-flow.cjs [screenshot-dir]
// Needs a dev server at BASE_URL (default http://localhost:5199/).
// The stale-data scenario intercepts /grounding.json in the browser only; no file on disk is changed.
const path = require('path');
const fs = require('fs');

const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const REPO = path.resolve(__dirname, '../..');
const URL = process.env.BASE_URL || 'http://localhost:5199/';
const SHOTS = process.argv[2] || null;
const G = JSON.parse(fs.readFileSync(path.join(REPO, 'public/grounding.json'), 'utf8'));
const P07 = '07-Schoen2025-StressTestingDeliberativeAlignment';
const P33 = '33-Guan2024-DeliberativeAlignment';

const problems = [];
const log = (...a) => console.log(...a);
const check = (ok, msg) => { log(`  ${ok ? '✓' : '✗'} ${msg}`); if (!ok) problems.push(msg); };
const shot = (page, name) => (SHOTS ? page.screenshot({ path: path.join(SHOTS, name) }) : Promise.resolve());
const text = async (page, sel) => ((await page.textContent(sel)) || '').replace(/\s+/g, ' ');
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const open = async (w, h) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errors.push(`[${w}] ${m.type()}: ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`[${w}] pageerror: ${e.message}`));
    return { ctx, page };
  };

  log('== main workflow at 1440: search → paper → compare → citation → evidence');
  let { ctx, page } = await open(1440, 900);
  await page.goto(URL, { waitUntil: 'networkidle' });
  check(!(await page.isVisible('.datanote')), 'no data-status strip when grounding data matches the graph');
  let clicks = 0;
  await page.fill('.globalsearch input', 'deliberative alignment');
  await page.press('.globalsearch input', 'Enter'); clicks++;
  await page.waitForSelector('.results-q');
  const p07 = page.locator('.section').first().locator('.paperlist button', { hasText: 'P07' });
  check((await p07.count()) === 1, 'P07 appears in the search results');
  await p07.click(); clicks++;
  await page.waitForSelector('.inspector-panel');
  await page.click('.inspector-panel button:has-text("Compare with")'); clicks++;
  await page.waitForTimeout(400);
  const sugg = await page.$$eval('.suggest li', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
  log('     suggestions:', sugg.join(' | '));
  check(sugg.length > 0, 'Compare offers one-click partners instead of an empty selector');
  // every stated reason must be true: "P07 cites it" only for matched citations; "shares N" only with N > 0
  const reasonsOk = await page.$$eval('.suggest li', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
  check(reasonsOk.every((s) => !/shares 0 concept/.test(s)), 'no "shares 0 concepts" suggestions');
  const citedSugg = reasonsOk.filter((s) => /P07 cites it/.test(s)).map((s) => s.split(' ')[0]);
  const p07Targets = G.citations.verified.filter((c) => c.source === P07 && c.targetInGraph).map((c) => c.target.slice(0, 2));
  check(citedSugg.length > 0 && citedSugg.every((lab) => p07Targets.includes(lab.slice(1, 3))), `"P07 cites it" only for matched citations (${citedSugg.join(', ')})`);
  const firstCited = page.locator('.suggest li', { hasText: 'P07 cites it' }).first();
  const targetLabel = (await firstCited.textContent()).trim().split(/\s/)[0];
  await firstCited.locator('button').click(); clicks++;
  await page.waitForTimeout(700);
  const hash = await page.evaluate(() => location.hash);
  check(hash.startsWith(`#/compare/${P07}/${targetLabel.slice(1, 3)}-`), `comparison P07 × ${targetLabel} loaded`);
  const summary = await text(page, '.summary');
  check(new RegExp(`P07 cites ${targetLabel} \\(matched in P07’s reference list`).test(summary), 'summary: "matched", not "verified"');
  await page.click('.cite > summary'); clicks++;
  const citeBody = await text(page, '.cite[open] .citebody');
  check(/Automated match, not reviewed by a person/.test(citeBody), 'citation provenance says automated, not human-reviewed');
  await page.locator('.rows .row-details summary').first().click(); clicks++;
  const cmpMeta = await page.$$eval('.row-details[open] .pairq .qmeta', (els) => els.map((e) => e.textContent.trim()));
  check(cmpMeta.length > 0 && cmpMeta.every((t) => /found in pdf|approximate pdf match|not found in pdf/.test(t)), `Compare quotes use the same local PDF check as the inspector (${cmpMeta.join(' | ')})`);
  await page.locator('.row-details[open] .pairq .quote').first().click(); clicks++;
  await page.waitForTimeout(400);
  const tags = await page.$$eval('.inspector-panel .evidence > li .evmeta .tag', (els) => els.map((e) => e.textContent.trim()));
  check(tags.some((t) => /^Found in PDF · p\. \d+/.test(t)), `supporting evidence shows the PDF match (${tags.slice(0, 2).join(' | ')})`);
  check(/does not confirm that the extracted claim reads them correctly/.test(await text(page, '.inspector-panel')), 'quote matching ≠ semantic validation is stated');
  log(`     clicks from search to evidence: ${clicks} (plus typing the query)`);
  check(clicks <= 7, 'workflow completes in at most 7 clicks');
  check(!(await overflow(page)), 'no horizontal overflow');
  await shot(page, 'final-1-workflow.png');

  log('== wording: hypotheses, AI-assisted verdicts, graph gaps');
  await page.goto(`${URL}#/entity/alignment-faking`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const claimTip = await page.getAttribute('.inspector-panel .claimrow .claim-observed', 'title');
  check(/Classified by the extraction/.test(claimTip || ''), 'claim-type badges are presented as extractor labels');
  await page.goto(`${URL}#/gap/no-mitigation:gradient-hacking`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const gap = await text(page, '.inspector-panel');
  check(/AI-assisted review \(claude-opus-5-5/.test(gap) && /not a human review/.test(gap), 'gap verdict labelled AI-assisted, not human');
  check(/No claim in the graph reports/.test(gap), 'gap type explained in terms of the graph');
  check(!/A reviewer checked the papers/.test(gap), 'no claim that papers were checked');
  await page.click('.tabs button:has-text("Gaps")');
  check(/can be a real research gap or a link the extraction missed/.test(await text(page, '.tabpanel .intro')), 'Gaps tab distinguishes graph gaps from research gaps');
  await shot(page, 'final-2-gap-verdict.png');
  await ctx.close();

  log('== stale grounding data (intercepted in the browser only)');
  ({ ctx, page } = await open(1440, 900));
  await page.route('**/grounding.json', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...G, graphSha256: '0'.repeat(64) }) }));
  await page.goto(`${URL}#/compare/${P07}/${P33}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  check(await page.isVisible('.datanote.stale'), 'stale strip shown');
  check(/different version of the graph, so they are not shown/.test(await text(page, '.datanote')), 'stale strip explains that the data is hidden');
  check((await page.$$('.cite')).length === 0, 'no citation rows from stale data');
  check(/not established from available data/.test(await text(page, '.summary')), 'summary falls back to "not established"');
  await page.goto(`${URL}#/entity/trusted-monitoring-with-defer-to-trusted`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const staleTags = await page.$$eval('.inspector-panel .evmeta .tag, .inspector-panel .claimrow .tag', (els) => els.map((e) => e.textContent.trim()));
  check(!staleTags.some((t) => /Found in PDF|Not found in PDF|Approximate PDF match|^Review$/.test(t)), `no PDF-match or review labels from stale data (${staleTags.join(' | ')})`);
  check(staleTags.includes('Extractor-validated') && !staleTags.includes('Validated quote'), 'fallback label names its source (extractor), not a generic "validated"');
  await shot(page, 'final-3-stale.png');
  await ctx.close();

  log('== 390 mobile: compare suggestions + stale strip');
  ({ ctx, page } = await open(390, 844));
  await page.goto(`${URL}#/compare/${P07}/_`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  check((await page.$$('.suggest li')).length > 0, '390: suggestions visible');
  check(!(await overflow(page)), '390: no horizontal overflow');
  await shot(page, 'final-4-mobile-suggest.png');
  await ctx.close();
  ({ ctx, page } = await open(390, 844));
  await page.route('**/grounding.json', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...G, graphSha256: '0'.repeat(64) }) }));
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  check(await page.isVisible('.datanote.stale'), '390: stale strip visible on mobile');
  check(!(await overflow(page)), '390: no overflow with strip');
  await ctx.close();

  log('\nconsole errors/warnings:', errors.length ? '\n' + errors.join('\n') : 'none');
  log(problems.length ? `FAILED ${problems.length}:\n - ${problems.join('\n - ')}` : 'ALL CHECKS PASSED');
  await browser.close();
  process.exit(problems.length ? 1 : 0);
})().catch((e) => { console.error('CRASH:', e.message); process.exit(1); });
