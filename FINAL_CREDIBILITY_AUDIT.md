# Final scientific-credibility and usability audit

This pass checked wording, staleness handling and the main research workflow. The changes are small and targeted:
- no new features or redesign;
- the graph (`public/graph.json`), the gap engine (`src/analysis/gaps.ts`), the verdict file and the grounding pipeline are untouched, with no diff against HEAD for the tracked files;
- no PDF extraction was rerun;
- no LLM was used to analyze papers;
- nothing was committed or pushed.

## 1. Changes made

### Staleness: stale evidence is never shown as checked
| Before | After |
|---|---|
| The browser compared only node and link counts, and `GroundingIndex.issues` was never shown | `fetchGraph` fingerprints the exact graph bytes (SHA-256, Web Crypto) and `buildGroundingIndex` compares them with the export's `graphSha256` (`src/data/api.ts`, `src/analysis/grounding.ts`) |
| Stale data would still label citations and quotes | On a hash or count mismatch, the index is marked `stale` and **not used at all**: no citation rows, no PDF-match tags, no review flags. Quotes fall back to the graph's own extractor status, now labelled **"Extractor-validated"** (`src/ResearchGraphDashboard.tsx`) |
| Nothing visible | A one-line strip under the top bar, shown only when there's an issue. It's amber when stale ("…produced for a different version of the graph, so they are not shown"), and neutral when the browser can't fingerprint the graph (non-secure context: matched by counts only). It's visible on mobile too. |

### Terminology
| Distinction | Before | After |
|---|---|---|
| Locally matched vs human-reviewed citations | "P07 cites P33 (**verified** in P07's reference list)"; "The citation is **verified**"; graph-edge note "Verified in…" | "**matched** in P07's reference list"; provenance says "**Automated match, not reviewed by a person**"; the Citation section and the paper's Citations section say "matched automatically… not reviewed by a person" |
| AI-assisted vs human gap verdicts | "**A reviewer checked the papers** and the gap is real"; "Reviewed by claude-opus-5-5" | "The reviewer **judged** the gap real…"; "**AI-assisted review** (claude-opus-5-5, 2026-11-07), **not a human review**", with the verdict file's method (graph quotes plus model knowledge, PDFs not re-read) as tooltip; legend "Gap review verdicts (AI-assisted)"; Gaps tab "verdicts are AI-assisted reviews, not peer review" |
| PDF quote matching vs semantic validation | Inspector said "Found in PDF" with a disclaimer, but Compare showed the extractor's "validated quote" for the same quote | Compare now uses the **same local check** as the inspector ("found in pdf"); the disclaimer is unchanged; the fallback is named by its source ("Extractor-validated") |
| Missing graph relationships vs missing science | Gap types said "**no method in the collection is reported** to detect…"; Gaps tab said "places where these papers leave a question open"; cited-but-no-overlap said "extraction coverage is probably incomplete" | Gap types now describe the **graph** ("No claim in the graph says…"); Gaps tab: "A gap in the graph can be a real research gap or a link the extraction missed"; cited-but-no-overlap: "…points to incomplete extraction in the graph, not to the papers being scientifically unrelated" |
| Unconfirmed reference vs confirmed absence | "not found" summary said "**neither reference list cites the other**" / "neither lists the other paper" | "Citation: **none found** in either reference list (automated search; a match can be missed)"; reason: "…not proof that neither paper cites the other". Ambiguous-only pairs stay **"not established … 1 unconfirmed reference match"**. Paper panel: "None found (automated search)" |
| Observed vs hypothesized | Badge tooltips stated the claim type as fact ("Reported as an experimental result") | "**Classified by the extraction** as a result the paper reports (automatic label; check the quote)", and likewise for hypothesized and cited. The badges themselves are unchanged. |

### Workflow fix (one dead end)
**Before:** search → paper → "Compare with…" opened an empty second selector.

**After:** Compare offers up to 6 one-click partners:
- papers the chosen paper **cites or is cited by** (matched references), ranked by shared-concept similarity, with their reason ("P07 cites it (matched reference) · shares 2 concepts");
- then related papers that **actually share** concepts.

Building the suggestions also surfaced a misleading label: "shares **0** concepts" could appear, because the existing similarity score adds a bonus for author–year mentions. Zero-overlap suggestions are now excluded. Each reason is checked against `grounding.json` in the browser test.

### Files changed in this pass
| File | What changed |
|---|---|
| `src/data/api.ts`, `src/App.tsx` | Graph fingerprint |
| `src/analysis/grounding.ts` | `stale` and `fingerprint` fields, issue texts |
| `src/ResearchGraphDashboard.tsx` | Stale gating, status strip, compare suggestions, review-method tooltip |
| `src/components/ComparePanel.tsx` | Wording, suggestions, shared quote provenance |
| `src/components/Inspector.tsx` | Wording, AI-review label, extractor fallback label |
| `src/components/copy.ts`, `GapsPanel.tsx`, `InsightsPanel.tsx`, `ui.tsx` | Wording |
| `src/analysis/compare.ts` | "Not found" reason text only |
| `src/analysis/views.ts` | Citation-edge note text only |
| `src/index.css` | Strip and suggestion styles |
| `scripts/test-grounding.ts` | Staleness tests and a wording guard |
| `scripts/e2e/citation-flow.cjs` | Two assertions updated to the new wording |
| `scripts/e2e/credibility-flow.cjs` | **New** browser check |
| `CITATION_INTEGRATION.md` | One limitation line corrected |

## 2. Tests actually run (final code, each command run separately, full output reviewed)

| Command | Result |
|---|---|
| `npm test` | **33 passed, 0 failed.** 17 comparison tests, plus 16 grounding tests, of which 2 are new: staleness (wrong hash, wrong counts, no hash) and a wording guard that fails if "verified in … reference list", "A reviewer checked the papers", "neither lists the other paper", the old gap wording or the old claim tooltip reappear |
| `npm run lint` | No warnings or errors |
| `npm run build` | Passes (896 kB JS; the existing cytoscape chunk-size warning remains) |
| `node scripts/e2e/credibility-flow.cjs` | **29 of 29**, 0 console errors |
| `node scripts/e2e/citation-flow.cjs` | **29 of 29**, 0 console errors |

`credibility-flow.cjs` runs headless Chromium at 1440 and 390 px and checks:
- **Main workflow, 7 clicks:** search "deliberative alignment" → P07 → Compare with… → suggested P02 (P07 cites it) → citation provenance → shared-concept quote → evidence "Found in PDF · p. N".
- **Suggestion reasons:** all true.
- **Wording:** citation, verdict and gap wording as described above.
- **Stale data:** simulated by intercepting `/grounding.json` in the browser only, with no file changed. The strip is shown, there are no citation rows, no PDF-match or review labels, the summary says "not established", and the fallback reads "Extractor-validated".
- **Layout:** no overflow on desktop or mobile.

Both browser scripts live in the repo and were reviewed before running. They use an existing local Playwright install (`PLAYWRIGHT_MODULE`) and a dev server on port 5199. The earlier scratch scripts outside the repo were **not** run in this pass.

*Test-quality notes:*
- My first version of the workflow test assumed P33 would be among the top suggestions. Under the existing similarity score it isn't, so I changed the test to verify each stated reason instead.
- One check (`count >= 0`) was vacuous and was removed rather than counted.

## 3. Scientific limitations
- **The graph is an automated extraction.** Every entity, claim and claim type (observed, hypothesized, cited) is an extractor output. Only 1,152 unique quotes support it, and coverage is uneven: P32 has 9 extracted concepts, P25 has 8.
- **Five curated papers (#11–#15) aren't in the graph.** Gaps near their topics (sycophancy, sabotage, situational awareness) may be artifacts.
- **Gap verdicts are an AI-assisted review** (claude-opus-5-5) of graph quotes plus the model's prior knowledge of the papers. The PDFs weren't re-read, and nobody independently reviewed them.
- **Citations are automated reference-list matches:** arXiv ID, exact title, title prefix plus author/year, or author+year with ≥80% title overlap. 237 are matched (174 between graph papers) and 18 are ambiguous. Three PDFs have no locatable reference list (#11, #12, P25).
- **"Found in PDF" means the quote's words occur in the PDF text layer.** It says nothing about whether the claim built on them is correct, typed correctly, or has the right polarity. 8 claims typed "observed" have hedged quotes and are flagged, but they aren't resolved.
- **Shared concepts depend on entity naming.** Synonyms and abbreviations split across papers (e.g. "CoT monitor" vs "chain-of-thought monitoring") reduce overlap. Alias candidates exist in `analysis/grounding/` but were not merged.
- **The gap rules are structural heuristics.** On the 60 reviewed gaps, 42 were judged real or partly real and 18 false positives (AI-assisted judgement).

## 4. Claims that are safe to make in the demo
- "Every claim in the graph links to a quote and page from its source paper. 1,148 of 1,152 quotes were found verbatim in the paper's own PDF text by a local check, and 1,151 sit on the stated page."
- "One claim's quote couldn't be found in its paper, and the app flags it for review instead of hiding it."
- "Citations between papers are matched automatically in each paper's reference list (174 between papers in the graph). Each comes with the reference excerpt and page, and uncertain matches are shown separately and never counted."
- "The comparison only reports overlap that exists in the graph, with quotes from each paper. It never says two papers agree or disagree."
- "When a paper cites another but the graph shows no shared concept, the app says the graph's extraction is probably incomplete for that pair, and it doesn't invent a relationship."
- "Gaps are leads generated from the graph's structure. Each one carries an AI-assisted review verdict, and about 70% were judged real or partly real."
- "No language model was called to produce the citation or quote checks. They ran locally in a few seconds, and reruns are cached."
- "If the evidence data doesn't match the loaded graph, the app hides it and says so."

## 5. Claims that must not be made
- ~~"The citations are verified"~~ or ~~"human-verified"~~. They're **automated matches**.
- ~~"Paper X does not cite paper Y"~~. "None found" is an automated search result, and ambiguous cases are "not established".
- ~~"The claims are verified"~~ or ~~"fact-checked"~~. Only the quote text was matched to the PDF; interpretation, claim type and polarity were not checked.
- ~~"Experts reviewed the gaps"~~ or ~~"peer-reviewed gaps"~~. The verdicts are **AI-assisted**, from graph quotes plus model knowledge, without re-reading the PDFs.
- ~~"These are the open problems in AI safety"~~. They're **leads within this 30-paper graph**, and some are extraction artifacts.
- ~~"Papers that cite each other agree"~~, or that shared concepts imply agreement.
- ~~"The graph is complete"~~ or ~~"covers the field"~~. It's 30 of 35 curated papers, with uneven extraction depth.
- ~~"Observed" means experimentally proven.~~ It's the extractor's classification of the quote.
- ~~"Multi-agent"~~ or ~~"AI reads the papers live"~~. The app runs deterministic, client-side analysis over a precomputed graph.

## 6. Remaining risks
- ~~**Demo-path risk:** fcose layouts are randomized per view.~~ *Resolved in the demo-readiness pass:* layouts are now seeded per view and reproducible (see `DEMO_READINESS.md`).
- **Stale-data risk:** if `graph.json` is replaced without re-running `pipeline.py` and `export_frontend.py`, all citation and quote checks disappear. The app is honest about this, but it's a degraded demo.
- ~~**Non-secure context:** count-only matching.~~ *Resolved in the demo-readiness pass:* the count fallback was removed, and a portable SHA-256 now runs where Web Crypto is unavailable (see `DEMO_READINESS.md`).
- **Ranking risk:** suggestions and "related papers" use the existing IDF similarity, which favours entity-rich papers (P07's top suggestions are P02 and P01, not P33). That's acceptable, but it's not a relevance judgement.
- **Wording drift:** the wording guard covers the main phrases, but new UI text could reintroduce "verified" without tripping it.
- **Untested:** real touch devices, screen readers, Firefox and Safari; keyboard-only use of the graph canvas.
- **Bundle size** (~896 kB) can delay the first load on slow connections.
- **Background process:** the dev server started for testing is still running on port 5199.
