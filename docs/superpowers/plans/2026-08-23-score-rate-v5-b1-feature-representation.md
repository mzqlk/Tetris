# score-rate-v5 B1 Feature Representation Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

Goal: 在保持 score-rate-v5 搜索、fitness、公平性与运行时不变量不变的前提下，建立并验证四个公开机会特征能否在线性 pairwise gate 中稳定表达保井、兑现四消和 survival-safe 行为。

Architecture: 共享纯逻辑层新增仅供 B1 representation gate 使用的候选特征提取器；它复用现有 13 维 afterstate 特征、SRS placement、summarizeTetrisWellAt 与公开七袋 chance，不接入 active v5 FEATURE_NAMES、CEM 或 trainer。训练目录只保存版本化公开 placement-pair 描述和无副作用 gate runner；gate 通过后停止，生产 feature/schema/search contract 另行设计与授权。

Tech Stack: TypeScript 5.6、Vitest 3、Node.js/tsx、现有 Tetris engine/SRS、src/ai/publicState.ts 的精确七袋概率；不新增运行时依赖。

## Global Constraints

- 每个执行会话先读 AGENTS.md、docs/ai-training-handoff.md，再刷新真实 HEAD、git status、训练进程、repository lock、目标 run artifacts 和 published/bundled weights。
- 直接在当前 master 工作区实施；不创建 branch/worktree，不 broad-add，不 stash/reset/restore，不 commit，除非获得单独 commit 授权。
- 永远不得读取、执行、哈希、修改、移动、删除、暂存或提交 training/searchProbe.ts、training/searchProbeWorker.ts、training/searchProbe.test.ts；只能用普通 git status 确认其路径状态。
- 不修改、移动、删除或归档 public/ai/score-rate-v5-smoke-20260820-200634/，不修改 src/ai/trained-weights.json、public/ai/best-weights.json 或其他 published weights，不删除任何 TEMP lock。
- active v5 合同继续是 score-rate-v5 / schema 6 / bag-expectimax-hold-v2 / depth 4 / root-child beams 64/32 / maxWorkUnits=3584 / budget-corpus-v1；本计划不得创建 schema 7、v6 或 v3 artifacts。
- CEM scalar fitness 仍精确为 meanScore / scheduled maxPieces；T4、Hold、lane delta、I-access、pair label、margin witness 和 gate diagnostics 不进入 fitness、elite 排序或 updateCem。
- 搜索和特征只使用公开 board/current/next/hold/holdAvailable/unseenBagMask；不读取 seed、RNG、隐藏 bag、精确 bag index 或运行时生成顺序。
- 标准 Hold、精确七袋等概率、SRS placement、survival-first value order、board row 非原地修改和 shared src/ai pure logic 保持不变。
- B1 gate 只写 stdout；不写 public/ai、training-archive、checkpoint、training log、weights 或 published files。
- 所有测试列表使用 git ls-files 或明确的受限路径；不得运行会收集未跟踪 protected probe 的裸 npm test。
- representation gate 任一条件失败即停止：不加 budget、不加 T4 bonus、不修改 CEM、不自动转入 C，也不进入 production feature/schema/search integration。

---

## File Responsibility Map

| 文件 | 操作 | 单一责任 |
| --- | --- | --- |
| src/ai/opportunityFeatures.ts | Create | B1 四项候选特征、17 维候选名称、公开 I-access truth table 与 lane delta 纯函数；不改变 active 13 维导出 |
| src/ai/opportunityFeatures.test.ts | Create | 候选特征顺序、范围、同 lane、无机会归零、公开 I-access、Hold/七袋边界与不变性测试 |
| training/featureRepresentationCorpus.ts | Create | 复用 32 个公开 literal state，保存 32 条人工审阅 placement-pair descriptor 并物化合法正负 placement |
| training/featureRepresentationCorpus.test.ts | Create | pair 数量、分层、合法性、state/pair 唯一性、确定性和无 seed/RNG 依赖测试 |
| training/featureRepresentationGate.ts | Create | old-13/new-17 同协议 deterministic margin witness、LOSO、safety、净增统计和 stdout-only JSON CLI |
| training/featureRepresentationGate.test.ts | Create | margin solver、LOSO、threshold、fail-closed、stable serialization 和无文件写入测试 |
| package.json | Modify | 增加只读 diagnose:feature-representation 脚本；不改变训练/bench 脚本 |
| docs/superpowers/plans/2026-08-23-score-rate-v5-b1-feature-representation.md | Create | 本计划；执行完成后更新 continuity，不在本计划内提交 |

## Interfaces to Freeze Before Coding

Use these exact TypeScript shapes so every task agrees on names and dimensions:

    export const B1_CANDIDATE_FEATURE_NAMES = [
      ...FEATURE_NAMES,
      'targetLaneUsableDepthDelta',
      'targetLaneSetupProgressDelta',
      'targetLaneReadyRowsDelta',
      'futureIAccessProbability',
    ] as const;

    export interface B1PlacementFeatureInput {
      boardBefore: Board;
      boardAfter: Board;
      linesCleared: number;
      placedCells: readonly Position[];
      pending: PendingPreviewState;
    }

    export interface PlacementPairDescriptor {
      id: string;
      stateId: string;
      category: 'strategy' | 'safety';
      positiveCellKey: string;
      negativeCellKey: string;
      positiveClass: 'preserve-well' | 'complete-tetris' | 'safety-only';
      negativeClass: 'destroy-well' | 'lower-order' | 'risky-survival';
    }

    export interface MaterializedPlacementPair {
      descriptor: PlacementPairDescriptor;
      state: PublicSearchState;
      positive: B1PlacementFeatureInput;
      negative: B1PlacementFeatureInput;
    }

    export interface RepresentationGateMetrics {
      pairCount: number;
      strategyCorrect13: number;
      strategyCorrect17: number;
      safetyCorrect13: number;
      safetyCorrect17: number;
      leaveOneStateOutStrategyRate13: number;
      leaveOneStateOutStrategyRate17: number;
      leaveOneStateOutSafetyRegressionCount13: number;
      leaveOneStateOutSafetyRegressionCount17: number;
      solvedStrategyStateGain: number;
      repeatedRunDeterministic: boolean;
    }

    export interface RepresentationGateResult extends RepresentationGateMetrics {
      status: 'pass' | 'fail';
      witness13: readonly number[] | null;
      witness17: readonly number[] | null;
      failureReasons: readonly string[];
    }

    export interface MarginSolverOptions {
      margin: number;
      normCap: number;
      tolerance: number;
      learningStep: number;
      maxUpdates: number;
    }

extractB1PlacementFeatures(input) must return a 17-element vector in exactly the order of B1_CANDIDATE_FEATURE_NAMES. The existing FEATURE_NAMES, FEATURE_COUNT, extractFeatures behavior and active weights remain unchanged until a separately approved production design.

### Task 1: Implement shared public opportunity feature primitives

Files:
- Create: src/ai/opportunityFeatures.ts
- Create: src/ai/opportunityFeatures.test.ts
- Read-only reference: src/ai/features.ts, src/ai/tetrisStrategy.ts, src/ai/publicState.ts, src/ai/stateTransitions.ts

Interfaces:
- Consumes: extractFeatures, summarizeTetrisWell, summarizeTetrisWellAt, enumerateBagOutcomes, PendingPreviewState, and B1PlacementFeatureInput.
- Produces: B1_CANDIDATE_FEATURE_NAMES, B1_CANDIDATE_FEATURE_COUNT, futureIAccessProbability, extractB1PlacementFeatures.

- [ ] Step 1: Write failing tests for the exact candidate contract

The test file imports createEmptyBoard/createPiece from the existing engine, boardFrom from src/ai/testUtils, and the exported B1 types/functions; all fixtures are literal and deterministic.

    const placedCells = [
      { x: 0, y: 18 }, { x: 0, y: 19 }, { x: 0, y: 20 }, { x: 0, y: 21 },
    ];
    const input = (boardBefore: Board, boardAfter: Board): B1PlacementFeatureInput => ({
      boardBefore,
      boardAfter,
      linesCleared: 0,
      placedCells,
      pending: {
        board: boardAfter,
        current: createPiece(2),
        hold: null,
        holdAvailable: true,
        unseenBagMask: 0b1111111,
      },
    });

    it('keeps the v5 thirteen names first and appends the four B1 names', () => {
      expect(B1_CANDIDATE_FEATURE_NAMES.slice(0, FEATURE_NAMES.length)).toEqual(FEATURE_NAMES);
      expect(B1_CANDIDATE_FEATURE_NAMES.slice(-4)).toEqual([
        'targetLaneUsableDepthDelta',
        'targetLaneSetupProgressDelta',
        'targetLaneReadyRowsDelta',
        'futureIAccessProbability',
      ]);
      expect(B1_CANDIDATE_FEATURE_COUNT).toBe(17);
    });

    it('returns zero lane deltas when the canonical pre-lane has no opportunity', () => {
      const empty = createEmptyBoard();
      const result = extractB1PlacementFeatures(input(empty, empty));
      expect(result.slice(13, 16)).toEqual([0, 0, 0]);
    });

    it('compares the same pre-lane column after a placement', () => {
      const before = boardFrom(['#########.', '#########.', '#########.', '#########.']);
      const after = boardFrom(['.#########', '.#########', '.#########', '.#########']);
      const result = extractB1PlacementFeatures(input(before, after));
      expect(result.slice(13, 16)).toEqual([-1, -1, -1]);
    });

- [ ] Step 2: Run the focused tests and observe RED

    npx vitest run src/ai/opportunityFeatures.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false

Expected: FAIL because the B1 module and exports do not yet exist.

- [ ] Step 3: Implement lane deltas without changing active v5 features

Use summarizeTetrisWell(boardBefore) once. If its usableDepth, setupCells, and readyRows are all zero, emit three zero deltas. Otherwise call summarizeTetrisWellAt(boardAfter, before.column) and calculate:

    const clampUnit = (value: number) => Math.max(-1, Math.min(1, value));
    const usableDepthDelta = clampUnit((after.usableDepth - before.usableDepth) / 4);
    const setupProgressDelta = clampUnit((after.setupCells - before.setupCells) / 36);
    const readyRowsDelta = clampUnit((after.readyRows - before.readyRows) / 4);

Prefix these values with the unchanged extractFeatures(boardAfter, linesCleared, placedCells) result. Do not call summarizeTetrisWell(boardAfter) to select a new lane.

- [ ] Step 4: Implement the one-public-chance I-access truth table

For a post-placement PendingPreviewState, first require pending.holdAvailable === true; lockPlacement restores Hold after every real placement, so false indicates an invalid B1 feature input and must throw. Enumerate enumerateBagOutcomes(pending.unseenBagMask). For each preview, construct the same public next state used by revealPreview and mark I accessible when current.type === 1, hold === 1, or next === 1. Sum exact outcome probabilities; unseenBagMask === 0 therefore uses the existing full seven-bag 1/7 outcome probability. Return 1 immediately when current or hold already exposes I. Never inspect hidden bag data.

- [ ] Step 5: Add boundary and immutability tests, then observe GREEN

Cover current=I, hold=I, chance preview=I, invalid pending state with Hold unavailable, mask containing I, mask excluding I, empty mask, all four lane normalization bounds, line-clear afterstate, and unchanged input board rows. Run:

    npx vitest run src/ai/opportunityFeatures.test.ts src/ai/features.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false

Expected: all focused tests PASS; FEATURE_NAMES and the existing 13-value extractFeatures assertions remain unchanged.

### Task 2: Freeze and materialize the 32 public placement pairs

Files:
- Create: training/featureRepresentationCorpus.ts
- Create: training/featureRepresentationCorpus.test.ts
- Read-only reference: training/tetrisOpportunityCorpus.ts, src/ai/placements.ts, src/ai/stateTransitions.ts, src/engine/board.ts

Interfaces:
- Consumes: TETRIS_OPPORTUNITY_CORPUS_V1, materializeOpportunityState, enumeratePlacements, cellKey, and the engine lock/clear transitions.
- Produces: B1_PLACEMENT_PAIR_CORPUS_ID, B1_PLACEMENT_PAIR_DESCRIPTORS, materializePlacementPair, materializeAllPlacementPairs.

- [ ] Step 1: Write the descriptor schema and count tests

    expect(B1_PLACEMENT_PAIR_DESCRIPTORS).toHaveLength(32);
    expect(B1_PLACEMENT_PAIR_DESCRIPTORS.filter((p) => p.category === 'strategy')).toHaveLength(24);
    expect(B1_PLACEMENT_PAIR_DESCRIPTORS.filter((p) => p.category === 'safety')).toHaveLength(8);
    expect(new Set(B1_PLACEMENT_PAIR_DESCRIPTORS.map((p) => p.id)).size).toBe(32);

Each descriptor must name an existing corpus state and two explicit legal placement cellKey values. The positive/negative class is reviewed data, never calculated from the candidate feature values.

- [ ] Step 2: Run the corpus tests and observe RED

    npx vitest run training/featureRepresentationCorpus.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false

Expected: FAIL because the descriptor table and materializer do not exist.

- [ ] Step 3: Add the reviewed descriptor table

Use the existing 32 public literal states as the only state source. Add exactly one descriptor for each state: 24 strategy records with positive preserve-well/complete-tetris and negative destroy-well/lower-order; 8 safety records with positive safety-only survival-preserving and negative risky-survival. Store cell keys, not seed/RNG/hidden-bag data. A missing state, duplicate pair id, or pair whose two cell keys resolve to the same placement is an error.

- [ ] Step 4: Materialize each pair through the real engine

For each descriptor, materialize its public state, enumerate placements using SRS BFS, resolve both cell keys, then call the shared lockPlacement(state, placement). Use that transition's boardAfter、linesCleared、placedCells 和 pending directly; do not reimplement lock/clear/preview semantics in training code. Reject invalid positions, wrong piece types, unknown cell keys, mutated source rows, and any pair whose public inputs differ.

- [ ] Step 5: Verify determinism and public-only provenance

    it('materializes identical pair values on repeated calls', () => {
      expect(materializeAllPlacementPairs()).toEqual(materializeAllPlacementPairs());
    });

    it('contains no runtime seed or hidden bag fields', () => {
      expect(JSON.stringify(B1_PLACEMENT_PAIR_DESCRIPTORS)).not.toMatch(/seed|rng|bagIndex|hidden/i);
    });

Run the focused corpus test and expect GREEN. Do not run a simulator or training loop to generate descriptors.

- [ ] Step 6: Obtain independent read-only review of all 32 pair labels

The reviewer checks each positive/negative placement against the rendered pre-state, SRS-reachable locked cells, post-clear board, target lane and survival consequence. Reject any pair that is feature-derived, ambiguous, uses different public inputs, or labels a lower-survival move as the positive safety action. Resolve findings by changing only the explicit descriptor and its test, then rerun the corpus test.

### Task 3: Implement the deterministic old-13/new-17 margin gate

Files:
- Create: training/featureRepresentationGate.ts
- Create: training/featureRepresentationGate.test.ts

Interfaces:
- Consumes: materializeAllPlacementPairs, extractFeatures, extractB1PlacementFeatures, and the pair descriptor categories.
- Produces: evaluateRepresentationGate, judgeRepresentationGate, fitLinearMarginWitness, serializeRepresentationGateResult, and a stdout-only CLI entry point.

- [ ] Step 1: Write RED tests for solver and thresholds

    const solverOptions = {
      margin: 0.01,
      normCap: 1,
      tolerance: 1e-9,
      learningStep: 0.05,
      maxUpdates: 100000,
    } as const;

    it('finds a deterministic witness for a separable synthetic delta set', () => {
      const result = fitLinearMarginWitness([[1, 0], [0, 1]], solverOptions);
      expect(result.found).toBe(true);
      expect(result.witness).toEqual(
        fitLinearMarginWitness([[1, 0], [0, 1]], solverOptions).witness,
      );
    });

    it('fails closed when safety regresses even if strategy accuracy is high', () => {
      expect(judgeRepresentationGate({
        pairCount: 32,
        strategyCorrect13: 18,
        strategyCorrect17: 24,
        safetyCorrect13: 8,
        safetyCorrect17: 7,
        leaveOneStateOutStrategyRate13: 0.75,
        leaveOneStateOutStrategyRate17: 1,
        leaveOneStateOutSafetyRegressionCount13: 0,
        leaveOneStateOutSafetyRegressionCount17: 1,
        solvedStrategyStateGain: 6,
        repeatedRunDeterministic: true,
      }).status).toBe('fail');
    });

- [ ] Step 2: Run the focused gate tests and observe RED

    npx vitest run training/featureRepresentationGate.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false

Expected: FAIL because the solver and gate exports do not yet exist.

- [ ] Step 3: Implement a deterministic bounded margin witness search

Build one deterministic scale per dimension from all 32 pair deltas: scale[d] = max(1, max(abs(delta[d]))). Divide each delta dimension by that scale; the old-13 run uses the first 13 values of the same scale vector. Use a fixed margin 0.01, L2 norm cap 1, tolerance 1e-9, cyclic pair order sorted by pair.id, learning step 0.05, projection after each update, and maximum 100000 updates. Start from an all-zero witness; run the same cyclic projected hinge update for every selected constraint set. A witness is accepted only when every selected pair has dot(w, delta) >= 0.01 - 1e-9; failure to find one by the cap is a fail-closed gate result, not a claim of universal mathematical inseparability.

- [ ] Step 4: Evaluate old 13 dimensions and new 17 dimensions with one protocol

For each representation, enumerate allowed strategy exclusion sets in this order: zero exclusions, then every one-state exclusion by state id, then every two-state exclusion in lexicographic state-id order. Every solve always includes all 8 safety constraints. Select the first witness from the smallest exclusion count; evaluate it against all 24 strategy and all 8 safety pairs, and record per-state correctness, margin minimum and excluded ids. If no witness exists with at most two strategy exclusions, that representation fails.

Run leave-one-state-out separately for each representation: remove one held-out strategy state, fit on the remaining 23 strategy states plus all 8 safety states using the same zero/one/two-exclusion ordering, then evaluate the held-out strategy state and every safety state. A safety regression in any fold invalidates that representation. Old 13 and new 17 dimensions therefore use the same pairs, scale derivation, solver constants, exclusion enumeration and fold order.

- [ ] Step 5: Enforce the exact representation gate

Set status='pass' only when all conditions hold:

    pairCount === 32
    && safetyCorrect17 === 8
    && strategyCorrect17 >= 22
    && leaveOneStateOutStrategyRate17 >= 0.90
    && leaveOneStateOutSafetyRegressionCount17 === 0
    && (strategyCorrect17 - strategyCorrect13) >= 4
    && repeatedRunDigest === identicalRunDigest

The CLI must emit one JSON object to stdout and never create or overwrite a file. The JSON contains only corpus/pair ids, counts, margins, witnesses, failure reasons, and status; it excludes seeds, hidden-bag state, absolute paths, and board dumps.

- [ ] Step 6: Add fail-closed and serialization tests, then observe GREEN

Test missing pair, illegal placement, NaN/Infinity feature, safety regression, strategy count below 22, LOSO below 90%, old/new gain below 4, nondeterministic order, and stdout-only behavior. Run:

    npx vitest run training/featureRepresentationGate.test.ts training/featureRepresentationCorpus.test.ts src/ai/opportunityFeatures.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false

Expected: all focused tests PASS and no file appears under public/ai, training-archive, or any run directory.

### Task 4: Add the bounded diagnostic command and complete the code gate

Files:
- Modify: package.json
- Create/modify only the B1 files listed above
- No changes: src/ai/trainingObjective.ts, src/ai/weights.ts, training/cem.ts, training/train.ts, published weights, v5 run artifacts, or protected probes

Interfaces:
- Consumes: serializeRepresentationGateResult and the checked-in pair corpus.
- Produces: npm run diagnose:feature-representation, a stdout-only deterministic JSON diagnostic.

- [ ] Step 1: Add the command without side effects

    "diagnose:feature-representation": "tsx training/featureRepresentationGate.ts"

The command must parse no training flags, create no lock, read no run artifact, and exit 0 only for representation status='pass'; malformed corpus or gate failure exits nonzero after printing the single JSON result.

- [ ] Step 2: Run the tracked focused suite

    $tests = @(
      'src/ai/features.test.ts',
      'src/ai/opportunityFeatures.test.ts',
      'training/featureRepresentationCorpus.test.ts',
      'training/featureRepresentationGate.test.ts'
    )
    npx vitest run @tests --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false

Expected: all listed tests PASS; no protected probe is collected.

- [ ] Step 3: Run static code gates only

    npm run lint
    npm run build
    npm run typecheck:train
    git diff --check

Expected: exit 0 for each command. These gates do not authorize the diagnostic command, calibration, training, benchmark, paired benchmark, publication, or browser/runtime acceptance.

- [ ] Step 4: Perform independent read-only review

Review exact feature order, same-lane delta, I-access truth table, public-only inputs, SRS/clear parity, row immutability, deterministic solver, pair provenance, stdout-only behavior, protected path scope, and absence of active v5/CEM/schema changes. Resolve Critical/Important findings and rerun affected focused tests.

- [ ] Step 5: Refresh live state and stop before running the diagnostic

    git rev-parse HEAD
    git status --short --branch
    Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match '(?i)(score-rate|training|Tetris)' }
    Get-ChildItem -LiteralPath '.git' -Force -File -Filter '*.lock' -ErrorAction SilentlyContinue
    Get-ChildItem -LiteralPath 'public/ai/score-rate-v5-smoke-20260820-200634' -Force

Do not execute npm run diagnose:feature-representation in this plan. The diagnostic run is a separate user-authorized gate; its result must be independently reviewed before any production feature integration is proposed.

## Acceptance Gates and Stop Conditions

1. Representation code gate: Tasks 1–4 focused tests, lint, build, train typecheck and diff-check pass; independent review has no unresolved Critical/Important findings.
2. Representation diagnostic gate: Only after a fresh process/lock/artifact refresh and explicit command authorization. Pass requires all six conditions in Task 3, including 8/8 safety, strategy at least 22/24, LOSO at least 90%, and new-vs-old gain at least 4. Failure stops B1.
3. Production integration gate: Not part of this plan. A PASS may authorize a new design/plan for production feature wiring and new schema/contract naming; it does not authorize implementation, calibration, training, benchmark, paired, publication, push, or runtime acceptance.

## Plan Self-Review Checklist

- [ ] The approved B1 spec's four feature names, same-lane deltas, public I-access, 32-state pairs, safety/strategy/LOSO/net-gain thresholds, fairness invariants, compute boundary, and independent gates map to explicit tasks or stop conditions.
- [ ] Active 13-feature v5 behavior, CEM fitness, search budget, schema 6 artifacts, published weights, and current run remain untouched.
- [ ] No step reads or executes a protected probe; no command uses a bare test glob that can collect it.
- [ ] No production schema/contract name is invented; no production integration is included.
- [ ] No placeholder or underspecified implementation step appears in this plan.
- [ ] No commit, push, training, calibration, benchmark, paired, publication, or browser/runtime command is executed as part of plan creation.

## Handoff

Plan is intentionally stopped after the representation code gate. If the user authorizes execution, use subagent-driven-development or executing-plans, perform fresh state checks in the new session, and stop before the diagnostic command. If the representation gate passes, return to the user for a separate production integration design and authorization.
