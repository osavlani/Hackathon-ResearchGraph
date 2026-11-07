// ---------- Raw shapes: exactly what GET /graph returns (networkx node-link JSON) ----------

export interface RawEntityNode {
  id: string;
  label: string;
  node_type: string;
  canonical_name: string;
  aliases?: string;
  papers: string; // "paperA; paperB"
  paper_count: number;
  mention_count: number;
  source_pages: string;
  first_passage: string;
  type_votes?: string;
  evidence_json: string;
}

export interface RawPaperNode {
  id: string; // "paper:<paper_id>"
  label: string;
  node_type: 'Paper';
  canonical_name: string;
  paper_id: string;
  source_pdf: string;
  pages_with_evidence: string;
  source_kind: string;
  evidence_json: string;
}

export type RawNode = RawEntityNode | RawPaperNode;

export interface RawSemanticLink {
  id: string;
  label: string;
  predicate: string;
  negated: boolean;
  claim_type: string;
  papers: string;
  paper_count: number;
  evidence_count: number;
  source_pages: string;
  first_passage: string;
  contexts: string;
  validation_statuses: string;
  evidence_json: string;
  grounding_review: string;
  indirect_evidence_count: number;
  source: string;
  target: string;
  key: string;
}

export interface RawProvenanceLink {
  label: string;
  predicate: 'DOCUMENTS';
  edge_kind: 'provenance';
  paper_id: string;
  source_pdf: string;
  page: string;
  first_passage: string;
  evidence_json: string;
  evidence_count: number;
  source: string;
  target: string;
  key: string;
}

export type RawLink = RawSemanticLink | RawProvenanceLink;

export interface RawGraph {
  directed: boolean;
  multigraph: boolean;
  graph: Record<string, unknown>;
  nodes: RawNode[];
  links: RawLink[];
}

// ---------- Normalized shapes used by the app ----------

export type NodeType =
  | 'Paper'
  | 'Finding'
  | 'Hypothesis'
  | 'Behavior'
  | 'Method'
  | 'Concept'
  | 'AIModel'
  | 'ExperimentalCondition'
  | 'EvaluationMethod'
  | 'Mechanism'
  | 'Gap'; // synthetic: produced by the gap engine, never in the backend graph

export type ClaimType = 'observed' | 'hypothesized' | 'cited' | null;

export interface Evidence {
  paperId: string;
  sourcePdf: string;
  page: number | null;
  passage: string;
  chunkId?: string;
  validationStatus?: string; // verified | fuzzy_verified | ...
  context?: string;
  claimType?: string;
  endpointGrounding?: string;
}

export interface GNode {
  id: string;
  label: string;
  type: NodeType;
  papers: string[]; // paper_ids (without "paper:" prefix)
  paperCount: number;
  mentionCount: number;
  sourcePages: string;
  firstPassage: string;
  aliases: string[];
  evidence: Evidence[];
  /** evidence entries per paper_id */
  perPaper: Map<string, number>;
  // paper-only
  paperId?: string;
  sourcePdf?: string;
}

export type EdgeKind = 'semantic' | 'provenance' | 'derived-uses' | 'derived-cites' | 'derived-aligned' | 'gap';

export interface GEdge {
  id: string;
  source: string;
  target: string;
  predicate: string; // backend predicate or derived label
  label: string; // human label for display
  kind: EdgeKind;
  negated: boolean;
  claimType: ClaimType;
  papers: string[];
  evidenceCount: number;
  validation: string[];
  grounding: string | null;
  contexts: string;
  evidence: Evidence[];
  /** free text explanation for derived edges */
  note?: string;
}

export interface PaperMeta {
  paperId: string;
  nodeId: string;
  rank: number | null;
  firstAuthor: string | null;
  year: number | null;
  shortTitle: string;
  title: string;
  sourcePdf: string;
}
