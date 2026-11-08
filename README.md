# **ResolveNet (ResearchGraph)**

**Connect research papers. Explore evidence. Find the missing links.**

Research Graph turns a collection of scientific papers into an interactive knowledge graph. It helps researchers explore connections, compare papers, inspect source quotations, and investigate *candidate* research gaps. The demo focuses on AI scheming, alignment faking, and sandbagging.

## What Research Graph Does

- **Topic search and graph exploration:** Explore papers, methods, models, findings, and their extracted relationships.
- **Evidence inspection:** Open claims to view their source quotations, page numbers, and available PDF-match status.
- **Paper comparison:** Compare two papers for shared concepts, methods, evidence paths, and automatically matched citations.
- **Connection Reveal:** Watch graph-supported connections appear progressively, then inspect the evidence behind each step.
- **Candidate gap detection:** Six graph-based heuristics identify missing detection, missing mitigation, untested claims, single-source evidence, narrow model coverage, and potentially conflicting claims.
- **AI-assisted gap assessments:** Review labels help prioritize candidates, but are not human verification or proof of scientific novelty.

### Demo corpus

| Metric | Reported value |
|---|---:|
| Papers represented in graph | 30 |
| Nodes | 1,630 |
| Relationships | 2,327 |
| Scientific claim edges | 551 |
| Candidate gaps | 60 |
| Extracted quotations checked against PDFs | 1,152 |

### PDF evidence grounding

A local Python/PyMuPDF pipeline compares extracted quotations against the source PDFs without additional AI calls. Reported results are **1,148 exact matches**, **3 approximate matches**, and **1 unmatched quotation** (99.65% exact). This checks whether quoted words occur in PDF text; it **does not** establish that the extracted claim or its interpretation is scientifically correct.

Citation links are automated reference-list matches, not human-reviewed citation verification. Grounding metadata is tied to the graph using SHA-256 so stale results are not presented as checked evidence.

### Gap assessment limitations

The engine produces **candidate gaps within the analyzed corpus**, not definitive claims that no one has studied a topic. The separate AI-assisted review classified 22 as confirmed within the corpus, 20 as partly addressed, 8 as closed in the corpus, 4 as extraction artifacts, and 6 as unsupported. These labels are automated judgments based on graph evidence and model knowledge; the original PDFs were not independently re-read during that review.

## Run Locally

### Requirements

- Node.js 20.19 or newer
- npm

### Installation

```bash
git clone https://github.com/osavlani/Hackathon-ResearchGraph.git
cd Hackathon-ResearchGraph
npm install
npm run dev
```

Open **http://localhost:5173** in your browser.

The default demo loads `public/graph.json` and does **not** require a backend.

### Other Commands

```bash
npm run build      # Create a production build
npm run preview    # Preview the production build locally
npm test           # Run project tests
npm run lint       # Check linting
```

### Optional Backend Graph Source

If you have a compatible backend exposing `GET /graph`, create a `.env.local` file containing:

```env
VITE_API_BASE=http://localhost:8000
```

The frontend then loads the graph from that endpoint instead of the bundled file. This is optional and not required for the demo.

## Tech Stack

- **Frontend:** React, TypeScript, Vite
- **Graph visualization:** Cytoscape.js with fcose layout
- **Analysis:** Browser-side graph indexing, paper comparison, and rule-based gap detection
- **Grounding:** Python and PyMuPDF
- **Data:** Bundled JSON graph, grounding, and gap-review exports

## Project Structure

```text
src/                    React UI and graph analysis
src/analysis/           Comparison, gaps, grounding, and reveal logic
src/components/         Graph view, inspector, comparison, and reveal UI
public/graph.json       Demo knowledge graph
public/grounding.json   Quote and citation matching results
public/gap_verifications.json  AI-assisted gap review labels
scripts/grounding/      Local PDF grounding pipeline
scripts/                  Validation and test scripts
```

## Known Limitations

Research Graph currently demonstrates a curated 30-paper corpus. Five additional papers from the planned 35-paper set are not represented in the graph. Automated extraction can split synonyms or merge concepts incorrectly, leading to false gaps or missed connections. Reference matching may miss citations or produce ambiguous candidates. The default demo explores existing data; it does not support arbitrary PDF uploads or perform live paper ingestion through the interface.

## ** License**

This project is licensed under the **Apache License 2.0**.
