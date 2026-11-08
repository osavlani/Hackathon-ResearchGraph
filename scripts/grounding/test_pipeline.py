"""Unit tests for the grounding pipeline on synthetic text (no PDFs, no network, no model).
Run: python3 -m unittest scripts/grounding/test_pipeline.py -v"""
import json
import sys
import tempfile
import unittest
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import pipeline as P  # noqa: E402

REFS = (
    "References\n"
    "Greenblatt, R., Denison, C., et al. Alignment faking in large lan-\nguage models. arXiv:2412.14093, 2024.\n"
    "Greenblatt, R., Shlegeris, B., et al. Some other unrelated report on widgets. 2024.\n"
    "Hubinger, E., et al. Sleeper agents: Training deceptive LLMs that persist through safety training, 2024.\n"
    + "Doe, J. Filler reference 2021. Roe, K. Another 2022. Poe, L. More 2023.\n" * 20
)
PROSE = "This appendix describes the prompts used in our experiments in detail. " * 60


def source(pages, rank=99, year=2025):
    return {"meta": {"rank": rank, "year": year, "in_graph": True}, "data": {"pages": pages, "refs": P.locate_references(pages)}, "sha": P.sha_text("".join(pages))}


class Text(unittest.TestCase):
    def test_nospace_handles_hyphenation_and_ligatures(self):
        self.assertEqual(P.nospace("lan-\nguage ﬁne-tuning"), "languagefinetuning")

    def test_agent_vs_activity(self):
        self.assertTrue(P.agent_vs_activity("optimizer", "optimization"))
        self.assertTrue(P.agent_vs_activity("schemers", "scheming"))
        self.assertFalse(P.agent_vs_activity("behavior", "behavior"))

    def test_abbreviation_expansion(self):
        abbr = {"cot": "chain of thought"}
        self.assertEqual(P.canon("CoT monitoring", abbr)[1], P.canon("chain-of-thought monitoring", abbr)[1])
        self.assertNotEqual(P.canon("CoT monitoring", {})[1], P.canon("chain-of-thought monitoring", {})[1])

    def test_mined_abbreviations_require_matching_initials(self):
        g = {"nodes": [{"label": "x", "evidence_json": json.dumps([{"passage": "we use reinforcement learning from human feedback (RLHF) and a widget (ZQ)"}])}], "links": []}
        mined = P.mine_abbreviations(g)
        self.assertEqual(mined.get("rlhf"), "reinforcement learning from human feedback")
        self.assertNotIn("zq", mined)


class References(unittest.TestCase):
    def test_heading_and_appendix_end(self):
        pages = [PROSE] * 6 + [REFS, "Appendix\n" + PROSE, PROSE]
        r = P.locate_references(pages)
        self.assertTrue(r["found"])
        self.assertEqual((r["start_page"], r["end_page"]), (7, 8))
        self.assertNotIn("prompts used", "".join(t for _, t in r["chunks"]))

    def test_density_end_without_appendix(self):
        pages = [PROSE] * 6 + [REFS, REFS.replace("References\n", ""), PROSE, PROSE]
        r = P.locate_references(pages)
        self.assertEqual(r["end_page"], 9)  # keeps the trailing page, stops before the second prose page

    def test_no_heading_falls_back_to_density(self):
        pages = [PROSE] * 6 + [REFS.replace("References\n", "")] * 2
        r = P.locate_references(pages)
        self.assertEqual(r["method"], "inferred-by-density")


class Citations(unittest.TestCase):
    def run_match(self, src, targets):
        stats = defaultdict(int)
        with tempfile.TemporaryDirectory() as d:
            return P.match_citations({"S": src}, targets, Path(d), stats), stats

    def targets(self):
        return {
            "AF": {"rank": 1, "title": "Alignment Faking in Large Language Models", "author": "Greenblatt", "year": 2024, "arxiv": "2412.14093", "in_graph": True},
            "PW": {"rank": 17, "title": "Stress-Testing Capability Elicitation With Password-Locked Models", "author": "Greenblatt", "year": 2024, "arxiv": None, "in_graph": True},
            "SA": {"rank": 3, "title": "Sleeper Agents: Training Deceptive LLMs that Persist Through Safety Training", "author": "Hubinger", "year": 2024, "arxiv": None, "in_graph": True},
            "XX": {"rank": 4, "title": "Risks from Learned Optimization in Advanced Machine Learning Systems", "author": "Hubinger", "year": 2019, "arxiv": None, "in_graph": True},
        }

    def test_verified_and_never_invented(self):
        res, _ = self.run_match(source([PROSE] * 6 + [REFS]), self.targets())
        by = {r["target"]: r for r in res}
        self.assertEqual(by["AF"]["status"], "verified")
        self.assertIn("arxiv", by["AF"]["method"])
        self.assertEqual(by["SA"]["status"], "verified")  # hyphenation and case differences tolerated
        self.assertNotIn("XX", by)  # not in the reference list -> no candidate at all
        self.assertEqual(by["AF"]["reference_page"], 7)

    def test_same_author_year_sibling_does_not_become_a_citation(self):
        res, stats = self.run_match(source([PROSE] * 6 + [REFS]), self.targets())
        pw = [r for r in res if r["target"] == "PW"]
        # "Greenblatt ... 2024" appears, but the nearby title is a different paper: never verified
        self.assertTrue(all(r["status"] != "verified" for r in pw))

    def test_future_target_is_ambiguous(self):
        res, _ = self.run_match(source([PROSE] * 6 + [REFS], year=2019), self.targets())
        self.assertEqual({r["target"]: r["status"] for r in res}["AF"], "ambiguous")

    def test_cache_prevents_rework(self):
        stats = defaultdict(int)
        src = source([PROSE] * 6 + [REFS])
        with tempfile.TemporaryDirectory() as d:
            P.match_citations({"S": src}, self.targets(), Path(d), stats)
            P.match_citations({"S": src}, self.targets(), Path(d), stats)
        self.assertEqual((stats["citation_sources_processed"], stats["citation_sources_cached"]), (1, 1))


if __name__ == "__main__":
    unittest.main()
