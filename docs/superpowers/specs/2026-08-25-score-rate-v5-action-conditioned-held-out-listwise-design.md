# score-rate-v5 action-conditioned held-out listwise diagnostic design

**日期：** 2026-08-25

**状态：** 用户已批准 diagnostic-first 方向；本文只冻结独立设计。本文不实现代码、不运行 diagnostic，也不接入 production search、CEM、schema、weights 或 artifacts。

**设计代号：** `d1-action-conditioned-held-out-listwise-v1`

## 1. 结论、目标与技术边界

C0 已得到终局 `fail-joint-improvement-not-shown`：gen-6 best 在独立 seeds 上同时复现了更高 score-rate 与更高 Tetris share，但 piece-cap survival 只有 `14/30`，而 gen-10 `mu` 为 `30/30`。强 Tetris/score 信号不能抵消 survival regression，因此 CEM-only representative retention/archive 路线关闭，C1 不成立。

B1/B1.1/B1.2 也不能继续：旧 same-state pairwise corpus 让 state-only I-access term在正负 action 中精确抵消，challenge corpus又暴露 provenance、old13 alias 与 safety-domain 问题。D1 不修补旧 corpus、不重标旧 labels，也不复用其 PASS/FAIL 判定。

D1 只检验一个窄命题：

> 在真实 v5 决策轨迹、label-blind 的 12-placement candidate subsets、按 seed group 隔离的 train/validation/test split 上，显式 action-conditioned 公共特征能否比旧 13 维 afterstate 表达更好地选择 survival-safe 且 score/Tetris 联合非劣的 placement。

D1 是 representation/protocol diagnostic，不是新的训练目标或 production policy。即使 D1 PASS，也只允许另写 production integration design；不得直接改 `FEATURE_NAMES`、训练、benchmark 或发布。

## 2. 已冻结的历史输入

### 2.1 Source artifacts

D1 只从 C0 已经严格校验的 immutable run 读取两个向量：

- run：`public/ai/score-rate-v5-smoke-20260820-200634`；
- checkpoint SHA-256：`93B2A63FF221B7E6EE1BD5CBFF8AE8C75B5B96411AD5B2EE4AFFA3806B6C06BD`；
- log SHA-256：`C86457320694A8C2D85C734D64D9CE6E58166D913974F945370D15FBC7C651BA`；
- `gen6-best`：`gen=6.bestWeights`，normalized vector digest `233cc500168fe7258305d87654a640ad9aef3f67092d5e0e016f910b9d660ca9`；
- `gen10-mu`：`normalize(checkpoint.mu)`，vector digest `b669671a3cf0132db1e2948cc610aef98bf22a0284f182ac248a74fdf3234b1b`。

这两个向量同时承担 source-trajectory behavior policies 与 counterfactual continuation policies。不得加入 gen-9、published baseline、新 witness 或诊断后挑选的向量。读取必须复用 C0 的 immutable snapshot validator；hash/schema/vector 任一不符为 `invalid-input`。

### 2.2 Active contract remains unchanged

D1 的所有 trajectory、placement materialization 与 continuation 都复用：

- `score-rate-v5`、checkpoint schema 6；
- 原 13 项 `FEATURE_NAMES`，值、语义和顺序不变；
- `bag-expectimax-hold-v2`、depth 4、root/child beams 64/32；
- `maxWorkUnits=3584`、`budget-corpus-v1`；
- transposition/placement caches 65536/16384；
- 标准 Hold、精确七袋 public state、真实 SRS placement；
- survival-first search value order、deterministic tie-breaks；
- board-row immutability；
- scalar fitness 精确为 `meanScore / scheduled maxPieces`。

D1 不改变或重新解释上述合同。D1 label 中的短 horizon score-rate也使用 scheduled horizon 作分母，绝不用 survived pieces 作分母。

## 3. 为什么采用 placement subsets + held-out listwise

### 3.1 采用方案：真实 trajectory placement subsets

每个样本是一个完整公开 decision state 及其 12 个 label-blind 合法 current-piece placements。模型一次对整个 placement subset 打分，训练目标是该 subset 的 survival-best joint Pareto front，而不是把人工 positive/negative pair 当成互相独立的二分类样本。

D1 有意不把 root `hold` 当作 list item。active v5 的 empty Hold 会先 reveal preview，再重新运行 placement search；把实际 sampled preview 下的 placement反向压成 capture-state action会泄漏当时尚未公开的信息，而完整 branch-contingent plan又会把 action space扩大为 placement的笛卡尔积。D1 因此只诊断 current-piece placement ranking。标准 Hold仍原样用于 source trajectory和 forced placement之后的 continuation policy；D1 PASS也不证明 root Hold ranking得到改善。

优点：

- state-only 项不会被误当成 same-state action signal；
- placement competition 与 SRS placement identity保留在同一 subset；
- 所有来自同一 seed 的相关 states 进入同一 split，避免 trajectory/bag-prefix leakage；
- test split 在模型和超参数冻结后只评一次。

### 3.2 拒绝：继续构造 B1.3 pair corpus

旧路线已经用 terminal rule 关闭。继续寻找人工 alias/safety pairs 会把失败转化为 corpus 搜索，产生 post-selection bias，且仍不能回答真实 placement-subset 泛化问题。

### 3.3 拒绝：直接 action-conditioned production integration

直接把候选特征加入 `FEATURE_NAMES` 会同时改变 schema、weights、CEM 维度、cache identity 与运行成本；在 held-out evidence 之前无法区分 representation gain 与过拟合。D1 必须先以独立 module 验证。

## 4. Frozen seed provenance and grouped split

### 4.1 Behavior seed manifest

base seed 固定为 `20260825`。split seed 使用现有 `hashSeed`：

```text
train[i]      = hashSeed(20260825, 0, i), i = 0..19
validation[i] = hashSeed(20260825, 1, i), i = 0..7
test[i]       = hashSeed(20260825, 2, i), i = 0..11
```

精确 manifest 为：

```json
{"train":[3997649999,2652572990,1307495981,4257386268,2912309259,1567232250,222155241,3172045528,1826968519,481891510,3431781797,2086704788,741627779,3691518066,2346441057,1001364048,3951254335,2606177326,1261100317,4210990604],"validation":[2430987566,3776064575,4035800844,1085910557,1345646826,2690723835,2950460104,569817],"test":[864325133,3814215420,3554479151,2209402142,4073951689,2728874680,2469138411,1124061402,2988610949,1643533940,1383797671,38720662]}
```

SHA-256 over UTF-8 `JSON.stringify({ train, validation, test })` 必须为：

```text
19da6a75ad75ccc71e8e7238ea01378583ab7f63cd16786ce70fa7228f981341
```

40 个 seeds 必须唯一，且与 gen 0–9 training seeds、30 fixed-reevaluation seeds、30 historical paired seeds 和 30 C0 seeds 零交集。任何 mismatch 或 collision 均 fail closed；不得换 seed 补洞。

### 4.2 Group isolation

一个 seed 是不可拆分的 provenance group。该 seed 下：

- 两个 behavior vectors；
- 两个 capture slots；
- 全部 candidate placements；
- 全部 counterfactual continuation labels

必须全部进入同一 split。不得按 state、placement、board height、label、Tetris result 或 survival result重新分组。

因此固定规模为：

| Split | Seed groups | Subsets |
| --- | ---: | ---: |
| train | 20 | 80 |
| validation | 8 | 32 |
| test | 12 | 48 |
| total | 40 | 160 |

每个 group 的四个 subsets顺序固定为：behavior vector `[gen6-best, gen10-mu]`，capture slot `[128, 512]`。

### 4.3 Counterfactual stream seeds

每个 subset使用两个 fresh compatible-future streams：

```text
labelSeed = hashSeed(
  20260825,
  3,
  behaviorSeed,
  behaviorVectorIndex,
  captureSlotIndex,
  streamIndex
)
```

迭代顺序固定为 split `[train, validation, test]`、group ordinal、behavior vector、capture slot、stream `[0,1]`。320 个 label seeds 必须全部唯一，并与 behavior、training、fixed、historical-paired、C0 seeds 零交集。SHA-256 over UTF-8 `JSON.stringify(labelSeeds)` 必须为：

```text
a268a5e77c64e68faa4d8cad73727c0623df0531ba0390183742146dc365eb3f
```

同一 subset 内所有 placements 和两个 continuation policies 必须复用相同的两个 compatible streams。不得为表现差的 placement重抽 future，也不得根据 partial labels 丢弃 placement。

## 5. Source-state materialization

### 5.1 Capture points

对每个 behavior seed 与每个 frozen behavior vector，使用 active v5 contract 从 fresh initial game 开始运行。捕获：

- 第 128 个 scheduled piece 落下前的公开 decision state；
- 第 512 个 scheduled piece 落下前的公开 decision state。

piece number 为 1-based：slot 128 位于已有 127 个 locked pieces 后，slot 512 位于已有 511 个 locked pieces 后。任一 trajectory 在 capture point 前 gameover、error、abort 或产生非完整诊断，则整个 D1 输入为 `invalid-input`；不得改用邻近 piece、另一 seed 或只保留幸存 trajectory。

### 5.2 Public-state manifest

manifest 只记录重放所需的公开状态与 provenance：

- board rows；
- current piece pose、next、hold、holdAvailable、unseenBagMask；
- public score、lines、level 与 scheduled piece number；
- split、behavior seed、behavior vector id/digest、capture slot；
- source trajectory 在该 state 的 search diagnostics；这些 diagnostics只供 provenance/coverage报告，不进入 feature、label、subset selection或模型。

不得记录或作为 feature 使用 hidden bag order、RNG state、seed、split id、behavior vector id、state/subset id、labels、weights、margin 或 witness。seed/provenance 只供审计和重放。

canonical state fingerprint 为 SHA-256 over UTF-8：

```text
JSON.stringify([
  boardRows,
  current.type,current.rotation,current.position.x,current.position.y,
  next,hold,holdAvailable,unseenBagMask,
  score,lines,level,scheduledPieceNumber
])
```

160 个 fingerprints 必须全局唯一。state/placement manifest 在任何 counterfactual label 计算前冻结并计算 canonical digest。implementation plan 必须把该 materialization digest作为 pre-registration output；label 阶段不得改 manifest。

## 6. Label-blind placement candidate subsets

### 6.1 Placement semantics

一个 D1 candidate 精确表示 captured public state 的 current piece 经真实 BFS/SRS 到一个合法 lock placement。D1 candidate universe 不包含 root `hold`；不得把 actual source trajectory 在 empty-Hold 后、看见 sampled preview 才选择的 placement带回 capture state。强制 placement锁定后，preview chance与后续 Hold均按 active public state machine处理。

canonical placement id：

```text
`${placedPieceType}:${cellKey(lockedPiece)}`
```

同一 placedPieceType/cell set 的不同 move paths按现有 placement dedup合并。placement id、placed cells、lines cleared、board-after、post-placement public chance branches 必须互相重放一致。

### 6.2 Label-blind 12-placement subset

每个 subset必须精确 12 个 placements。选择过程只能读取 state fingerprint与 canonical placement id：

1. 枚举并按 placement id排序全部 legal current-piece placements；
2. 对每个 placement计算 SHA-256 over UTF-8 `JSON.stringify([stateFingerprint, placementId, "d1-placement-subset-v1"])`；
3. 按 digest、placement id升序取前 12 个；
4. 最终 subset重新按 placement id排序。

若合法 placements少于 12、placement无法唯一重放或 fingerprint重复，则 `invalid-input`。不得使用 source behavior action、Hold result、old13/new24 feature、search value、label、survival、score、Tetris 或人工类别筛选 placements。

本文所有 `subsetSurvivalOracle` 与 `subsetJointFront` 都只相对于这 12 个冻结 candidates，不代表 complete root action space 或全部 legal placements。D1 结论必须保留这个限制。

## 7. Diagnostic representations

### 7.1 Baseline `afterstate13`

baseline 对每个 placement使用现有 `extractFeatures(boardAfter, linesCleared, placedCells)`，精确 13 维、原值、原顺序。preview chance只影响 post-placement public state，不影响 board-after，因此 13 维在 chance branches间保持相同。

### 7.2 Candidate `action24`

候选向量只在 D1 module 内定义。它是原 13 维后依次追加以下 11 项；不得加入 production `FEATURE_NAMES` 或复用 B1 的 17 维身份：

```text
targetLaneUsableDepthDelta
targetLaneSetupProgressDelta
targetLaneReadyRowsDelta
targetLanePlacedCellFraction
placedPieceIsI
verticalIInTargetLane
targetLaneRemainsUsable
futureIAccessProbabilityAfterAction
readyRowsTimesFutureIAccess
setupProgressTimesFutureIAccess
nextDecisionLegalActionProbability
```

前三项沿用 same pre-lane 思路；它们只由 deterministic placement transition决定，在 exact public preview branches上的期望等于该 deterministic值：

```text
targetLaneUsableDepthDelta = clamp((after.usableDepth-before.usableDepth)/4,-1,1)
targetLaneSetupProgressDelta = clamp((after.setupCells-before.setupCells)/36,-1,1)
targetLaneReadyRowsDelta = clamp((after.readyRows-before.readyRows)/4,-1,1)
```

`before` 来自 `summarizeTetrisWell(boardBefore)`。若 `usableDepth==0 && setupCells==0 && readyRows==0`，target lane 为 null，所有 lane-specific 项（delta、placed-cell fraction、vertical-I、两个 interaction）均为 0；不得从 afterstate换列制造 signal。否则 `after` 必须用同一 column 的 column-specific summary。

其余项定义为：

- `targetLanePlacedCellFraction`：四个 locked cells 中位于 frozen target column 的数量除以 4；
- `placedPieceIsI`：placed piece type 为 I 时 1，否则 0；
- `verticalIInTargetLane`：placed piece 是 vertical I，且四个 cells 都位于 frozen target column时 1，否则 0；
- `targetLaneRemainsUsable`：pre-state存在 frozen target lane，且 placement后同一 column的 `usableDepth > 0` 时 1，否则 0；
- `futureIAccessProbabilityAfterAction`：在 placement后的 exact public chance branches上，下一 decision 可立即使用 current/standard Hold取得 I 的总概率，重复事件去重，范围 `[0,1]`；
- `readyRowsTimesFutureIAccess`：`clamp(after.readyRows/4,0,1) * branchFutureIAccess` 的概率期望；
- `setupProgressTimesFutureIAccess`：`clamp(after.setupCells/36,0,1) * branchFutureIAccess` 的概率期望；
- `nextDecisionLegalActionProbability`：在 post-placement public chance branches上，先以共享 `revealPreview` materialize 下一 decision；若 `revealPreview` 返回 `null`，该 branch 已按共享 simulator/runtime 语义 game-over，合法动作贡献严格为 0，禁止在其后合成 state 再尝试 Hold。仅对成功 materialize 的 branch，下一 decision 至少存在一个合法 current placement或 standard-Hold continuation 时记为 legal，并按 branch probability 精确汇总。

这 11 项只使用 board-before、placement、board-after 与 exact public bag/Hold branches；禁止 seed、hidden order、RNG、labels、split、behavior identity 或 continuation result。所有值必须 finite，delta 位于 `[-1,1]`，其余位于 `[0,1]`。输入 board rows 不得原地修改。

### 7.3 Cache and production isolation

D1 extractor是独立 pure diagnostic boundary。它不得被 `searchBudgeted`、browser AI、simulator、trainer、CEM、weight loader 或 checkpoint调用。若 future production design选择这些特征，必须重新设计 placement/cache identity；D1 不先行修改任何 production cache。

## 8. Counterfactual subset labels

### 8.1 Compatible future streams

每个 label seed 从 captured public unseen mask构造一条与公开状态兼容的 future stream；captured `current` 与 `next` 已经公开且不在 stream 中重复。生成算法精确冻结为：

1. `rng = mulberry32(labelSeed)`，同一 stream跨所有 bag持续使用同一 RNG state；
2. 初始 available pieces 是 `unseenBagMask == 0 ? [1,2,3,4,5,6,7] :` mask 中 set bits 对应的 piece types，严格升序；
3. 对 available array执行 in-place Fisher-Yates：`for i = length-1 downTo 1`，`j = floor(rng() * (i+1))`，交换 `array[i]` 与 `array[j]`；
4. 从 index 0起依次消费；当前 array耗尽后，以同一个 RNG继续对 fresh `[1,2,3,4,5,6,7]` 重复第 3 步；
5. label前预生成精确 256 个 piece types。每个 stream的 prefix digest 是 SHA-256 over UTF-8 `JSON.stringify(pieces)`；所有 prefix digests与其 canonical aggregate digest必须在第一个 counterfactual context前冻结。

256 超过单个 128-piece context的最大消费上界：每次 lock消费一个新 preview，且一个 context至多发生一次 empty Hold，empty Hold额外消费一个 preview。消费规则精确为：forced placement lock先消费一个 preview；此后每个 lock消费一个 preview；non-empty Hold不消费；第一次且唯一可能的 empty Hold消费一个 preview；任何第二次 empty Hold表示 state-machine错误并 `runtime-fail`。每次 draw都必须通过现有 `revealPiece` 与当前 public unseen mask核验，contradiction为 `runtime-fail`。

不得复用 source trajectory 的 hidden continuation。preview promotion、empty/non-empty Hold与换袋都按现有 state machine消费同一条 frozen stream；不得在 context间共享 mutable cursor。

同一 subset/placement 的四个 contexts 为：

```text
[gen6-best, gen10-mu] x [stream0, stream1]
```

每个 context先强制执行该 placement，再由对应 frozen continuation vector使用 active v5 search继续，直到总计 128 个 scheduled pieces（forced placement计为第 1 个）或 gameover/error/abort。所有 12 placements必须完成全部四个 contexts；不得 early stop或替换失败结果。

### 8.2 Exact per-placement outcomes

对四个 contexts聚合：

- `pieceCapContexts`：达到 128 scheduled pieces 的 contexts 数，范围 `0..4`；
- `minPieces`：四个 contexts 的最小 survived/locked pieces；
- `sumPieces`：四个 contexts 的 survived/locked pieces 总数；
- `sumScore`：相对 captured public score 的 score增量总和；
- `scoreRate = sumScore / (4 * 128)`；
- exact aggregate clear counts；
- `tetrisNumerator = 4 * totalTetrises`；
- `tetrisDenominator = totalLinesFromCounts(clearCounts)`；denominator 为 0 时 Tetris share 定义为 0。

score-rate 的分母始终是四个 contexts各 128 的 scheduled cap；提前死亡不缩小分母。clear counts必须合法重构 lines，所有数值必须 finite/non-negative，unexpected reason或不完整 context为 `runtime-fail`。

### 8.3 Survival-first joint target set

每个 subset先按以下 exact survival tuple取最大值：

```text
(pieceCapContexts, minPieces, sumPieces)
```

按上述字段 lexicographic descending。低于最大 survival tuple 的 placement永远不能进入 target set；score 或 Tetris 不能补偿 survival差距。

在最大 survival tier 内，再按 `(sumScore, tetrisShare)` 取非支配前沿：若 placement B 的 score不低且 Tetris share不低，并至少一项严格更高，则 B dominates A。Tetris fraction比较使用整数 cross-multiplication，不用浮点容差。所得非空集合称为 `subsetJointFront`。

listwise target distribution `q` 在 `subsetJointFront` 上均匀分配概率，其他 placements为 0。该定义没有 score/Tetris加权和，因此一个指标的提升不能抵消另一个指标的退化。

## 9. Held-out listwise fitting protocol

### 9.1 Shared objective

`afterstate13` 与 `action24` 使用完全相同的数据、subsets、target distributions、normalization、optimizer、regularization grid 和 selection rules。对每个 subset 的 placement feature `x` 与线性权重 `w`：

```text
p(a|s,w) = softmax_a(w · x_s,a)
L(w) = mean_s(-sum_a q_s,a * log p(a|s,w)) + lambda/2 * ||w||^2
```

不使用 intercept，因为同一 subset 的常数在 softmax 中抵消。feature normalization只用当前 fit split，精确规则为：

1. 一个 fit split若有 `M` 个 subsets，则统计域精确为 canonical subset order × canonical placement order的全部 `N=M*12` rows；不得先做 per-subset averaging或使用 label weights；
2. 对每个 dimension按上述 row顺序做两遍 binary64统计。第一遍从 `sum=+0` 开始，逐 row执行 `sum = sum + x`，`mean=sum/N`；第二遍从 `squared=+0` 开始，逐 row先算 `delta=x-mean`，再执行 `squared = squared + delta*delta`；`variance=squared/N`，`std=Math.sqrt(variance)`；
3. 使用 population denominator `N`，禁止 `N-1`、single-pass variance、compensated summation、parallel reduction或重新排序。若任一输入/中间值非 finite或 `variance<0`，为 `runtime-fail`；
4. 仅当 `variance===0` 时，该 dimension的 normalized value、mean/std projection中的 std都 canonicalize为 `+0`；否则精确使用 `(x-mean)/std`。所有 normalized values必须 finite；
5. train fit只统计 train。final fit按 split order `[train,validation]`、各自 group/subset/placement canonical order拼接后重算，不读取 test。validation/test绝不进入 train normalization，test永不进入任何 fit normalization。

### 9.2 Deterministic optimizer

每个 lambda使用自包含 deterministic full-batch damped Newton solver；不得依赖未冻结的外部 optimizer版本：

1. operational solver runtime精确冻结为 Node `24.14.0`、V8 `13.6.233.17-node.41`、`win32-x64`；任一 identity mismatch为 `invalid-input`。全程使用该 runtime的 ECMAScript `Number`、`Math.exp`、`Math.log` 与 IEEE-754 binary64基本运算，禁止 float32、FMA/显式 `Math.fround`、compensated summation、parallel reduction、random initialization或 platform BLAS；
2. 每个 placement的 logit从 `logit=+0` 开始，按 dimension `d=0..D-1` 精确执行 `product=w[d]*x[d]`、`logit=logit+product`；不得重排、融合或补偿。按 placement id顺序扫描最大 logit，完全相等保留较早 placement；随后按同一顺序令 `term[a]=Math.exp(logit[a]-maxLogit)`，从 `denominator=+0` 开始逐 placement执行 `denominator=denominator+term[a]`，再令 `logDenominator=Math.log(denominator)`、`p[a]=term[a]/denominator`、`logP[a]=(logit[a]-maxLogit)-logDenominator`。每个 term、denominator、logDenominator、p与logP必须 finite，denominator必须 `>0`；objective只使用 `logP`，不得重新调用 `Math.log(p)`；
3. initial weights全 `+0`，max Newton iterations `200`，convergence为 gradient infinity norm `<=1e-9`；进入每次 iteration前先检查 convergence；
4. objective从 `loss=+0` 开始，按 subset顺序、placement id顺序执行 `loss = loss + (-q*logP)`，完成全部 subsets后先除以 `M`，再按 dimension顺序执行 `loss = loss + lambda/2*w[d]*w[d]`；
5. gradient对每个 dimension `d` 从 `+0` 开始；按 subset顺序先令 `local=+0`，按 placement顺序执行 `local = local + (p-q)*x[d]`，再执行 `gradient[d] = gradient[d] + local/M`；全部 subsets完成后执行 `gradient[d] = gradient[d] + lambda*w[d]`；
6. Hessian对每个 subset先按 dimension顺序计算 `mu[d]`：从 `+0` 开始按 placement顺序执行 `mu[d] = mu[d] + p*x[d]`。随后按 row dimension `d=0..D-1`、column dimension `e=0..D-1`，令 `local=+0`，按 placement顺序执行 `local = local + p*(x[d]-mu[d])*(x[e]-mu[e])`，再执行 `H[d][e] = H[d][e] + local/M`。全部 subsets完成后，只对 `d==e` 按 dimension顺序执行 `H[d][d] = H[d][d] + lambda`；不得只计算半矩阵后镜像；
7. 以不归一化 pivot row 的 Gaussian elimination解 `H*direction=-gradient`。复制 `A=H`、`b=-gradient` 后，对 `k=0..D-1`：在 rows `k..D-1` 中选 `abs(A[row][k])` 最大者，完全相等取最小 row；必要时交换整行与对应 `b`；令 `pivot=A[k][k]`，若 non-finite或 `abs(pivot)<=1e-15` 则失败；对 `i=k+1..D-1` 依次令 `factor=A[i][k]/pivot`、`A[i][k]=+0`，再对 `j=k+1..D-1` 执行 `A[i][j]=A[i][j]-factor*A[k][j]`，最后执行 `b[i]=b[i]-factor*b[k]`。不得 normalize pivot row或改变 loop order；
8. back substitution按 `i=D-1..0`：`sum=b[i]`，随后按 `j=i+1..D-1` 执行 `sum=sum-A[i][j]*direction[j]`，最后 `direction[i]=sum/A[i][i]`；所有运算逐步检查 finite；
9. direction dot gradient从 `dot=+0` 开始，按 dimension `0..D-1` 精确执行 `dot=dot+gradient[d]*direction[d]` 并要求 `dot<0`。line search从 step `1` 开始，Armijo `c1=1e-4`；candidate weights按 dimension顺序计算。若 `L(w+step*direction) > L(w) + c1*step*dot`，则 step精确乘 `0.5`；最多 64 次 candidate evaluations。没有 accepted step、direction不是 descent direction或任一值非 finite均 `runtime-fail`；
10. accepted step后按 dimension顺序写入 candidate weights并继续下一 iteration；第 200 次 update后仍未满足 gradient门即 `runtime-fail`。objective、gradient、Hessian、direction与weights任一 non-finite立即失败。validation/test top-placement logits复用第 2 项完全相同的 dot recurrence与 tie-break；

weight digest 对 canonical dimension order逐维写入一个 binary64 little-endian value并计算 SHA-256；写 bytes前把 `-0` canonicalize为 `+0`，拒绝 NaN/Infinity。normalization digest按 dimension `d=0..D-1` 逐维交错写入 `mean[d]` 后紧接 `std[d]` 两个 binary64 little-endian values；不得先写全部 means或加入长度/文本。重复 fit必须得到逐 bit相同的 normalized statistics、weights、gradient norm、iteration count与 digests。

任一 lambda fit失败会使整个 representation fit与整门 `runtime-fail`；不得增加 iterations、换 solver、改 pivot/line search或丢弃该 lambda后继续解释结果。

### 9.3 Validation and final test boundary

lambda grid固定为：

```text
[0.0001, 0.001, 0.01, 0.1, 1]
```

每个 representation独立在 train fit五个模型，再按 validation结果 lexicographic选择：

1. 最少 `survivalBelowSubsetOracle` selections；
2. 最多 `subsetJointFront` hits；
3. 最大 lambda（更强 regularization）；
4. canonical weight digest。

lambda 冻结后，使用 train+validation重新计算 normalization并只 fit一次 final model。必须先在 immutable in-memory freeze record中记录 representation id、lambda、normalization digest、final weight digest和 convergence evidence；freeze record构造成功前禁止调用 test-label materializer，构造后也不暴露任何 mutation API。随后 test labels才可进入 evaluation boundary。test 不得用于选 lambda、改 feature、改 placement subset、改 threshold、改 optimizer或 refit。

模型 top placement按 score descending、canonical placement id ascending确定；tie-break不读取 labels。

## 10. Test metrics and fail-closed verdict

test split精确 12 seed groups、48 subsets。对 old/new top placement分别计算：

- `survivalBelowSubsetOracle`：selected survival tuple低于该 subset最大 tuple 的数量；
- `subsetJointFrontHits`：selected placement属于 `subsetJointFront` 的数量；
- selected outcomes 的 aggregate `sumScore`、scheduled score-rate与 Tetris share；
- new-vs-old 每个 subset的 survival tuple comparison；
- 每个 seed group四个 subsets的 old/new `subsetJointFrontHits` 与 `groupFrontDelta = new-old`；
- model、normalization、weights、selected placement ids与 metric projection digests。

### 10.1 `pass-action-conditioned-listwise-supported`

以下条件必须全部成立：

1. provenance、160 subsets、每 subset 12 placements、全部 7680 continuation contexts、solver与 replay均完整有效；
2. `action24.survivalBelowSubsetOracle == 0`；
3. 48/48 subsets上 action24 selected survival tuple均不低于 afterstate13 selected tuple；
4. `action24.subsetJointFrontHits >= 36`；
5. `action24.subsetJointFrontHits - afterstate13.subsetJointFrontHits >= 8`；
6. 12/12 seed groups的 `groupFrontDelta >= 0`，且至少 6/12 groups的 `groupFrontDelta > 0`；
7. action24 selected aggregate `sumScore >= afterstate13.sumScore`；
8. action24 selected aggregate Tetris share `>= afterstate13`；
9. 条件 7 与 8 至少一个严格更高；
10. 无 error、abort、nondeterminism、non-finite value 或 test-before-freeze evidence。

条件 2–3 是硬 survival gate；条件 5–6 阻止 `+8` gain只由两个高度相关的 seed groups驱动；条件 7 与 8 分开判断，禁止用 score improvement抵消 Tetris regression，或反之。

PASS 只支持：“在冻结的真实 trajectory held-out placement subsets 与短 horizon counterfactual labels 上，action24 比 afterstate13 表现出跨 seed分布、survival-safe 的 subset-internal joint selection gain。”它不证明完整 legal placement/root action space、root Hold ranking、production search、CEM training、5000-piece fixed reevaluation、paired benchmark或 publication可通过。

### 10.2 `fail-representation-gain-not-held-out`

provenance/runtime有效，但 subset-front absolute floor、`+8` held-out gain或 seed-group distribution门不成立。关闭当前 action24/listwise feature hypothesis；不得后验改 placements、subsets、splits、features、lambda grid或 thresholds追求 PASS。

### 10.3 `fail-joint-selection-not-shown`

representation hit门可能成立，但 action24出现任一 survival regression，selected aggregate score/Tetris任一低于 afterstate13，或两项都与 afterstate13精确相等。score严格比较用 integer `sumScore`；Tetris share严格比较用 aggregate numerator/denominator整数 cross-multiplication。该状态因此也覆盖“representation gates全过，但没有任何 joint metric严格改善”。该结果优先于 representation gain；不得把更高 hit rate、score或 Tetris解释为 joint PASS。

### 10.4 `invalid-input` / `runtime-fail`

- artifact/vector/seed/digest/state/placement/manifest mismatch、capture缺失、少于12 legal placements或 duplicate fingerprint为 `invalid-input`；
- simulation/worker/optimizer failure、abort、malformed metrics、test-before-freeze、non-convergence或 deterministic replay mismatch为 `runtime-fail`。

两类结果都只允许 correctness design/fix gate；不得改冻结 source vectors、seeds、capture points、placement selection、horizon、features或 thresholds。

verdict precedence唯一固定为：`invalid-input` → `runtime-fail` → `fail-joint-selection-not-shown` → `fail-representation-gain-not-held-out` → `pass-action-conditioned-listwise-supported`。前一状态适用时不得同时或降级报告后一状态；`failureReasons` 仍可列出同一状态内全部 canonical reasons。

## 11. Determinism, replay and output contract

primary 完成后，只 replay 以下 16 个 context records：test group ordinal `[0,11]` × behavior vector `[gen6-best,gen10-mu]` × capture slot `[128,512]` × continuation policy `[gen6-best,gen10-mu]`；每项固定使用该 subset 的 canonical-first placement与 stream 0。projected score/pieces/clear counts/reason/search diagnostics必须逐值一致。

completed diagnostic stdout恰好一行 canonical JSON，至少含：

- mode/status/failure reasons；
- source artifact hashes与 vector digests；
- active search metadata；
- behavior/label seed digests；
- state/placement manifest digests与 split counts；
- feature names/order/ranges与 feature projection digests；
- label protocol、context counts与 label digest；
- 两个 representations 的 lambda、normalization/weight/convergence digests；
- validation selection evidence；
- test seed-group metrics、gate booleans、selected-placement digest；
- replay evidence；
- SHA-256 over完整 canonical result projection。

completed verdict时 stderr必须为空。diagnostic不得写 repository、TEMP、checkpoint、log、candidate、weight或 `public/ai` 文件，不创建 repository trainer lock。无法安全形成 structured failure时，stdout为空，stderr只给 concise redacted error。SIGINT销毁 worker pool并返回 `runtime-fail`，不输出 partial verdict。

## 12. Cost and separate operational gate

冻结工作量上界：

- source trajectories：40 groups × 2 behavior vectors × 512 pieces = 40,960 scheduled pieces；
- labels：160 subsets × 12 placements × 2 continuation policies × 2 streams × 128 pieces = 983,040 scheduled pieces；
- replay：16 × 128 = 2,048 scheduled pieces；
- 总上界：1,026,048 scheduled pieces。

该成本约为 C0 scheduled pieces 的 1.6 倍；实际 wall time取决于 survival与固定 3584-unit search，本文不承诺时长。未来 implementation plan必须先以 injected fakes 完成 code gate；真实 D1 diagnostic是单独 operational gate，只能在 fresh process/lock/artifact/weight/index检查、独立 whole-change review与 continuity match 后运行一次。不得 retry、optional stop、换 seed、减 placements、换 horizon或根据 partial result裁剪 contexts。

## 13. Independent gates after this design

| Gate | Allowed scope | Explicit stop |
| --- | --- | --- |
| Written spec review | 只审本文的一致性、可实现性、泄漏与 fail-closed 规则 | 未批准前不写 implementation plan |
| Implementation plan | 只规划 diagnostic pure core、materializer、fake-driven tests、CLI 和 safe gates | 不实现、不运行真实 D1 |
| Code gate | TDD 实现 diagnostic-only module；focused safe tests、explicit ESLint、build、safe train typecheck、diff-check、独立 task/whole reviews | 不运行真实 D1 |
| Operational D1 | fresh pre-flight后一次完整 diagnostic，验证 stdout/digest/replay/post-flight | 不接 production、不训练 |
| Production integration design | 仅当 D1 PASS 时才 eligible；重新冻结 feature/search/cache/schema/compatibility | 不因 D1 PASS 自动实现 |
| Signal/fixed/paired/publication | 各自需要新 plan、fresh evidence与独立技术 PASS | 任一前门不能授权下一门 |

production候选若未来成立，最终资格仍必须满足 aggregate Tetris share `>=20%`、相对 immutable published baseline 的 paired score-rate/Tetris-share 95% lower bounds均 `>0`、zero survival regression。D1 的 128-piece labels与 36/48、+8 thresholds不是 candidate/publication门。

## 14. Invariants and non-goals

- 不修改 active v5 feature/search/CEM/train/schema contracts；
- 不修改 `public/ai/score-rate-v5-smoke-20260820-200634`、`src/ai/trained-weights.json`、`public/ai/best-weights.json` 或任何 run/published artifact；
- 不修补、重跑或重标 B1/B1.1/B1.2；
- 不把 C0 gen-6 specialist直接保留进 archive或 candidate pool；
- 不增加 budget、piece cap、T4 bonus、curriculum、Pareto/CEM selection或新 objective；
- 不建立 training-only AI implementation；共享 engine/SRS/public-state logic只能复用；
- 不允许 board-row mutation、hidden bag/seed/RNG/label leakage；
- protected probes仍只允许在 ordinary `git status` 中看到路径名，禁止读取、执行、哈希、修改、移动、删除、test、typecheck、review、stage或 commit；
- 不 broad-add、stash、reset、restore、checkout或 clean；
- 本设计不授权 diagnostic execution、calibration、training/resume/restart、bench/paired、publication、push、browser/runtime acceptance或 artifact/lock mutation。

## 15. Design completion and next decision

本文完成后先做 placeholder、internal consistency、scope与ambiguity self-review，再由 fresh independent reviewer分别给出 spec-compliance 与 design-quality verdict。Critical/Important finding必须修复并 scoped re-review。

review clean 后只以本文 exact pathspec提交，保持既有 WIP与真实 index边界。随后停在用户 written-spec review gate：用户批准本文后，下一步只能调用 `writing-plans` 编写 code-only implementation plan；不得直接实现或运行 D1。
