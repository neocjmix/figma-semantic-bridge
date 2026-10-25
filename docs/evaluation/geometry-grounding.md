# Constructed geometry grounding benchmark — 2026-10-26

This is the synthetic precision/recall report for [issue #3](https://github.com/neocjmix/figma-semantic-bridge/issues/3).
It evaluates source-ID sets on 14 deliberately constructed cases. It does not
measure semantic understanding, human review quality or real Figma accuracy.

## Corpus and independent expected sets

[`scripts/benchmark-grounding.ts`](../../scripts/benchmark-grounding.ts) declares
literal expected source-ID sets separately from execution of `matchRegion`.
Labels follow the described constructed objects: isolated sources, controls
spanning separate branches, empty space and unavailable hidden sources. They do
not call the matcher, reproduce its scoring equations or derive expected IDs
from its returned candidates. The implementation agent authored the fixtures;
these are not labels from independent human reviewers or a representative corpus.

Two equal-bounds cases permit either geometric source as an explicit alternative.
Both must remain ambiguous. Accepting an alternative does not establish which
layer is visible, newer or semantically intended. The benchmark never assigns
semantic confidence or approves a source.

## Executed result

The recorded [JSON result](geometry-grounding.json) contains the corpus SHA-256,
runtime, observation timestamp, per-case predictions, labels, counts, ambiguity
and all timing samples. It was executed on Node 22.22.0, macOS arm64.

| Measure | Result |
| --- | --- |
| Cases / correct acceptable source sets | 14 / 14 |
| Micro TP / FP / FN | 15 / 0 / 0 |
| Micro precision / recall / F1 | 1.0 / 1.0 / 1.0 |
| Macro precision / recall / F1 | 1.0 / 1.0 / 1.0, each across 11 nonempty-denominator cases |
| Empty-space abstentions | 2 / 2 correct |
| Incomplete-observation required abstention | 1 / 1 correct |
| Positive cases with no proposed source | 0 |
| Ambiguity on complete scopes | 3 of 13 (23.08%) |
| Additional incomplete-scope ambiguity | 1; this is a coverage warning, not an equal-bounds measurement |
| Agreement with separate ambiguity labels | 14 / 14 |
| Determinism | 14 / 14 unchanged under reversal and rotation of input-node order |

| Case | Expected source-set size | Ambiguous |
| --- | ---: | --- |
| Isolated exact rectangle | 1 | No |
| 0.3px tolerance offset | 1 | No |
| Equal-bounds siblings | 1 of two alternatives | Yes |
| Equal-bounds parent and fill | 1 of two alternatives | Yes |
| Separate siblings with a gap | 2 | No |
| Controls in distant tree branches | 2 | No |
| Two containers with nested labels | 2 | No |
| Partly overlapping siblings | 2 | Yes |
| Hidden ancestry | 1 visible source | No |
| Zero-opacity ancestry | 1 visible source | No |
| Child outside parent bounds | 1 | No |
| Empty gap | 0 | No |
| Outside edge touching only | 0 | No |
| Incomplete captured observation | 0, withheld | Yes |

Each timing case has three unreported warmups and 25 reported repetitions.
Timing includes index construction on only 2–5 source nodes and is not a scale
or native-performance result. Consult the JSON for the measured median, minimum,
maximum and samples; no pass threshold is derived from these small timings.

## Scoring and limitations

For each case, TP is the predicted/expected set intersection, FP is a proposed
ID absent from the expected set, and FN is an expected ID omitted from the
prediction. Precision is TP/(TP+FP); recall is TP/(TP+FN). Set F1 is
2TP/(2TP+FP+FN). With several acceptable alternatives, one whole set is selected
by highest F1 and a stable lexicographic tie-break; alternatives are never
unioned, and precision and recall are not optimized against different sets.

A zero denominator is recorded as `null` (not measured), not an invented score.
An empty prediction for empty-space or required-withholding labels is counted
as a successful abstention separately. Macro scores exclude null denominators
and report the number included. The incomplete case says nothing about the
unknown full source set: it checks only that partial capture is not approved
as sufficient evidence.

Perfect scores on these hand-selected cases do not establish unseen-case
generalization. No screenshots, native Figma reads, real paint-order resolution,
mask/clipping interpretation, provider inference, human semantic labels or
productivity measurements were performed. The broader F4/F5 acceptance remains
separate in [completion status](../completion-status.md#external-dependencies).

## Reproduce

```sh
npm run benchmark:grounding
node --import tsx --test tests/product-grounding-benchmark.test.ts
```

The benchmark overwrites only its generated JSON report. Tests verify scoring
with deliberate false positives/negatives, abstentions, undefined denominators,
duplicate rejection and alternative-set ties, then check the labeled cases.
The first focused test run failed because the implementation module did not yet
exist; the completed implementation passed all three focused tests and TypeScript.
