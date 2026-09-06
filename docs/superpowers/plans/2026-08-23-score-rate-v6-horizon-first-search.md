# score-rate-v6 Horizon-First Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变 score-rate 标量 fitness、公平信息边界和 survival-first 排序的前提下，先用可否证 D0 诊断确认 horizon-first 搜索，再将唯一通过的 beam/budget 配置冻结为 `score-rate-v6` / schema 7 / `bag-expectimax-hold-v3`。

**Architecture:** Phase A 先建立 32-state 显式公开语料、共享纯搜索策略层和只输出 stdout JSON 的 D0 CLI；默认 v5 搜索行为在此阶段保持不变，D0 代码门通过后必须停止，等待独立运行授权。只有 D0 产生唯一合格配置且用户批准该结果后，Phase B 才把同一共享实现提升为 production search，扩展诊断、CEM archive、固定复评 pool、schema/artifact 校验和 dashboard；诊断、校准、训练、paired、publication 与 browser acceptance 仍是彼此独立的操作门。

**Tech Stack:** TypeScript 5.6、Vitest 3、Node.js/tsx、React 18；沿用项目 engine/SRS、纯 `src/ai` 搜索、worker_threads 训练器和 JSON/JSONL artifacts，不新增运行时依赖。

## Global Constraints

- 开始每个执行会话时先读 `AGENTS.md` 与 `docs/ai-training-handoff.md`，再刷新真实 HEAD、`git status`、trainer 进程、repository lock、目标 output dir 和 published/bundled weights；continuity `match` 不能替代这些现场证据。
- 直接在当前 `master` 工作区实施；除非用户另行要求，不创建 branch 或 worktree。
- 永远不得读取、执行、哈希、修改、移动、删除、暂存或提交 `training/searchProbe.ts`、`training/searchProbeWorker.ts`、`training/searchProbe.test.ts`；只能用 `git status` 确认它们的未跟踪路径状态。
- 所有测试列表必须来自 `git ls-files`。三个 protected probe 存在时，不运行会收集未跟踪测试的裸 `npm test`；用本文的 tracked-test 命令作为完整 tracked suite。
- 不修改、移动、删除或归档 `public/ai/score-rate-v5-smoke-20260820-200634/`，不修改 `src/ai/trained-weights.json`、`public/ai/best-weights.json` 或任何 published weights，不删除任何 TEMP lock。
- Phase A 不改变 production 默认 `score-rate-v5` / schema 6 / `bag-expectimax-hold-v2` / beams 64/32 / `maxWorkUnits=3584`，不创建 schema 7 artifact。
- D0 只读运行是独立授权门。Phase A 的代码与测试完成不授权执行 `npm run diagnose:horizon`。
- D0 的搜索顺序固定为预算 `3584, 3840, 4096, 4352, 4608` 外层、beam tuple `16/2,8/1`、`12/2,6/1`、`8/2,4/1`、`6/2,3/1`、`4/1,2/1` 内层；第一个通过项即唯一选择，最大预算不得超过 4608。
- D0 到 4608 仍失败时，A+ 被否证并停止；不得自动增加预算、降低门槛、切到 B/C、校准或训练。
- 只有获批 D0 JSON 中的 `selectedConfiguration` 可成为 Phase B 常量；实施者没有另选 tuple/budget 的裁量权。
- Phase B 才能把 active contract 更新为 `score-rate-v6`、schema 7、`bag-expectimax-hold-v3`；`FEATURE_NAMES` 仍为原 13 项且顺序不变。
- CEM scalar fitness 始终精确为 `meanScore / scheduled maxPieces`；T4、Hold、策略槽、target well、search diagnostics 和 archive 均不得进入 fitness 或 `updateCem`。
- 搜索只使用 `board/current/next/hold/holdAvailable/unseenBagMask`；不得读取 seed、RNG、隐藏 bag、精确 bag index 或运行时生成顺序。
- unseen bag mask 中各合法 piece 保持精确等概率；mask 为空时开启完整七袋。标准 Hold 每锁定回合最多一次，Hold 不消耗 lock depth，空 Hold 与非空 Hold 语义不变。
- `SearchValue` 继续先比较 `survivalProbability`，仅在 survival 相等时比较 `expectedHeuristicValue`；strategy slot 与 intent 不得覆盖该顺序。
- Placement 继续使用 engine rotation/SRS；不得原地修改 board rows；`src/ai` 不增加 Node、DOM、filesystem 或模块级可变状态。
- work-unit 仍在 placement evaluation、chance expansion、cache hit 执行前扣费；完整层事务、depth-1 保证、上一完整层回退和永不透支语义保持。
- Hold 是 placement beam 之外的独立分支；chance node 不设 beam，枚举全部公开合法 outcome。
- v6 新跑必须使用显式、启动时为空的独立目录，且不 resume/append/migrate schema 1–6 artifacts。目录名只在未来训练授权时确定。
- D0 最多评估 `25 × 32 × 3` 个配置/状态/权重组合，并为确定性重复一次；它是分钟级有界诊断。正式搜索 unit 上限相对 v5 为 `1.0..1.2857×`，训练因存活尾部可能为 v5 的 `1..3×`；首次 fixed reevaluation 最多评估 baseline 加三个 pool vectors，后续最多三个 vectors。
- 所有 commit 步骤都需要当时的 commit 授权，只允许列出的精确 pathspec；未获授权时保留已验证 worktree 并更新 continuity，不得 broad-add、stash、reset、restore、push 或发布。

---

## File Responsibility Map

| 文件 | 操作 | 单一责任 |
| --- | --- | --- |
| `training/tetrisOpportunityCorpus.ts` | Create | 版本化 32-state 公开语料、人工动作类别标签、materialize 与动作分类 |
| `training/tetrisOpportunityCorpus.test.ts` | Create | 语料 exact count/order、只读性、公开字段、分层与标签契约 |
| `training/horizonDiagnosticWeights.ts` | Create | 冻结 postmortem 的 baseline、gen-6 best、gen-10 fixed candidate 三个 13 维向量及 provenance |
| `training/horizonDiagnosticWeights.test.ts` | Create | 精确 provenance、维度、有限值、L2 normalization |
| `src/ai/horizonPolicy.ts` | Create | score/strategy slots 稳定并集、同井 intent 转移与纯排序策略 |
| `src/ai/horizonPolicy.test.ts` | Create | slots、dedupe、stable tie、intent establish/preserve/reset/invalidate |
| `src/ai/tetrisStrategy.ts` | Modify | 增加指定列 well summary 与合法四格 I 带判断，不改变现有 best-well diagnostics |
| `src/ai/tetrisStrategy.test.ts` | Modify | 指定列与原 best-well 行为的回归测试 |
| `src/ai/searchCache.ts` | Modify | 将 `targetWellColumn` 纳入 decision/pending/equivalence cache identity |
| `src/ai/searchCache.test.ts` | Modify | 证明 intent 不同不能 cache alias，无 intent 的 v5 key 行为稳定 |
| `src/ai/search.ts` | Modify | 共享 v5/vNext expectimax core、horizon limits、逐完整深度 trace；Phase A 默认仍走 v5 policy |
| `src/ai/search.test.ts` | Modify | horizon policy、Hold/chance/survival/ledger 回归和 v5 parity |
| `training/horizonDiagnostic.ts` | Create | 有界 25-config D0 runner、pass/fail selector、stdout-only JSON CLI |
| `training/horizonDiagnostic.test.ts` | Create | gate 算法、选择顺序、fail-closed、序列化与无 import side effect |
| `package.json` | Modify | 新增 `diagnose:horizon` 脚本；不改变现有训练/bench 脚本语义 |
| `src/ai/searchBudget.ts` | Modify in Phase B | 冻结获批 D0 slots/budget 为 v3 production limits |
| `src/ai/searchBudget.test.ts` | Modify in Phase B | 常量、depth-1 lower bound、最大 4608 和 metadata 一致性 |
| `src/ai/trainingObjective.ts` | Modify in Phase B | 唯一 v6/schema7/v3 objective 与 exact search metadata 真相 |
| `src/ai/weights.ts` | Modify in Phase B | 读取 published v3、历史 schema6 与 active schema7；校验扩展诊断 |
| `src/ai/weights.test.ts` | Modify in Phase B | schema 7 exact-key、schema 6 compatibility、malformed metadata 拒绝 |
| `src/ai/simulate.ts` | Modify in Phase B | 聚合 slot/intent/逐深度 action-source 与 depth 3/4 完成率 |
| `src/ai/simulate.test.ts` | Modify in Phase B | 聚合算术、zero-call、Hold 与跨真实决策 intent 不持久化 |
| `training/cem.ts` | Modify in Phase B | 保持 CEM 更新不变，增加 elite T4 quantiles 与两个 archive 的纯选择函数 |
| `training/cem.test.ts` | Modify in Phase B | archive 资格、tie-break、reset 与 fitness 不敏感性 |
| `training/reevaluation.ts` | Modify in Phase B | `mu/scoreChampion/strategyChampion` 去重 pool 与 shared seed task layout |
| `training/reevaluation.test.ts` | Modify in Phase B | pool 顺序、去重、fresh baseline index 与既有 baseline 计划 |
| `training/publication.ts` | Modify in Phase B | 独立 gate 判定与 pool winner 排序；严格 score/T4/survival 门 |
| `training/publication.test.ts` | Modify in Phase B | 0.1% strict score、20% T4、survival、pool tie-break |
| `training/reevaluationLog.ts` | Modify in Phase B | 每个 pool entry 的 source/evaluation/qualification 与 selected identity exact schema |
| `training/reevaluationLog.test.ts` | Modify in Phase B | 多 entry round-trip、独立原因、deep snapshot 与 metadata mismatch |
| `training/runArtifacts.ts` | Modify in Phase B | schema 7 checkpoint/log/candidate exact-key、archive replay、旧 run 拒绝 resume |
| `training/runArtifacts.test.ts` | Modify in Phase B | archive/log replay、artifact identity、schema 1–6 fail-closed |
| `training/candidateWeights.ts` | Modify in Phase B | run-local schema 7 candidate，保留 pool source identity |
| `training/candidateWeights.test.ts` | Modify in Phase B | candidate exact fields、search diagnostics 与 source identity |
| `training/train.ts` | Modify in Phase B | archive update、三向量固定复评、atomic boundary 顺序与 generation diagnostics |
| `training/train-cli.test.ts` | Modify in Phase B | stubbed worker 的 pool orchestration、resume、无越界写入与 SIGINT 边界 |
| `training/calibrateSearchBudget.ts` | Modify in Phase B | 对获批 frozen config 执行 140/160 ms 独立性能门，不重新选择设计 |
| `training/calibrateSearchBudget.test.ts` | Modify in Phase B | frozen config、三 block、两 corpus、结构失败与 measurement error |
| `training/benchSummary.ts` | Modify in Phase B | 新 search diagnostics 的只读汇总/格式化；不执行 benchmark |
| `training/benchSummary.test.ts` | Modify in Phase B | 新聚合字段与 v3 metadata |
| `training/pairedBench.ts` | Modify in Phase B | 只接受 schema 7 v6 candidate，保持共享 seeds/config |
| `training/pairedBench.test.ts` | Modify in Phase B | v6 exact metadata 与历史 published v3 baseline 身份 |
| `src/training/dashboard/types.ts` | Modify in Phase B | v6 generation diagnostics 类型 |
| `src/training/dashboard/useTrainingLog.ts` | Modify in Phase B | v6 URL、exact metadata 与新增 generation fields 解析 |
| `src/training/dashboard/useTrainingLog.test.ts` | Modify in Phase B | v6 行解析、未知字段与 malformed diagnostics 拒绝 |
| `src/training/dashboard/App.tsx` | Modify in Phase B | 展示 depth 3/4、strategy retention、intent 与 elite T4 quantiles |
| `README.md` | Modify in Phase B | v6 contract、D0/代码/校准/训练/paired/publication 独立门 |
| `docs/ai-training-handoff.md` | Modify in Phase B | v5 失败历史、v6 invariants、操作边界和 recovery |

## Phase A — D0 prototype and code gate

### Task 1: Freeze the opportunity corpus and postmortem vectors

**Files:**
- Create: `training/tetrisOpportunityCorpus.ts`
- Create: `training/tetrisOpportunityCorpus.test.ts`
- Create: `training/horizonDiagnosticWeights.ts`
- Create: `training/horizonDiagnosticWeights.test.ts`

**Interfaces:**
- Consumes: `PublicSearchState`、`Piece`、`PieceType` 与 `assertPublicSearchState`。
- Produces:

```ts
export const TETRIS_OPPORTUNITY_CORPUS_ID = 'tetris-opportunity-corpus-v1' as const;
export type OpportunityStratum = 'build' | 'ready' | 'bag-hold' | 'safety';
export type OpportunityActionClass =
  | 'preserve-well' | 'complete-tetris' | 'destroy-well' | 'safety-only';

export interface SerializedOpportunityState {
  id: string;
  stratum: OpportunityStratum;
  rows: readonly number[];
  current: Piece;
  next: PieceType;
  hold: PieceType | null;
  holdAvailable: boolean;
  unseenBagMask: number;
  targetWellColumn: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  expectedActionClass: Exclude<OpportunityActionClass, 'destroy-well'>;
}

export const TETRIS_OPPORTUNITY_CORPUS_V1:
  readonly SerializedOpportunityState[];
export function materializeOpportunityState(
  value: SerializedOpportunityState,
): PublicSearchState;

export type DiagnosticWeightId = 'published-baseline' | 'gen-6-best' | 'gen-10-fixed';
export interface DiagnosticWeightSet {
  id: DiagnosticWeightId;
  source: 'checkpoint-publishedBaseline' | 'generation-6-bestWeights' | 'gen-10-reevaluation-candidate';
  weights: readonly number[];
}
export const HORIZON_DIAGNOSTIC_WEIGHTS: readonly DiagnosticWeightSet[];
```

- `TETRIS_OPPORTUNITY_CORPUS_V1` 必须按 `build-00..07`、`ready-00..07`、`bag-hold-00..07`、`safety-00..07` 固定排序。每个 entry 是完整 object literal；`rows` 必须是 22 个 unsigned 10-bit masks，不从 seed/RNG 或 simulator 生成。
- 24 个 strategy entries 的 label 只能是 `preserve-well` 或 `complete-tetris`；8 个 safety entries 固定为 `safety-only`。四个 bag/hold 组合（I in Hold、Hold empty、I in unseen mask、mask=0 bag boundary）每种至少两个。
- 三个向量固定为：

```ts
const PUBLISHED_BASELINE = [
  -0.031367029399983, -0.495143825415516, 0.0793071621028899,
  -0.064800464568292, 0.148406805642361, -0.300289317086154,
  -0.554188438392129, -0.422380132844968, -0.270541828558403,
  0.269145014191284, 0, 0, 0,
];
const GEN_6_BEST = [
  0.0218502033064118, -0.32193032364733, 0.240911730611772,
  0.185681209868789, -0.256836448069508, -0.446863105235042,
  -0.442665035753348, -0.432159844211585, -0.164324040989483,
  -0.184088692905663, 0.199873040803461, 0.230420019619894,
  -0.0326763798156333,
];
const GEN_10_FIXED = [
  -0.513541023663498, -0.219476966334894, -0.290560391562285,
  0.267021389649145, -0.000960449936586498, -0.189080133190787,
  -0.164840923648044, -0.495240431756198, -0.211698868222967,
  0.275489296503775, 0.203033598813738, 0.22997937389389,
  -0.0967882329751097,
];
```

- [ ] **Step 1: Write corpus contract tests**

```ts
expect(TETRIS_OPPORTUNITY_CORPUS_V1.map((entry) => entry.id)).toEqual([
  ...Array.from({ length: 8 }, (_, i) => `build-${String(i).padStart(2, '0')}`),
  ...Array.from({ length: 8 }, (_, i) => `ready-${String(i).padStart(2, '0')}`),
  ...Array.from({ length: 8 }, (_, i) => `bag-hold-${String(i).padStart(2, '0')}`),
  ...Array.from({ length: 8 }, (_, i) => `safety-${String(i).padStart(2, '0')}`),
]);
for (const entry of TETRIS_OPPORTUNITY_CORPUS_V1) {
  expect(entry.rows).toHaveLength(22);
  expect(entry.rows.every((row) => Number.isInteger(row) && row >= 0 && row < 1024)).toBe(true);
  expect(() => materializeOpportunityState(entry)).not.toThrow();
  expect(Object.isFrozen(entry)).toBe(true);
  expect(Object.isFrozen(entry.rows)).toBe(true);
}
```

- [ ] **Step 2: Run the focused tests and observe RED**

Run:

```powershell
npx vitest run training/tetrisOpportunityCorpus.test.ts training/horizonDiagnosticWeights.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
```

Expected: FAIL because the two modules do not exist.

- [ ] **Step 3: Implement literal corpus data, materialization, and frozen vectors**

`materializeOpportunityState` must clone every row and piece position, call `assertPublicSearchState`, and never return references that can mutate corpus literals. Action classification is implemented once in Task 2's shared pure policy and consumed by D0; the corpus module contains data/materialization only.

- [ ] **Step 4: Run focused tests and observe GREEN**

Run the Step 2 command. Expected: both files PASS; exact corpus length is 32, strata are 8/8/8/8, and all vectors have 13 finite entries with L2 norm within `1e-9` of 1.

- [ ] **Step 5: Review the corpus as data, not as generated fixtures**

Reviewer must inspect all 32 board diagrams/masks, confirm labels do not encode unique coordinates, and confirm no seed/RNG/hidden bag field exists. Any board or label change after this review requires `tetris-opportunity-corpus-v2`.

- [ ] **Step 6: Commit only if the commit gate is explicitly open**

```powershell
git add -- training/tetrisOpportunityCorpus.ts training/tetrisOpportunityCorpus.test.ts training/horizonDiagnosticWeights.ts training/horizonDiagnosticWeights.test.ts
git commit -m "test: freeze horizon diagnostic corpus"
```

### Task 2: Add pure target-well and stable beam policy primitives

**Files:**
- Create: `src/ai/horizonPolicy.ts`
- Create: `src/ai/horizonPolicy.test.ts`
- Modify: `src/ai/tetrisStrategy.ts:4-76`
- Modify: `src/ai/tetrisStrategy.test.ts:8-44`

**Interfaces:**
- Consumes: `Board`, `PlacementTransition`, placement `enumerationIndex` and `immediateHeuristic`.
- Produces:

```ts
export type TargetWellColumn = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | null;
export type BeamSource = 'score' | 'strategy' | 'both';
export interface HorizonBeamLimits {
  rootScoreSlots: number;
  rootStrategySlots: number;
  childScoreSlots: number;
  childStrategySlots: number;
}
export interface HorizonPlacementEntry<T> {
  value: T;
  enumerationIndex: number;
  immediateHeuristic: number;
  linesCleared: number;
  boardAfter: Board;
}
export interface SelectedHorizonPlacement<T> extends HorizonPlacementEntry<T> {
  beamSource: BeamSource;
  targetWellColumn: TargetWellColumn;
}
export function selectHorizonPlacementBeam<T>(
  entries: readonly HorizonPlacementEntry<T>[],
  root: boolean,
  currentIntent: TargetWellColumn,
  limits: HorizonBeamLimits,
): SelectedHorizonPlacement<T>[];

export function summarizeTetrisWellAt(
  board: Board,
  column: Exclude<TargetWellColumn, null>,
): TetrisWellSummary;
export function hasVerticalIBand(
  board: Board,
  column: Exclude<TargetWellColumn, null>,
): boolean;
export type TargetWellActionClass = 'preserve-well' | 'complete-tetris' | 'destroy-well';
export function classifyTargetWellTransition(args: {
  boardBefore: Board;
  boardAfter: Board;
  linesCleared: number;
  targetWellColumn: Exclude<TargetWellColumn, null>;
}): TargetWellActionClass;
```

- Strategy ordering is the lexicographic tuple `(linesCleared === 4, readyRows, setupCells, usableDepth, -enumerationIndex)` descending. This ordering chooses entries for strategy slots only; it never changes `immediateHeuristic` or final `SearchValue`.
- With `currentIntent=null`, an eligible strategy placement establishes `summarizeTetrisWell(boardAfter).column`; with an intent, only the same column is evaluated. A 4-line clear resets to null. Loss of `hasVerticalIBand` ends that strategy lane. A score-only placement retains an existing intent only while the same-column summary is not worse; otherwise its continuation intent is null.
- Stable union order is final `enumerationIndex` order. Dedupe is by enumeration identity: score first marks `score`, strategy-only marks `strategy`, duplicates become `both`. Hold is not accepted by this API.

- [ ] **Step 1: Write RED tests for specified-column summaries and beam union**

```ts
expect(summarizeTetrisWellAt(boardFrom([
  '####.#####', '####.#####', '####.#####', '####.#####',
]), 4)).toEqual({ column: 4, usableDepth: 4, setupCells: 36, readyRows: 4 });

const entries = [
  { value: 'score', enumerationIndex: 0, immediateHeuristic: 100,
    linesCleared: 0, boardAfter: boardFrom([]) },
  { value: 'both', enumerationIndex: 1, immediateHeuristic: 90,
    linesCleared: 0, boardAfter: boardFrom([
      '####.#####', '####.#####', '####.#####', '####.#####',
    ]) },
  { value: 'strategy', enumerationIndex: 3, immediateHeuristic: 0,
    linesCleared: 0, boardAfter: boardFrom([
      '#########.', '#########.', '#########.', '#########.',
    ]) },
];
const selected = selectHorizonPlacementBeam(entries, true, null, {
  rootScoreSlots: 2, rootStrategySlots: 2,
  childScoreSlots: 1, childStrategySlots: 1,
});
expect(selected.map(({ enumerationIndex, beamSource }) =>
  [enumerationIndex, beamSource])).toEqual([[0, 'score'], [1, 'both'], [3, 'strategy']]);
```

- [ ] **Step 2: Run focused tests and observe RED**

```powershell
npx vitest run src/ai/tetrisStrategy.test.ts src/ai/horizonPolicy.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
```

Expected: FAIL on missing exports/modules.

- [ ] **Step 3: Implement the minimal pure policy**

Reuse the existing `summarizeTetrisWell` comparison order. Validate columns as integers `0..9`, validate all slot counts as positive safe integers, clone arrays before sorting, and never mutate boards or entries.

- [ ] **Step 4: Add edge-case tests**

Cover exact heuristic ties, duplicate score/strategy selection, completed Tetris reset, invalidated band, compatible score placement, null-intent establishment, and a strategy entry whose high strategy rank does not alter its heuristic value.

- [ ] **Step 5: Run focused tests and observe GREEN**

Run Step 2. Expected: PASS with deterministic order on two repeated calls.

- [ ] **Step 6: Commit only if authorized**

```powershell
git add -- src/ai/horizonPolicy.ts src/ai/horizonPolicy.test.ts src/ai/tetrisStrategy.ts src/ai/tetrisStrategy.test.ts
git commit -m "feat: add pure horizon beam policy"
```

### Task 3: Share the expectimax core and expose bounded D0 trace

**Files:**
- Modify: `src/ai/search.ts:43-584`
- Modify: `src/ai/search.test.ts:31-352`
- Modify: `src/ai/searchCache.ts:99-159`
- Modify: `src/ai/searchCache.test.ts:62-206`

**Interfaces:**
- Consumes: Task 2 `HorizonBeamLimits`, `TargetWellColumn`, `BeamSource`, `selectHorizonPlacementBeam`.
- Produces:

```ts
export interface HorizonSearchLimits extends HorizonBeamLimits {
  maxLockedDepth: 1 | 2 | 3 | 4;
  maxWorkUnits: number;
  transpositionCacheEntries: number;
  placementCacheEntries: number;
}
export interface CompletedDepthTrace {
  depth: 1 | 2 | 3 | 4;
  actionKind: 'place' | 'hold';
  beamSource: BeamSource | 'hold';
  targetWellColumn: TargetWellColumn;
  value: SearchValue;
  work: WorkBudgetSnapshot;
}
export interface HorizonSearchTrace {
  completedDepths: readonly CompletedDepthTrace[];
  strategySlotsRetained: number;
  strategySlotsDeduplicated: number;
  strategySlotsPruned: number;
  targetWellEstablished: number;
  targetWellReset: number;
  targetWellInvalidated: number;
}
interface MutableHorizonTrace {
  completedDepths: CompletedDepthTrace[];
  strategySlotsRetained: number;
  strategySlotsDeduplicated: number;
  strategySlotsPruned: number;
  targetWellEstablished: number;
  targetWellReset: number;
  targetWellInvalidated: number;
}
export interface HorizonSearchDecision extends SearchDecision {
  trace: HorizonSearchTrace;
}
export function searchHorizonBudgeted(
  state: PublicSearchState,
  weights: number[],
  limits: HorizonSearchLimits,
): HorizonSearchDecision | null;
```

- Extend `decisionStateKey` and `pendingStateKey` with a final `targetWellColumn: TargetWellColumn = null`; the encoded key must include `intent|-` or `intent|0..9`. Extend `collapseEquivalentPlacements` so entries with different continuation intent never collapse.
- Keep `searchBudgeted` calling the same core with the legacy score-only policy. Its public result and work-unit accounting must remain bit-for-bit equal for representative v5 fixtures.
- `searchHorizonBudgeted` begins with null intent. Hold passes intent unchanged and never consumes placement slots. A real search call never accepts prior intent, preventing cross-decision persistence.
- A complete depth trace is appended only after that depth commits. An exhausted partial depth contributes counters but no committed trace entry or cache entry.
- Final action comparison is `compareSearchValues`, then smaller placement enumeration index; Hold loses an exact placement tie, preserving the existing placement-before-Hold behavior.

- [ ] **Step 1: Write cache-identity RED tests**

```ts
expect(decisionStateKey(state, 3, false, 4))
  .not.toBe(decisionStateKey(state, 3, false, null));
expect(pendingStateKey(pending, 2, false, 4))
  .not.toBe(pendingStateKey(pending, 2, false, 5));
```

- [ ] **Step 2: Write search-core RED tests**

Assert that strategy-only entries reach the beam, Hold stays external, chance outcomes remain exact, a Tetris resets intent, repeated calls return identical action/value/trace, and `searchBudgeted` matches a captured v5 action/value/diagnostics fixture.

- [ ] **Step 3: Run focused tests and observe RED**

```powershell
npx vitest run src/ai/searchCache.test.ts src/ai/search.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
```

- [ ] **Step 4: Refactor to a policy-parameterized internal core**

Use one `runBudgeted` implementation with an internal discriminated policy:

```ts
type SearchPolicy =
  | { kind: 'score-only'; root: number; child: number }
  | { kind: 'horizon'; limits: HorizonBeamLimits; trace: MutableHorizonTrace };
```

Do not copy chance, Hold, ledger, cache, or iterative-deepening logic into a second implementation.

- [ ] **Step 5: Run focused tests and observe GREEN**

Run Step 3. Expected: PASS; v5 parity fixtures remain exact and horizon trace has entries only for complete depths.

- [ ] **Step 6: Commit only if authorized**

```powershell
git add -- src/ai/search.ts src/ai/search.test.ts src/ai/searchCache.ts src/ai/searchCache.test.ts
git commit -m "feat: expose bounded horizon search trace"
```

### Task 4: Build the deterministic D0 selector and stdout-only CLI

**Files:**
- Create: `training/horizonDiagnostic.ts`
- Create: `training/horizonDiagnostic.test.ts`
- Modify: `package.json:6-16`

**Interfaces:**
- Consumes: Tasks 1–3 corpus, weights, classifier and `searchHorizonBudgeted`; v5 comparison uses `searchBudgeted` with unchanged `DETERMINISTIC_SEARCH_LIMITS`.
- Produces:

```ts
export const D0_BUDGETS = [3584, 3840, 4096, 4352, 4608] as const;
export const D0_BEAMS = [
  { rootScoreSlots: 16, rootStrategySlots: 2, childScoreSlots: 8, childStrategySlots: 1 },
  { rootScoreSlots: 12, rootStrategySlots: 2, childScoreSlots: 6, childStrategySlots: 1 },
  { rootScoreSlots: 8, rootStrategySlots: 2, childScoreSlots: 4, childStrategySlots: 1 },
  { rootScoreSlots: 6, rootStrategySlots: 2, childScoreSlots: 3, childStrategySlots: 1 },
  { rootScoreSlots: 4, rootStrategySlots: 1, childScoreSlots: 2, childStrategySlots: 1 },
] as const;

export interface D0Configuration extends HorizonBeamLimits { maxWorkUnits: number }
export interface D0StateResult {
  weightId: DiagnosticWeightId;
  stateId: string;
  stratum: OpportunityStratum;
  v5ActionKey: string;
  vNextActionKey: string;
  v5ActionClass: OpportunityActionClass;
  vNextActionClass: OpportunityActionClass;
  v5SurvivalProbability: number;
  vNextSurvivalProbability: number;
  completedDepth: 0 | 1 | 2 | 3 | 4;
  trace: HorizonSearchTrace;
  deterministic: boolean;
}
export interface D0WeightGates {
  weightId: DiagnosticWeightId;
  depthOneComplete: boolean;
  strategyDepthThreeComplete: boolean;
  strategyDepthFourCount: number;
  safetyPreserved: boolean;
  targetLaneRetained: boolean;
  improvedStrategyCount: number;
  noSurvivalRegression: boolean;
}
export interface D0Attempt {
  configuration: D0Configuration;
  results: readonly D0StateResult[];
  weightGates: readonly D0WeightGates[];
  overBudgetCount: number;
  passed: boolean;
  failureReasons: readonly string[];
}
export interface D0Output {
  mode: 'horizon-diagnostic';
  status: 'pass' | 'fail';
  corpus: 'tetris-opportunity-corpus-v1';
  weights: readonly DiagnosticWeightId[];
  selectedConfiguration: D0Configuration | null;
  attempts: readonly D0Attempt[];
  failureReasons: readonly string[];
}
export function selectD0Configuration(attempts: readonly D0Attempt[]): D0Output;
export function runHorizonDiagnostic(): D0Output;
export function serializeHorizonDiagnostic(output: D0Output): string;
```

- Every configuration must evaluate all `32 states × 3 weights`; a configuration passes only if every weight set independently satisfies: 32/32 depth 1, 24/24 strategy depth 3, at least 18/24 strategy depth 4, 8/8 safety states choose the same stable action identity as v5 or have strictly higher survival, 24/24 target-lane retention, and at least 18/24 preserve/complete changes with no survival decrease.
- For strategy states, map Task 2's `TargetWellActionClass` directly to `OpportunityActionClass`. For safety states, record class `safety-only`, but never use that shared label as proof of parity; compare `hold` or `place:${cellKey}` action identity first, then require strictly higher survival for an alternative action.
- `D0Attempt` must include per-weight/per-state v5 action class, vNext action class, completed depth, committed action/value/source/intent for every complete layer, exact unit categories, survival delta, all boolean gates, and deterministic repeat result. It must not include absolute paths, seeds, raw hidden bags or artifact writes.
- Run each search twice and compare serialized action/value/trace. Any exception becomes a structured failed attempt and exit code 1; the CLI must not swallow structural errors into a passing result.

- [ ] **Step 1: Write selector RED tests with synthetic attempts**

Cover: first passing tuple at 3584 wins; no 3584 pass advances to 3840; a later wider tuple cannot beat an earlier passing tuple at the same budget; all failures yield null; malformed/missing state evidence fails closed.

- [ ] **Step 2: Write CLI contract RED tests**

```ts
const output: D0Output = {
  mode: 'horizon-diagnostic',
  status: 'fail',
  corpus: 'tetris-opportunity-corpus-v1',
  weights: ['published-baseline', 'gen-6-best', 'gen-10-fixed'],
  selectedConfiguration: null,
  attempts: [],
  failureReasons: ['no-configuration-passed'],
};
expect(serializeHorizonDiagnostic(output)).toBe(JSON.stringify(output));
const importOutput = execFileSync(process.execPath, [
  '--import', 'tsx', '--input-type=module',
  '-e', "await import('./training/horizonDiagnostic.ts')",
], { cwd: process.cwd(), encoding: 'utf8' });
expect(importOutput).toBe('');
expect(Object.keys(JSON.parse(serializeHorizonDiagnostic(output)))).toEqual([
  'mode', 'status', 'corpus', 'weights', 'selectedConfiguration', 'attempts', 'failureReasons',
]);
```

- [ ] **Step 3: Run focused tests and observe RED**

```powershell
npx vitest run training/horizonDiagnostic.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
```

- [ ] **Step 4: Implement the finite runner and script**

Add exactly:

```json
"diagnose:horizon": "tsx training/horizonDiagnostic.ts"
```

The main guard writes one JSON line to stdout and sets exit code from `status`; no `node:fs` import is allowed in `training/horizonDiagnostic.ts`.

- [ ] **Step 5: Run focused Phase A tests, not the diagnostic**

```powershell
npx vitest run training/tetrisOpportunityCorpus.test.ts training/horizonDiagnosticWeights.test.ts src/ai/tetrisStrategy.test.ts src/ai/horizonPolicy.test.ts src/ai/searchCache.test.ts src/ai/search.test.ts training/horizonDiagnostic.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
```

Expected: PASS. Do not execute `npm run diagnose:horizon` in this task.

- [ ] **Step 6: Commit only if authorized**

```powershell
git add -- training/horizonDiagnostic.ts training/horizonDiagnostic.test.ts package.json
git commit -m "feat: add bounded horizon diagnostic"
```

### Task 5: Phase A tracked code gate and mandatory stop

**Files:**
- No product file changes.
- Update continuity checkpoint only after evidence review.

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces: a reviewed Phase A code state that is ready to request D0 run authorization, not a D0 result.

- [ ] **Step 1: Verify no protected path entered index/diff**

```powershell
git status --short
git diff --name-only
git diff --cached --name-only
```

Expected: protected files appear only as untracked in `git status`; neither diff list contains them.

- [ ] **Step 2: Run the complete tracked test suite**

```powershell
$tests = @(git ls-files -- '*.test.ts' | Where-Object { $_ -like 'src/*' -or $_ -like 'training/*' })
npx vitest run @tests --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
```

Expected: exit 0. This is the full tracked suite while the three protected untracked probes remain out of scope.

- [ ] **Step 3: Run non-operational code gates**

```powershell
npm run lint
npm run build
npm run typecheck:train
git diff --check
```

Expected: every command exits 0. These commands do not authorize D0, calibration, training or benchmark.

- [ ] **Step 4: Request independent read-only review**

Review scope is the exact Phase A path list from Tasks 1–4. Reviewer must check shared-logic reuse, v5 parity, cache intent identity, finite selector ordering, stdout-only behavior, public-state boundary and protected-path exclusion.

- [ ] **Step 5: Stop at the D0 authorization gate**

Do not run the following until the user separately authorizes it:

```powershell
npm run diagnose:horizon
```

When authorized, refresh HEAD/status/process/lock/artifacts first, capture the single stdout JSON without writing repository artifacts, obtain independent read-only review, and return to the user with either the exact `selectedConfiguration` or the A+ blocked verdict. Do not continue automatically into Phase B.

## Phase B — Production v6, only after an approved D0 PASS

Phase B begins only when all three conditions are true: D0 was separately authorized and executed, its JSON has `status='pass'` with one non-null `selectedConfiguration`, and the user explicitly approves production implementation using that exact configuration.

### Task 6: Freeze the selected configuration and schema-7 metadata

**Files:**
- Modify: `src/ai/searchBudget.ts:53-93`
- Modify: `src/ai/searchBudget.test.ts:9-end`
- Modify: `src/ai/trainingObjective.ts:6-36`
- Modify: `training/objective.ts:1-24`
- Modify: `src/ai/weights.ts:11-519`
- Modify: `src/ai/weights.test.ts:57-517`

**Interfaces:**
- Consumes: exact approved `D0Output.selectedConfiguration`.
- Produces:

```ts
export const SCORE_RATE_V5_OBJECTIVE = 'score-rate-v5' as const;
export const SCORE_RATE_OBJECTIVE = 'score-rate-v6' as const;
export const SEARCH_CONTRACT = 'bag-expectimax-hold-v3' as const;
export const SEARCH_SCHEMA_VERSION = 7 as const;
export const SEARCH_METADATA = Object.freeze({
  searchContract: SEARCH_CONTRACT,
  searchDepth: 4,
  rootScoreSlots: D0_SELECTED.rootScoreSlots,
  rootStrategySlots: D0_SELECTED.rootStrategySlots,
  childScoreSlots: D0_SELECTED.childScoreSlots,
  childStrategySlots: D0_SELECTED.childStrategySlots,
  maxWorkUnits: D0_SELECTED.maxWorkUnits,
  budgetCorpus: 'budget-corpus-v1',
  tetrisOpportunityCorpus: 'tetris-opportunity-corpus-v1',
  transpositionCacheEntries: 65_536,
  placementCacheEntries: 16_384,
} as const);
```

`D0_SELECTED` in the code block denotes the already approved JSON value, not a developer-selected placeholder. Copy all five numeric fields verbatim into one frozen constant and assert exact equality in tests.

- [ ] **Step 1: Write schema RED tests**

Assert objective v6, schema 7, exact metadata key order above, work units `<=4608`, and exact equality to the approved D0 selection. Add parser fixtures for published version 3, historical version 6 v5, and active version 7 v6.

- [ ] **Step 2: Run focused tests and observe RED**

```powershell
npx vitest run src/ai/searchBudget.test.ts src/ai/weights.test.ts training/config.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
```

- [ ] **Step 3: Freeze constants and exact parser branches**

Schema 6 parsing remains a read-only weight compatibility branch; `runArtifacts` will reject resuming it. Do not rewrite `src/ai/trained-weights.json`.

- [ ] **Step 4: Run focused tests and observe GREEN**

Run Step 2. Expected: PASS.

- [ ] **Step 5: Commit only if authorized**

```powershell
git add -- src/ai/searchBudget.ts src/ai/searchBudget.test.ts src/ai/trainingObjective.ts training/objective.ts src/ai/weights.ts src/ai/weights.test.ts training/config.test.ts
git commit -m "feat: freeze score rate v6 search contract"
```

### Task 7: Promote horizon search and aggregate diagnostics

**Files:**
- Modify: `src/ai/search.ts:43-584`
- Modify: `src/ai/search.test.ts:119-352`
- Modify: `src/ai/simulate.ts:38-396`
- Modify: `src/ai/simulate.test.ts:322-514`
- Modify: `training/benchSummary.ts:30-190`
- Modify: `training/benchSummary.test.ts:64-end`

**Interfaces:**
- `searchBudgeted` now consumes frozen `HorizonSearchLimits`; callers still cannot inject a runtime depth/beam flag.
- Extend simulation diagnostics with exact additive fields:

```ts
export interface ActionSourceCounts { score: number; strategy: number; both: number; hold: number }
export interface SimulationSearchDiagnostics {
  // existing fields stay required
  completedDepthActionSources: [ActionSourceCounts, ActionSourceCounts,
    ActionSourceCounts, ActionSourceCounts, ActionSourceCounts];
  strategySlotsRetained: number;
  strategySlotsDeduplicated: number;
  strategySlotsPruned: number;
  targetWellEstablished: number;
  targetWellReset: number;
  targetWellInvalidated: number;
  depthThreeCompletionRate: number;
  depthFourCompletionRate: number;
}
```

- `depthThreeCompletionRate = (histogram[3] + histogram[4]) / searchCalls`; `depthFourCompletionRate = histogram[4] / searchCalls`; both are zero for zero calls.
- Each actual lock causes the next `searchBudgeted` call to restart with null intent. Trace data is consumed into counters and is not stored in `SimState` as a future decision input.

- [ ] **Step 1: Write RED aggregation and invariant tests**

Cover action-source histogram sums, slot/intent counter addition, derived depth rates, zero calls, Hold counting, and two actual locks that each establish intent independently.

- [ ] **Step 2: Run focused tests and observe RED**

```powershell
npx vitest run src/ai/search.test.ts src/ai/simulate.test.ts training/benchSummary.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
```

- [ ] **Step 3: Promote the horizon policy and aggregate only diagnostics**

Do not add strategy values to `expectedHeuristicValue`. Update all empty/snapshot/add/divide helpers so exact-key validation can reconstruct totals.

- [ ] **Step 4: Run focused tests and observe GREEN**

Run Step 2. Expected: PASS, including existing exact bag/Hold/survival/search regressions.

- [ ] **Step 5: Commit only if authorized**

```powershell
git add -- src/ai/search.ts src/ai/search.test.ts src/ai/simulate.ts src/ai/simulate.test.ts training/benchSummary.ts training/benchSummary.test.ts
git commit -m "feat: activate horizon first search diagnostics"
```

### Task 8: Add cap-2000 score and strategy archives without changing CEM

**Files:**
- Modify: `training/cem.ts:21-317`
- Modify: `training/cem.test.ts:131-520`

**Interfaces:**

```ts
export type ArchiveSource = 'scoreChampion' | 'strategyChampion';
export interface TrainingArchiveEntry {
  source: ArchiveSource;
  generation: number;
  candidateIndex: number;
  weights: number[];
  scoreRate: number;
  tetrisLineShare: number;
  survivalDiagnostics: SurvivalDiagnostics;
}
export interface TrainingArchives {
  scoreChampion: TrainingArchiveEntry | null;
  strategyChampion: TrainingArchiveEntry | null;
}
export function updateTrainingArchives(args: {
  current: TrainingArchives;
  generation: number;
  maxPieces: number;
  maxPiecesCap: number;
  gamesPerCandidate: number;
  candidates: readonly number[][];
  stats: CandidateStats;
}): TrainingArchives;
export function tetrisPercentiles(values: readonly number[]): {
  p25: number; p50: number; p75: number; positiveCount: number;
};
```

- Archive updates only when `maxPieces === maxPiecesCap === 2000`.
- scoreChampion: highest scoreRate; tie uses earlier generation then smaller candidate index.
- strategyChampion candidates must have all games at cap and `scoreRate >= 0.99 * generationBestScoreRate`; choose higher T4, then higher scoreRate, earlier generation, smaller index.
- Return deep snapshots. `updateCem`, `sampleCandidates`, `noiseAt`, elite fraction and `CandidateStats.fitness` remain unchanged.

- [ ] **Step 1: Write RED archive tests**

Test pre-cap no-op, cap update, exact 0.99 boundary inclusion, incomplete survival exclusion, cross-generation replacement/ties, and deep immutability.

- [ ] **Step 2: Add a fitness-invariance test**

Two candidates with equal score but different T4/strategy/search diagnostics must still have identical `fitness`, and `updateCem` with those fitnesses must not read archive data.

- [ ] **Step 3: Run focused tests and observe RED**

```powershell
npx vitest run training/cem.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
```

- [ ] **Step 4: Implement archive and nearest-rank percentiles**

Use stable ascending sort and index `Math.ceil(q * n) - 1` for q 0.25/0.5/0.75; empty input returns zeros.

- [ ] **Step 5: Run focused tests and observe GREEN**

- [ ] **Step 6: Commit only if authorized**

```powershell
git add -- training/cem.ts training/cem.test.ts
git commit -m "feat: retain score and strategy champions"
```

### Task 9: Plan and adjudicate the three-vector fixed reevaluation pool

**Files:**
- Modify: `training/reevaluation.ts:1-27`
- Modify: `training/reevaluation.test.ts:1-39`
- Modify: `training/publication.ts:23-87`
- Modify: `training/publication.test.ts:56-100`

**Interfaces:**

```ts
export type ReevaluationSource = 'mu' | 'scoreChampion' | 'strategyChampion';
export interface ReevaluationPoolEntry {
  source: ReevaluationSource;
  sourceGeneration: number;
  weights: number[];
}
export interface ReevaluationPlan {
  weights: number[][];
  baselineIndex: 0 | null;
  pool: readonly { source: ReevaluationSource; sourceGeneration: number; evaluationIndex: number }[];
}
export function planReevaluation(
  publishedBaseline: ReevaluationSummary | null,
  publishedWeights: number[],
  mu: number[],
  archives: TrainingArchives,
  reevaluationGeneration: number,
): ReevaluationPlan;

export interface PoolQualification {
  source: ReevaluationSource;
  sourceGeneration: number;
  evaluation: ReevaluationSummary;
  qualification: CandidateQualification;
  selected: boolean;
}
export function selectQualifiedPoolCandidate(
  entries: readonly Omit<PoolQualification, 'qualification' | 'selected'>[],
  baseline: ReevaluationSummary,
  currentQualified: ReevaluationSummary | null,
): { entries: PoolQualification[]; selectedIndex: number | null };
```

- Pool order is normalized mu, scoreChampion, strategyChampion. Exact vector duplicates keep the earliest source only.
- Each entry independently evaluates strict score `> baseline + 0.001*max(abs scores)`, T4 `>=0.20`, and survival `>=baseline`.
- Intrinsically qualified entries sort by higher meanScore, higher T4, lower meanHeight, then original pool order. Existing bestQualifiedCandidate still wins when its meanScore is not lower; losing pool entries use reason `not-better-qualified-candidate` and remain logged.

- [ ] **Step 1: Write RED pool construction tests**

Cover 1/2/3 unique vectors, all duplicate combinations, baseline at index 0 only on the first reevaluation, and identical 30-seed schedule indices.

- [ ] **Step 2: Write RED qualification/winner tests**

Cover each independent gate, exact boundaries, score/T4/height/pool ordering, and current-qualified protection.

- [ ] **Step 3: Run focused tests and observe RED**

```powershell
npx vitest run training/reevaluation.test.ts training/publication.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
```

- [ ] **Step 4: Implement pure pool planning and adjudication**

No worker calls or filesystem writes belong in these modules.

- [ ] **Step 5: Run focused tests and observe GREEN**

- [ ] **Step 6: Commit only if authorized**

```powershell
git add -- training/reevaluation.ts training/reevaluation.test.ts training/publication.ts training/publication.test.ts
git commit -m "feat: adjudicate fixed reevaluation pool"
```

### Task 10: Migrate checkpoint, log, and candidate artifacts to exact schema 7

**Files:**
- Modify: `training/reevaluationLog.ts:22-329`
- Modify: `training/reevaluationLog.test.ts:10-end`
- Modify: `training/runArtifacts.ts:44-1085`
- Modify: `training/runArtifacts.test.ts:29-end`
- Modify: `training/candidateWeights.ts:20-130`
- Modify: `training/candidateWeights.test.ts:17-end`

**Interfaces:**
- Extend `ScoreRateCheckpoint` with `archives: TrainingArchives`.
- Replace singular reevaluation `candidate/qualification` with:

```ts
export interface LoggedPoolEntry {
  source: ReevaluationSource;
  sourceGeneration: number;
  evaluation: LoggedReevaluation;
  qualification: CandidateQualification & {
    scoreDelta: number;
    scoreRateDelta: number;
    tetrisLineShareDelta: number;
    pieceCapGamesDelta: number;
  };
  selected: boolean;
}
export interface ReevaluationLogEntry extends SearchMetadata {
  objective: 'score-rate-v6';
  kind: 'reevaluation';
  // gen, ts, schedule, publishedBaseline, currentQualified stay exact
  pool: readonly LoggedPoolEntry[];
  selectedSource: ReevaluationSource | null;
  decision: 'save-candidate' | 'keep-current';
}
```

- Schema 7 checkpoint/log/candidate exact-key metadata includes both corpus ids, four slot counts, budget and cache caps. Missing or extra archive/pool/source keys fail before worker creation or writes.
- `CandidateWeightsFile` includes `candidateSource` and `sourceGeneration`; only the selected pool identity can be serialized.
- `readCompatibleCheckpoint` rejects objective v5/schema6 for resume with a clear incompatibility error. `parseWeightsFile` may still parse historical schema6 as read-only compatibility.
- Artifact boundary stays generation-log append, optional candidate write, then in-memory state update, then checkpoint write; any pool evaluation failure writes none of these.

- [ ] **Step 1: Convert fixtures to exact schema 7 and write RED rejection tests**

Add valid 1/2/3-entry reevaluations; missing archive, duplicate source, wrong sourceGeneration, different schedule metadata, multiple selected entries, and selectedSource mismatch must all reject.

- [ ] **Step 2: Run focused tests and observe RED**

```powershell
npx vitest run training/reevaluationLog.test.ts training/runArtifacts.test.ts training/candidateWeights.test.ts src/ai/weights.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
```

- [ ] **Step 3: Implement exact parsers/builders and deep snapshots**

Every archive/pool vector is 13 finite L2-normalized values. Archive source, generation, candidate index, training scoreRate, T4 and survival are required and cross-checked against generation logs where replay evidence exists.

- [ ] **Step 4: Run focused tests and observe GREEN**

- [ ] **Step 5: Commit only if authorized**

```powershell
git add -- training/reevaluationLog.ts training/reevaluationLog.test.ts training/runArtifacts.ts training/runArtifacts.test.ts training/candidateWeights.ts training/candidateWeights.test.ts src/ai/weights.ts src/ai/weights.test.ts
git commit -m "feat: validate score rate v6 artifacts"
```

### Task 11: Wire archives, generation diagnostics, and fixed pool into the trainer

**Files:**
- Modify: `training/train.ts:12-560`
- Modify: `training/train-cli.test.ts:27-end`
- Modify: `training/pool.ts:10-64`

**Interfaces:**
- Consumes: Tasks 7–10 diagnostics, archive helper, pool planner and schema builders.
- Produces: atomic v6 generation/reevaluation boundaries with no publication side effect.

- Generation records add `eliteTetrisPositiveCount`, `eliteTetrisP25`, `eliteTetrisP50`, `eliteTetrisP75`, and deep-snapshotted `archives`.
- Restore/save `archives`; reset both archive slots only after a complete fixed reevaluation boundary is successfully appended and checkpointed. An aborted reevaluation retains the previous complete checkpoint archives.
- For each pool vector, build exactly the same `reevalGames × fixedReevaluationSeeds(baseSeed)` tasks at `reevalMaxPieces`; taskId remains `evaluationIndex * games + gameIndex`.
- Candidate write occurs only for the selected pool entry with `shouldSave=true`; no qualified entry means no candidate creation/overwrite.

- [ ] **Step 1: Extend stubbed worker tests to a three-vector pool**

Assert identical seeds and schedule, source ordering, individual qualification reasons, one selected candidate, checkpoint archive reset, resume round-trip and no write outside the temp run dir.

- [ ] **Step 2: Add SIGINT/worker failure cases**

Abort during any pool entry must leave generation log, reevaluation log, candidate and checkpoint at the last complete boundary; pool destroy and repository lock release remain awaited.

- [ ] **Step 3: Run focused tests and observe RED**

```powershell
npx vitest run training/train-cli.test.ts training/pool.test.ts training/cem.test.ts training/reevaluation.test.ts training/publication.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
```

- [ ] **Step 4: Implement orchestration with local next-state variables**

Keep `nextArchives`, `nextPublishedBaseline`, `nextBestQualifiedCandidate`, `candidateWeightsToWrite`, generation log and reevaluation log local until every worker result and schema builder succeeds.

- [ ] **Step 5: Run focused tests and observe GREEN**

- [ ] **Step 6: Commit only if authorized**

```powershell
git add -- training/train.ts training/train-cli.test.ts training/pool.ts
git commit -m "feat: train with auditable reevaluation archives"
```

### Task 12: Update calibration, read-only consumers, dashboard, and docs

**Files:**
- Modify: `training/calibrateSearchBudget.ts:12-509`
- Modify: `training/calibrateSearchBudget.test.ts:32-end`
- Modify: `training/pairedBench.ts:99-133`
- Modify: `training/pairedBench.test.ts:7-178`
- Modify: `src/training/dashboard/types.ts:1-36`
- Modify: `src/training/dashboard/useTrainingLog.ts:3-134`
- Modify: `src/training/dashboard/useTrainingLog.test.ts:6-end`
- Modify: `src/training/dashboard/App.tsx:12-84`
- Modify: `README.md:121-156,169-173`
- Modify: `docs/ai-training-handoff.md:145-161,296-363`

**Interfaces:**
- Calibration `--select` measures the already approved frozen configuration against 140 ms and returns it or null; it does not choose a different design. `--verify-frozen` runs three complete blocks against 160 ms. Both report `budget-corpus-v1` and `tetris-opportunity-corpus-v1`, exact unit/depth/determinism evidence, and make no writes.
- Paired plan continues to require published version 3 score-rate-v2 gen-40 baseline, but candidate must be exact schema 7 score-rate-v6 with active metadata.
- Dashboard URL becomes `/ai/score-rate-v6/training-log.jsonl`; it displays elite T4 positive count/quantiles, depth 3/4 rates, strategy retention/dedupe/prune and intent counters.

- [ ] **Step 1: Write RED calibration and consumer tests**

Assert frozen config equality, 140/160 thresholds, three verification blocks, both corpus ids, malformed diagnostic rejection, paired schema7 acceptance, v6 log parsing and unknown top-level field rejection.

- [ ] **Step 2: Run focused tests and observe RED**

```powershell
npx vitest run training/calibrateSearchBudget.test.ts training/pairedBench.test.ts src/training/dashboard/useTrainingLog.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
```

- [ ] **Step 3: Implement consumers and documentation**

Documentation must explicitly preserve: scalar fitness, fairness/Hold/seven-bag/survival invariants, D0-selected limits, output-dir fail closed, user-run smoke, two-generation signal gate, fixed/paired/publication/browser separation, no published weight mutation, and stale-lock authorization.

- [ ] **Step 4: Run focused tests and observe GREEN**

- [ ] **Step 5: Commit only if authorized**

```powershell
git add -- training/calibrateSearchBudget.ts training/calibrateSearchBudget.test.ts training/pairedBench.ts training/pairedBench.test.ts src/training/dashboard/types.ts src/training/dashboard/useTrainingLog.ts src/training/dashboard/useTrainingLog.test.ts src/training/dashboard/App.tsx README.md docs/ai-training-handoff.md
git commit -m "docs: document score rate v6 gates"
```

### Task 13: Final code gate and stop before every operational gate

**Files:**
- No product file changes.
- Update continuity checkpoint after fresh evidence and review.

- [ ] **Step 1: Re-run focused contract suites**

```powershell
npx vitest run src/ai/horizonPolicy.test.ts src/ai/search.test.ts src/ai/searchBudget.test.ts src/ai/searchCache.test.ts src/ai/simulate.test.ts src/ai/weights.test.ts training/cem.test.ts training/reevaluation.test.ts training/publication.test.ts training/reevaluationLog.test.ts training/runArtifacts.test.ts training/candidateWeights.test.ts training/train-cli.test.ts training/calibrateSearchBudget.test.ts training/pairedBench.test.ts src/training/dashboard/useTrainingLog.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
```

- [ ] **Step 2: Run the complete tracked suite and static gates**

```powershell
$tests = @(git ls-files -- '*.test.ts' | Where-Object { $_ -like 'src/*' -or $_ -like 'training/*' })
npx vitest run @tests --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
npm run lint
npm run build
npm run typecheck:train
git diff --check
```

- [ ] **Step 3: Audit exact path scope and artifacts**

```powershell
git status --short
git diff --name-only
git diff --cached --name-only
```

Verify no protected probe, v5 run artifact, published weight or `src/ai/trained-weights.json` appears in diff/index. Refresh run directory names/sizes/mtimes, process list and repository lock; do not hash protected probes or published weights without the relevant later gate.

- [ ] **Step 4: Obtain whole-change independent read-only review**

Reviewer checks spec coverage, shared-logic purity, cache intent key, chance/Hold/survival invariants, ledger accounting, archive selection, exact schemas, fixed pool seeds, atomic abort boundaries, protected pathscope and absence of operational side effects. Resolve every Critical/Important finding and rerun the affected focused suites plus Step 2.

- [ ] **Step 5: Stop and request the next gate explicitly**

Code completion does not authorize any command below:

```powershell
npm run calibrate:search -- --select
npm run calibrate:search -- --verify-frozen
npm run train -- --generations 1 --output-dir <future-empty-v6-run-dir>
npm run bench -- --games 30 --max-pieces 2000
npm run bench:paired -- --baseline <published-v3-baseline> --candidate <qualified-v6-candidate> --seed <independent-integer>
```

Calibration、用户运行的一代 smoke、两代 signal、正式训练/fixed reevaluation、paired、publication、push 与 browser/runtime acceptance 必须分别重新授权。不得把其中任何一个放进自动串行脚本。

## Operational Acceptance Gates (run only after separate authorization)

1. **D0 diagnostic:** 32-state × 3-weight finite matrix passes exactly as Task 4; otherwise A+ blocked and return to user.
2. **Code gate:** Tasks 6–13 tests/static checks/review pass; no operational evidence is inferred.
3. **Calibration/performance:** frozen D0 config passes Node 140 ms selection and three 160 ms blocks; later ordinary browser p95 must independently be `<=200 ms`. Failure returns to design; no runtime fallback.
4. **Signal:** user first runs one-generation smoke in a newly confirmed empty directory. A later separately authorized short run passes only after cap 2000 and two consecutive complete generations with elite T4 positive count `>=5/10`, elite T4 p50 `>=0.01`, best T4 `>=0.01`, all elite games at cap, complete depth/slot/budget diagnostics and no worker/artifact error.
5. **Fixed reevaluation:** same immutable baseline, same 30 seeds, 5000 cap and exact search config; selected vector must have strict score improvement above 0.1% tolerance, T4 `>=0.20`, and survival no lower. Only it may create run-local candidate.
6. **Paired:** 30 independent matched seeds, same search config/5000 cap; candidate 30/30 survival and both score-rate delta and T4-share delta 95% CI lower bounds `>0`.
7. **Publication:** publish only the exact paired candidate identity after separate approval; preserve pre/post content identity and metadata. Publication does not authorize commit, push or browser/runtime acceptance.

## Plan Self-Review Checklist

- [ ] Every approved design requirement maps to a task or operational gate: D0 corpus/matrix/blocking, horizon slots/intent/cache, unchanged fitness/CEM, archives/pool, schema 7, diagnostics, fairness and independent acceptance gates.
- [ ] No implementation step requires reading or executing a protected probe.
- [ ] No command starts D0, calibration, training, benchmark, paired, publication or browser acceptance as part of a code task.
- [ ] All dynamic numeric production values come only from an approved non-null D0 `selectedConfiguration`; no developer discretion remains.
- [ ] `SearchMetadata`, `SearchDiagnostics`, archive, pool and candidate source property names are identical across producer, parser, tests and dashboard.
- [ ] Every staging command uses exact pathspecs; no broad add/stash/reset/restore/push instruction exists.

## Execution Handoff

Plan execution must start with Phase A Task 1 and stop after Task 5. The next decision is not how to implement Phase B; it is whether the user separately authorizes the bounded D0 run after reviewing Phase A code evidence. If D0 later passes and the exact selection is approved, begin Phase B Task 6 with a fresh continuity resume and live-state refresh.
