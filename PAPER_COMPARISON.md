# Paper Relationship Explorer ("Compare papers")

It answers: **why are these two papers connected, what do they share, how do they differ, and where can I verify it?** Everything comes from the existing knowledge graph. The graph isn't modified, no edges are fabricated, and nothing calls an LLM.

## What the graph can and can't support

I checked this against `public/graph.json` before designing the feature:

| Fact | Consequence for the feature |
|---|---|
| No paper→paper edges and **0 reference-list passages** | A direct citation can never be established. The UI says **"Not established from available data."** If a backend later adds `CITES` edges, the code reports them (`compare.ts`, `citeEdges`). |
| Author–year text matches exist (e.g. Carlsmith 2023 names "Hubinger … 2019") | Shown separately as **author–year mentions**, labelled "not a reference-list check", with ambiguity flagged (Greenblatt 2024 matches 3 papers) |
| Every Finding and Hypothesis node belongs to exactly **one** paper | Papers never share a finding node. "Related findings" means *two findings that involve the same specific entity*, and is never called agreement or disagreement. |
| Every entity listed for a paper (1,735 of 1,735 listings) has a quote from that paper | Every shared or unique item shows quotes from the correct paper, with page numbers |
| Only 67 of about 1,600 entities appear in 2+ papers; 243 of 435 paper pairs share **no** specific entity | Empty results are common and are reported honestly, and indirect paths matter |
| Vague labels exist ("LLMs", "models", "frontier models") | Treated as generic: never used in a path, never counted as a connection, listed separately |
| `validation_status` is set by the extraction pipeline; ResearchGraph has no PDFs | Quotes are labelled **validated / approximate match / not validated**, meaning pipeline validation. Nothing in the app claims an original-PDF check. |

## The workflow

1. Open it in one of three ways: **Papers tab → "Compare two papers →"**, the **Compare** sidebar tab, or **"Compare with…"** in a paper's details panel (which pre-fills paper A).
2. Pick **Paper A** and **Paper B** with the searchable selectors (type a title, author or year; arrow keys and Enter work). You can swap the papers. There are example pairs.
3. A **summary** appears first:
   - what the papers share;
   - the strongest link;
   - citation status;
   - any claims that describe the same relationship;
   - the reminder that missing from the graph isn't missing from the paper.
4. The **graph** shows only the two papers, A pinned left and B pinned right, plus the connecting paths. Every drawn edge is a path edge.
5. Collapsible sections:
   - **Citation**
   - **How they connect** (ranked paths)
   - **Shared concepts**
   - **Methods & models** (shared methodology vs shared terms only)
   - **Findings** (same-relationship claims, findings about the same topic, and each paper's findings side by side)
   - **Differences**
   - **Gaps & coverage**
6. **Every item is clickable** and opens the existing details panel without leaving the comparison. A paper→entity item opens only that paper's quotes about it. A claim opens the claim. A finding opens the finding.
7. The URL is `#/compare/<A>/<B>`, so Back/Forward and links work.

## How each part is computed (`src/analysis/compare.ts`)

| Part | Rule |
|---|---|
| **Paper uses entity** | The node lists the paper **and** carries ≥1 quote from it. The role in that paper is taken from the strongest of: **in reported results** (a Finding the paper DOCUMENTS INVOLVES it, or an *observed* claim edge from that paper touches it), **hypothesized or cited only**, or **named only** |
| **Shared concepts** | Behavior, Concept or Mechanism used by both, ranked by specificity. Generic labels are listed separately and not counted |
| **Shared methodology vs terminology** | Method, Evaluation, Model or Condition used by both. It's *methodology* only if it's **in reported results in both papers**; otherwise it's *shared terms only* |
| **Specificity** | `ln(1 + N/df) / ln(1 + N)` over the 30 papers, ×0.1 for generic labels |
| **Paths** (max 2 entity hops) | 1. **shared**: A → X → B. 2. **linked**: A → X → (backend claim edge) → Y → B. 3. **co-studied**: A → X ← Finding/Hypothesis of any paper (with its DOCUMENTS edge) → Y → B. Generic entities are never used. Score = specificity of each entity × quote validation per hop × claim weight (observed 1, cited 0.6, hypothesized 0.5, indirect grounding ×0.7) × a length penalty. Every path is re-validated before display (`validatePath`) |
| **Same relationship** | Claim edges from each paper with **identical endpoints**, classified as same direction, opposite directions ("compare contexts") or different relationships |
| **Findings about the same topic** | One finding from each paper that INVOLVES the same specific entity; each finding is shown at most twice |
| **Differences** | Entities extracted from one paper only, methods first, with the caveat that absence from the graph doesn't prove absence from the paper |
| **Research gaps** | Gap-engine gaps (with their reviewer verdicts) whose papers include both A and B |
| **Never linked in the graph** | A method or evaluation from one paper's results × a behavior from the other paper's results, where **no edge or shared finding anywhere** connects them (near-synonyms count as linked; metrics are excluded). Labelled as possibly untested *or* missed by extraction |
| **Graph coverage notes** | Missing reference data, sparse papers (<25 extracted entities), mentions without overlap, and possible naming splits (same stemmed words, or ≥0.6 word overlap). These describe the data, not the science |

## Files

| File | Change |
|---|---|
| `src/analysis/compare.ts` | **New**: comparison engine plus `validatePath` |
| `src/components/ComparePanel.tsx` | **New**: selectors, summary, sections |
| `scripts/test-compare.ts` | **New**: 17 tests over the real graph (`npm test`) |
| `src/analysis/views.ts` | `compare` view mode: path-only subgraph, emphasized edges, pinned papers |
| `src/components/GraphView.tsx` | Emphasized-edge style; fcose `fixedNodeConstraint` for pinned papers |
| `src/components/Inspector.tsx` | "Compare with…" button; opens paper→entity quotes from anywhere (`uses:<paper>:<node>`); quote labels say "Validated quote" with an accurate tooltip |
| `src/components/PapersPanel.tsx` | "Compare two papers →" entry |
| `src/ResearchGraphDashboard.tsx` | Compare tab, `#/compare/A/B` route, comparison memo, details panel opens without leaving compare |
| `src/index.css` | Compare styles; tab sizing fix (4 tabs now fit a 280 px sidebar) |
| `package.json` | `"test": "tsx scripts/test-compare.ts"` |

Unchanged: `public/graph.json`, `public/gap_verifications.json`, `src/analysis/gaps.ts`, `src/data/*`, `src/types.ts`. The gap engine output is byte-identical to before (checked with `cmp`).

## Validation results

### `npm test`: 17 passed, 0 failed
- **All 435 pairs** compute, average 1.4 ms per pair. For every pair:
  - every path passes `validatePath`: real nodes and edges, Findings documented by the stated paper, INVOLVES edges real;
  - every shared or unique item's quotes come from the paper it's attributed to;
  - "unique" items are not actually present in the other paper;
  - related findings really INVOLVE the stated entity;
  - mention quotes come from the mentioning paper.
- **Citations:** no pair ever reports an established citation. The Carlsmith→Hubinger 2019 mention is found and the Greenblatt 2024 mentions are flagged ambiguous.
- **Closely related pairs:**
  - P01 × P29 share compliance gap, alignment faking and situational awareness; GPT-4o is shared methodology; there are 5 paths.
  - P23 × P24 share sandbagging.
- **Unrelated pairs:** 243 of 435 share no specific entity, and none of them gets a "shared" path. P01 × P25 has no path at all.
- **Generic concepts:** "LLMs", "models" and "frontier models" are detected; generics never appear inside any path in any pair. Paths are sorted by score, and a 2-paper entity outranks "sandbagging" (11 papers) on specificity.
- **Methodology vs terminology** holds for all pairs: 77 methodology items vs 34 terms-only.
- **Same-relationship claims** require identical endpoints (10 found, including the P01 × P29 Claude 3 Opus / alignment faking opposite-direction pair). Related findings carry no polarity at all.
- **Sparse coverage:** P32 (9 entities) is flagged. Every comparison states that reference data is missing.
- The raw graph object is unchanged after all 435 comparisons.

### Browser: 36 checks passed (headless Chromium, Playwright, 1440 / 1024 / 390 px), 0 console errors
- **Entry and selection:** the entry point works; typing filters the selector to a single paper and Enter selects it; the hash route updates.
- **Graph:** shows exactly the two papers, A left of B, and every drawn edge is a path edge.
- **Evidence:**
  - clicking a path entity opens "Mentioned in paper" with **only P01's quotes**;
  - a shared concept shows one labelled quote per paper;
  - clicking the P29 quote opens **P29-only** evidence, and the row stays open.
- **Sections:** the citation section separates mentions from citations and flags ambiguity; differences carry the absence caveat; coverage vs research gaps are labelled distinctly; opposite-direction claims say "compare contexts"; no agree/contradict wording.
- **Navigation:** swap and browser Back work. Unrelated, sparse, "Compare with…" pre-fill and example-pair flows work.
- **Layout:** no overflow at any width, including with details open on mobile.
- **Regression:** the earlier full UI suite (`flows.cjs`) still passes. It caught the 4-tab overflow, which I fixed and checked at 1440, 1280, 1024 and 800 px.

Screenshots: `docs/ux/cmp-*.png`.

### Build and lint
`npm run build` ✅ (882.6 kB JS; the existing cytoscape chunk-size warning remains) · `npm run lint` ✅ 0 warnings, 0 errors.

## Known limitations
- **Recall is limited by extraction.** Real relationships the extractor missed don't appear. The clearest case: P03 Sleeper Agents × P25 Simple probes share no entity, although P25 studies P03's models. The "never linked" list surfaces "defection probes × backdoored behavior" there, which is a coverage gap rather than a research gap, as the UI warns.
- **Naming splits** ("CoT monitor" vs "chain-of-thought monitoring") are detected only when the words overlap; abbreviations are missed.
- **The role "in reported results"** means the entity appears in a Finding or observed claim of that paper. That's a proxy for "used in experiments", not proof of it.
- **Paths stop at two entity hops,** so longer chains aren't searched.
- **The headless browser tests** don't cover real touch devices, screen readers, Firefox or Safari.
