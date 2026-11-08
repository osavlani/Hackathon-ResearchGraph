#!/usr/bin/env python3
"""
Export validated grounding results for the frontend:  analysis/grounding/*.json  ->  public/grounding.json

  python3 scripts/grounding/export_frontend.py

- Reads only the pipeline's outputs plus its local text cache. It never opens a PDF and never calls a model.
- Refuses to export if the graph changed since the pipeline ran (stale results).
- Verified and ambiguous citations stay in separate lists; ambiguous ones are never promoted.
- Reference excerpts are recovered from the cached reference-list text (readable form of the pipeline's
  normalized snippet). If the cache is missing, the normalized snippet is exported instead and marked as such.
- Quote results are keyed by FNV-1a(paper_id + "\\u0000" + passage). src/analysis/grounding.ts computes the same hash.
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(HERE))
import pipeline as P  # noqa: E402  (reuses locate_references / nospace / nfkc; no extraction is run)

GROUNDING = REPO / "analysis/grounding"
CACHE = REPO / ".cache/grounding"
OUT = REPO / "public/grounding.json"
EXPORT_VERSION = 1


def fnv1a(s: str) -> str:
    h = 0x811C9DC5
    for b in s.encode("utf-8"):
        h ^= b
        h = (h * 0x01000193) & 0xFFFFFFFF
    return f"{h:08x}"


def cached_pages_by_paper(graph: dict) -> dict[str, list[str]]:
    """paper key (graph paper_id or rank:NN) -> cached page texts, via the pipeline manifest. No PDF access."""
    manifest = P.load_json(CACHE / "manifest.json", {})
    by_name = {n["source_pdf"]: n["paper_id"] for n in graph["nodes"] if n.get("node_type") == "Paper"}
    out: dict[str, list[str]] = {}
    for path, m in manifest.items():
        name = Path(path).name
        data = P.load_json(CACHE / "pdf" / f"{m['sha']}.json", None)
        if not data:
            continue
        key = by_name.get(name)
        if key is None:
            r = re.match(r"^(\d+)_", name)
            if r:
                key = next((pid for pid in by_name.values() if pid.startswith(f"{int(r.group(1)):02d}-")), f"rank:{int(r.group(1)):02d}")
        if key and (key not in out or name in by_name):
            out[key] = data["pages"]
    return out


def readable_excerpt(pages: list[str], pos: int, keys: list[str], radius: int = 150) -> dict | None:
    """Map the match at `pos` in the normalized (no-space) reference text back to the raw cached text.
    Returns {before, match, after} so the UI can highlight exactly what matched."""
    ref = P.locate_references(pages)
    if not ref.get("found"):
        return None
    raw = "".join(t for _, t in ref["chunks"])
    index: list[int] = []
    for i, ch in enumerate(raw):
        for _ in P.nospace(ch):
            index.append(i)
    ns_len = len(index)
    key = next((k for k in keys if k and pos + len(k) <= ns_len and "".join(P.nospace(raw[index[j]]) for j in range(pos, pos + len(k)))[: len(k)] == k), None)
    if key is None:
        return None
    a, b = index[pos], index[pos + len(key) - 1] + 1
    clean = lambda t: re.sub(r"(\w)- (\w)", r"\1\2", re.sub(r"\s+", " ", P.nfkc(t)))
    return {"before": clean(raw[max(0, a - radius): a]).lstrip(), "match": clean(raw[a:b]).strip(), "after": clean(raw[b: b + radius]).rstrip()}


def main() -> int:
    graph_bytes = (REPO / "public/graph.json").read_bytes()
    graph_sha = hashlib.sha256(graph_bytes).hexdigest()
    summary = P.load_json(GROUNDING / "run_summary.json", None)
    if not summary:
        print("No pipeline output found. Run scripts/grounding/pipeline.py first.", file=sys.stderr)
        return 1
    if summary["graph_sha256"] != graph_sha:
        print("public/graph.json changed since the grounding run: re-run the pipeline before exporting.", file=sys.stderr)
        return 1
    graph = json.loads(graph_bytes)
    cites = P.load_json(GROUNDING / "citation_candidates.json", {})
    quotes = P.load_json(GROUNDING / "quote_verification.json", {})
    rels = P.load_json(GROUNDING / "relationship_candidates.json", {})
    queue = P.load_json(GROUNDING / "review_queue.json", {})
    pages = cached_pages_by_paper(graph)
    titles = P.known_titles()

    def keys_for(target: str) -> list[str]:
        """Strings the pipeline may have matched for this target, most specific first."""
        r = re.match(r"^(\d+)-([A-Za-z]*?)(\d{4})?-", target) or re.match(r"^rank:(\d+)$", target)
        rank = 25 if target.startswith("Simple-probes") else int(r.group(1)) if r else None
        title = titles.get(rank, "") if rank else ""
        tp = pages.get(target)
        arx = re.search(r"arXiv:\s?(\d{4}\.\d{4,5})", "\n".join(tp[:2])) if tp else None
        author = r.group(2) if r and r.re.groups >= 2 and r.group(2) else ("MacDiarmid" if rank == 25 else "")
        if author.lower() == "vanderweij":
            author = "vanderweij"
        return [P.nospace(arx.group(1)) if arx else "", P.nospace(title), P.nospace(title.split(":")[0]), P.nospace(author)]

    def citation(c: dict) -> dict:
        assert c["status"] in ("verified", "ambiguous")
        excerpt = readable_excerpt(pages[c["source"]], c["pos"], keys_for(c["target"])) if c["source"] in pages else None
        return {
            "source": c["source"], "target": c["target"],
            "sourceInGraph": c["source_in_graph"], "targetInGraph": c["target_in_graph"],
            "method": c["method"], "page": c["reference_page"], "block": c["reference_block"],
            "excerpt": excerpt or {"before": "", "match": c["snippet"], "after": ""},
            "excerptKind": "reference-text" if excerpt else "normalized-snippet",
        }

    verified = [citation(c) for c in cites["verified"] if c["status"] == "verified"]
    ambiguous = [citation(c) for c in cites["ambiguous"] if c["status"] == "ambiguous"]
    vkeys = {(c["source"], c["target"]) for c in verified}
    ambiguous = [c for c in ambiguous if (c["source"], c["target"]) not in vkeys]  # a verified match always wins

    quote_map = {}
    for r in quotes["results"]:
        quote_map[fnv1a(f"{r['paper_id']}\u0000{r['passage']}")] = {
            "status": r["status"], "pages": r.get("found_pages") or [], "pageCheck": r.get("page_check"), "coverage": r.get("coverage"),
        }
    assert len(quote_map) == len(quotes["results"]), "quote hash collision"

    flags = {}
    for u in rels.get("unlocatable_claims", []):
        flags[u["edge"]] = {"kind": "quote-not-found", "text": "None of this claim's quotes could be located in the paper's extracted text. Check the PDF before relying on it."}
    for q in queue.get("cases", []):
        flags.setdefault(q["edge"], {"kind": "hedged-observed", "text": f"Typed as observed, but its quote is hedged (“{q['hedge_word']}”). It may be a hypothesis; check the source."})

    out = {
        "version": EXPORT_VERSION,
        "pipelineVersion": summary["pipeline_version"],
        "graphSha256": graph_sha,
        "graphCounts": {"nodes": len(graph["nodes"]), "links": len(graph["links"])},
        "modelCalls": summary["stats"].get("llm_calls", 0),
        "citations": {"verified": verified, "ambiguous": ambiguous},
        "quotes": quote_map,
        "flags": flags,
        "referencesMissing": sorted(x["paper"] for x in P.load_json(GROUNDING / "unresolved.json", {}).get("no_reference_section", [])),
        "referencesChecked": sorted(k for k, pg in pages.items() if P.locate_references(pg).get("found")),
        "pipelineCitedWithoutSharedEntity": [[x["source"], x["target"]] for x in rels.get("citation_without_shared_entity", [])],
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n")
    readable = sum(c["excerptKind"] == "reference-text" for c in verified + ambiguous)
    print(f"wrote {OUT.relative_to(REPO)}: {len(verified)} verified + {len(ambiguous)} ambiguous citations "
          f"({readable} with readable reference text), {len(quote_map)} quote results, {len(flags)} flags, {OUT.stat().st_size // 1024} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
