import type { GraphIndex } from '../data/graphIndex';
import type { Evidence } from '../types';

/**
 * Results of the local grounding pipeline (scripts/grounding/), exported to public/grounding.json by
 * scripts/grounding/export_frontend.py. Read-only: nothing here changes the knowledge graph.
 *
 *  - citations: matched in the citing paper's own reference list (arXiv id, exact title, title prefix +
 *    author/year, or author+year with >=80% title overlap). "ambiguous" matches are kept apart and never
 *    treated as citations.
 *  - quotes: whether each evidence passage was found in the text of its own PDF. This says the words are
 *    in the paper, not that the extracted claim interprets them correctly.
 */

export interface RefExcerpt { before: string; match: string; after: string }
export interface Citation {
  source: string; // citing paper (paper_id, or "rank:NN" for a curated paper absent from the graph)
  target: string; // cited paper
  sourceInGraph: boolean;
  targetInGraph: boolean;
  method: string;
  page: number; // page of the citing PDF where the reference entry was matched
  block: string; // page range of the detected reference list
  excerpt: RefExcerpt;
  excerptKind: 'reference-text' | 'normalized-snippet';
}
export type QuoteStatus = 'exact' | 'fuzzy' | 'not-found' | 'too-short' | 'no-pdf';
export interface QuoteMatch { status: QuoteStatus; pages: number[]; pageCheck?: 'match' | 'off-by-one' | 'mismatch' | null; coverage?: number | null }
export interface ReviewFlag { kind: 'quote-not-found' | 'hedged-observed'; text: string }

export interface GroundingFile {
  version: 1;
  pipelineVersion: string;
  graphSha256: string;
  graphCounts: { nodes: number; links: number };
  modelCalls: number;
  citations: { verified: Citation[]; ambiguous: Citation[] };
  quotes: Record<string, QuoteMatch>;
  flags: Record<string, ReviewFlag>;
  /** papers whose reference list was located and searched */
  referencesChecked: string[];
  referencesMissing: string[];
  pipelineCitedWithoutSharedEntity: [string, string][];
}

export interface PairCitations {
  aCitesB: Citation[];
  bCitesA: Citation[];
  ambiguous: Citation[];
  /** true when both papers' reference lists were located, so "no citation found" is meaningful */
  bothChecked: boolean;
  unchecked: string[];
}

export interface GroundingIndex {
  file: GroundingFile;
  /** problems found while checking the file against the loaded graph; shown in the top bar when non-empty */
  issues: string[];
  /** true unless the loaded graph's SHA-256 equals the one the file was produced for; the app must not use it then */
  stale: boolean;
  /** how the file was matched to the loaded graph ('unavailable' = the graph could not be hashed) */
  fingerprint: 'sha256-match' | 'sha256-mismatch' | 'unavailable';
  between(a: string, b: string): PairCitations;
  cites(pid: string): Citation[];
  citedBy(pid: string): Citation[];
  quote(e: Evidence): QuoteMatch | null;
  flag(edgeId: string): ReviewFlag | null;
}

/** FNV-1a 32-bit over UTF-8, identical to export_frontend.py's fnv1a(). */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(s)) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * Integrity is established only by an exact SHA-256 match between the loaded graph bytes and the
 * graph the grounding file was produced for. There is no weaker fallback: an unknown or different
 * hash means the file is not used (stale = true), whatever the node and edge counts are.
 */
export function buildGroundingIndex(file: GroundingFile, ix: GraphIndex, loaded: { sha256: string | null }): GroundingIndex {
  const issues: string[] = [];
  const fingerprint: GroundingIndex['fingerprint'] = !loaded.sha256 ? 'unavailable' : loaded.sha256 === file.graphSha256 ? 'sha256-match' : 'sha256-mismatch';
  const stale = fingerprint !== 'sha256-match';
  if (fingerprint === 'sha256-mismatch')
    issues.push('Citation and PDF-match data were produced for a different version of the graph, so they are not shown. Re-run the grounding pipeline and export.');
  else if (fingerprint === 'unavailable')
    issues.push('The loaded graph could not be fingerprinted, so its integrity is unknown and citation and PDF-match data are not shown.');
  const known = (pid: string, inGraph: boolean) => !inGraph || ix.paperById.has(pid);
  const valid = (c: Citation) => known(c.source, c.sourceInGraph) && known(c.target, c.targetInGraph) && c.source !== c.target;
  const verified = file.citations.verified.filter(valid);
  if (verified.length !== file.citations.verified.length) issues.push(`${file.citations.verified.length - verified.length} citation(s) refer to papers not in this graph and were ignored.`);
  const vkey = new Set(verified.map((c) => `${c.source}>${c.target}`));
  // a pair is never both verified and ambiguous in the same direction; verified wins
  const ambiguous = file.citations.ambiguous.filter((c) => valid(c) && !vkey.has(`${c.source}>${c.target}`));
  const by = (list: Citation[], f: (c: Citation) => string) => {
    const m = new Map<string, Citation[]>();
    for (const c of list) m.set(f(c), [...(m.get(f(c)) ?? []), c]);
    return m;
  };
  const checked = new Set(file.referencesChecked);
  const vOut = by(verified, (c) => c.source);
  const vIn = by(verified, (c) => c.target);
  return {
    file,
    issues,
    stale,
    fingerprint,
    between: (a, b) => {
      const unchecked = [a, b].filter((p) => !checked.has(p));
      return {
        aCitesB: verified.filter((c) => c.source === a && c.target === b),
        bCitesA: verified.filter((c) => c.source === b && c.target === a),
        ambiguous: ambiguous.filter((c) => (c.source === a && c.target === b) || (c.source === b && c.target === a)),
        bothChecked: unchecked.length === 0,
        unchecked,
      };
    },
    cites: (pid) => vOut.get(pid) ?? [],
    citedBy: (pid) => vIn.get(pid) ?? [],
    quote: (e) => file.quotes[fnv1a(`${e.paperId}\u0000${e.passage}`)] ?? null,
    flag: (id) => file.flags[id] ?? null,
  };
}

export const QUOTE_LABEL: Record<QuoteStatus, string> = {
  exact: 'Found in PDF',
  fuzzy: 'Approximate PDF match',
  'not-found': 'Not found in PDF',
  'too-short': 'Too short to check',
  'no-pdf': 'No PDF available',
};

export const METHOD_LABEL = (m: string) =>
  m.startsWith('arxiv-id') ? 'arXiv ID of the cited paper appears in the reference list'
    : m.startsWith('exact-title') ? 'Exact title appears in the reference list'
    : m.startsWith('title-prefix') ? 'Title (before the colon) plus author/year appear in the reference list'
    : m.startsWith('author+year+fuzzy-title') ? 'Author, year and ≥80% of the title appear together'
    : m;
