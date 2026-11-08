ResolveNet (ResearchGraph)

Connect research papers. Discover hidden relationships. Find what's missing.

ResolveNet turns a set of research papers into an interactive knowledge graph and points out the research gaps between them. Every claim links back to the quote and page it came from.

Home view

- What it does
Topic search: finds the papers, methods, models and findings related to a topic.
Evidence inspector: click any node or edge to see its source quote, page number, validation status, and whether it was observed or only hypothesized.
Gap engine: finds 6 kinds of gaps from the graph's structure (no detection method, no mitigation, untested claim, single source, narrow model coverage, conflicting results) and suggests fixes using methods already in the corpus.
Gap verdicts: each gap carries a verdict badge from a separate AI review pass (LLM judgements, not human ground truth).
Compare papers: shared concepts, connecting evidence and differences between any two papers.

Demo corpus: 30 papers on AI scheming, alignment faking and sandbagging. The graph has 1,630 nodes and 2,327 links.

Gap verdict

- Run it

Requires Node.js 20.19+. No backend is needed: the graph ships in public/graph.json.


bash
npm install
npm run dev        # http://localhost:5173

Other commands: npm run build, npm test, npm run lint.

To load the graph from a backend, create .env.local containing VITE_API_BASE=http://localhost:8000. The app then reads {base}/graph.

- How it works
A pipeline extracts entities and relationships from the PDFs into graph.json. Each edge keeps its quote, page and claim type.
The app indexes the graph in the browser and only shows a small part of it at a time.
The gap engine (src/analysis/gaps.ts) applies rules to the graph and searches the corpus for possible fixes.
A local Python script (scripts/grounding/, no LLM calls) checks quotes and citations against the PDFs. A SHA-256 fingerprint ties its results to the exact graph.

Built with: React, TypeScript, Vite, Cytoscape.js (fcose layout), Python, PyMuPDF.

- Limitations
Papers #11–#15 of the planned 35-paper corpus are not in the graph yet.
Citations between papers are approximate.
Some gaps are false positives caused by duplicate entity names.

License :- 
Apache 2.0
