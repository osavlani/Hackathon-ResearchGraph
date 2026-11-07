# Gap verification: scheming / alignment-faking / sandbagging corpus

**Graph:** `research_knowledge_graph_improved.json` (30 Paper nodes, 1,630 nodes, 2,327 edges)
**Gaps checked:** all 60 produced by `src/analysis/gaps.ts`
**Scope:** corpus only. Resolutions and verdicts reference only papers in the uploaded corpus, with no outside literature.
**Method:** I read each gap's trigger edges and evidence passages in the graph and checked them against what the corpus papers report. Page numbers come from the graph's own evidence. I did not re-read the PDFs.
**Machine-readable verdicts:** `public/gap_verifications.json`. The UI shows these as badges.

## Results

| Verdict | Count | Meaning |
|---|---|---|
| Confirmed | 22 | The gap is real within the corpus |
| Partly addressed | 20 | Some corpus paper partly covers it, but the graph missed or under-weighted it |
| Closed in corpus | 8 | A corpus paper does address it; the extractor missed the edge |
| Extraction artifact | 4 | Caused by entity-normalization splits |
| Not supported | 6 | The rule fired but its premise is wrong (metrics, non-harmful behaviors, context-dependent "conflicts") |

So 42 of 60 gaps (70%) are real or partly real, and 18 are false positives. Every false positive traces back to one of three causes:

1. **Entity-normalization splits.** "deception", "deceptive behavior" and "strategic deception" are separate nodes, and so are "scheming" and "covert actions". A mitigation or detector attached to one name is invisible to the others.
2. **Metrics typed as phenomena.** "compliance gap" and "covert action rate" are measurements, not things to detect.
3. **Context-blind conflict detection.** Both conflicts disappear once you read the edge `contexts`. One is a different experimental setting (P01's sycophancy setting); the other is a different model (ChatGPT vs GPT-4 in P35).

## Real gaps worth reporting (confirmed)

- **Gradient hacking:** discussed in 4 papers (P04, P05, P06, P26) and observed or tested in none. There's no detection or mitigation. P26 notes it would undermine capability-eval-based safety cases.
- **Exploration hacking:** theoretical only (P06, P26). The closest empirical work (P17, P23, P24) uses password-locked or sandbagging organisms, never RL exploration.
- **Beyond-episode goals and early undermining:** these are Carlsmith (P05) premises for scheming that no paper measures.
- **Mesa-optimization and pseudo-alignment:** P04 constructs with no operationalization anywhere in the corpus.
- **Goal misgeneralization and power-seeking:** discussed (P34, P05, P10), with no tested detection or mitigation.
- **Mitigating anti-AI-lab behavior:** P01 measures self-exfiltration attempts, but no paper tests a mitigation.
- **Removing the RM-sycophancy objective:** P19 detects the planted objective through auditing, but removing it isn't studied.

## Partly addressed (the most interesting research directions)

- **Situational awareness as a cause of scheming:** SA is measured (P18, P21, P22), but its causal role (P05, P34) is untested. A corpus-based route would be to vary SA, using the P18/P21 setups, and measure covert action rate with the P07 suite.
- **Deceptive alignment detection:** detectors exist for planted organisms (P25 probes on P03 sleeper agents, P19 auditing, P20 CoT monitoring), but none for naturally emergent cases like P01's.
- **Scheming mitigation:** P07's anti-scheming training cuts covert actions (o3 13%→0.4%) without eliminating them, and it raises verbalized evaluation awareness. So it's unclear how much of the drop is real alignment.
- **Evaluation recognition:** P28 (realistic honeypots), P27 and P22 characterize it, but no intervention reduces it.

## Gaps that may be artifacts of missing papers

Curated papers **#11–#15** have no Paper node in this graph:

- #11 Why Do Some LMs Fake Alignment
- #12 SAD (Situational Awareness Dataset)
- #13 Agentic Misalignment
- #14 Sabotage Evaluations
- #15 Sycophancy to Subterfuge

The sycophancy, sabotage and situational-awareness gaps are each weaker than they look, because the missing papers address them directly. Re-ingesting those five papers is the cheapest way to improve the gap list.

## Suggested engine improvements (in priority order)

1. Merge near-synonym entities before running gap rules. The engine already finds them via `related()` (is-a, similar names), but only uses them for resolutions.
2. Add a context check in conflict detection: flag a conflict only when the two edges' `contexts` overlap.
3. Exclude metric-like concepts (labels containing *rate, gap, score*) and non-harmful behaviors (e.g. *calibration*) from the no-detection and no-mitigation rules.
4. Add paper→paper citation edges to the backend. Right now "cites" is approximated from author-year mentions in extracted passages, which is sparse, and same-author same-year papers are ambiguous: Greenblatt 2024 matches three corpus papers.
