# score-rate-v5 B1.2 structural challenge corpus design

**日期：** 2026-08-24  
**状态：** 用户已批准执行 B1.2 推荐路线；本文冻结设计，后续实现、code gate 与一次独立 diagnostic 按本文顺序执行。  
**终止规则：** B1.2 是 B1 corpus 系列的最后一次尝试。code gate、独立 label review 或 diagnostic 任一失败即停止，不创建 B1.3，不后验修 corpus。

## 1. Fresh evidence 与 B1.1 postmortem

### 已验证事实

- B1.1 diagnostic 只运行过一次，结果为 `challenge-inconclusive`：old13 strategy `24/24`，超过冻结的 `<=20/24` challenge-validity 上限；new17 未运行。
- B1.1 的 32 个所谓新 states 在 board/public-state 层大量复用了既有 `tetrisOpportunityCorpus`：lane 对应 build，completion 对应 ready，safety 逐项相同，多数 I-access 对应 bag-hold。更换 id/group 不构成独立 corpus。
- B1.1 completion positives 多为当前 I 直接四消，old13 已直接包含 `linesCleared`、`lineClearValue` 与 after-board 的 height/holes/transitions/well summaries；这些标签因此与旧表示高度同构。
- `lockPlacement` 对同一 pre-state 的两个 placement 产生相同的 pending `current`、`hold`、`holdAvailable` 与 `unseenBagMask`。`futureIAccessProbability` 只读取这些字段，不读取 placement 或 board，所以它在任一 same-state pair 中的正负 delta 精确为 0。
- shared protocol 允许排除最多两个 strategy states 后寻找 witness，再用该 witness 回评完整 corpus。`24/24` 是该 tolerant representation protocol 的 in-sample summary，不是独立固定分类器准确率；LOSO 才承担跨 state 泛化检查。
- 2026-08-24 fresh baseline：HEAD `7e33240fa52a9cbc7837753262b95a434fb75ad7`，real index 为空，无 repository/index lock；active v5 contract 无 HEAD/index diff；gen-10 run 与 published weight hashes 未漂移。

### 设计判断

B1.1 inconclusive 的主要原因不是已经证明 old13 足够，而是 corpus provenance 与标签结构没有真正挑战旧 after-state 特征。B1.2 必须先在构造上保证可证伪空间，再测量追加 lane-delta features 是否能恢复策略区分。

## 2. 方案比较

### 方案 A：结构性 old13 alias corpus（采用）

冻结 8 个 same-state alias pairs。每个 pair 的标签先由目标井连续性、真实 SRS、post-clear 与 survival 后果确定；随后要求 positive/negative 的 old13 13 维向量逐项完全相同，而至少一个 target-lane delta 不同。任何 old13 linear witness 在这些 pair 上 margin 都只能为 0，因此 old13 strategy 最多 `16/24`，无需依赖 solver 的排除选择或运行结果。

优点是 challenge-validity 在设计上成立，且仍测试真实同局面 action ranking。风险是 alias corpus 属于有意针对旧表示盲点的 adversarial unit gate，不代表真实游戏分布；因此即使 PASS 也只授权 production design，不授权训练或效果宣称。

### 方案 B：运行时 deterministic generator + first-N solver-blind candidates（拒绝）

固定枚举顺序后按结构 predicate 取 first-N，运行成本低，但若 corpus 在 diagnostic 时仍动态筛选，pre-registration 边界不清晰；若 predicate 不包含 alias，又不能保证 old13 `<=20/24`。B1.2 仅保留 deterministic builder 作为 code-gate 重放工具，diagnostic 只消费已经冻结并带 digest 的 manifest。

### 方案 C：修改 pair protocol、替换 I-access feature 或直接进入 constrained/Pareto CEM（本轮不采用）

cross-state/listwise protocol 能使 state-level I-access term 可观测，action-conditioned I-access feature 也可能更合理；constrained/Pareto CEM 则直接触及选择机制。但三者都扩大问题定义，不能修复 B1.1 corpus provenance。若 B1.2 失败，下一设计应从这些方向中选择，而不是继续做 B1.3。

## 3. Corpus contract

### 3.1 身份与形状

- corpus id：`b1-2-structural-challenge-corpus-v1`；
- 32 个全新 public states，每个 state 精确一个 positive/negative pair；
- 24 strategy states：
  - 8 `target-lane-alias`；
  - 8 `lane-transfer-control`；
  - 8 `public-i-context-control`；
- 8 `safety-control`；
- state id、pair id、state fingerprint、pair fingerprint 全局唯一。

public state 只含 board rows、current、next、hold、holdAvailable、unseenBagMask 与人工审阅 target column。不得包含 seed、RNG、hidden bag order、bag index、weights、feature vectors、margin 或 witness。

### 3.2 Semantic non-reuse

定义 canonical state fingerprint：

```text
SHA256(JSON([rows,current.type,current.rotation,current.position,next,hold,
             holdAvailable,unseenBagMask,targetWellColumn]))
```

定义 canonical pair fingerprint：

```text
SHA256(JSON([stateFingerprint,positiveCellKey,negativeCellKey,
             positiveClass,negativeClass]))
```

另定义 structural provenance fingerprint：

```text
SHA256(JSON([rows,current.type,current.rotation,current.position]))
```

B1.2 的所有 state fingerprint 必须与以下集合不相交：

- `TETRIS_OPPORTUNITY_CORPUS_V1`；
- `b1-placement-pair-corpus-v1` 的 materialized states；
- `b1-1-challenge-corpus-v1`。

仅改 id、group、next、Hold、mask、target metadata 或 descriptor 不能绕过检查；只要 board/current 相同就视为 reuse。因此 full state fingerprint 与 structural provenance fingerprint 均须和三个旧 corpus 无重叠。

### 3.3 Deterministic builder 与冻结点

builder 使用以下有限、无 RNG 的 grammar；这些 ranges 与顺序在实现前冻结，不得根据生成数量或 feature/solver 结果扩大：

- alias board：solid skyline，由镜像 well pair `(1,8)`、`(2,7)`、`(3,6)`、`(4,5)`，`baseHeight=4..9`、`wellDrop=2..4`、`shoulderLift=0..2`、`centerDip=0..1` 依此嵌套枚举；current 只按 `[I,O,T]` 即 piece types `[1,2,3]` 枚举；
- lane-transfer control board：target column `0..9`、`baseHeight=4..9`、`wellDrop=2..4`、`leftShoulderDelta=0..2`、`rightShoulderDelta=0..2`，再按 current piece `1..7`；
- public-I-context control board：沿用 lane-transfer grammar 的 board 生成式，但要求不同 structural provenance fingerprint，并依次枚举 `next=1..7`、`hold=[null,1..7]`、`holdAvailable=[false,true]`、`unseenBagMask=[0,1,2,4,8,16,32,64,127]`；这些 public fields 只提供跨 state 覆盖，不参与 same-state label；
- safety board：target column `0..9`、solid skyline `baseHeight=12..18`、`wellDrop=1..4`，叠加固定 notch offset `[-3,-2,-1,0]` 与 current piece `1..7`；禁止 top 4 rows 有占用；
- solid skyline 的精确定义为：column height 为 0..21 的整数，cell `(x,y)` filled 当且仅当 `y >= TOTAL_ROWS-height[x]`；notch 只清除 grammar 指定的一个既有 filled cell；
- state fields 未由该 group 显式枚举时使用纯 index 映射：`next=((templateIndex+1)%7)+1`、`hold=templateIndex%3===0 ? null : ((templateIndex+3)%7)+1`、`holdAvailable=templateIndex%2===0`、`unseenBagMask=[0,21,42,85,127][templateIndex%5]`。

全局 candidate 顺序固定为：group order、grammar 参数的上述书写顺序、state structural fingerprint、positive cell key、negative cell key。alias placement pair 还要求 cell sets 关于 board 中轴镜像；其它 group 遍历所有 `positiveCellKey < negativeCellKey` 的合法 pair。它先执行与 feature 无关的 domain label predicate，再执行 group-specific admission：

1. 枚举 current piece 的真实 SRS placements，并用 shared `lockPlacement` materialize；
2. positive/negative 必须来自同一完整 public pre-state；
3. 两者 immediate `linesCleared` 与 immediate score class 必须相同，禁止重新引入 old13 的 line-clear shortcut；
4. survival class 精确定义为 `isValidPosition(boardAfter, pending.current)`；正负必须相等且为 true。top-out proximity 精确定义为 `max(columnHeights(boardAfter))`；positive 必须 `<=` negative；
5. `targetWellColumn` 必须精确等于 `summarizeTetrisWell(boardBefore).column`；pre-target summary 的 `usableDepth/setupCells/readyRows` 不能全零，避免 `laneDeltas` 的 zero short-circuit；允许多个物理井同分，但 canonical tie-break 必须唯一给出 descriptor target；
6. target summary 比较使用既有 `compareTetrisWellSummaries` 顺序，即 `(readyRows, setupCells, usableDepth)`；positive after 相对 before 必须 `>=0`，negative after 相对 before 必须 `<0`。若 public current/next/Hold/mask 表示 I 可用，则 vertical-I access 定义为：`enumeratePlacements(boardAfter, createPiece(1))` 中存在一个 placement 的四个 cells 全部位于 target column；positive 必须保留、negative 必须失去；
7. alias group 额外要求 old13 positive/negative vectors 逐项 `Object.is` 相等，且三个 target-lane delta 至少一项不相等；该 equality 是预注册的 blind-spot admission，不得使用 old13/new17 solver、margin、witness、accuracy 或 exclusion 结果；alias 按全局 candidate 顺序取前 8 个，不得更换；
8. control groups 不得按 old13/new17 vector、margin 或 solver 结果筛选。

builder 按全局 candidate 顺序精确取各 group 所需数量，输出 frozen manifest。独立 label review 通过后，计算并写死 `B1_2_PRE_REGISTRATION_DIGEST`。从该 digest 冻结起，任何 state、label、cell key、group、threshold 或 order 修改都会使 code gate 失败；diagnostic 不调用 builder 搜索，只读取 frozen manifest。

若 finite grammar 无法生成 8 个合法 alias states、16 个合法 strategy controls 或 8 个 safety controls，B1.2 code gate 失败并停止。不得扩大 grammar、改成 near-equality、放宽标签或参考 solver 输出继续挑选。

## 4. Label review contract

每个 pair 的独立 review package 必须只呈现结构证据，不呈现 feature vector、solver、margin、witness 或 accuracy：

- pre-board、public current/next/Hold/mask 与 target column；
- positive/negative SRS cell keys 与 materialized post-clear boards；
- lines cleared、最高列、holes、spawn/reveal survival；
- target column before/after `usableDepth/setupCells/readyRows`；
- public I available 时，vertical I placement 是否由真实 SRS enumeration 可达；
- positive/negative label predicate 的逐项 PASS/FAIL；
- board rows 与 shared row references 未被修改的证据。

每个 state 必须由独立 reviewer 裁决 `APPROVED`。任何 Critical/Important finding 先按 TDD 修复，再做 scoped re-review；在 32/32 全部批准前不得创建 pre-registration digest 或运行 diagnostic。

## 5. Feature identifiability

B1.2 保留现有 candidate 17D extractor，以维持 B1/B1.1 parity，但公开报告以下限制：

```text
targetLaneDeltaIdentifiable = true
futureIAccessProbabilityIdentifiable = false
futureIAccessReason = same-state-pair-constant
```

测试必须证明每个 same-state pair 的 positive/negative `futureIAccessProbability` 相等。B1.2 的 new17 增益只能归因于三个 target-lane delta dimensions；即使 diagnostic PASS，也不得宣称 `futureIAccessProbability` 有 action-ranking 价值。是否删除、替换为 action-conditioned interaction，或改用 listwise/cross-state protocol，留给独立 production design。

## 6. Shared protocol 与判定

- B1 与 B1.1 的 public result schema、literal golden、pair ordering、failure reasons 与 deterministic digests保持不变；
- B1.2 继续调用现有 dimension-isolated evaluator：old13 不调用 new extractor；challenge-invalid 时不调用 new17；
- 每个 strategy state 精确一个 pair，避免 LOSO `.find(stateId)` 漏评；
- solver constants保持 margin `0.01`、norm cap `1`、tolerance `1e-9`、learning step `0.05`、max updates `100000`；
- old13 alias pairs 的 exact-zero delta 必须在 solver 前由 corpus code gate 单独证明；
- identifiability disclosure 与 result digest 只在新的 B1.2 wrapper 中投影；不得修改 shared protocol serializer 或 B1/B1.1 wrapper schema；
- B1.2 result digest 覆盖 frozen manifest digest、pair order、identifiability disclosure、old13/new17 summaries、witness、LOSO、safety 与 failure reasons。

一次 diagnostic 的 PASS 条件全部同时成立：

1. corpus/pre-registration digest 与 reviewed manifest匹配；
2. old13 strategy `<=20/24`；8 个 alias pairs 又使设计上限为 `16/24`；
3. new17 strategy `>=22/24`；
4. `strategyGain = new17 - old13` 且严格 `>4`；
5. new17 safety `8/8`；
6. new17 LOSO strategy rate严格 `>0.90`；在 24 个唯一 states 下最小通过值为 `22/24`；
7. 每折 safety regression 为 0；
8. repeated result deterministic，两个 SHA-256 digest完全相同；
9. evaluation、serialization 或 validation 无 error，stdout恰好一行 JSON，stderr为空且无文件写入。

`strategyGain >4` 对应 minimum gain 5。B1.1 旧文档中的 `>=4` 是历史文字冲突，不适用于 B1.2；用户最新明确要求的 strict `>4` 为权威值。

任一条件失败都 fail-closed。只有 old13 `>20` 时状态为 `challenge-inconclusive`；其他阈值、determinism、validation 或 runtime failure 为 `fail`。两种状态均停止 B1 corpus 系列。

## 7. 实施与审查门

### Task 1 — Corpus builder、frozen manifest 与 provenance

先观察 RED，再实现有限 grammar、32-state materialization、semantic non-reuse、alias invariants、manifest digest 与 mutation-sensitive determinism tests。不得调用 representation solver。

### Task 2 — 独立 32-label review 与 corpus re-review

生成结构-only review package；独立 reviewer 逐 state 审查。finding 以 TDD 修复并 scoped re-review。最后冻结 pre-registration digest。

### Task 3 — B1.2 gate 与 legacy parity

复用 shared protocol，新增 identifiability disclosure、strict thresholds、challenge early-stop、stdout-only CLI 与 no-file tests。旧 B1/B1.1 golden/digest必须保持。

### Task 4 — Safe code gates 与 whole-change review

只运行显式 focused tests、显式安全 ESLint 文件、build、排除 protected probes 与 browser-only `loadWeights.ts` 的 safe train typecheck、scoped `git diff --check`。独立 whole-change review 的 Critical/Important finding 必须修复并 scoped re-review。

### Task 5 — 一次独立 diagnostic

先刷新 HEAD/index/status、全部 Node processes、repository locks、run artifacts、published weights 与 protected status。仅运行一次新的 B1.2 diagnostic；捕获 exit、elapsed、stdout/stderr、JSON、digest 与运行后现场。不得重跑以追求 PASS。

## 8. 不变量与写入边界

- active contract保持 `score-rate-v5` / schema 6 / `bag-expectimax-hold-v2` / depth 4 / beams 64/32 / `maxWorkUnits=3584` / `budget-corpus-v1`；
- fitness保持精确 `meanScore / scheduled maxPieces`；
- `FEATURE_NAMES` 仍为原 13 项，B1 candidate features不接入 production；
- 保持标准 Hold、精确七袋概率、公开 unseen mask、真实 SRS、survival-first、board row immutability与浏览器/Node共享纯逻辑；
- 不修改 B1、B1.1 corpus、labels、golden 或 diagnostic results；
- 不修改 CEM、training/search contract、schema、weights、run artifacts或 published files；
- 不修改、移动、删除或归档 `public/ai/score-rate-v5-smoke-20260820-200634`；
- protected probes只允许在普通 `git status` 中看到路径名，不得读取、执行、哈希、修改、移动、删除、stage、commit或进入 test/typecheck/review package；
- 不 broad-add、不 stash/reset/restore，不删除任何 repository/TEMP lock；
- 本轮不运行 calibration、training/resume/restart、bench、paired benchmark、publication、push、browser/runtime acceptance或 commit。

## 9. 终止与后续

- B1.2 PASS：只允许进入独立 production integration design；必须如实保留 I-access 不可辨识结论，不自动改 active v5或训练。
- B1.2 `challenge-inconclusive`：停止 B1 corpus 系列，下一候选为 feature/protocol redesign 或 constrained/Pareto CEM design；不得继续扩 corpus。
- B1.2 `fail`：representation 假设在该结构 gate 下未成立；同样停止 B1 corpus 系列，不增加 budget、不加 T4 bonus、不改标签追 PASS。
