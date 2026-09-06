# D2 sharded held-out listwise diagnostic — final report

**Run** `d2-a4b01fc869c486c1` · 261/261 shards · 2 episodes · ~10 h wall clock
**Verdict** `fail-joint-selection-not-shown` · exit 1
**`resultDigest`** `955f5ec9c89b41a8259dfa66b598616f8c641ef69959b8ff0d566d21460a1b62`
**Post-flight** 27 checks passed, 0 failed

Per design §10.3(a) this verdict **closes the action-conditioned representation
hypothesis**. That closure is pre-registered: placements, subsets, splits,
features, the lambda grid, cardinality and thresholds may not be changed
afterwards in pursuit of a PASS. Nothing in this report argues around that, and
the recommendation is not to re-run D2.

What the rest of this report does is fix the *scope* of the closure, because a
verdict recorded without its scope will be over-read later.

---

## 1. What the run measured

| metric (48 held-out subsets) | afterstate13 | action24 | delta |
| --- | --- | --- | --- |
| `sumScore` | 13,884,400 | 13,834,700 | −49,700 (−0.36 %) |
| `scoreRate` | 564.96 | 562.94 | −2.02 |
| `tetrisShare` | 0.06409 | 0.06097 | −4.9 % relative |
| `subsetJointFrontHits` | 19 | 19 | 0 |
| `survivalBelowSubsetOracle` | 0 | 0 | — |

```
failureReasons: action24-score-lower-than-afterstate13
                action24-tetris-share-lower-than-afterstate13
                joint-score-and-tetris-not-strictly-higher
```

## 2. What this establishes, exactly

**The verdict's own name is the accurate summary: not *shown*.** Three things
follow from it, and no more.

1. On this frozen sample, action24's selections scored slightly lower on both
   score and Tetris share.
2. The two representations tied at 19/48 front hits.
3. Both survival gates passed cleanly, so the result is not an artefact of the
   knife-edge described in §4.

**It does not establish that action24 is worse.** Design §9 is explicit that
this is a deterministic pre-registered acceptance gate that "不宣称 p-value 或
随机置信区间". A −0.36 % gap on one fixed 48-subset sample carries no
significance claim, and the gate demands *strict* improvement on both score and
Tetris share — a criterion a genuinely equal representation fails roughly half
the time. Reporting this as "action24 is worse" would assert something the
design deliberately refuses to measure.

**The most informative single fact is the 19–19 tie.** The selected placement
lists are largely identical. Eleven extra action-conditioned features rarely
changed which placement was chosen — and a representation that rarely changes
the decision cannot produce a detectable difference in either direction. That,
rather than the sign of the score delta, is what this run actually learned.

## 3. Four of the seven gates could not discriminate

Recorded because it bounds what the experiment could ever have concluded, and
because it was established **before** the verdict existed, not after.

- **The two survival gates are inert.** 99.8 % of continuations reach the
  128-piece cap (2,203 of 2,208 test labels), so a placement's survival tuple is
  `(4, 128, 512)` for essentially every candidate and the subset oracle equals
  almost all of them. `action24OracleSafe` and `action24NonLowerSurvival` cannot
  reward a better representation; they can only fire on an unlucky selection.
  Measured pre-verdict and recorded in `progress.md` with a ~18.5 % estimate of
  a coincidental failure — which did not occur.
- **The 36/48 front-hit floor was unreachable.** Both representations scored 19.
  No outcome of this experiment could have satisfied `action24FrontHitFloor`, so
  even a decisive action24 win would have failed. Whether 36 was ever calibrated
  against an attainable range is an open question about the gate, not about the
  representations.
- **The `+8` front-hit gain follows the floor.** From a tie at 19, reaching a
  +8 margin means 27 against 19 — an effect size the observed agreement between
  the two models gives no reason to expect.

The verdict therefore rests entirely on score and Tetris share. Those two did
discriminate, and they said "not shown".

## 4. The saturation is the same failure this project already retired once

A competent player does not die inside 128 pieces, so a survival-based measure
ties at its ceiling for every candidate worth choosing. This is structurally the
same defect that killed the lines-based fitness (`docs/ai-training-handoff.md`
§ "历史根因：消行数封顶"), one level up: there it was elites tied at `0.4 × cap`
with selection pressure vanishing; here it is candidates tied at
`(4, 128, 512)` with two acceptance gates unable to separate them.

Raising the cap is **not** the fix. That was tried on the fitness problem and
failed: survival grows with the cap, so the ceiling moves but never arrives,
while cost grows exponentially.

## 5. What may and may not follow

**May not** — §10.3(a) forbids all of this:

- re-running D2 with different thresholds, features, lambda grid, cardinality,
  splits or subsets;
- treating the four non-discriminating gates as grounds to retry *this*
  experiment. The gate-design observations in §3 are recorded so that a future,
  separately designed question does not inherit them — not as an argument that
  this question deserves another attempt.

**May** — and is the honest reading:

- **Do not adopt action24.** This is the correct action on this evidence and
  matches the gate.
- **Do not describe the action-conditioned idea as refuted.** It was closed by
  pre-registration on an experiment whose discriminating power reduced to two of
  seven gates, and whose two models mostly agreed. "Closed" and "refuted" are
  different claims; the record should carry the first.
- **A different question, if anyone asks one, needs its own design gate**, and
  needs to fix the measurement before the hypothesis: a horizon where competent
  play actually dies, thresholds calibrated against an attainable range, and a
  power argument made in advance rather than discovered in the receipts.

## 6. Provenance and integrity

- `resultDigest` recomputed independently from the canonical projection with
  `runProvenance` excluded — the partition-invariance claim holds on a real
  two-episode run.
- `receiptDigestSummary` recomputed from all 261 receipts on disk; every receipt
  validates under the production validator and is bound to this manifest; phase
  counts exactly as §5.1 specifies.
- Seeds are the pre-registered constants: `baseSeed 20260902`,
  `behaviorSeedDigest 72a121fe…b4643`, `labelSeedDigest 4afd6a46…08a8df`.
- Write boundary held: the four artifact hashes are byte-identical to pre-flight
  (`src/ai/trained-weights.json` and `public/ai/best-weights.json` both
  `062552496E7E…550D90`), no repository trainer lock was created, no candidate
  directory, nothing written outside `diagnostics/d2-a4b01fc869c486c1/`.

## 7. One caveat on the run itself

The run spans two code versions. Episode 1 halted at `fit/action24` on a D1
convergence defect — an absolute `gradientNorm <= 1e-9` tolerance that a
converged fit whose floating-point floor sits at 1.832e-9 can never satisfy —
and episode 2 ran after that was fixed.

The fix changed **no selected model**: selection chose λ=0.001 for both
representations, and both winners converged bit-identically before and after.
The λ=0.1 cell that the fix unblocked was compared and lost. The manifest binds
no source-code version, so nothing in the protocol would have detected the
change on its own; what did was `assertRebuildMatchesReceipts`, and
`fit/afterstate13` was verified to rebuild to its pre-fix receipt digest
`61efa05a…c982` under the fixed code.
