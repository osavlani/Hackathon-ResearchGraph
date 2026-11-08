# Citation and quote-provenance integration

This document covers how the local grounding pipeline's verified results reach the ResearchGraph frontend. To produce them:
- no PDF was re-extracted;
- no model was called;
- `public/graph.json` was not touched;
- the gap engine was not changed.

## Data flow

```
analysis/grounding/*.json  ──(scripts/grounding/export_frontend.py)──▶  public/grounding.json  ──▶  app (optional)
       ▲ pipeline output                     reads the pipeline output + its local text cache only
```

`export_frontend.py` never opens a PDF:
- **Reference excerpts** come from the pipeline's cached reference-list text (`.cache/grounding/`), which turns its normalized snippets back into readable excerpts with the matched span highlighted.
- **Stale results are refused:** the script stops if `public/graph.json` changed since the pipeline ran (SHA-256 check).
- **Ambiguous citations stay separate:** the script asserts that each exported citation keeps its pipeline status, and drops any ambiguous entry whose direction is already verified.
- **Size and loading:** 241 KB, loaded alongside the graph. If it's missing, the app behaves exactly as before.

| `grounding.json` field | Contents |
|---|---|
| `citations.verified` / `citations.ambiguous` | Each entry has source, target, `*InGraph`, method, reference-list page, reference-block page range, and a highlighted excerpt `{before, match, after}`. Never merged. |
| `referencesChecked` / `referencesMissing` | Papers whose reference list was or wasn't located (missing: #11, #12 and P25, the Anthropic web page) |
| `quotes` | FNV-1a(`paper_id \0 passage`) → `{status: exact / fuzzy / not-found, pages, pageCheck, coverage}` for all 1,152 unique graph quotes |
| `flags` | Claims to review: the P06 claim whose quote is absent from the paper text, plus the 8 hedged "observed" claims from the review queue |
| `graphSha256`, `graphCounts`, `modelCalls` | Staleness check and provenance (`modelCalls: 0`) |

## What the user sees

**Compare papers** (existing view; no new tab or panel):

- **Summary.** It states the direction and source: *"Citation: P07 cites P33 (verified in P07's reference list, p. 27)."* Otherwise it says one of:
  - *"neither reference list cites the other"*, only when both lists were found and searched and no ambiguous match exists;
  - *"not established from available data"*, optionally with *"1 unconfirmed reference match"*.
  **An ambiguous match never yields "not found".**
- **Citation section** (opens by default when a citation exists): one collapsible row per direction (*P07 cites P33 · ref. list p. 27*). Expanding a row shows:
  - the reference-list excerpt with the matched arXiv ID, title or author highlighted;
  - the matching rule in plain words;
  - the page range of the reference list.

  Unconfirmed matches and author–year text mentions sit in their own collapsed lists, marked "not counted". The section also states: *"A citation shows the papers are connected; it does not show that they agree."*
- **Graph.** A dotted violet arc between the two pinned papers, pointing from the citing paper to the cited one, labelled with the reference page.
- **Cited but no shared entity.** When a verified citation exists but the graph links the papers through no specific concept, method or model, the summary adds that extraction coverage for this pair is probably incomplete. The same note appears under *Gaps & coverage*. No relationship is invented.

**Evidence inspector:**
- **One provenance tag per quote** from the local PDF check:
  - **Found in PDF · p. N** (green);
  - **Approximate PDF match** (amber);
  - **Not found in PDF** (red).

  A page disagreement is shown inline, and the tooltip also gives the extraction pipeline's status.
- **A one-line disclaimer** under the evidence: *"'Found in PDF' means these words appear in the paper. It does not confirm that the extracted claim reads them correctly."*
- **Flagged claims** show a *Flagged for review* callout. Their rows in an entity's claim list carry a small **Review** tag.
- **The P06 claim** "trusted monitoring with defer to trusted REDUCES backdoor risk relative to trusted monitoring" is flagged. Its only quote ("…(10%): 93% Write code with a subtle back- 83%") reads like flattened table text, which is the likely reason it couldn't be located.
- **Paper details** gain a collapsed **Citations** section (*Cites* / *Cited by*, verified only). Each paper chip opens Compare for that pair. The older author–year regex list stays below it, renamed *Author–year mentions (approximate)*.

## Files changed

| File | Change |
|---|---|
| `scripts/grounding/export_frontend.py` | **New.** Builds `public/grounding.json` from the pipeline output |
| `public/grounding.json` | **New** generated data file (the graph is unchanged) |
| `src/analysis/grounding.ts` | **New.** Types, `fnv1a` (same hash as the exporter), `buildGroundingIndex` (validates ids against the loaded graph; verified wins over ambiguous) |
| `src/analysis/compare.ts` | Optional `refs` argument. Citation status is now `established` / `not-found` / `not-established`, with `aCitesB` / `bCitesA` / `ambiguous`. New `cited-without-overlap` coverage note. Shared concepts, methods, paths and findings are computed exactly as before. |
| `src/analysis/views.ts` | Compare view draws verified citations as emphasized paper→paper edges |
| `src/components/ComparePanel.tsx` | Citation summary, collapsible citation rows with highlighted excerpts, unconfirmed matches and mentions kept apart |
| `src/components/Inspector.tsx` | Quote-match tags, disclaimer, review callout and "Review" tag, paper Citations section |
| `src/components/GraphView.tsx`, `src/index.css` | Citation-edge style; citation, excerpt and flag styles |
| `src/data/api.ts`, `src/App.tsx`, `src/ResearchGraphDashboard.tsx` | Optional loading of `/grounding.json` (`VITE_GROUNDING_URL`), passed down as an index |
| `scripts/test-grounding.ts` | **New.** 14 integration tests; `npm test` runs them after the comparison tests |
| `scripts/e2e/citation-flow.cjs` | **New.** Browser check (read-only; screenshots only when given a directory) |
| `HANDOFF.md` | Run commands and grounding → frontend notes |

## Validation

All commands were run separately, and their full output was reviewed.

**`npm test`: 31 passed, 0 failed** (17 existing comparison tests + 14 new).

*Citations:*
- **Pipeline identity.** Every exported verified citation is a pipeline-verified candidate with the same direction, page and method: 237 = 237.
- **Ambiguous never verified.** Ambiguous matches are never exported or indexed as verified. Across all directed pairs, every indexed citation is in the verified set.
- **Direction.**
  - `between(a,b).aCitesB` contains only a→b and mirrors `between(b,a).bCitesA`;
  - all 174 in-graph citations are reachable exactly once;
  - every in-graph paper id resolves to a Paper node.
- **Excerpts.** Every excerpt (255) highlights text that identifies the cited paper: an arXiv ID, the exact title, the title prefix, or the first author.
- **Status across all 435 pairs:**
  - *established* (171) exactly when a verified citation exists;
  - the 9 ambiguous-only pairs are all *not established*, with "could not be confirmed";
  - *not found* (229) only when both lists were searched and no ambiguous match exists;
  - *not established* 35 in total.
- **P25 pairs** are never "not found".
- **No inference from citations.** Comparison content (concepts, methods, paths, same-relationship claims) is identical with and without citation data, so citations never create inferred relationships.
- **Missing connections match the pipeline.** "Cited but no shared entity" notes appear only for verified citations with no specific overlap: 66 pairs, identical to the pipeline's list (67 directed = 66 unordered pairs).

*Quotes:*
- **Coverage.** All graph quotes have a match result, and the counts equal the pipeline summary: exact 1,148, fuzzy 3, not found 1.
- **The P06 claim is flagged,** and its quote is the only unmatched one.

*Integrity:*
- the graph SHA-256 equals both the pipeline's and the export's;
- the gap engine still yields the same 60 gap ids as the reviewed verdict file;
- `modelCalls` is 0.

**`npm run lint`:** no warnings or errors. **`npm run build`:** passes (892 kB JS; the existing cytoscape chunk-size warning remains).

**Browser** (`scripts/e2e/citation-flow.cjs`, headless Chromium, 1440 and 390 px): **29 of 29 checks passed, 0 console errors.**
- **P07 × P33:**
  - the summary gives direction and page;
  - there's no agreement wording;
  - exactly one citation row with the right direction;
  - the highlighted text equals the exported match;
  - the page range is shown;
  - one graph edge P07 → P33.
- **P01 × P03:** the citation is shown with the coverage explanation, and no shared relationship is invented.
- **P01 × P09:** only the verified direction appears as a citation; the ambiguous P09 → P01 is listed separately and is absent from the summary.
- **P24 × P33** (ambiguous only): no citation row; "not established … 1 unconfirmed reference match"; never "neither reference list".
- **P25 × P03:** not "not found".
- **Inspector:** the P06 claim shows the Review tag, the callout and "Not found in PDF"; the disclaimer appears; exact matches show their page.
- **Paper details:** P07's Citations list matches `grounding.json` (19), and a chip opens Compare for the pair.
- **Layout:** no horizontal overflow on desktop or mobile.

Screenshots: `docs/ux/cite-*.png`.

*Process note.* An earlier version reported ambiguous-only pairs as "neither reference list cites the other". The browser check caught this, and it was fixed so that ambiguous matches are always *not established*. The run had used a scratch script outside the repository; the browser check is now `scripts/e2e/citation-flow.cjs`, inside the repo and reviewed.

## Remaining limitations

- **Citation recall.** Citations are only as complete as reference-list detection. Three PDFs have no locatable reference list (#11, #12, P25), and unusual formatting can hide a match. That's why "not found" is worded as "searched, not found", and why pairs involving those papers say "not established".
- **Ambiguous matches.** 18 remain, mostly "Greenblatt 2024" (3 corpus papers) and Ngo 2022 apparently citing 2024 work (probably a later revision). They need a human look; they're shown but never counted.
- **Quote matching is lexical.** "Found in PDF" confirms the words, not the claim's interpretation, claim type or polarity. The 8 hedged "observed" claims are flagged for that reason but not resolved.
- **The citation edge exists only in the Compare view.** Other views don't draw citation edges, and nothing is added to the graph; ingesting `CITES` edges is a backend decision.
- **Running the browser check** needs a dev server and an existing Playwright install (`PLAYWRIGHT_MODULE`). It isn't part of `npm test`.
- **Staleness.** `public/grounding.json` must be re-exported whenever the pipeline is re-run. The exporter refuses stale input (SHA-256), and the tests check the hash. Since the final credibility pass, the browser also fingerprints the loaded graph (SHA-256). Mismatched data is hidden entirely, and a one-line strip explains why (see `FINAL_CREDIBILITY_AUDIT.md`).
