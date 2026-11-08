# ResearchGraph viz: handoff summary

**Status (2026-11-07):** working. `npm run build` passes, and the app renders against the real graph with no console errors. I visually checked four views: overview, topic, paper and gap. All 60 engine gaps have reviewer verdicts.

## What it is

It's a React + TypeScript + Vite dashboard that visualizes the knowledge graph from the backend's `GET /graph` (networkx node-link JSON), styled after `ResearchGraph_Dashboard_UI.pdf`. It does four jobs:

1. **Topic research.** Type a topic and it ranks the matching entities and papers, shows each paper's *aligned papers*, which corpus papers it *mentions*, what it *uses* (methods, evaluations, models), and every label on the paper.
2. **Evidence inspector.** For any node or edge it shows the quotes, page numbers, validation status (verified / fuzzy / unverified), claim type (observed / hypothesized / cited) and contexts.
3. **Gap engine.** It finds knowledge gaps from graph structure and suggests **how to resolve each one using only the uploaded corpus**: which method, evaluation, model or paper to borrow.
4. **Gap verification.** Reviewer verdicts from `public/gap_verifications.json` appear as badges, and dismissed gaps are filtered out of the suggestions.

## Run

```bash
npm install
npm run dev            # http://localhost:5173, reads public/graph.json
npm run build          # type-check + production build
npx tsx scripts/dump-gaps.ts public/graph.json gaps.generated.json   # headless gap run, for review
npm test               # comparison tests (all 435 pairs) + citation/quote-provenance integration tests
python3 scripts/grounding/pipeline.py --pdf-dir ~/Downloads/Research-schema_papers   # local grounding pass -> analysis/grounding/REPORT.md
python3 -m unittest scripts/grounding/test_pipeline.py                                 # its unit tests (synthetic text, no PDFs)
python3 scripts/grounding/export_frontend.py                                           # analysis/grounding -> public/grounding.json (no PDF access)
```

To point it at the backend, create `.env.local` with either of these:

```
VITE_API_BASE=http://localhost:8000        # app calls {base}/graph
# or
VITE_GRAPH_URL=https://…/graph.json
VITE_GAP_VERIFICATION_URL=/gap_verifications.json   # optional
```

## Using it inside another React app

```tsx
import ResearchGraphDashboard from './src/ResearchGraphDashboard';
<ResearchGraphDashboard graph={rawGraphJson} verifications={verificationFileOrNull} sourceLabel="GET /graph" />
```

All analysis is client-side. Besides `/graph`, no other endpoint is required. `/papers` and `/insights` from the mockup aren't used; insights are computed from the graph.

Dependencies: `cytoscape`, `cytoscape-fcose` (layout), and React 19. Dev: `tsx`, `@types/cytoscape`.

## File map

| File | What it does |
|---|---|
| `src/types.ts` | Raw backend shapes (`RawGraph`, node and link types) and the normalized `GNode`, `GEdge`, `Evidence` and `PaperMeta` |
| `src/data/api.ts` | `fetchGraph()` and `fetchGapVerifications()`, configured with the env vars above |
| `src/data/graphIndex.ts` | `buildIndex(raw)` parses `evidence_json`, splits `papers` strings, and builds in/out adjacency, paper→entities and paper metadata. It also holds `PREDICATE_LABEL` |
| `src/data/paperMeta.ts` | Parses `paper_id` (`NN-AuthorYYYY-Title` or `NN-YYYY-Title`) and holds a title table for the 35 curated papers. `missingCorpusRanks()` reports curated papers absent from the graph |
| `src/analysis/text.ts` | Tokenizer, crude stemmer and Jaccard similarity |
| `src/analysis/search.ts` | `searchTopic()` scores nodes by query-token match (label > alias > passage) and ranks papers by evidence-weighted entity hits |
| `src/analysis/related.ts` | `alignedPapers()` (IDF-weighted cosine over shared entities), `buildCitations()` (author+year mention detection in passages) and `usesEdge()` (derived paper→entity edge) |
| `src/analysis/gaps.ts` | **Gap engine**, covering the 6 rule types plus corpus-only resolution search. See below |
| `src/analysis/verification.ts` | Verdict types and the `gap_verifications.json` schema |
| `src/analysis/insights.ts` | Data for the "Research discovery" panel: themes, shared methods, conflicts, underexplored areas and suggested directions |
| `src/analysis/compare.ts` | **Paper Relationship Explorer**: grounded two-paper comparison (shared concepts/methods with per-paper quotes, ranked evidence paths, findings, differences, gaps & coverage notes) plus `validatePath`. See `PAPER_COMPARISON.md` |
| `src/analysis/views.ts` | `buildView()` turns `{overview, topic, paper, entity, gap}` into the visible subgraph (filtered view, so 1,630 nodes never render at once). It adds synthetic Gap nodes and "leads to gap" / "could resolve" edges |
| `src/ResearchGraphDashboard.tsx` | The exportable component: top bar with search, sidebar tabs, graph stage and the contextual details panel. It holds all state and syncs the view to the URL hash (`#/paper/<id>` etc.), so browser Back/Forward and deep links work |
| `src/App.tsx` | Loading, error and retry states, wrapped around the dashboard |
| `src/components/GraphView.tsx` | Cytoscape canvas: styles, fcose layout, neighborhood highlight, tap to select and double-tap to re-centre. Exposes `fit`/`zoomBy` through a ref |
| `src/components/Inspector.tsx` | Details panel (opens only when something is selected), with variants for claims, gaps, papers and entities. Evidence comes first; secondary details are collapsible |
| `src/components/PapersPanel.tsx` | Sidebar "Papers" tab: pinned search results, example topics, corpus list, and the missing-papers notice |
| `src/components/InsightsPanel.tsx` | Sidebar "Discover" tab: the 5 insight lists as collapsible sections |
| `src/components/ComparePanel.tsx` | Sidebar "Compare" tab: two searchable paper selectors and the comparison report |
| `src/components/GapsPanel.tsx` | Sidebar "Gaps" tab: all gaps, filterable by verdict and type |
| `src/components/ui.tsx`, `copy.ts` | Shared UI primitives (icons, badges, popover, collapsible section) and plain-language copy for gap types and verdicts |
| `src/theme.ts` | Node colour and shape per type, plus edge colours |
| `src/index.css` | Dark theme matching the mockup |
| `scripts/dump-gaps.ts` | Runs the gap engine in Node and writes `gaps.generated.json` |
| `public/graph.json` | Copy of `research_knowledge_graph_improved.json` |
| `public/gap_verifications.json` | 60 verdicts with notes and corpus references |
| `GAP_VERIFICATION.md` | Write-up of the verification |

## Data contract (from the backend)

- **Nodes.** Entity nodes have `id, label, node_type, papers ("a; b"), paper_count, mention_count, evidence_json, …`. Paper nodes have `id = "paper:<paper_id>"`, plus `paper_id, source_pdf, pages_with_evidence`.
- **Node types:** Finding, Behavior, Hypothesis, Method, Concept, AIModel, ExperimentalCondition, EvaluationMethod, Mechanism and Paper. The graph has **no Gap or Limitation nodes**; gaps are derived in the frontend.
- **Links.** Semantic links have `predicate` (INVOLVES, EXHIBITS, INCREASES, REDUCES, MITIGATES, DETECTS, MEASURES, ENABLES, CORRELATES_WITH, IS_A, OBSERVED_UNDER), plus `negated`, `claim_type` (observed / hypothesized / cited), `contexts`, `validation_statuses` and `evidence_json`. Provenance links have `edge_kind: "provenance"`, `DOCUMENTS` (Paper → Finding/Hypothesis) and `page`.
- **No paper→paper citation edges exist.** "Mentions" in the UI is approximated from passages.

## Gap engine rules (`src/analysis/gaps.ts`)

**Key entities** are Behavior, Concept or Mechanism nodes with `paper_count ≥ 2` or `mention_count ≥ 4`.

| Kind | Fires when |
|---|---|
| `no-detection` | A phenomenon (a Behavior, or a Concept that something EXHIBITS / INCREASES) has no DETECTS or MEASURES edge from a Method or EvaluationMethod |
| `no-mitigation` | A Behavior has no *observed* MITIGATES or REDUCES edge from a Method |
| `untested-claim` | At least 2 hypothesized causal claims have no observed counterpart and observed claims are no more than half of them, or the entity is involved in mostly Hypothesis nodes rather than Findings |
| `single-source` | At least 3 papers mention the entity but at most one paper's observed edges support it |
| `narrow-models` | Observed EXHIBITS edges come from a single model family, after checking near-synonym entities |
| `conflict` | The same (source, target) pair has both negated and plain versions of a predicate, or both INCREASES/ENABLES and REDUCES/MITIGATES |

**Resolutions (corpus only)** are found by `related(entity)`, which collects the entity itself, its IS_A neighbours, similarly named entities (Jaccard ≥ 0.34) and entities co-involved in the same findings. It then looks for corpus edges like `Method -DETECTS/MITIGATES-> related entity`. Results are scored by relatedness × (observed ? 1 : 0.5) × log(evidence). `evalSetups()` adds "paper X already studies this entity and has evaluation Y you could reuse". For conflicts, ExperimentalConditions that move the target are listed as candidate moderators.

**Gap IDs are stable:** `kind:entityId` (or `conflict:src|tgt`). That lets verdicts survive engine re-runs as long as the backend keeps the same entity ids.

## Verification results

There are 22 confirmed, 20 partly addressed, 8 closed in corpus, 4 extraction artifacts and 6 not supported. `GAP_VERIFICATION.md` has the details. False positives come from three causes: entity-normalization splits, metrics treated as phenomena, and context-blind conflict detection.

## Known limitations / TODO (next person, start here)

1. **Five curated papers (#11–#15) aren't in the graph.** Re-ingest them, then re-run `scripts/dump-gaps.ts` and re-verify any new gap ids. Verdicts for ids that no longer appear are simply ignored.
2. **Engine improvements** from the verification, in priority order:
   - (a) merge near-synonyms before running rules;
   - (b) compare `contexts` in conflict detection;
   - (c) exclude metric-like and non-harmful entities.
3. **Citation detection** is approximate and sparse, and it's ambiguous for Greenblatt 2024 (three corpus papers share it). Prefer a backend `CITES` edge from the reference lists.
4. **Bundle size** is about 836 kB, mostly cytoscape. If that matters, lazy-load `GraphView` with `React.lazy`.
5. **Verdicts are static JSON.** To let users verify in the UI, add a POST endpoint and an editor in the Gap inspector.
6. **Layout** is fcose with `randomize: true`, so positions change on each view change. Cache positions per view if stable layouts are wanted.

## Local grounding pipeline (`scripts/grounding/`)

It's a read-only Python pass (PyMuPDF, standard library otherwise) that proposes citation edges, alias merges and suspicious relationships **without modifying the graph and without any model calls**. Outputs go to `analysis/grounding/` (start with `REPORT.md`).

- **Caching.** Extracted PDF text is cached in `.cache/grounding/`, which is git-ignored and must never be committed because it holds paper text. The cache is keyed by file SHA-256. Extraction, quote matching and citation matching are versioned separately (`EXTRACT_VERSION`, `QUOTE_VERSION`, `PIPELINE_VERSION`), so changing matching logic never re-extracts PDFs. An unchanged rerun takes about 0.7 s and does no work.
- **Review queue.** Cases that need semantic judgement are written to `review_queue.json`, capped at 10, each containing only a short passage. Nothing is sent anywhere automatically.
- **Frontend.** `export_frontend.py` writes `public/grounding.json`, which holds verified and ambiguous citations (kept separate), quote-match results and review flags. The app loads it optionally (`VITE_GROUNDING_URL`). The export refuses to run if `public/graph.json` changed since the pipeline ran. See `CITATION_INTEGRATION.md`.
- **Next step.** After a human validates the proposals, ingest them on the backend: `CITES` edges from `relationship_candidates.json → citation_backed`, and high-confidence aliases from `alias_candidates.json`. The frontend's Paper Relationship Explorer already reports `CITES` edges when they exist.
