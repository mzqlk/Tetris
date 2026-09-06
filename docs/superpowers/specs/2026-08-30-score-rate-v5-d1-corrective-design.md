# D1 invalid-input corrective design: variable-cardinality held-out listwise

**日期：** 2026-08-30  
**设计代号：** `d1-action-conditioned-held-out-listwise-v2-variable-cardinality`  
**状态：** corrective design gate；本文件不授权 implementation plan、代码、D1 重跑或任何训练/benchmark 操作。

## 1. 结论与问题边界

D1 v1 的唯一 operational 结果是合法的 fail-closed `invalid-input / placement-manifest-mismatch`。其根因不是搜索、标签、拟合或统计结果，而是冻结协议要求每个 subset 精确 12 个合法 current-piece placements；train group 4、seed `2912309259`、`gen6-best`、slot 512 的真实公开状态只有 9 个合法唯一 placements。因而 160 subsets、1,920 placements、7,680 contexts 均未形成，不能把本次结果解释成 representation FAIL 或统计 verdict，也不得重跑 v1。

本 corrective design 只修正 D1 的输入可行性协议：合法 placement 数量 `L_s` 进入预注册 manifest，subset cardinality 定义为 `K_s = min(12, L_s)`。它不改变 active v5，也不把变量 cardinality 变成 production action universe、训练目标或权重契约。

## 2. 三条路线及裁决

### A（推荐）：预注册 variable cardinality

对每个已冻结 public state，先枚举全部合法、去重后的 current-piece placements，并按 canonical `placementId` 排序。若 `L_s >= 12`，仍按 v1 的 state-fingerprint/placement-id/protocol-tag digest 取前 12 个；若 `2 <= L_s < 12`，保留全部 `L_s` 个。禁止 padding、重复、替换、跳过或按 label/score/survival 选择。`L_s < 2` 仍是 invalid-input，因为没有可比较的 listwise decision。

A 保持真实竞争关系，能容纳已观察到的 9-placement state；通过“subset 等权”避免大 subset 在 loss 中获得更高权重。代价是 placements/contexts 不再是固定总数，必须把每个 subset 的 `L_s/K_s` 与总计写入 digest，并让所有消费者使用 manifest，而不是硬编码 1,920/7,680。

### B：降低全局固定 K

预注册 `K=9`（或更低），所有 state 只取确定性最前 K 个。它容易保持固定计数，但会丢弃合法动作，改变 17-placement state 的竞争问题，并把单个 blocker 的最小值传播为全局信息损失；它也不能解释为什么选 9 而不是其他值。除非未来独立设计证明 A 无法实现，B 不采用。

### C：重定义 deterministic capture eligibility/slot

预注册只接受合法数不少于 12 的 capture state，遇到不足则使该 capture 不 eligible。它保留 v1 的 fixed-K 数学形状，但会改变真实 trajectory 的 capture sampling frame，且若先观察到合法数再挑 slot，会产生 eligibility/post-selection bias；若补充新 slot/seed，又会改变已冻结 provenance。C 不是当前 blocker 的最小修复，不采用。

**裁决：** 采用 A，协议版本从 v1 升为 v2；A 不等于用户此前对方案 A 的实现授权，仍须经过本 design 的独立 review、用户批准、另行 implementation-plan gate、code gate 与一次新的 operational gate。

## 3. 不变边界

下列 active v5 合同逐字保持：`score-rate-v5`、checkpoint schema 6、13 项 `FEATURE_NAMES` 及顺序、`bag-expectimax-hold-v2`、depth 4、root/child beams 64/32、`maxWorkUnits=3584`、`budget-corpus-v1`、缓存 65536/16384、标准 Hold、精确七袋 public state、SRS、survival-first、deterministic tie-break、board-row immutability，以及 `meanScore / scheduled maxPieces`。published version 3 权重和所有 run/published artifacts 不变。

D1 v2 仍是 diagnostic-only：不修改 `FEATURE_NAMES`、search/CEM/train/schema/weights，不接入 browser/runtime，不重标 v1 labels，不采用 B1/C0 的输入，不扩大 root Hold 或 complete action universe。v1 的 stdout 只能作为 invalid-input 历史证据；它不是 v2 的数据。

## 4. Frozen input、manifest 与 canonical digest

行为向量、40 个 grouped behavior seeds、320 个 label seeds、capture slots、source artifact hashes、state fingerprints 与 public-state materialization 规则全部沿用 v1；不得换 seed、邻近 slot、source vector 或 hidden bag state。v2 仅替换 placement-cardinality rule，并把 protocol tag 改为 `d1-placement-subset-v2-variable-cardinality`。

每个 subset manifest entry 按固定顺序记录：split、group ordinal、behavior vector、capture slot、state fingerprint、`legalCount=L_s`、`selectedCount=K_s`、完整 legal placement-ID universe digest、按 `placementId` 排序的 selected placement IDs 及其 canonical placement projections。完整 legal universe 先独立按 `placementId` 升序并 hash；`L_s` 必须等于该独立枚举的长度。候选选择严格为 `sortBy(sha256(JSON.stringify([stateFingerprint, placementId, "d1-placement-subset-v2-variable-cardinality"])), then placementId).slice(0,K_s)`，随后仅为 manifest 重排为 `placementId` 升序；`K_s=12` 时这与 v1 的前 12 规则相同，`K_s<12` 时保留该排序结果的全部 `L_s` 项。selected IDs 不能只与自身 manifest 自洽。manifest 不记录 label、score、survival、Tetris、model output 或 source chosen action。

canonical serialization 是 UTF-8、无空白的 `JSON.stringify`，数组按 split `[train,validation,test]`、group ordinal、vector、slot 排序；subset 内先 legal universe ID 升序，再 selected ID 升序；context flatten order 是 subset order × selected placement order × continuation vector `[gen6-best,gen10-mu]` × stream `[0,1]`。每个 context manifest tuple 固定为 `[taskId, subsetIndex, placementId, continuationVectorId, streamIndex, labelSeed, prefixDigest]`，context digest 只 hash 该 ordered tuple array；task-association digest 独立 hash `[taskId,subsetIndex,placementId,continuationVectorId,streamIndex]` tuple array；label digest 独立 hash ordered outcome projections。task ID 为该 flatten order 的从 0 开始连续 ordinal，worker 返回按 task ID 恢复该顺序。对象 key 使用本文列出的固定顺序；所有 `-0` 先 canonicalize 为 `0`；禁止 `undefined`、NaN、Infinity、重复 ID 或非确定性字段。至少产生并输出：

- source/state manifest digest；
- placement manifest digest；
- 每 split、每 group 的 `legalCount`/`selectedCount` histogram 与各自 digest；split 顺序固定为 `[train,validation,test]`，group 顺序固定为 ordinal 0..39，`legalCount` bins 按 count 升序且只记录非零 bin，`selectedCount` bins 固定完整列出 K=2..12（含零样本 bin）；
- context manifest digest；
- 每 subset 的 `L_s/K_s`，split totals 与全局 `N_placements = sum_s K_s`、`N_contexts = 4 * N_placements`。

结构计数必须是 40 groups、160 subsets、每 group 四个 subset；每个 subset `2 <= K_s <= 12`。`N_placements=1920` 或 `N_contexts=7680` 不再是 v2 的有效性条件，只有 manifest 推导出的总数才是权威。任何 state fingerprint 重复、placement 无法重放、legal count 与 replay 不一致、`L_s<2`、digest/order mismatch 都返回 `invalid-input`，并在 pool 创建前 fail closed。

## 5. 等权 listwise、labels 与 evidence 计数

每个 subset 的 target front 在其自身 K 个 placements 上均匀分配 `q=1/|front|`。拟合 loss 仍是 subset loss 的算术平均：每个 subset 权重严格为 `1/M`，不是按 K、placement、context 或 survived pieces 加权。train-only normalization/fit 的 `M,N` 是 train subset 数与 `Σ_train K_s`，按 train canonical order；lambda 选择后，final normalization/fit 的 `M,N` 是 train+validation subset 数与 `Σ_(train+validation) K_s`，严格按 `[train,validation]` 拼接且禁止 test rows；每个 representation 只执行一次 final fit，并在 test-label materialization 前冻结 normalization、weights、lambda、convergence。变量 K 只改变 row 数，不改变共同 optimizer/lambda grid。

每个 placement 仍有四个 contexts：两 continuation vectors × 两 frozen future streams。每个 context 的 scheduled horizon、forced placement、Hold/bag/SRS/reveal 规则和 128-piece 分母不变；提前死亡不缩小分母。每个 placement 的 `pieceCapContexts`、`minPieces`、`sumPieces`、score 与 exact clear counts 仍按四 context 聚合。subset front 仍先按 survival tuple，再按 score/Tetris Pareto；Tetris 仍用整数 cross-multiplication。

因此本次 v2 primary evidence 计数为：160 个 subset、`P = Σ_s K_s` 个 placements、`C = 4P` 个 contexts；另有固定 16 个 replay contexts。报告必须同时给出 split/group/subset cardinality histogram，不能把 variable totals 写成旧的 1,920/7,680。样本、组、placement 的权重规则必须在 manifest freeze 前固定：拟合 loss 为 `L=(1/M)Σ_s L_s`，其中每个 subset 的 `L_s=-Σ_{a=1..K_s}q_{s,a}log p_{s,a}` 且 `q` 在该 subset front 上均匀；normalization 的 `N=Σ_s K_s` 行按 canonical subset/placement order统计，绝不按每 subset 的 K 归一化后再平均。seed group 的四 subset metrics 等权取平均；test aggregate 的 score 为 48 个 selected subset 的 context outcome 总和，分母固定为 `48*4*128`，全局 Tetris 为其整数 numerator/denominator；group metrics 仅用于独立 group gate，不改变 aggregate 权重。

## 6. 阈值、multiplicity 与选择泄漏

为保持问题可比，v2 沿用 v1 的预注册 deterministic gates：action24 `survivalBelowSubsetOracle=0`；48/48 selected survival tuple 不低于 afterstate13；action24 front hits 至少 36/48；相对 afterstate13 的 front-hit gain 至少 +8；12/12 groups 的 front delta 非负且至少 6/12 严格为正；aggregate score 不低、aggregate Tetris share 不低，且二者至少一个严格更高；无 error/abort/nondeterminism/non-finite/test-before-freeze。v2 的 estimand 明确为“每个 captured subset 内，对其预注册 K 个候选的 listwise selection 能力”，不是对 placements 加权的全局 action accuracy；36/48、+8、12/12、6/12 都按 subset/group 计数，K 只改变 subset 内候选集合，不改变门槛。应额外按 `K=2..12` 分层报告 hit、survival 与 front delta；任何层的样本数不足不允许事后合并或删除。v2 不因 cardinality 变化放宽门槛或事后重算阈值。

这是预注册的确定性 acceptance gate，不宣称 p-value 或随机抽样置信区间；48 subset 与 12 group 的双层门本身就是对相关 trajectory 的分布约束。两 representation、五个 lambda 及最终比较均只允许通过 train/validation 的固定选择流程；test 只在两个 immutable final models freeze 后 materialize，一次性评估。不得把 lambda、subset cardinality、threshold、feature、seed 或 failure 结果作为 post-selection 搜索空间。若未来增加置信区间或显著性声明，必须在另一个 design 中预注册 multiplicity 控制（至少按 representation/comparison family 做 Holm 或 Bonferroni），且不得改变本 gate 的 verdict。

### 6.1 Provenance capability amendment（用户于 2026-08-30 批准）

`D1FitSubset` 的公开形状保持 `subsetId/placementIds/features/q` 不变；不得添加一个可由调用者伪造的 `split` 字段并把它当作 provenance。Task 3 审查确认：Fit 第一次收到裸 structural object 时自行计算 digest 或写入 WeakMap，只能证明之后没有 substitution，不能证明该对象最初来自 train。因而 provenance authority 必须来自已经验证真实 capture split、160-subset canonical order、完整 legal universe、context task association 和 worker result identity 的 Labels 边界。

`buildD1ContextTasks` 返回的冻结 batch 本身是不可复制的当前运行 capability。Labels 在 private `WeakMap` 中绑定一个新鲜不可序列化 run authority、160 个 verified subsets、canonical task associations、context/task-association digests 与每 split 的动态 task ranges。Labels 的 authority verifier 可以向 Fit 返回一个同样由 Labels private `WeakMap` 认证的 opaque run-identity object；它只允许按对象 identity 比较同 run，调用者构造、copy、spread 或 JSON round-trip 的对象不在 registry 中。任何 copied/plain object、另一次 `buildD1ContextTasks` 的 batch、重排或跨运行对象都不是同一 capability。run authority/identity 不进入 worker payload、canonical JSON、public evidence 或 digest。

Labels 只允许通过该 context capability 各 materialize 一次 `train`、`validation`、`test` labeled batch。每次必须逐 task 验证 worker projection 的完整 assigned identity、projection digest、无缺失/重复/额外 task，并根据 verified capture 的真实 split 和 manifest-derived task range聚合；调用者提供的 split 只用于选择预期 range，不能覆盖 capture split。每个 labeled batch 按 canonical subset order 冻结完整 `subsetId/groupOrdinal/placementIds/afterstate13/action24/outcomes/survivalOracle/jointFrontPlacementIds/q`，并绑定 run authority、真实 split、source context capability、canonical batch digest 与 label projection digest。copy、对象 spread、JSON round-trip、同 bytes 的人工对象、跨 split 或二次 materialization 都必须拒绝。

Fit 的低层纯数学函数可以继续接收 structural subsets 以测试 normalization、loss 和 solver，但它们的返回值没有 operational authority。只有接受 authenticated `train` batch 的训练 wrapper 才能为每 representation、每个冻结 lambda 各产生一次 run-bound fit capability；五个 lambda 必须精确齐全并绑定同一 train batch。validation selection 必须消费同一 run authority 的 authenticated `validation` batch，逐值绑定 ordered identities、features、outcomes、survival/front 和由 exact front 重建的 uniform q；任一 raw/copy/foreign-run fit 或 batch 都拒绝。

最终 refit 只接受同一 run authority 的两份 authenticated train/validation batches 与对应 selection capabilities。每个 representation 恰调用一次低层 fitter，输入严格为 `[train,validation]` canonical rows；同一 run authority 只能 mint 一份 final-model bundle。final bundle 的 private capability 绑定 opaque run identity、两 representation 的 train/validation batch digests、lambda、normalization、weights 与 convergence；public model/evidence shape 不增加任何 authority 字段。

跨模块 test-label crossing 使用以下唯一所有权与状态机，不允许 Orchestrator 自行比较 private token，也不允许仅凭 authentic run identity 启动 test。Labels owns `D1TestLabelAttemptCapability`、run-level test state 与 `consume/materialize/fail` crossing；Fit owns final-bundle capability、其一次性 test-consumption state，以及只接受 authentic final bundle 的 `consumeD1FinalBundleForTest(finalModels, expectedRunIdentity)` verifier。Labels 导出的 `consumeD1TestLabelCapability(finalModels, contextBatch)` 先从 context `WeakMap` 取得 expected run identity，再调用 Fit verifier；Fit verifier 必须在 final bundle 已 mint、run identity 相同且状态为 `unconsumed` 时原子地把它改为 `in-flight`，并返回只在 Fit private registry 中有效的一次性 attestation。Labels 随即消费该 Fit attestation，原子地把自己的 run-level test state 从 `unconsumed` 改为 `in-flight`，然后才返回 Labels-minted opaque attempt object。Fit attestation 不能由 run identity、selection、plain model 或 copied final bundle产生；任何 caller 都不能在 final freeze 前启动 attempt。

Labels 与 Fit 的状态都只能按 `unconsumed -> in-flight -> materialized|failed` 前进。copied/plain/spread/JSON/manual/foreign-run/cross-split/second-use attempt 全部拒绝。Orchestrator 必须在发出第一个 test worker task之前取得该 attempt。test worker 成功后，Labels `materializeD1LabeledBatch` 只有在 exact attempt、exact context batch、exact test task range/projections 全部验证后才把 Labels 状态置为 `materialized` 并返回 authenticated test batch；随后 Fit 只允许 exact final bundle/exact test batch 的 held-out crossing 把自身状态置为 `materialized`。任何 validation/worker/abort/cleanup 异常先把仍为 `in-flight` 的 Labels/Fit 状态不可逆地标为 `failed`，再传播或聚合 cleanup error；即使 failure hook 自身抛错，两侧都已不再是 `unconsumed`。final bundle mint 之前、使用 copied/foreign final model、第二次 consume/materialize/fail、重复 task tuple、或把 test batch 交给 train/validation fitter时统一返回 `runtime-fail/test-before-freeze`。test labeled batch 形成后只允许同 run final bundle 的 held-out/replay/evidence 消费，不能进入 normalization、lambda selection 或 final refit。

本 amendment 只改变 D1 diagnostic 内部的 Labels/Fit/Orchestrator capability 语义；不扩大 `D1FitSubset`、`D1ContextTask` 或 worker payload，不改变 canonical public result、统计 estimand、solver、阈值、active v5 或 runtime/production contract。

## 7. Replay、post-selection 与 validity 风险

placement subset 的选择只依赖 public state fingerprint、canonical placement ID 与 v2 tag digest；source action、labels、score、survival、Tetris、feature 或 model 不得参与。若 `L_s>12`，hash 取前 12；若 `L_s<12`，全部合法 placements 都在 manifest 中，因此没有“挑出表现好的少数动作”的 post-selection。

模型、lambda、normalization 和 test-label capability 的 freeze boundary 按 6.1 的 run-bound provenance state machine 收紧。固定 16 replay 为 test group endpoints `[0,11]` × 两 vector × 两 slot × 两 continuation policies，选择每个 subset 的 canonical-first placement、stream 0；它是 audit-only，不回写模型或 subset。replay 必须逐值匹配 primary projection；不匹配为 runtime-fail。v2 失败后不得重新定义 K、换 capture、扩 seed、重抽 stream、删除低分 placement 或重复运行寻求 PASS。

## 8. 输入 validation 与状态 precedence

v2 的 structured status 分层保持清晰：manifest/source/seed/state/placement/cardinality/digest 不可行性是 `invalid-input`；simulation/worker/fit/abort/replay/determinism 是 `runtime-fail`；只有完整有效的 variable-cardinality evidence 才允许统计 verdict。顶层 orchestrator 可以返回 invalid-input；既有 valid held-out result 的统计接口不应被偷偷扩大成含 invalid-input 的内部结果类型，具体接口边界须在下一 plan 中显式冻结。

状态优先级仍为：`invalid-input -> runtime-fail -> fail-joint-selection-not-shown -> fail-representation-gain-not-held-out -> pass-action-conditioned-listwise-supported`。phase matrix 固定为：runtime identity/source hash/seed/state/fingerprint/legal-universe/manifest/cardinality/digest 在 source 或 manifest freeze 前失败均为 `invalid-input`；pool/worker/simulation/fit/abort/replay/determinism/test-before-freeze 为 `runtime-fail`；完整 evidence 后才可统计 verdict。pre-pool failure projection 的固定字段为 `mode, phase, status, failureReasons, source, seeds, completedCounts, manifestDigests, resultDigest`。`completedCounts` 精确包含总 `states/subsets/placements/contexts`，以及 `splitSubsets`、`splitPlacements` 的 `[train,validation,test]` 三项；`contexts` 在完整 context/task-association manifest freeze 前为 0，freeze 后精确为 `4*placements`。尚未完整验证的 count/digest 只允许显式 `0`/`null`，不得泄漏路径、seed secret、labels 或 partial outcomes。structured failure 与 complete result 对所有允许的 numeric `-0` 都先 canonicalize 为 `+0`，而不是一处拒绝、一处改写。任何 invalid input 在 worker pool 前返回；不得 retry、optional-stop、替换 seed/slot/state、padding/duplication、降低 K 的全局常数或将 partial evidence 降级成 statistical fail。structured failure 也必须使用同一 canonical serialization/digest 规则；无法安全形成 structured result 时 stdout 为空、stderr 只给 redacted error。

## 9. 下一 implementation-plan gate 的可测试 acceptance 条件

下一门只能规划 diagnostic-only v2 的实现，不得包含 production integration、训练、benchmark、publication 或 runtime acceptance。其 code-gate 必须至少能用 fake/injected dependencies 证明：

1. 同一 v1 fixture 在 9-placement state 上生成 `L=9,K=9`，无 padding/重复；17-placement state 生成 `L=17,K=12`，选择规则与 v1 tag 之外仅改 v2 tag；另覆盖 `L=0/1` invalid、`L=2` valid、`L=12` 全选、`L=13` 截断；完整 legal-universe digest、`L` 与 selected IDs 均由独立枚举校验，所有 selected IDs 对 action/label/score mutation 不变。
2. canonical manifest、histogram、context counts、ordering 与 digests 对重复运行 byte-identical；`L<2`、duplicate、malformed/non-finite、manifest/replay mismatch 都在 pool 前返回 invalid-input。
3. fake pipeline 证明 loss 对 subsets 等权而非 rows/K 加权；两 representation 共享 normalization、lambda grid、selection与 test-freeze boundary；Labels-owned context/run capability 分别且一次性认证 train/validation/test，raw/copy/cross-run/cross-split batches 不能 mint operational fit/selection/final capabilities；test labels 在同一 run-bound final bundle 前不可达。
4. variable `K` 下 survival-first/front、scheduled denominator、`N=ΣK_s` normalization、`L=(1/M)ΣL_s` subset 等权、48-subset score/Tetris aggregate、K-stratified metrics、threshold gates、16 replay selection 和 invalid/runtime precedence 仍按本设计逐项可验证。
5. exact output 包含 v2 protocol id、所有 required digests、per-split cardinality totals/histograms、`sum K`/`4*sum K`，且不伪装为 1,920/7,680；不写 repository/TEMP/public artifacts，不获取 trainer lock。
6. safe code gates、独立 spec/quality review、fresh continuity/post-flight 全部 clean 后，才形成单独 operational authorization request；新的 D1 仍只允许一次，且必须在命令前由用户明确批准。

## 10. 本轮停止点

本设计不实现、不运行测试/build/typecheck/calibration/diagnostic/training/benchmark，不修改 active v5 或任何 artifact/weight/lock，不 stage/commit/push，也不读取、执行、哈希或审查 protected probe。完成本设计的独立 review、必要修订与 continuity 更新后停止，等待用户批准下一技术门。Design clean 不代表 D1 v2 可运行，更不代表 statistical PASS、production integration、训练、发布或 runtime acceptance。
