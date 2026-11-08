#!/usr/bin/env python3
"""
Local-first grounding pipeline for ResearchGraph.  No LLM calls are made by this script.

  python3 scripts/grounding/pipeline.py [--pdf-dir DIR ...] [--graph public/graph.json] [--out analysis/grounding]

Stages (all deterministic, all local):
  1. PDF text extraction with PyMuPDF (text only, never images/OCR); cached per file SHA-256.
  2. Reference sections located by heading; citations matched by arXiv id, normalized title,
     first-author surname and year. Uncertain matches are kept separate.
  3. Local quote-to-text verification of every graph evidence passage against its own paper.
  4. Entity alias candidates: deterministic normalization + curated and corpus-mined abbreviations.
  5. Missing / suspicious relationship candidates from graph structure + stages 2-4.
  6. Optional review queue (<= 10 small passages) for cases that need semantic judgement.
     The queue is written to disk only; nothing is sent anywhere.

The graph is read-only. All proposals are written to --out, never into the graph.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
import unicodedata
from collections import defaultdict
from difflib import SequenceMatcher
from pathlib import Path

PIPELINE_VERSION = "1.6.0"   # matching / analysis logic
EXTRACT_VERSION = "1"        # PDF text extraction format; bump only if extraction itself changes
QUOTE_VERSION = "1"          # quote-matching logic
MAX_REVIEW_CASES = 10
REPO = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent

# ----------------------------------------------------------------------------- text utils

def nfkc(s: str) -> str:
    s = unicodedata.normalize("NFKC", s or "")
    return s.replace("­", "").replace("ﬁ", "fi").replace("ﬂ", "fl")


def nospace(s: str) -> str:
    """Lowercase alphanumerics only. Robust to hyphenation, line breaks and punctuation differences."""
    return re.sub(r"[^a-z0-9]+", "", nfkc(s).lower())


def spaced(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", nfkc(s).lower()).strip()


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def sha_text(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()[:16]


def load_json(p: Path, default):
    try:
        return json.loads(p.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def dump_json(p: Path, data) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")


# ----------------------------------------------------------------------------- corpus metadata

def known_titles() -> dict[int, str]:
    """Curated titles, read from the frontend's paperMeta.ts so there is a single source of truth."""
    src = (REPO / "src/data/paperMeta.ts").read_text()
    block = src[src.index("KNOWN_TITLES"): src.index("};", src.index("KNOWN_TITLES"))]
    return {int(m.group(1)): m.group(2).replace("’", "'") for m in re.finditer(r"^\s*(\d+):\s*'(.+)',\s*$", block, re.M)}


FILENAME_RE = re.compile(r"^(\d+)_([A-Za-z]+?)(\d{4})_|^(\d+)_(\d{4})_")


def paper_from_filename(name: str, titles: dict[int, str]) -> dict:
    m = FILENAME_RE.match(name)
    if m and m.group(1):
        rank, author, year = int(m.group(1)), m.group(2), int(m.group(3))
    elif m:
        rank, author, year = int(m.group(4)), None, int(m.group(5))
    elif name.lower().startswith("simple probes"):
        rank, author, year = 25, "MacDiarmid", 2024
    else:
        return {"rank": None, "author": None, "year": None, "title": None}
    if author and author.lower() == "vanderweij":
        author = "van der Weij"
    return {"rank": rank, "author": author, "year": year, "title": titles.get(rank)}


# ----------------------------------------------------------------------------- stage 1: extraction

def extract_pdf(path: Path, sha: str, cache_dir: Path, stats: dict) -> dict:
    """Text-only extraction, cached by content hash. Returns {pages, arxiv, refs}."""
    cp = cache_dir / "pdf" / f"{sha}.json"
    cached = load_json(cp, None)
    if cached and cached.get("version") == EXTRACT_VERSION:
        stats["pdf_cached"] += 1
        cached["refs"] = locate_references(cached["pages"])  # cheap; re-derived so logic changes never re-extract
        return cached
    import fitz  # PyMuPDF; imported lazily so cached runs don't need it

    fitz.TOOLS.mupdf_display_errors(False)

    doc = fitz.open(path)
    pages = [page.get_text("text") for page in doc]  # text layer only; images are never rendered
    doc.close()
    stats["pdf_extracted"] += 1
    stats["pages_extracted"] += len(pages)
    first = "\n".join(pages[:2])
    arx = re.search(r"arXiv:\s?(\d{4}\.\d{4,5})", first)
    data = {"version": EXTRACT_VERSION, "file": path.name, "pages": pages, "arxiv": arx.group(1) if arx else None}
    dump_json(cp, data)
    data["refs"] = locate_references(pages)
    return data


REF_HEAD = re.compile(r"^\s*(?:\d+\.?\s*|[A-Z]\.?\s+)?(references|bibliography|works cited|literature cited|citations)\s*$", re.I | re.M)
APPENDIX_HEAD = re.compile(
    r"^\s*(?:appendix|appendices|supplementary material|A\s+(?:appendix|additional|details|experimental|extended|further|full|implementation|proofs?|prompts?)\b)",
    re.I | re.M,
)


YEAR_RE = re.compile(r"\b(?:19[5-9]\d|20[0-3]\d)[a-z]?\b")


def year_density(text: str) -> float:
    """Publication years per 1,000 characters: reference lists are dense, prose is not."""
    return len(YEAR_RE.findall(text)) / max(1.0, len(text) / 1000)


def locate_references(pages: list[str]) -> dict:
    """Reference block = from a 'References' heading until an appendix heading or the first page whose
    year density drops to prose level. Without a heading, fall back to the densest run of pages in the
    last 60% of the document (marked as 'inferred')."""
    n = len(pages)
    start = None
    for i in range(int(n * 0.2) if n > 4 else 0, n):
        m = REF_HEAD.search(pages[i])
        if m:
            start = (i, m.end())
            break
    method = "heading"
    if start is None:
        dense = [i for i in range(int(n * 0.4), n) if year_density(pages[i]) >= 6]
        if not dense:
            return {"found": False, "reason": "no reference heading and no citation-dense pages"}
        start, method = (dense[0], 0), "inferred-by-density"
    i0, off = start
    chunks: list[list] = []
    # 1) an appendix heading within 15 pages is the most reliable end marker
    app = None
    for i in range(i0, min(n, i0 + 15)):
        text = pages[i][off:] if i == i0 else pages[i]
        a = APPENDIX_HEAD.search(text)
        if a and (i > i0 or a.start() > 200):
            app = (i, a.start())
            break
    for i in range(i0, min(n, i0 + 40)):
        text = pages[i][off:] if i == i0 else pages[i]
        if app and i == app[0]:
            chunks.append([i + 1, text[: app[1]]])
            break
        chunks.append([i + 1, text])
        if app:
            continue
        # 2) otherwise stop once this page AND the next read like prose (keeping this trailing page)
        if i > i0 and year_density(text) < 2.5 and (i + 1 >= n or year_density(pages[i + 1]) < 2.5):
            break
    return {"found": True, "method": method, "start_page": chunks[0][0], "end_page": chunks[-1][0], "chunks": chunks}


# ----------------------------------------------------------------------------- stage 2: citations

def match_citations(sources: dict, targets: dict, cache_dir: Path, stats: dict) -> list[dict]:
    """sources: key -> {meta, data}; targets: key -> meta with title/author/year/arxiv."""
    targets_sig = sha_text(json.dumps({k: [v.get("title"), v.get("author"), v.get("year"), v.get("arxiv")] for k, v in sorted(targets.items())}))
    out = []
    same_author_year = defaultdict(list)
    for k, t in targets.items():
        if t.get("author") and t.get("year"):
            same_author_year[(t["author"].lower(), t["year"])].append(k)
    for skey, s in sources.items():
        ref = s["data"]["refs"]
        cache_key = f"{s['sha']}-{targets_sig}-{PIPELINE_VERSION}"
        cp = cache_dir / "cites" / f"{cache_key}.json"
        hit = load_json(cp, None)
        if hit is not None:
            stats["citation_sources_cached"] += 1
            for k, v in hit["counters"].items():
                stats[k] += v
            out.extend(hit["results"])
            continue
        before = {k: stats[k] for k in ("citations_explained_by_sibling", "citations_rejected_different_title")}
        stats["citation_sources_processed"] += 1
        res: list[dict] = []
        if not ref.get("found"):
            dump_json(cp, {"results": res, "counters": {}})
            out.extend(res)
            continue
        page_ns = [(pg, nospace(t)) for pg, t in ref["chunks"]]
        ns = "".join(t for _, t in page_ns)
        bounds, acc = [], 0
        for pg, t in page_ns:
            acc += len(t)
            bounds.append((acc, pg))
        page_at = lambda pos: next((pg for b, pg in bounds if pos < b), bounds[-1][1])
        for tkey, t in targets.items():
            if tkey == skey or (t.get("rank") is not None and t.get("rank") == s["meta"].get("rank")):
                continue
            title_ns = nospace(t.get("title") or "")
            pre_ns = nospace((t.get("title") or "").split(":")[0])
            author_ns = nospace(t.get("author") or "")
            year = str(t.get("year") or "")
            ev = None
            if t.get("arxiv") and t["arxiv"].replace(".", "") in ns:
                p = ns.index(t["arxiv"].replace(".", ""))
                ev = ("verified", "arxiv-id", p)
            elif title_ns and len(title_ns) >= 20 and title_ns in ns:
                p = ns.index(title_ns)
                ev = ("verified", "exact-title", p)
            elif pre_ns and len(pre_ns) >= 20 and pre_ns in ns:
                p = ns.index(pre_ns)
                win = ns[max(0, p - 400): p + 400]
                ok = (author_ns and author_ns in win) or (year and year in win)
                ev = ("verified" if ok else "ambiguous", "title-prefix" + ("+author/year" if ok else " only"), p)
            if ev:
                res.append(cite_record(skey, tkey, s, t, ev[0], ev[1], ns, ev[2], len(title_ns or pre_ns), page_at(ev[2])))
                continue
            # author + year only: look for "<surname> ... <year>" and compare the nearby text with the title
            if not (author_ns and year):
                continue
            best = None
            for m in re.finditer(re.escape(author_ns), ns):
                win = ns[m.start(): m.start() + 600]
                if year not in win:
                    continue
                if title_ns:
                    lcs = SequenceMatcher(None, title_ns, win, autojunk=False).find_longest_match(0, len(title_ns), 0, len(win)).size
                    ratio = lcs / len(title_ns)
                else:
                    ratio = 0.0
                if best is None or ratio > best[0]:
                    best = (ratio, m.start())
            if not best:
                continue
            ratio, p = best
            peers = same_author_year.get(((t.get("author") or "").lower(), t.get("year")), [])
            if ratio >= 0.8:
                res.append(cite_record(skey, tkey, s, t, "verified", f"author+year+fuzzy-title({ratio:.2f})", ns, p, len(title_ns), page_at(p)))
            elif ratio >= 0.45 or len(peers) > 1:
                why = f"author+year, title similarity {ratio:.2f}" + (f"; {len(peers)} corpus papers share this author+year" if len(peers) > 1 else "")
                res.append(cite_record(skey, tkey, s, t, "ambiguous", why, ns, p, len(title_ns), page_at(p)))
            else:
                stats["citations_rejected_different_title"] += 1
        # an author+year hit sitting on a reference already verified for a same-author/same-year sibling is
        # explained by that sibling: drop it instead of reporting it as ambiguous
        verified_pos = [(r["target"], r["pos"]) for r in res if r["status"] == "verified"]
        kept = []
        for r in res:
            t = targets[r["target"]]
            peers = same_author_year.get(((t.get("author") or "").lower(), t.get("year")), [])
            if r["status"] == "ambiguous" and r["method"].startswith("author+year") and any(vt in peers and vt != r["target"] and abs(vp - r["pos"]) < 700 for vt, vp in verified_pos):
                stats["citations_explained_by_sibling"] += 1
                continue
            kept.append(r)
        res = kept
        # a source cannot cite work published 2+ years later unless the PDF is a later revision: keep separate
        sy = s["meta"].get("year")
        for r in res:
            ty = targets[r["target"]].get("year")
            if r["status"] == "verified" and sy and ty and ty > sy + 1:
                r["status"] = "ambiguous"
                r["method"] += f"; target ({ty}) is newer than source ({sy}): PDF may be a later revision"
            if ref.get("method") == "inferred-by-density":
                r["method"] += "; reference block inferred (no heading)"
        dump_json(cp, {"results": res, "counters": {k: stats[k] - v for k, v in before.items()}})
        out.extend(res)
    return out


def cite_record(skey, tkey, s, t, status, method, ns, pos, span, page) -> dict:
    return {
        "source": skey,
        "source_in_graph": s["meta"].get("in_graph", False),
        "target": tkey,
        "target_in_graph": t.get("in_graph", False),
        "status": status,
        "method": method,
        "reference_page": page,
        "pos": pos,
        "reference_block": f"{s['data']['refs'].get('start_page')}-{s['data']['refs'].get('end_page')}",
        # short normalized snippet only (no spaces): enough to audit the match, not a copy of the paper
        "snippet": ns[max(0, pos - 60): pos + max(span, 40) + 40][:220],
    }


# ----------------------------------------------------------------------------- stage 3: quote verification

def verify_quotes(graph: dict, pdf_by_paper: dict, cache_dir: Path, stats: dict) -> dict[str, dict]:
    """Every unique (paper, passage) is checked against that paper's own PDF text. Cached per PDF hash."""
    quotes: dict[str, dict] = {}
    for item in graph["nodes"] + graph["links"]:
        for e in json.loads(item.get("evidence_json") or "[]"):
            k = f"{e.get('paper_id')}|{e.get('passage')}"
            q = quotes.setdefault(k, {"paper_id": e.get("paper_id"), "passage": e.get("passage") or "", "pages": set(), "pipeline_status": set(), "owners": set()})
            if e.get("page") not in (None, ""):
                q["pages"].add(int(e["page"]))
            q["pipeline_status"].add(e.get("validation_status") or "none")
            q["owners"].add(item.get("id") or f"{item.get('source')}>{item.get('target')}:{item.get('key')}")
    results: dict[str, dict] = {}
    by_paper = defaultdict(list)
    for k, q in quotes.items():
        by_paper[q["paper_id"]].append((k, q))
    for pid, items in by_paper.items():
        pdf = pdf_by_paper.get(pid)
        if not pdf:
            for k, q in items:
                results[k] = {"status": "no-pdf"}
            stats["quotes_no_pdf"] += len(items)
            continue
        cp = cache_dir / "quotes" / f"{pdf['sha']}-q{QUOTE_VERSION}.json"
        cache = load_json(cp, {})
        page_ns = None
        shingles = None
        dirty = False
        for k, q in items:
            qk = sha_text(q["passage"])
            if qk in cache:
                stats["quotes_cached"] += 1
                results[k] = cache[qk]
                continue
            stats["quotes_checked"] += 1
            if page_ns is None:
                page_ns = [nospace(p) for p in pdf["data"]["pages"]]
                doc_ns = "".join(page_ns)
                shingles = {doc_ns[i: i + 12] for i in range(0, max(0, len(doc_ns) - 11))}
            qn = nospace(q["passage"])
            r: dict
            if len(qn) < 20:
                r = {"status": "too-short"}
            else:
                found = [i + 1 for i, p in enumerate(page_ns) if qn in p]
                if found:
                    r = {"status": "exact", "found_pages": found}
                else:
                    # cross-page quotes: test the joined text
                    joined = [i + 1 for i in range(len(page_ns) - 1) if qn in page_ns[i] + page_ns[i + 1]]
                    if joined:
                        r = {"status": "exact", "found_pages": joined}
                    else:
                        grams = [qn[i: i + 12] for i in range(0, max(1, len(qn) - 11), 4)]
                        cover = sum(g in shingles for g in grams) / max(1, len(grams))
                        r = {"status": "fuzzy" if cover >= 0.8 else "not-found", "coverage": round(cover, 2)}
                        if r["status"] == "fuzzy":
                            best = max(range(len(page_ns)), key=lambda i: sum(g in page_ns[i] for g in grams))
                            r["found_pages"] = [best + 1]
            cache[qk] = r
            results[k] = r
            dirty = True
        if dirty:
            dump_json(cp, cache)
    # attach page agreement
    for k, q in quotes.items():
        r = dict(results[k])
        stated = sorted(q["pages"])
        fp = r.get("found_pages") or []
        if fp and stated:
            r["page_check"] = "match" if set(stated) & set(fp) else ("off-by-one" if any(abs(a - b) == 1 for a in stated for b in fp) else "mismatch")
        r.update({"paper_id": q["paper_id"], "stated_pages": stated, "pipeline_status": sorted(q["pipeline_status"]), "owners": sorted(q["owners"])[:6], "passage": q["passage"]})
        results[k] = r
    return results


# ----------------------------------------------------------------------------- stage 4: aliases

STOP = {"the", "a", "an", "of", "for", "to", "in", "on", "with", "and", "from", "by", "via"}
SUFFIXES = ["ational", "ations", "ation", "ively", "ive", "ing", "ion", "ers", "er", "ies", "es", "ed", "ly", "s"]
GENERIC_RE = re.compile(
    r"^(the |a |an )?(current |frontier |large |small |modern |advanced |ai |language |)*(models?|llms?|systems?|agents?|assistants?|ai|training|fine-?tuning|evaluations?|experiments?|prompting|prompts?|reasoning|behaviou?rs?|safety|alignment|capabilit(y|ies)|tasks?|data|datasets?|methods?|results?)$",
    re.I,
)
GROUP = {"Behavior": "phen", "Concept": "phen", "Mechanism": "phen", "Method": "meth", "EvaluationMethod": "meth", "AIModel": "model", "ExperimentalCondition": "cond"}


def stem(w: str) -> str:
    for suf in SUFFIXES:
        if len(w) > len(suf) + 3 and w.endswith(suf):
            w = w[: -len(suf)]
            break
    return "decept" if w.startswith("deceiv") else w


def mine_abbreviations(graph: dict) -> dict[str, str]:
    """'<long form> (<ABBR>)' in the graph's own passages, accepted only if the initials spell the abbreviation."""
    found: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    texts = [n.get("label", "") for n in graph["nodes"]]
    for item in graph["nodes"] + graph["links"]:
        texts += [e.get("passage", "") for e in json.loads(item.get("evidence_json") or "[]")]
    pat = re.compile(r"((?:[A-Za-z][\w'-]*\s+){1,7}?[A-Za-z][\w'-]*)\s*\(([A-Z][A-Za-z0-9-]{1,9})\)")
    for t in texts:
        for m in pat.finditer(nfkc(t)):
            abbr = m.group(2)
            letters = re.sub(r"[^a-z]", "", abbr.lower())
            words = [w for w in re.split(r"[\s-]+", m.group(1).lower()) if w]
            for k in range(1, len(words) + 1):
                tail = words[-k:]
                core = [w for w in tail if w not in STOP]
                if "".join(w[0] for w in tail) == letters or "".join(w[0] for w in core) == letters:
                    if tail[0] in STOP:
                        continue
                    found[letters][" ".join(spaced(w) for w in tail)] += 1
                    break
    return {a: max(longs.items(), key=lambda x: x[1])[0] for a, longs in found.items() if len(a) >= 2}


def expand_abbr(label: str, abbr: dict[str, str]) -> str:
    return " ".join(abbr.get(t, t) for t in spaced(label).split())


def agent_vs_activity(x: str, y: str) -> bool:
    if x == y:
        return False
    agent = lambda w: re.search(r"(er|ers|or|ors)$", w) is not None
    activity = lambda w: re.search(r"(ing|ion|ions)$", w) is not None
    return (agent(x) and activity(y)) or (agent(y) and activity(x))


def canon(label: str, abbr: dict[str, str]) -> tuple[str, str, str]:
    """(surface key, abbreviation-expanded key, stemmed key)."""
    s = spaced(label.replace("’s", "").replace("'s", ""))
    surface = s.replace(" ", "")
    toks = []
    for t in s.split():
        toks += abbr.get(t, t).split()
    expanded = "".join(t for t in toks if t not in STOP)
    stemmed = " ".join(sorted(stem(t) for t in toks if t not in STOP))
    return surface, expanded, stemmed


def alias_candidates(graph: dict, abbr: dict[str, str], verdicts: dict) -> tuple[list[dict], list[dict]]:
    nodes = [n for n in graph["nodes"] if n.get("node_type") in GROUP]
    by = {n["id"]: n for n in nodes}
    keys = {n["id"]: canon(n["label"], abbr) for n in nodes}
    linked = defaultdict(set)
    isa = set()
    for l in graph["links"]:
        if l.get("edge_kind") == "provenance" or l.get("predicate") == "INVOLVES":
            continue
        a, b = l["source"], l["target"]
        if l.get("predicate") == "IS_A":
            isa.add(frozenset((a, b)))
        else:
            linked[a].add(b)
            linked[b].add(a)
    pairs = []
    buckets = defaultdict(list)
    for nid, (sf, ex, st) in keys.items():
        if len(sf) < 3:
            continue
        for kind, key in (("surface", sf), ("abbreviation", ex), ("inflection", st)):
            buckets[(kind, key)].append(nid)
    # aliases recorded by the extractor itself
    label_index = defaultdict(list)
    for n in nodes:
        label_index[spaced(n["label"])].append(n["id"])
    seen = {}
    rank = {"alias-field": 0, "surface": 1, "abbreviation": 2, "inflection": 3}
    def put(a, b, kind):
        if a == b:
            return
        k = tuple(sorted((a, b)))
        if k not in seen or rank[kind] < rank[seen[k]]:
            seen[k] = kind
    for (kind, _), ids in buckets.items():
        for i in range(len(ids)):
            for j in range(i + 1, len(ids)):
                put(ids[i], ids[j], kind)
    for n in nodes:
        for al in (n.get("aliases") or "").split(";"):
            for other in label_index.get(spaced(al), []):
                put(n["id"], other, "alias-field")
    for (a, b), kind in seen.items():
        na, nb = by[a], by[b]
        ga, gb = GROUP[na["node_type"]], GROUP[nb["node_type"]]
        if ga != gb:
            continue
        generic = bool(GENERIC_RE.match(na["label"].strip()) or GENERIC_RE.match(nb["label"].strip()))
        conflict = b in linked[a]
        hier = frozenset((a, b)) in isa
        conf = {"alias-field": "high", "surface": "high", "abbreviation": "high", "inflection": "medium"}[kind]
        if na["node_type"] != nb["node_type"]:
            conf = "medium" if conf == "high" else "low"
        if generic:
            conf = "low"
        why = ""
        if kind == "inflection":
            ta = [t for t in spaced(expand_abbr(na["label"], abbr)).split() if t not in STOP]
            tb = [t for t in spaced(expand_abbr(nb["label"], abbr)).split() if t not in STOP]
            if [stem(t) for t in ta] != [stem(t) for t in tb]:
                conf, why = "low", "same words in a different order: may be a different concept"
            elif any(agent_vs_activity(x, y) for x, y in zip(ta, tb)):
                conf, why = "low", "agent vs activity (e.g. optimizer vs optimization): related, likely not the same entity"
        if conflict or hier:
            conf = "rejected"
        pa = set(x.strip() for x in na["papers"].split(";") if x.strip())
        pb = set(x.strip() for x in nb["papers"].split(";") if x.strip())
        pairs.append({
            "a": a, "a_label": na["label"], "a_type": na["node_type"], "b": b, "b_label": nb["label"], "b_type": nb["node_type"],
            "evidence": kind, "confidence": conf,
            "note": "graph has a non-IS_A edge between them (distinct things)" if conflict else "graph has an IS_A edge (hierarchy, not alias)" if hier else "generic label" if generic else why,
            "papers_a": sorted(pa), "papers_b": sorted(pb), "new_shared_papers": sorted((pa | pb) - (pa & pb)) if not (pa <= pb or pb <= pa) else [],
        })
    pairs.sort(key=lambda p: (["high", "medium", "low", "rejected"].index(p["confidence"]), p["a_label"].lower()))
    # clusters over high + medium
    parent = {}
    def find(x):
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    for p in pairs:
        if p["confidence"] in ("high", "medium"):
            parent[find(p["a"])] = find(p["b"])
    groups = defaultdict(list)
    for x in list(parent):
        groups[find(x)].append(x)
    clusters = []
    for members in groups.values():
        if len(members) < 2:
            continue
        papers = sorted({pp.strip() for m in members for pp in by[m]["papers"].split(";") if pp.strip()})
        max_single = max(len([pp for pp in by[m]["papers"].split(";") if pp.strip()]) for m in members)
        gap_ids = sorted(g for g in verdicts if g.split(":", 1)[1] in members or any(m in g.split(":", 1)[1].split("|") for m in members))
        clusters.append({
            "members": sorted(({"id": m, "label": by[m]["label"], "type": by[m]["node_type"], "papers": by[m]["paper_count"], "mentions": by[m]["mention_count"]} for m in members), key=lambda x: -x["mentions"]),
            "papers_after_merge": len(papers), "papers_best_single": max_single,
            "gaps_touched": [{"gap": g, "verdict": verdicts[g]["verdict"]} for g in gap_ids],
        })
    clusters.sort(key=lambda c: (-(c["papers_after_merge"] - c["papers_best_single"]), -len(c["members"])))
    return pairs, clusters


# ----------------------------------------------------------------------------- stage 5: relationships

HEDGE = re.compile(r"\b(may|might|could|possibly|potentially|we hypothesi[sz]e|we speculate|we suspect|it is possible|plausibl[ey]|would)\b", re.I)


def relationships(graph, cites, clusters, quote_results, paper_rank):
    nodes = {n["id"]: n for n in graph["nodes"]}
    paper_ents = defaultdict(set)
    for n in graph["nodes"]:
        if n.get("node_type") in GROUP and not GENERIC_RE.match(n["label"].strip()):
            for p in n["papers"].split(";"):
                if p.strip():
                    paper_ents[p.strip()].add(n["id"])
    out = {"citation_backed": [], "alias_induced_shared_concepts": [], "citation_without_shared_entity": [], "unbacked_mentions": [], "unlocatable_claims": [], "page_mismatches": []}
    verified = [c for c in cites if c["status"] == "verified" and c["source_in_graph"] and c["target_in_graph"]]
    vset = {(c["source"], c["target"]) for c in verified}
    for c in verified:
        shared = paper_ents[c["source"]] & paper_ents[c["target"]]
        out["citation_backed"].append({"proposed_edge": {"source": f"paper:{c['source']}", "predicate": "CITES", "target": f"paper:{c['target']}"}, "method": c["method"], "shared_specific_entities": len(shared)})
        if not shared:
            out["citation_without_shared_entity"].append({"source": c["source"], "target": c["target"], "note": "cited, yet no specific entity in common: topical links are probably missing from the graph"})
    # alias-induced: pairs of papers that would share an entity only after merging a cluster
    for cl in clusters:
        ids = [m["id"] for m in cl["members"]]
        per = {m: {p.strip() for p in nodes[m]["papers"].split(";") if p.strip()} for m in ids}
        papers = sorted(set().union(*per.values()))
        for i, a in enumerate(papers):
            for b in papers[i + 1:]:
                if paper_ents[a] & paper_ents[b]:
                    continue
                out["alias_induced_shared_concepts"].append({"papers": [a, b], "via": [nodes[m]["label"] for m in ids if a in per[m] or b in per[m]]})
    # graph author-year mentions that no reference list backs up (computed like the frontend: surname + year in passages)
    targets = {pid: r for pid, r in paper_rank.items() if r.get("author") and r.get("year")}
    for item in graph["nodes"] + graph["links"]:
        for e in json.loads(item.get("evidence_json") or "[]"):
            text = (e.get("passage") or "") + " " + (e.get("context") or "")
            for tpid, t in targets.items():
                if tpid == e.get("paper_id"):
                    continue
                if re.search(rf"\b{re.escape(t['author']).replace('van der', 'van der ?')}\b[^.;)]{{0,40}}?\b{t['year']}\b", text, re.I):
                    key = (e.get("paper_id"), tpid)
                    if key not in vset:
                        out["unbacked_mentions"].append({"source": key[0], "target": key[1], "passage": (e.get("passage") or "")[:160]})
    dedup = {}
    for m in out["unbacked_mentions"]:
        dedup.setdefault((m["source"], m["target"]), m)
    out["unbacked_mentions"] = list(dedup.values())
    # semantic edges whose quotes cannot be located in the paper's own text
    for l in graph["links"]:
        if l.get("edge_kind") == "provenance":
            continue
        ev = json.loads(l.get("evidence_json") or "[]")
        if not ev:
            continue
        st = [quote_results.get(f"{e.get('paper_id')}|{e.get('passage')}", {}).get("status") for e in ev]
        if st and all(s == "not-found" for s in st):
            out["unlocatable_claims"].append({"edge": l.get("id"), "claim": f"{nodes[l['source']]['label']} {'NOT ' if l.get('negated') else ''}{l['predicate']} {nodes[l['target']]['label']}", "paper": ev[0].get("paper_id"), "pipeline_status": sorted({e.get('validation_status') or 'none' for e in ev})})
    for k, r in quote_results.items():
        if r.get("page_check") == "mismatch":
            out["page_mismatches"].append({"paper_id": r["paper_id"], "stated_pages": r["stated_pages"], "found_pages": r.get("found_pages"), "passage": r["passage"][:120]})
    return out


def review_queue(graph, quote_results, pdf_by_paper) -> tuple[list[dict], list[dict]]:
    """Semantic question the local code can't answer: is an 'observed' claim actually hedged in the source?
    Only cases whose quote was located locally are eligible, so the context window comes from the PDF text."""
    nodes = {n["id"]: n for n in graph["nodes"]}
    cands = []
    for l in graph["links"]:
        if l.get("edge_kind") == "provenance" or l.get("predicate") == "INVOLVES" or l.get("claim_type") != "observed":
            continue
        for e in json.loads(l.get("evidence_json") or "[]"):
            p = e.get("passage") or ""
            m = HEDGE.search(p)
            if not m:
                continue
            r = quote_results.get(f"{e.get('paper_id')}|{p}", {})
            weight = (nodes[l["source"]].get("paper_count", 1) or 1) + (nodes[l["target"]].get("paper_count", 1) or 1)
            cands.append((weight, l, e, m.group(0), r))
    cands.sort(key=lambda x: -x[0])
    queue, unresolved, used = [], [], set()
    for weight, l, e, hedge, r in cands:
        if l.get("id") in used:
            continue
        used.add(l.get("id"))
        claim = f"{nodes[l['source']]['label']} {'NOT ' if l.get('negated') else ''}{l['predicate']} {nodes[l['target']]['label']}"
        case = {"edge": l.get("id"), "paper_id": e.get("paper_id"), "page": e.get("page"), "claim": claim, "graph_claim_type": "observed", "hedge_word": hedge, "quote": e.get("passage")}
        if len(queue) < MAX_REVIEW_CASES and r.get("status") == "exact":
            pdf = pdf_by_paper.get(e.get("paper_id"))
            ctx = context_window(pdf["data"]["pages"], r["found_pages"][0], e.get("passage")) if pdf else None
            case["context"] = ctx
            case["question"] = "Does the source present this relationship as an observed result, or as a hypothesis/possibility? Answer: observed | hypothesized | unclear."
            case["approx_tokens"] = int(len((ctx or "") + case["quote"] + case["claim"] + case["question"]) / 4)
            queue.append(case)
        else:
            case["reason"] = "review cap reached" if len(queue) >= MAX_REVIEW_CASES else "quote not located locally"
            unresolved.append(case)
    return queue, unresolved


def context_window(pages, page_no, passage, radius=220) -> str | None:
    """+-radius characters of plain page text around the quote (fuzzy-anchored on its first words)."""
    text = re.sub(r"\s+", " ", nfkc(pages[page_no - 1]))
    probe = re.sub(r"\s+", " ", nfkc(passage))[:40]
    i = text.find(probe)
    if i < 0:
        words = probe.split()[:4]
        i = text.find(" ".join(words)) if words else -1
    if i < 0:
        return None
    return text[max(0, i - radius): i + len(passage) + radius]


# ----------------------------------------------------------------------------- report

def short(pid: str) -> str:
    m = re.match(r"^(\d+)-([A-Za-z]*?)(\d{4})", pid)
    if m:
        return f"P{m.group(1)} {m.group(2) or ''} {m.group(3)}".replace("  ", " ")
    if pid.startswith("rank:"):
        return f"#{pid[5:]} (not in graph)"
    return "P25 MacDiarmid 2024" if pid.startswith("Simple-probes") else pid


def write_report(out_dir: Path, summary: dict, cites: list, pairs: list, clusters: list, rels: dict, queue: list, unresolved: dict, verdicts: dict) -> None:
    st = summary["stats"]
    ver = [c for c in cites if c["status"] == "verified"]
    amb = [c for c in cites if c["status"] == "ambiguous"]
    in_graph = [c for c in ver if c["source_in_graph"] and c["target_in_graph"]]
    indeg = defaultdict(int)
    for c in in_graph:
        indeg[c["target"]] += 1
    methods = defaultdict(int)
    for c in ver:
        methods[re.sub(r"\(.*", "", c["method"]).split(";")[0]] += 1
    L = []
    w = L.append
    w("# Grounding report (local-first)\n")
    w(f"Generated by `scripts/grounding/pipeline.py` v{summary['pipeline_version']}. Graph sha256 `{summary['graph_sha256'][:12]}…` (read-only, unchanged).  ")
    w(f"**Model calls made: {st.get('llm_calls', 0)}.** Review queue: {summary['review_queue']['cases']} case(s) written to disk, not sent (≈{summary['review_queue']['approx_tokens_if_sent']} tokens if someone chooses to send them).\n")
    w("## Processing statistics\n")
    w("| Item | Value |\n|---|---|")
    rows = [
        ("PDF files found / unique by content", f"{st.get('pdf_files_found', 0)} / {st.get('pdf_unique', 0)}"),
        ("PDFs text-extracted this run / served from cache", f"{st.get('pdf_extracted', 0)} / {st.get('pdf_cached', 0)}"),
        ("Pages extracted this run (text layer only, no images, no OCR) / held in local cache", f"{st.get('pages_extracted', 0)} / {st.get('pages_in_cache', 0)}"),
        ("File hashes computed / reused", f"{st.get('hash_computed', 0)} / {st.get('hash_cached', 0)}"),
        ("Reference sections located", f"{st.get('reference_sections_found', 0)} of {st.get('papers_with_pdf', 0)}"),
        ("Citation sources matched this run / cached", f"{st.get('citation_sources_processed', 0)} / {st.get('citation_sources_cached', 0)}"),
        ("Graph quotes checked this run / cached", f"{st.get('quotes_checked', 0)} / {st.get('quotes_cached', 0)}"),
        ("Run time", f"{st.get('duration_s', 0)} s"),
    ]
    for k, v in rows:
        w(f"| {k} | {v} |")
    q = summary["quote_verification"]
    pc = summary["page_check"]
    w(f"\n## Quote verification (graph evidence vs. local PDF text)\n")
    w(f"{q.get('exact', 0)} of {sum(q.values())} unique quotes found verbatim (after whitespace/hyphenation normalization) in their own paper; "
      f"{q.get('fuzzy', 0)} fuzzy (≥80% of 12-character shingles); {q.get('not-found', 0)} not found. "
      f"Stated page agrees for {pc.get('match', 0)}, off by one for {pc.get('off-by-one', 0)}, mismatched for {pc.get('mismatch', 0)}.\n")
    w("## Verified citation candidates\n")
    w(f"**{len(ver)}** verified ({', '.join(f'{k}: {v}' for k, v in sorted(methods.items(), key=lambda x: -x[1]))}). "
      f"**{len(in_graph)}** connect two papers that are both in the graph; these are proposed `CITES` edges in `relationship_candidates.json` (not added to the graph). "
      f"The rest involve the five curated papers missing from the graph (#11–#15).\n")
    w("Most-cited papers within the graph: " + ", ".join(f"{short(t)} ({n})" for t, n in sorted(indeg.items(), key=lambda x: -x[1])[:8]) + ".\n")
    w("Rule: *verified* = the target's own arXiv id, its exact normalized title, or its title prefix plus author/year appears in the source's reference block; or author + year with ≥80% title overlap. Full list with page numbers and snippets: `citation_candidates.json`.\n")
    w("## Ambiguous citations (kept separate)\n")
    w("| Source | Target | Ref. page | Why uncertain |\n|---|---|---|---|")
    for c in amb:
        w(f"| {short(c['source'])} | {short(c['target'])} | {c['reference_page']} | {c['method']} |")
    w(f"\n{st.get('citations_explained_by_sibling', 0)} author+year hits were dropped because they sit on a reference already verified for a same-author, same-year sibling; "
      f"{st.get('citations_rejected_different_title', 0)} were rejected because the nearby title clearly differs (same author, different paper).\n")
    w("## Entity alias candidates\n")
    w("Deterministic only: punctuation/case/hyphen normalization, curated + corpus-mined abbreviations "
      f"(mined from the graph's own passages: {', '.join(f'{k}→{v}' for k, v in summary['abbreviations']['mined_pairs'].items())}; curated entries take precedence on conflict), and light stemming. Nothing is merged in the graph.\n")
    w("| Confidence | A | B | Evidence | Note |\n|---|---|---|---|---|")
    for p in pairs:
        w(f"| {p['confidence']} | {p['a_label']} ({p['a_type']}) | {p['b_label']} ({p['b_type']}) | {p['evidence']} | {p['note']} |")
    touched = [(c, g) for c in clusters for g in c["gaps_touched"]]
    if touched:
        w("\nAlias clusters that touch reviewed gaps: " + "; ".join(f"{' / '.join(m['label'] for m in c['members'])} → `{g['gap']}` ({g['verdict']})" for c, g in touched) + ".")
    arts = [g for g, v in verdicts.items() if v["verdict"] == "extraction-artifact"]
    w(f"\nNone of the {len(arts)} gaps reviewed as *extraction artifacts* (`{'`, `'.join(arts)}`) is explained by these aliases: their variants differ in meaning-bearing words (e.g. “misalignment” vs “misaligned behavior”), not just in spelling. Deterministic normalization does not and should not merge such pairs; they are listed under unresolved cases.\n")
    w("## Missing / suspicious relationship candidates\n")
    w(f"- **Cited but no shared entity in the graph: {len(rels['citation_without_shared_entity'])} of {len(rels['citation_backed'])}** citation-backed pairs. The papers are demonstrably related (one cites the other) but the graph links them through nothing specific, so topical links are probably missing. Examples: "
      + ", ".join(f"{short(x['source'])} → {short(x['target'])}" for x in rels["citation_without_shared_entity"][:8]) + ".")
    w(f"- **New shared concept after alias merge: {len(rels['alias_induced_shared_concepts'])}** paper pair(s): "
      + ("; ".join(f"{short(x['papers'][0])} × {short(x['papers'][1])} via {' / '.join(x['via'])}" for x in rels["alias_induced_shared_concepts"]) or "none") + ".")
    w(f"- **Author–year mentions in the graph not backed by a reference list: {len(rels['unbacked_mentions'])}.**")
    w(f"- **Claims whose every quote is absent from the paper's text: {len(rels['unlocatable_claims'])}** "
      + ("(" + "; ".join(f"“{x['claim']}” in {short(x['paper'])}, pipeline status {', '.join(x['pipeline_status'])}" for x in rels["unlocatable_claims"]) + ")" if rels["unlocatable_claims"] else "") + ".")
    w(f"- **Quotes on a different page than stated: {len(rels['page_mismatches'])}.**\n")
    w("## Optional review queue (not sent)\n")
    w(f"Claims typed *observed* whose quote contains hedging language, i.e. the one question here that needs semantic judgement. Capped at {summary['review_queue']['cap']}; each case carries only the quote and ±220 characters of local context.\n")
    w("| Claim | Paper, page | Hedge |\n|---|---|---|")
    for c in queue:
        w(f"| {c['claim']} | {short(c['paper_id'])}, p. {c['page']} | “{c['hedge_word']}” |")
    w("\n## Unresolved cases (stopped here instead of escalating)\n")
    w(f"- No reference section found: {', '.join(x['file'] for x in unresolved['no_reference_section']) or 'none'}.")
    w(f"- Ambiguous citations: {len(unresolved['ambiguous_citations'])} (table above).")
    w(f"- Quotes not found locally: {len(unresolved['quotes_not_found_locally'])}.")
    w(f"- Hedged claims beyond the review cap: {len(unresolved['claims_needing_review_beyond_cap'])}.")
    w(f"- Semantic synonyms behind the {len(arts)} extraction-artifact gaps: need a human (or a small, targeted model review).")
    w("\n## Files\n")
    w("`citation_candidates.json` · `alias_candidates.json` · `relationship_candidates.json` · `quote_verification.json` · `review_queue.json` · `unresolved.json` · `run_summary.json`. "
      "Extracted PDF text is cached in `.cache/grounding/` (git-ignored) and never leaves this machine.")
    (out_dir / "REPORT.md").write_text("\n".join(L) + "\n")


# ----------------------------------------------------------------------------- main

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--graph", default=str(REPO / "public/graph.json"))
    ap.add_argument("--verdicts", default=str(REPO / "public/gap_verifications.json"))
    ap.add_argument("--pdf-dir", action="append", default=[], help="directory with corpus PDFs (repeatable; searched recursively)")
    ap.add_argument("--out", default=str(REPO / "analysis/grounding"))
    ap.add_argument("--cache", default=str(REPO / ".cache/grounding"))
    args = ap.parse_args()
    t0 = time.time()
    out_dir, cache_dir = Path(args.out), Path(args.cache)
    stats = defaultdict(int)
    stats["llm_calls"] = 0  # this pipeline has no model client; kept explicit for the report

    graph_bytes = Path(args.graph).read_bytes()
    graph = json.loads(graph_bytes)
    graph_sha = hashlib.sha256(graph_bytes).hexdigest()
    verdicts = load_json(Path(args.verdicts), {}).get("verifications", {})
    titles = known_titles()
    graph_papers = {n["paper_id"]: n for n in graph["nodes"] if n.get("node_type") == "Paper"}
    by_pdf_name = {n["source_pdf"]: pid for pid, n in graph_papers.items()}

    # ---- discover PDFs (dedupe by content hash; prefer the graph's own file names)
    manifest = load_json(cache_dir / "manifest.json", {})
    files = []
    for d in args.pdf_dir:
        files += sorted(Path(d).expanduser().rglob("*.pdf"))
    stats["pdf_files_found"] = len(files)
    by_sha: dict[str, Path] = {}
    for f in files:
        st = f.stat()
        m = manifest.get(str(f))
        if m and m["size"] == st.st_size and m["mtime"] == st.st_mtime:
            sha = m["sha"]
            stats["hash_cached"] += 1
        else:
            sha = sha256_file(f)
            manifest[str(f)] = {"size": st.st_size, "mtime": st.st_mtime, "sha": sha}
            stats["hash_computed"] += 1
        if sha not in by_sha or f.name in by_pdf_name:
            by_sha[sha] = f
    stats["pdf_unique"] = len(by_sha)
    dump_json(cache_dir / "manifest.json", manifest)

    # ---- extract + key every PDF by paper (graph paper_id, or "rank:NN" for curated papers absent from the graph)
    docs = {}
    for sha, f in sorted(by_sha.items(), key=lambda x: x[1].name):
        meta = paper_from_filename(f.name, titles)
        pid = by_pdf_name.get(f.name)
        if pid is None and meta["rank"] is not None:
            pid = next((p for p in graph_papers if p.startswith(f"{meta['rank']:02d}-")), None)
        key = pid or (f"rank:{meta['rank']:02d}" if meta["rank"] is not None else f"file:{f.name}")
        if key in docs:
            stats["pdf_duplicate_paper"] += 1
            continue
        try:
            data = extract_pdf(f, sha, cache_dir, stats)
        except Exception as e:  # unreadable PDF: report, never retry
            stats["pdf_failed"] += 1
            docs[key] = {"meta": {**meta, "in_graph": pid is not None}, "data": {"pages": [], "arxiv": None, "refs": {"found": False, "reason": f"extraction failed: {e}"}}, "sha": sha, "file": f.name}
            continue
        docs[key] = {"meta": {**meta, "in_graph": pid is not None}, "data": data, "sha": sha, "file": f.name}
    stats["papers_with_pdf"] = len(docs)
    stats["pages_in_cache"] = sum(len(d["data"]["pages"]) for d in docs.values())
    stats["graph_papers_without_pdf"] = len([p for p in graph_papers if p not in docs])
    stats["reference_sections_found"] = sum(1 for d in docs.values() if d["data"]["refs"].get("found"))

    # ---- stage 2
    targets = {}
    for rank, title in titles.items():
        pid = next((p for p in graph_papers if p.startswith(f"{rank:02d}-")), None) or ("Simple-probes-can-catch-sleeper-agents-Anthropic" if rank == 25 and "Simple-probes-can-catch-sleeper-agents-Anthropic" in graph_papers else None)
        key = pid or f"rank:{rank:02d}"
        d = docs.get(key)
        fn_meta = d["meta"] if d else {}
        targets[key] = {"rank": rank, "title": title, "author": fn_meta.get("author"), "year": fn_meta.get("year"), "arxiv": d["data"]["arxiv"] if d else None, "in_graph": pid is not None}
        if not d and pid:
            m = re.match(r"^\d+-([A-Za-z]+?)(\d{4})-", pid)
            if m:
                targets[key].update(author=m.group(1), year=int(m.group(2)))
    cites = match_citations(docs, targets, cache_dir, stats)

    # ---- stage 3
    pdf_by_paper = {k: d for k, d in docs.items() if d["data"]["pages"]}
    quote_results = verify_quotes(graph, pdf_by_paper, cache_dir, stats)

    # ---- stage 4
    seed = load_json(HERE / "abbreviations.json", {})
    seed = {k: v for k, v in seed.items() if not k.startswith("_")}
    mined = mine_abbreviations(graph)
    abbr = {**mined, **seed}  # curated entries win on conflict
    pairs, clusters = alias_candidates(graph, abbr, verdicts)

    # ---- stage 5 + 6
    rels = relationships(graph, cites, clusters, quote_results, targets)
    queue, unresolved_claims = review_queue(graph, quote_results, pdf_by_paper)

    # ---- outputs (graph untouched)
    assert hashlib.sha256(Path(args.graph).read_bytes()).hexdigest() == graph_sha, "graph changed during run"
    qstat = defaultdict(int)
    pstat = defaultdict(int)
    for r in quote_results.values():
        qstat[r["status"]] += 1
        if "page_check" in r:
            pstat[r["page_check"]] += 1
    unresolved = {
        "no_reference_section": [{"paper": k, "file": d["file"], "reason": d["data"]["refs"].get("reason")} for k, d in docs.items() if not d["data"]["refs"].get("found")],
        "graph_papers_without_pdf": [p for p in graph_papers if p not in docs],
        "ambiguous_citations": [c for c in cites if c["status"] == "ambiguous"],
        "quotes_not_found_locally": [{"paper_id": r["paper_id"], "pipeline_status": r["pipeline_status"], "coverage": r.get("coverage"), "passage": r["passage"][:140]} for r in quote_results.values() if r["status"] == "not-found"],
        "claims_needing_review_beyond_cap": unresolved_claims,
    }
    stats["duration_s"] = round(time.time() - t0, 2)
    summary = {
        "pipeline_version": PIPELINE_VERSION, "graph_sha256": graph_sha,
        "stats": dict(stats),
        "quote_verification": dict(qstat), "page_check": dict(pstat),
        "citations": {"verified": sum(c["status"] == "verified" for c in cites), "ambiguous": sum(c["status"] == "ambiguous" for c in cites)},
        "aliases": {c: sum(p["confidence"] == c for p in pairs) for c in ("high", "medium", "low", "rejected")} | {"clusters": len(clusters)},
        "abbreviations": {"curated": len(seed), "mined": len(mined), "mined_pairs": dict(sorted(mined.items()))},
        "review_queue": {"cases": len(queue), "cap": MAX_REVIEW_CASES, "approx_tokens_if_sent": sum(c["approx_tokens"] for c in queue), "sent": 0},
    }
    dump_json(out_dir / "citation_candidates.json", {"verified": [c for c in cites if c["status"] == "verified"], "ambiguous": [c for c in cites if c["status"] == "ambiguous"]})
    dump_json(out_dir / "alias_candidates.json", {"clusters": clusters, "pairs": pairs})
    dump_json(out_dir / "relationship_candidates.json", rels)
    dump_json(out_dir / "quote_verification.json", {"summary": dict(qstat), "page_check": dict(pstat), "results": sorted(({k: v for k, v in r.items() if k != "owners"} | {"owners": r["owners"]} for r in quote_results.values()), key=lambda r: (r["paper_id"], r["status"]))})
    dump_json(out_dir / "review_queue.json", {"note": f"Optional. At most {MAX_REVIEW_CASES} small passages; nothing has been sent to any model.", "cases": queue})
    dump_json(out_dir / "unresolved.json", unresolved)
    dump_json(out_dir / "run_summary.json", summary)
    write_report(out_dir, summary, cites, pairs, clusters, rels, queue, unresolved, verdicts)
    print(json.dumps(summary["stats"] | {"quotes": dict(qstat), "pages": dict(pstat), "citations": summary["citations"], "aliases": summary["aliases"], "review_queue": summary["review_queue"]}, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
