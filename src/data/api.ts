import type { RawGraph } from '../types';
import type { GapVerificationFile } from '../analysis/verification';
import type { GroundingFile } from '../analysis/grounding';
import { sha256Hex } from './sha256';

/**
 * Data source. Configure with Vite env vars (.env.local):
 *   VITE_API_BASE=http://localhost:8000   -> GET {base}/graph
 *   VITE_GRAPH_URL=/graph.json            -> explicit URL (overrides API_BASE)
 * Default: /graph.json served from /public (the exported KG).
 */
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '');
const GRAPH_URL = (import.meta.env.VITE_GRAPH_URL as string | undefined) ?? (API_BASE ? `${API_BASE}/graph` : '/graph.json');
const VERIFICATION_URL = (import.meta.env.VITE_GAP_VERIFICATION_URL as string | undefined) ?? '/gap_verifications.json';
const GROUNDING_URL = (import.meta.env.VITE_GROUNDING_URL as string | undefined) ?? '/grounding.json';

export interface LoadResult<T> { ok: true; data: T; source: string }
export interface LoadError { ok: false; error: string; source: string }

async function getJson<T>(url: string): Promise<LoadResult<T> | LoadError> {
  try {
    const r = await fetch(url);
    if (!r.ok) return { ok: false, error: `${r.status} ${r.statusText}`, source: url };
    return { ok: true, data: (await r.json()) as T, source: url };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), source: url };
  }
}

export interface GraphLoad extends LoadResult<RawGraph> {
  /** SHA-256 of the exact bytes received (Web Crypto, or a portable fallback in non-secure contexts);
   *  null only if hashing itself failed, in which case integrity is treated as unknown */
  sha256: string | null;
}

/** Loads the graph and fingerprints the exact bytes, so derived data (grounding.json) can be checked against it. */
export async function fetchGraph(): Promise<GraphLoad | LoadError> {
  try {
    const r = await fetch(GRAPH_URL);
    if (!r.ok) return { ok: false, error: `${r.status} ${r.statusText}`, source: GRAPH_URL };
    const bytes = await r.arrayBuffer();
    let sha256: string | null = null;
    try {
      sha256 = await sha256Hex(bytes);
    } catch {
      sha256 = null; // integrity unknown -> grounding data will not be shown as checked
    }
    return { ok: true, data: JSON.parse(new TextDecoder().decode(bytes)) as RawGraph, source: GRAPH_URL, sha256 };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), source: GRAPH_URL };
  }
}

/** Optional: human/LLM verdicts for engine-generated gaps. Missing file is fine. */
export function fetchGapVerifications() {
  return getJson<GapVerificationFile>(VERIFICATION_URL);
}

/** Optional: local grounding results (verified citations, PDF quote matches). Missing file is fine. */
export function fetchGrounding() {
  return getJson<GroundingFile>(GROUNDING_URL);
}

export const DATA_SOURCES = { GRAPH_URL, VERIFICATION_URL, GROUNDING_URL, API_BASE };
