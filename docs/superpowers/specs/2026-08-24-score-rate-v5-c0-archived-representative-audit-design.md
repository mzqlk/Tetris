# score-rate-v5 C0 archived representative audit design

**日期：** 2026-08-24

**状态：** 用户已批准 C0 方向；本文只冻结设计，不实现或运行 audit，不修改训练、CEM、weights、artifacts 或 published model。

**一句话目标：** 用全新 matched seeds 独立复评已保存的 gen-6 best，判断真实的 Tetris/score 联合信号是否被 score-only CEM 的后续 elite averaging / `mu` 代表机制丢失。

## 1. 背景与当前证据

### 已验证事实

- active contract 仍为 `score-rate-v5` / schema 6 / `bag-expectimax-hold-v2` / depth 4 / root-child beams 64/32 / `maxWorkUnits=3584` / `budget-corpus-v1`。
- scalar fitness 仍精确为 `meanScore / scheduled maxPieces`；Tetris share、strategy/search diagnostics 与 survival diagnostics 不进入 CEM 排序或更新。
- A+ 的有限 horizon/search D0 已 fail-closed；B1/B1.1/B1.2 corpus 系列已按 terminal 规则停止。不得通过新 corpus、放宽 gate、加 budget 或人工 T4 bonus继续该路线。
- gen 6 的 generation best 在训练共同 seeds、5 games × 2000 pieces 上同时记录 `bestScoreRate=791.84` 与 `bestTetrisLineShare=0.0952863659401926`；同代 elite Tetris share 中位数仅 `0.0005008765339343852`。
- gen 9 best 的对应值为 `596.04` 与 `0.0010032605969400553`，elite Tetris share 中位数为 0。
- gen-10 fixed reevaluation 使用 30 games × 5000 pieces；published baseline 为 score rate `636.0193333333333`、Tetris share 0、30/30 survival，normalized `mu` candidate 为 `598.6733333333333`、Tetris share 0、30/30 survival。
- fresh inspection confirms every generation log record includes normalized `bestWeights`; C0 therefore does not need a new training run to recover gen-6 or gen-9 representatives.

### 未知项

gen-6 best 的 9.53% Tetris share 可能是：

1. 可在独立 seeds 上复现、且 score/survival也优于 gen-10 `mu` 的真实个体信号，说明 representative selection/retention丢失了有价值向量；
2. 只在 5 个 training seeds 上出现的高方差偶然值；
3. 可复现 Tetris、但以 score regression换取，不能满足用户要求的联合改进。

C0 只区分上述三类观测结果，不改变算法，也不单独诊断 search/representation 因果。

## 2. 方案比较

### 方案 A：C0 archived representative matched-seed audit（采用）

从 immutable gen-10 run 中提取 gen-6 best、gen-9 best、normalized gen-10 `mu` 与 immutable published baseline，在一套新的 30-game schedule 上运行完全相同的 v5 search。主假设预注册为 gen-6 best vs gen-10 `mu`；gen-9只作为 recent negative control，published baseline只作为资格参照。

优点：不训练、不改代码契约即可直接检验现有事实链；成本约为四个向量各 30 局，低于一次新训练代的 population evaluation，但仍是显著 CPU audit。风险：只检查三个 historical representatives，不能证明 Pareto archive 必然有效。

### 方案 B：直接实现 constrained/Pareto CEM（拒绝）

它会改变 elite selection、archive、checkpoint/schema 与训练成本；在 gen-6 信号尚未独立复现时，无法区分“保留机制错误”与“原信号只是噪声”。预计 game-task 成本显著增加，不符合最短可否证顺序。

### 方案 C：立即进入 action-conditioned feature + listwise protocol（备用）

它修复 same-state I-access feature不可辨识问题，但又开启新的 feature/protocol/corpus设计。只有 C0 否证 CEM-only hypothesis 后才进入该方向，避免同时改变表示与选择机制。

## 3. Frozen source inputs

### 3.1 Source artifacts

C0 输入只来自以下当前 run 与 published files；实现必须在任何 simulation 前重新验证文件 SHA-256：

| Path | SHA-256 |
| --- | --- |
| `public/ai/score-rate-v5-smoke-20260820-200634/checkpoint.json` | `93B2A63FF221B7E6EE1BD5CBFF8AE8C75B5B96411AD5B2EE4AFFA3806B6C06BD` |
| `public/ai/score-rate-v5-smoke-20260820-200634/training-log.jsonl` | `C86457320694A8C2D85C734D64D9CE6E58166D913974F945370D15FBC7C651BA` |
| `src/ai/trained-weights.json` | `062552496E7E1101502E62B8570DFDAF2A60B54EF4FEF1EA539723B910550D90` |
| `public/ai/best-weights.json` | `062552496E7E1101502E62B8570DFDAF2A60B54EF4FEF1EA539723B910550D90` |

Run validation must reuse the existing strict schema-6 artifact/log validators and require exactly generations 0–9 plus the gen-10 reevaluation boundary, objective/search metadata equality, no candidate, and `bestQualifiedCandidate=null`.

### 3.2 Vector identities

Vector digest is lowercase SHA-256 of UTF-8 `JSON.stringify(vector)` after exact extraction/normalization. Each vector must contain 13 finite values in unchanged `FEATURE_NAMES` order. 表中的 L2 使用现有 strict validator 相同的 `Math.hypot(...vector)` 计算。

| C0 id | Authoritative source | Normalization | L2 | Vector digest |
| --- | --- | --- | ---: | --- |
| `published-baseline` | checkpoint `publishedBaseline.weights` | already normalized; do not renormalize | `1.0000000000000002` | `f623fd7662d2b01b1c815d80897aa89379b72bbd66d654e1bbfe31e46ca7a67d` |
| `gen6-best` | generation record `gen=6.bestWeights` | already normalized; do not renormalize | `0.9999999999999999` | `233cc500168fe7258305d87654a640ad9aef3f67092d5e0e016f910b9d660ca9` |
| `gen9-best` | generation record `gen=9.bestWeights` | already normalized; do not renormalize | `1` | `f67d20457d421dbf4778e8c5196fd9611c711ba453e8e8fac0c2afe7a49be141` |
| `gen10-mu` | checkpoint `mu` | apply existing `normalize` exactly once | `1.0000000000000002` after normalize | `b669671a3cf0132db1e2948cc610aef98bf22a0284f182ac248a74fdf3234b1b` |

For provenance, raw checkpoint `mu` must also match digest `35c5623d1b07866673c636a0c1bf26fa32e53baf9ca9726482ec582261e62152` and pre-normalization L2 `0.6291257579420081`.

Missing, duplicated, non-finite, reordered, renormalized generation-best, or digest-mismatched input is `invalid-input`; no simulation may start.

## 4. Frozen evaluation schedule

- schedule id: `c0-archived-representative-audit-v1`;
- base seed: exact safe integer `20260824`;
- seed list: `hashSeed(20260824, gameIndex)` for `gameIndex=0..29`;
- seed-list digest: lowercase SHA-256 of UTF-8 `JSON.stringify(seedList)`，固定为 `1c2ce47837f0483d3f366a6817a29d88614029febfd6aca6dd42e376873b204b`;
- games: exactly 30 per vector;
- max pieces: exactly 5000 scheduled pieces per game;
- four vectors, same 30 seeds, total 120 primary simulations;
- search: unchanged `bag-expectimax-hold-v2`, depth 4, beams 64/32, budget 3584, `budget-corpus-v1`, caches 65536/16384;
- standard Hold, exact seven-bag public state, SRS, survival-first and deterministic tie-breaks unchanged;
- task ordering: seed-major, then vector order `published-baseline`, `gen6-best`, `gen9-best`, `gen10-mu`;
- no early stopping, optional stopping, candidate dropping, seed replacement or retry after partial result inspection.

The new C0 seed must not be training base seed `20260727`, historical paired seed `20260803`, or any existing fixed-reevaluation schedule. 在 simulation 前，implementation 必须从 parsed run metadata 与 frozen constants 重建 generation 0–9 的 50 个 training seeds、30 个 fixed-reevaluation seeds 和 30 个 historical paired seeds，并断言 C0 列表内部 30/30 唯一且与三套历史列表的交集均为空。

## 5. Metrics and statistical protocol

### 5.1 Per-game records

For every vector/seed, retain in memory only:

- score and `scoreRate = score / 5000`;
- reason (`pieceCap` or `gameover`) and pieces survived;
- singles/doubles/triples/tetrises;
- `tetrisLineShare` using the existing shared definition;
- mean height, strategy diagnostics and complete search diagnostics;
- deterministic result projection digest.

Diagnostics do not enter the verdict except where explicitly named below.

### 5.2 Paired intervals

Reuse the existing 30-sample two-sided 95% Student-t interval (`df=29`, critical value `2.045229642132703`) over per-seed differences. No bootstrap, seed resampling, one-sided conversion or multiple-vector winner selection is allowed.

Compute these pre-registered comparisons:

1. **Primary:** `gen6-best - gen10-mu`;
2. **Negative control:** `gen9-best - gen10-mu`;
3. **Qualification context:** `gen6-best - published-baseline` and `gen9-best - published-baseline`.

Only comparison 1 can determine C0 PASS. Comparison 2 cannot replace gen 6 if it looks better; comparisons 3 are reporting/publication context only.

For each comparison report score-rate difference interval and per-game Tetris-share difference interval, plus aggregate Tetris share and piece-cap counts for both sides.

## 6. Verdicts

### 6.1 `pass-retention-loss-supported`

All conditions must hold for the primary gen6-vs-mu comparison:

1. score-rate interval lower bound `>0`;
2. Tetris-share interval lower bound `>0`;
3. aggregate gen-6 Tetris share `>=0.01`;
4. gen-6 piece-cap games `>=` gen-10 mu piece-cap games;
5. no error/abort/nondeterminism and all 30 pairs complete.

This supports the narrow conclusion that a jointly better historical individual existed on independent seeds and was not represented by gen-10 `mu`. It authorizes only a separate C1 archive/selection design; it does not prove Pareto CEM, candidate qualification or publication readiness.

### 6.2 `fail-signal-not-reproduced`

Gen-6 aggregate Tetris share is below 1%, or its paired Tetris interval lower bound is not above 0. The CEM-retention hypothesis is rejected for the archived evidence; next design should be action-conditioned feature + held-out listwise protocol.

### 6.3 `fail-joint-improvement-not-shown`

Tetris signal reproduces, but score-rate lower bound is not above 0 or survival is lower than `mu`. This is a strategy/score tradeoff, not the user-required joint improvement. It does not authorize C1; next design should address representation/search rather than preserving a cosmetic Tetris specialist.

### 6.4 `invalid-input` / `runtime-fail`

Artifact/vector/schema/seed mismatch is `invalid-input`. Worker failure, abort, malformed diagnostics, unexpected reason, non-finite metric or deterministic replay mismatch is `runtime-fail`. Both stop without partial inference or rerun-driven seed changes.

### 6.5 Publication context remains stricter

Even if C0 passes, the existing final candidate rules remain unchanged: candidate aggregate Tetris share `>=0.20`, score-rate paired 95% lower bound `>0` versus published baseline, Tetris-share paired lower bound `>0`, and zero survival regression. C0's 1% floor is only a retention diagnostic, never a candidate/publication threshold.

## 7. Determinism and output contract

After the 120 primary simulations, rerun only game indices `0` and `29` for all four vectors (8 replay simulations). Exact projected records must match their primary records byte-for-byte. This is a pre-registered spot replay, not permission to rerun failed games.

The completed audit emits exactly one JSON line to stdout with:

- mode/status/schedule/search metadata;
- source file hashes and vector ids/digests;
- seed base and digest of the 30-seed list;
- aggregate result per vector;
- four paired comparisons with intervals;
- primary gate booleans and exact failure reasons;
- replay determinism evidence;
- SHA-256 digest over the complete canonical result projection.

stderr must be empty on a completed verdict. The audit creates no repository lock and writes no file, checkpoint, log, candidate, weight or `public/ai` artifact. On invalid input/runtime failure it exits nonzero; if a structured result can be safely formed it still emits one fail-closed JSON line, otherwise stderr contains only a concise redacted error and stdout is empty.

## 8. Implementation boundaries for a later plan

A future implementation plan may add only a standalone read-only C0 module/test and one package script. It should reuse:

- strict run artifact/log validation;
- `normalize`, `hashSeed`, `simulateGame`/`WorkerPool`, `aggregateFitness`;
- `pairedInterval30` and shared Tetris/survival calculations;
- frozen `SEARCH_METADATA`.

It must not create temporary weight files merely to satisfy `pairedBench`, because that would weaken provenance and introduce filesystem output. Existing `bench:paired` remains unchanged; C0 consumes the four validated in-memory vectors directly.

Any code gate must use explicit safe test/lint/typecheck lists excluding the protected untracked probes. Independent review must cover source/vector provenance, seed independence, exact task order, pair alignment, statistical calculations, no optional stopping, stdout-only/no-file behavior, abort cleanup, and active-v5 parity.

## 9. Cost and operational gate

Primary work is 120 games × 5000 scheduled pieces = 600,000 scheduled pieces, plus 8 replay games = 40,000 pieces. Runtime is expected to be significant because every decision uses the fixed v5 search; no wall-time promise is made before a code-only dry plan and process/CPU review.

The audit is neither training nor publication, but it is an expensive benchmark-like operational action. Before its single authorized run, refresh:

- real HEAD/index/status and active-v5 diffs;
- all Node processes with CPU/memory/command line;
- repository/index locks;
- source run entries, timestamps, exact hashes and parsed schema;
- candidate/default-run absence;
- both published weight hashes;
- protected probe status-only boundary.

SIGINT aborts the audit, destroys the worker pool and yields no partial verdict. No repository/TEMP lock is deleted.

## 10. Invariants and non-goals

- no change to `FEATURE_NAMES`, fitness, CEM, search contract, budget, schema 6 or weights;
- no training/resume/restart, calibration, existing bench/paired run, publication, push or browser/runtime acceptance in this design phase;
- no modification/movement/deletion/archive of the gen-10 run or any published file;
- no B1/B1.1/B1.2 corpus repair or diagnostic rerun;
- protected probes remain status-only and excluded from reading, execution, hashing, tests, typechecks, reviews, staging and commits;
- C0 does not choose Pareto archive semantics, schema 7, a new objective, T4 bonus or curriculum;
- C0 cannot establish causality beyond the four frozen representatives and one independent seed schedule.

## 11. Next decision

- `pass-retention-loss-supported` → write a separate C1 constrained/Pareto archive design while retaining scalar score-rate fitness and strict final joint-improvement gates;
- `fail-signal-not-reproduced` or `fail-joint-improvement-not-shown` → close CEM-only path and design action-conditioned feature + held-out listwise protocol;
- invalid/runtime failure → fix only input/runtime correctness under a new code/review gate; never change vectors, seeds or thresholds after seeing partial results.

本文完成 C0 design gate 即停止。Implementation plan、code、audit execution、training、benchmark、publication 或其他后续动作均不由本规格自动触发。
