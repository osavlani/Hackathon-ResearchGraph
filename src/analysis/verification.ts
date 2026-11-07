/**
 * Verdicts for engine-generated gaps, produced by a reviewer (human or Claude) who read the papers.
 * File: public/gap_verifications.json. Keyed by Gap.id so verdicts survive re-runs of the engine
 * as long as entity ids are stable.
 */
export type Verdict =
  | 'confirmed' // the gap is real within the corpus
  | 'partly-addressed' // some corpus paper partly covers it; the graph missed or under-weighted it
  | 'closed-in-corpus' // a corpus paper actually addresses it; extraction missed the edge
  | 'extraction-artifact' // gap caused by entity normalization / extraction noise
  | 'not-supported'; // the rule fired but the premise is wrong

export const VERDICT_LABEL: Record<Verdict, string> = {
  confirmed: 'Confirmed',
  'partly-addressed': 'Partly addressed',
  'closed-in-corpus': 'Closed in corpus',
  'extraction-artifact': 'Extraction artifact',
  'not-supported': 'Not supported',
};

export interface GapVerification {
  verdict: Verdict;
  note: string;
  /** corpus paper_ids (or "missing:NN" for curated papers absent from the graph) that bear on the verdict */
  corpusRefs: string[];
  reviewer?: string;
  date?: string;
}

export interface GapVerificationFile {
  version: 1;
  graphFile?: string;
  method?: string;
  verifications: Record<string, GapVerification>;
}
