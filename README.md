# **ResolveNet (ResearchGraph)**

### **Connect research papers. Discover hidden relationships. Find what's missing.**

ResolveNet transforms a collection of research papers into an interactive knowledge graph, helping researchers discover hidden connections, identify research gaps, and explore relationships between findings.

Every claim is grounded in its original source, with links to the supporting quote and page number.

---

## ** Home View**

### **What It Does**

- **Topic Search:** Discover papers, methods, models, and findings related to a specific research topic.
- **Evidence Inspector:** Click any node or edge to inspect its source quote, page number, validation status, and whether the claim was observed or hypothesized.
- **Gap Engine:** Identifies six types of research gaps through graph analysis:
  - Missing detection methods
  - Missing mitigation strategies
  - Untested claims
  - Single-source evidence
  - Narrow model coverage
  - Conflicting results
- **Gap Verdicts:** Each identified gap receives a verdict badge from a separate AI review pass. These verdicts represent LLM-based judgments, not human-verified ground truth.
- **Compare Papers:** Compare any two papers to explore shared concepts, connecting evidence, and differences.

### **Demo Corpus**

- **30 research papers** covering AI scheming, alignment faking, and sandbagging.
- **1,630 nodes**
- **2,327 links**

---

## ** Run It**

### **Requirements**

- Node.js 20.19 or higher
- npm

No backend is required for the default demo. The graph is included in `public/graph.json`.

### **Installation**

```bash
npm install
npm run dev
```

Open the application at:

http://localhost:5173

### **Other Commands**

```bash
npm run build
npm test
npm run lint
```

### **Using a Backend**

To load the graph from a backend, create a `.env.local` file:

```env
VITE_API_BASE=http://localhost:8000
```

The application will fetch the graph from:

```text
{base}/graph
```

---

## ** How It Works**

1. **Paper Processing:** A pipeline extracts entities and relationships from research PDFs and generates `graph.json`.
2. **Evidence Grounding:** Every edge retains its supporting quote, page number, and claim type.
3. **Graph Exploration:** The application indexes the graph in the browser and renders only a small portion at a time for efficient exploration.
4. **Research Gap Analysis:** The gap engine (`src/analysis/gaps.ts`) applies graph-based rules to identify potential research gaps and searches the corpus for possible solutions.
5. **Citation Validation:** A local Python script in `scripts/grounding/` validates quotes and citations against the original PDFs without making LLM calls.
6. **Graph Integrity:** A SHA-256 fingerprint connects grounding results to the exact graph version being analyzed.

---

## ** Built With**

- React
- TypeScript
- Vite
- Cytoscape.js (fcose layout)
- Python
- PyMuPDF

---

## ** Limitations**

- Papers #11–#15 from the planned 35-paper corpus have not yet been added to the graph.
- Citations between papers are approximate.
- Some research gaps may be false positives due to duplicate entity names.
- Gap verdicts are AI-generated judgments and should not be treated as definitive conclusions or human-verified findings.

---

## ** License**

This project is licensed under the **Apache License 2.0**.
