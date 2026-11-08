// Browser check of the citation / quote-provenance integration (read-only: it only loads pages and clicks).
//
// Prerequisites: a dev server (`npx vite --port 5199`) and Playwright with Chromium.
//   PLAYWRIGHT_MODULE=/path/to/node_modules/playwright node scripts/e2e/citation-flow.cjs [screenshot-dir]
// Defaults: BASE_URL=http://localhost:5199/, screenshots are skipped unless a directory is given.
const path = require('path');
const fs = require('fs');

const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const REPO = path.resolve(__dirname, '../..');
const URL = process.env.BASE_URL || 'http://localhost:5199/';
const SHOTS = process.argv[2] || null;
const G = JSON.parse(fs.readFileSync(path.join(REPO, 'public/grounding.json'), 'utf8'));

const P = {
  p01: '01-Greenblatt2024-AlignmentFaking',
  p03: '03-Hubinger2024-SleeperAgents',
  p07: '07-Schoen2025-StressTestingDeliberativeAlignment',
  p09: '09-Scheurer2023-DeceiveUnderPressure',
  p24: '24-Taylor2025-AuditingGamesSandbagging',
  p25: 'Simple-probes-can-catch-sleeper-agents-Anthropic',
  p33: '33-Guan2024-DeliberativeAlignment',
};
const problems = [];
const log = (...a) => console.log(...a);
const check = (ok, msg) => { log(`  ${ok ? '✓' : '✗'} ${msg}`); if (!ok) problems.push(msg); };
const verified = (s, t) => G.citations.verified.find((c) => c.source === s && c.target === t);
const compareUrl = (a, b) => `${URL}#/compare/${a}/${b}`;
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
const shot = (page, name) => (SHOTS ? page.screenshot({ path: path.join(SHOTS, name) }) : Promise.resolve());
const text = async (page, sel) => ((await page.textContent(sel)) || '').replace(/\s+/g, ' ');

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const watch = (page, tag) => {
    page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errors.push(`[${tag}] ${m.type()}: ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`[${tag}] pageerror: ${e.message}`));
  };
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  watch(page, 1440);
  const go = async (u) => { await page.goto(u, { waitUntil: 'networkidle' }); await page.waitForTimeout(700); };

  log('== P07 × P33: verified citation + shared concepts');
  await go(compareUrl(P.p07, P.p33));
  const c733 = verified(P.p07, P.p33);
  let summary = await text(page, '.summary');
  check(!!c733, 'fixture: P07 → P33 is verified in grounding.json');
  check(summary.includes(`P07 cites P33 (matched in P07’s reference list, p. ${c733.page})`), 'summary states direction and reference page');
  check(!/agree/i.test(summary), 'summary makes no agreement claim');
  const rows = await page.$$eval('.cite > summary .cdir', (els) => els.map((e) => e.textContent.trim()));
  check(rows.length === 1 && rows[0] === 'P07 cites P33', `one citation row with the correct direction (${rows.join(' | ')})`);
  await page.click('.cite > summary');
  const mark = (await page.textContent('.cite[open] mark')).trim();
  check(mark === c733.excerpt.match.trim(), `highlighted reference text equals grounding.json match (“${mark.slice(0, 60)}”)`);
  check((await text(page, '.cite[open] .qmeta')).includes(`pp. ${c733.block}`), 'provenance shows the reference-list page range');
  check(/does not show that they agree/.test(await text(page, '.compare .section:has(> summary:has-text("Citation"))')), 'citation section says citation ≠ agreement');
  const edges = await page.evaluate(() => window.__cy.edges('[kind = "derived-cites"]').map((x) => [x.source().id(), x.target().id()]));
  check(edges.length === 1 && edges[0][0] === `paper:${P.p07}` && edges[0][1] === `paper:${P.p33}`, 'graph draws one citation edge P07 → P33');
  await shot(page, 'cite-1-p07-p33.png');

  log('== P01 × P03: cited, but no shared entity');
  await go(compareUrl(P.p01, P.p03));
  summary = await text(page, '.summary');
  check(!!verified(P.p01, P.p03) && summary.includes('P01 cites P03'), 'P01 cites P03 shown');
  check(/incomplete extraction in the graph, not to the papers being scientifically unrelated/.test(summary), 'coverage explanation shown (graph gap, not scientific gap)');
  check(/No specific concept, method or model appears in both/.test(summary), 'no fabricated shared relationship');
  await shot(page, 'cite-2-p01-p03.png');

  log('== P01 × P09: verified one way, ambiguous the other');
  await go(compareUrl(P.p01, P.p09));
  const dirs = await page.$$eval('.cite > summary .cdir', (els) => els.map((e) => e.textContent.trim()));
  check(dirs.length === 1 && dirs[0] === 'P01 cites P09', `only the verified direction is a citation row (${dirs.join(' | ')})`);
  check(/unconfirmed reference match/.test(await text(page, '.compare .section:has(> summary:has-text("Citation"))')), 'ambiguous P09 → P01 listed separately');
  check(!(await text(page, '.summary')).includes('P09 cites P01'), 'ambiguous direction not stated as a citation');

  log('== P24 × P33: ambiguous only → "not established", never "not found"');
  await go(compareUrl(P.p24, P.p33));
  summary = await text(page, '.summary');
  check((await page.$$('.cite')).length === 0 && !/P24 cites P33|P33 cites P24/.test(summary), 'no verified citation shown');
  check(/not established from available data\. 1 unconfirmed reference match/.test(summary), 'summary: not established, 1 unconfirmed match');
  check(!/neither reference list/.test(summary), 'summary does not claim "not found"');
  await page.click('.compare .section > summary:has-text("Citation")');
  await page.click('details.subtle > summary:has-text("unconfirmed")');
  await shot(page, 'cite-3-ambiguous.png');

  log('== P25 × P03: P25 has no reference list');
  await go(compareUrl(P.p25, P.p03));
  summary = await text(page, '.summary');
  check(verified(P.p03, P.p25) ? summary.includes('P03 cites P25') : /not established from available data/.test(summary), 'P25 pair handled without claiming "not found"');

  log('== evidence inspector: quote-match status and the P06 flag');
  await go(`${URL}#/entity/trusted-monitoring-with-defer-to-trusted`);
  const flagged = page.locator('.claimrow:has(.tag:has-text("Review"))');
  check((await flagged.count()) >= 1, 'flagged claim marked "Review" in the claims list');
  await flagged.first().click();
  await page.waitForTimeout(300);
  const flag = await text(page, '.inspector-panel .callout.flag');
  check(/Flagged for review/.test(flag) && /could be located/.test(flag), 'P06 claim shows the review callout');
  const tags = await page.$$eval('.inspector-panel .evidence > li .evmeta .tag', (els) => els.map((e) => e.textContent.trim()));
  check(tags.some((t) => t.startsWith('Not found in PDF')), `unmatched quote tagged (${tags.join(' | ')})`);
  check(/does not confirm that the extracted claim reads them correctly/.test(await text(page, '.inspector-panel')), 'semantic-correctness disclaimer shown');
  await shot(page, 'cite-4-p06-flag.png');
  await go(`${URL}#/entity/alignment-faking`);
  const etags = await page.$$eval('.inspector-panel .evidence > li .evmeta .tag', (els) => els.map((e) => e.textContent.trim()));
  check(etags.some((t) => /^Found in PDF · p\. \d+/.test(t)), `exact matches show their page (${etags.slice(0, 3).join(' | ')})`);

  log('== paper details: Citations section → Compare');
  await go(`${URL}#/paper/${P.p07}`);
  await page.click('.inspector-panel .section > summary:has-text("Citations")');
  const chips = await page.$$eval('.inspector-panel .section:has(> summary:has-text("Citations")) .chip.paper', (els) => els.length);
  const expected = G.citations.verified.filter((x) => (x.source === P.p07 && x.targetInGraph) || (x.target === P.p07 && x.sourceInGraph)).length;
  check(chips === expected, `P07 citations listed: ${chips} (grounding.json: ${expected})`);
  await page.locator('.inspector-panel .section:has(> summary:has-text("Citations")) .chip.paper', { hasText: 'P33' }).first().click();
  await page.waitForTimeout(600);
  check((await page.evaluate(() => location.hash)) === `#/compare/${P.p07}/${P.p33}`, 'citation chip opens Compare for the pair');
  check(!(await overflow(page)), '1440: no horizontal overflow');
  await page.close();

  log('== 390 mobile');
  const m = await browser.newPage({ viewport: { width: 390, height: 844 } });
  watch(m, 390);
  await m.goto(compareUrl(P.p07, P.p33), { waitUntil: 'networkidle' });
  await m.waitForTimeout(700);
  check((await text(m, '.summary')).includes('P07 cites P33'), '390: citation in summary');
  await m.click('.cite > summary');
  check(await m.isVisible('.cite[open] mark'), '390: provenance expands');
  check(!(await overflow(m)), '390: no horizontal overflow');
  await shot(m, 'cite-6-mobile.png');

  log('\nconsole errors/warnings:', errors.length ? '\n' + errors.join('\n') : 'none');
  log(problems.length ? `FAILED ${problems.length}:\n - ${problems.join('\n - ')}` : 'ALL CHECKS PASSED');
  await browser.close();
  process.exit(problems.length ? 1 : 0);
})().catch((e) => { console.error('CRASH:', e.message); process.exit(1); });
