# Demo readiness

This document covers preparing ResearchGraph for a live demo. No scientific analysis changed:
- the graph, the gap engine and the scientific claims are untouched;
- no PDF extraction was rerun;
- nothing was committed or pushed.

## 1. What changed in this pass

| Area | Change | Files |
|---|---|---|
| **Reproducible layout** | fcose takes its random start from `Math.random` during a synchronous run (`animate: false`). Each layout run now swaps in a seeded PRNG (mulberry32) whose seed is an FNV-1a hash of the exact visible node and edge ids, and restores the original right after. Same dataset and view give the same picture on every reload, after navigating away and back, and at any window size (model coordinates). Different views still get their own layouts. Dragging, clicking, zoom and double-click are unchanged. | `src/components/GraphView.tsx` |
| **Integrity without count fallback** | The "matched by node and link counts only" path is **removed**. The app hashes the exact graph bytes it loads (SHA-256) with Web Crypto, or with a portable FIPS 180-4 implementation when Web Crypto is unavailable (plain HTTP on a LAN address). Grounding data is used **only on an exact hash match**. A different hash *or* an unknown hash hides all citation and PDF-match data and shows a one-line explanation. | `src/data/sha256.ts` (new), `src/data/api.ts`, `src/analysis/grounding.ts`, `src/ResearchGraphDashboard.tsx` |
| **Build-time fingerprint** | A Vite plugin hashes `public/graph.json` at build time. **`npm run build` fails** if `public/grounding.json` was produced for a different graph (the dev server only warns). The fingerprint is written to `dist/graph-integrity.json`. | `vite.config.ts`, `scripts/graph-integrity.ts` (new) |
| **Production-testable** | The browser-test handle (`window.__cy`) is available in production builds **only** with an explicit `?e2e` URL flag. Normal URLs don't expose it (checked). | `src/components/GraphView.tsx` |
| **Tests** | +4 unit tests: SHA-256 vectors and agreement with Node crypto on the real graph; no count fallback; a same-count edit is stale; the build gate fails on a same-count edit (temp-dir fixtures, `public/` never written). New production browser suite. | `scripts/test-grounding.ts`, `scripts/e2e/demo-readiness.cjs` (new) |

## 2. Demo setup (production build)

```bash
npm install                      # once
npm test                         # 36 tests; must pass
npm run build                    # fails if graph.json and grounding.json don't belong together
npx vite preview --port 4199     # serves dist/ at http://localhost:4199/
```

Before going on stage:
1. Open `http://localhost:4199/#/compare/07-Schoen2025-StressTestingDeliberativeAlignment/33-Guan2024-DeliberativeAlignment`. There should be **no** amber strip under the top bar, and the summary should read *"Citation: P07 cites P33 (matched in P07's reference list, p. 27)."*
2. `cat dist/graph-integrity.json` should show `"match": true`.
3. Use a desktop browser window of about 1440×900. Mobile works, but the story reads best on desktop.
4. Dismiss the "How to explore" card once, or leave it for the opening, since it explains the clicks.
5. Serve from **localhost or HTTPS** if you can. Plain HTTP on a LAN IP also works now (portable hash), but the first load spends a little longer hashing.

If you ever replace `public/graph.json`, re-run `scripts/grounding/pipeline.py` and `scripts/grounding/export_frontend.py` before `npm run build`. The build refuses to ship a mismatched pair.

## 3. A reliable paper-comparison scenario (about 3 minutes)

All of this is checked by the browser suites against the production build.

1. **Search** "deliberative alignment" in the top bar. P07 (*Stress Testing Deliberative Alignment*) appears in the ranked results with a "Mentions …" reason.
2. **Open P07.** The details panel shows what it studies; the graph shows its neighbourhood (same layout every time).
3. **Click "Compare with…"** to get one-click partners. The top three are papers P07 cites (*"P07 cites it (matched reference) · shares N concepts"*), followed by papers that share concepts. To show the strongest story, pick **P33** from the Paper B selector (type "Guan"), or open the deep link above.
4. **Read the summary**, along these lines: "They share 1 specific concept (*overrefusal*) and 1 method (*deliberative alignment*), which appears in both papers' reported results. Strongest link: both include deliberative alignment. **P07 cites P33**, matched in P07's reference list, p. 27."
5. **Expand the citation:** the reference-list excerpt has the arXiv ID **2412.16339** highlighted, and it's labelled *"Automated match, not reviewed by a person."* In the graph, a dotted arc runs P07 → P33.
6. **Open "Shared concepts" → *overrefusal*:** one quote from each paper, each tagged *found in pdf* with its page. Click a quote and the details panel lists that paper's quotes, with *"Found in PDF · p. N"* and the disclaimer that this doesn't validate the claim.
7. **Show honesty under uncertainty** (optional, 30 seconds):
   - `#/compare/01-Greenblatt2024-AlignmentFaking/03-Hubinger2024-SleeperAgents`: *P01 cites P03*, yet the graph shares nothing with it, and the app says this is incomplete extraction, not unrelated science.
   - `#/compare/24-Taylor2025-AuditingGamesSandbagging/33-Guan2024-DeliberativeAlignment`: *"not established … 1 unconfirmed reference match"*.
8. **Flagged claim** (optional): `#/entity/trusted-monitoring-with-defer-to-trusted` → the claim with the *Review* tag → *"Not found in PDF"* and *Flagged for review*.

Measured on the production build: a cold load straight to the P07 × P33 comparison takes about **0.6 s** on this machine.

## 4. Validation actually run (final code)

Each command was run separately and its full output reviewed.

| Command | Result |
|---|---|
| `npm test` | **36 passed, 0 failed** (17 comparison + 19 grounding/integrity) |
| `npm run lint` | No warnings or errors |
| `npm run build` | Passes; integrity gate `match: true`; 898 kB JS (the existing cytoscape chunk-size warning remains) |
| `node scripts/e2e/demo-readiness.cjs` (production preview, port 4199) | **25 of 25**, 0 console errors |
| `node scripts/e2e/credibility-flow.cjs` with `BASE_URL=http://localhost:4199/?e2e` | **29 of 29**, 0 console errors (full workflow at 1440 and 390 px) |
| `node scripts/e2e/citation-flow.cjs` with `BASE_URL=http://localhost:4199/?e2e` | **29 of 29**, 0 console errors (citations, quote provenance, P06 flag, desktop and mobile) |

What `demo-readiness.cjs` checks on the **production** build:
- **Test handle:** not exposed without `?e2e`.
- **Build fingerprint:** served, with `match: true`.
- **Reproducible layout:** identical node positions across two fresh browser contexts for overview (110 nodes), compare P07×P33 (11), paper P01 (42), entity *alignment faking* (48) and topic search (57). Also identical after navigating away and back, and at 390 px. Different views still get different layouts.
- **Interaction:** clicking opens details; nodes can be dragged; zoom works.
- **Same-count tamper:** `graph.json` served with one label changed ("Claude 3 Opus" → "Claude 3 Opvs", identical node and edge counts, in the browser only). The stale strip appears, there are no citation rows, the summary says "not established", and there are no PDF-match or review labels.
- **No Web Crypto:** integrity is still established by the portable hash (citation shown), and a same-count edit is still caught.
- **Demo deep link:** works without `?e2e`.

*Test-quality note.* The first run reported "nodes can't be dragged". The cause was in the test: clicking a node opens the details panel, which resizes the canvas, so the drag started at a stale screen position. After re-reading the position, dragging works. The app wasn't changed for this.

## 5. Known limitations

- **Reproducibility scope.** The layout is reproducible for the same dataset, view and filter state, using this version of `cytoscape-fcose`. A library upgrade, a changed graph, or toggled filters give a different (but again reproducible) layout. Manual drags aren't saved across reloads.
- **What integrity covers.** It covers `graph.json` ↔ `grounding.json`. It does *not* prove that `grounding.json` itself is correct; that rests on the pipeline and its tests. `gap_verifications.json` is keyed by gap id and isn't hash-bound to the graph.
- **First-load cost:** the portable SHA-256 on plain-HTTP LAN hosting adds hashing time for the 5 MB graph. That wasn't benchmarked separately; under localhost, Web Crypto is used.
- **`?e2e` flag:** this exposes the Cytoscape instance on `window.__cy` in production. It's harmless (read and write access to an in-page graph view), but don't share `?e2e` links.
- **Bundle size:** about 898 kB JS (cytoscape), not code-split.
- **Scientific limitations are unchanged** (see `FINAL_CREDIBILITY_AUDIT.md`):
  - citations are automated matches;
  - verdicts are AI-assisted;
  - "Found in PDF" means the words are present, not that the claim was validated;
  - 5 curated papers aren't in the graph.
- **Not tested:** physical touch devices, screen readers, Firefox and Safari.
- **Servers left running from testing:**
  - dev server on port 5199;
  - production preview on port 4199.
