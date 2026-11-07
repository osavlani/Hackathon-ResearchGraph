import type { RawGraph } from '../types';
import type { GapVerificationFile } from '../analysis/verification';

/**
 * Data source. Configure with Vite env vars (.env.local):
 *   VITE_API_BASE=http://localhost:8000   -> GET {base}/graph
 *   VITE_GRAPH_URL=/graph.json            -> explicit URL (overrides API_BASE)
 * Default: /graph.json served from /public (the exported KG).
 */
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '');
const GRAPH_URL = (import.meta.env.VITE_GRAPH_URL as string | undefined) ?? (API_BASE ? `${API_BASE}/graph` : '/graph.json');
const VERIFICATION_URL = (import.meta.env.VITE_GAP_VERIFICATION_URL as string | undefined) ?? '/gap_verifications.json';

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

export function fetchGraph() {
  return getJson<RawGraph>(GRAPH_URL);
}

/** Optional: human/LLM verdicts for engine-generated gaps. Missing file is fine. */
export function fetchGapVerifications() {
  return getJson<GapVerificationFile>(VERIFICATION_URL);
}

export const DATA_SOURCES = { GRAPH_URL, VERIFICATION_URL, API_BASE };
