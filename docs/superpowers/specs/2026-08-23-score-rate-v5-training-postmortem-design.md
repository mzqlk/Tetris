# score-rate-v5 训练失败复盘与 vNext 搜索设计

**日期：** 2026-08-23

**状态：** 用户已批准 B1 feature-first 设计；仅形成规格，尚未为 B1 编写实施计划、修改 B1 代码、运行 B1 训练、benchmark、paired、发布或运行时验收。A+ 的一次 D0 已按批准范围执行并 fail-closed 失败。

**历史失败 run：** `public/ai/score-rate-v5-smoke-20260820-200634`

**当前代码契约：** `score-rate-v5` / schema 6 / `bag-expectimax-hold-v2`

**历史方向：** A+，诊断门控的 horizon-first 搜索；D0 已失败，因此未形成 v6/schema 7/v3 合同

**当前获批方向：** B1 feature-first；保持 score-rate 与公平性不变，追加公开机会特征，先通过 pairwise 线性可分性 gate

## 1. 目标、结论与授权边界

本规格完成两件事：

1. 对 score-rate-v5 gen-10 失败作事实、判断和未知项分离的复盘；
2. 冻结下一版搜索的设计方向、因果诊断、候选归档、算力边界和分阶段验收门。

核心结论是：固定 candidate 相对 baseline 的退化主要位于 CEM 的选择分布与代表向量机制；稳定四消没有形成，则最可能是实际搜索视野、特征/beam 表达和“score-rate 训练、四消末端资格门”三者共同作用。当前证据不能把 100% budget exhaustion 单独判为根因。A+ D0 在批准的有限搜索范围内未找到合格 tuple，故下一设计裁决转为 B1；B1 先验证公开信息是否足以表达保井与兑现机会，再决定是否冻结新的 schema/contract。

本规格只授权设计记录。它不授权：

- 编写实施计划或修改任何代码；
- 再次运行 postmortem 诊断、calibration、training、bench、paired benchmark 或 browser/runtime acceptance；
- resume、restart、继续或新开训练；
- 生成、覆盖或发布权重；
- 修改、移动、删除或归档现有 run artifacts；
- commit、push 或发布；
- 读取、执行、哈希、修改、移动、删除或暂存受保护的 `training/searchProbe.ts`、`training/searchProbeWorker.ts`、`training/searchProbe.test.ts`；
- 删除任何 TEMP trainer lock。

设计批准与实施授权仍是两个独立门。本规格结束后停止，不进入 implementation plan。

## 2. 新鲜现场与 artifact 事实

2026-08-23 现场复核结果（本次重新读取的易漂移状态）：

- `master` HEAD 为 `7e33240fa52a9cbc7837753262b95a434fb75ad7`；相对 `origin/master` ahead 28；
- real index 为空，但工作树存在此前已批准的 Phase A WIP：7 个 tracked 修改、设计/计划文档以及 horizon diagnostic/corpus 文件；三个受保护 probe 只通过 `git status` 确认未跟踪，未读取其内容；
- 当前没有匹配 Tetris trainer/search 运行的 Node 进程；
- Git common directory 及工作区扫描到的 repository lock 不存在；TEMP 中的无关锁未读取、未删除；
- run 目录只有 `checkpoint.json` 和 `training-log.jsonl`；不存在 `candidate-weights.json`；
- checkpoint `version=6`、`gen=10`；日志含 gen 0–9 十条连续 generation 与一条 gen-10 reevaluation，末尾换行完整；
- 所有日志记录均为 `score-rate-v5` / `bag-expectimax-hold-v2`，搜索 metadata 为 depth 4、root/child beams 64/32、`maxWorkUnits=3584`、`budget-corpus-v1`；
- 十代 generation wall time 合计 `19.5319219444` 小时；
- continuity Markdown 可定位并读取；本次 `Resume` 返回 `insufficient / state:missing-or-corrupt`，因此本节结论来自重新建立的现场证据，而不是 checkpoint state。
- published/runtime 权重文件的现场身份未改变；gen-10 run 未写入任何新文件。

历史 run、TEMP locks、published runtime 权重与 bundled 权重在本阶段均保持原地未修改。

## 3. Postmortem：事实、判断和未知项

### 3.1 population 中位数与 sigma

十代 `medianScoreRate` 始终仅为 `0..0.133333`。到调度 cap 2000 后，population median 只存活 `24.6..38.4` pieces，而 elite median 每代都达到当代 cap。该分布说明大多数采样向量很早死亡、几乎没有消行，选择信号由少数高分尾部候选提供。

sigma 均值从 gen 0 的 `0.741700` 收缩到 gen 9 的 `0.601022`。但 gen 9 的注入 noise variance 仍为：

```text
0.5 * 0.95^9 = 0.315125
sqrt(0.315125) = 0.561360
```

`updateCem` 使用 `sqrt(elite variance + noise)`，所以最终 sigma 已接近配置噪声自身形成的下界。它只证明采样分布比初始状态窄，不证明 population 已形成稳定策略，更不证明 `mu` 是高质量动作策略。

**判断：** “median 长期接近零”表明 population 大部分仍不称职；“sigma 收缩”只是分布收窄，不能抵消尾部选择、五局测量和大噪声带来的高方差。不能把两者合并描述为“CEM 已稳定收敛但模型偶然复评失败”。

### 3.2 gen 6 的 9.53% T4

gen 6 的 score-rate best candidate 同时有 `9.5286366%` Tetris line share。由于它是当代 score-rate 第一名，它事实上属于十个 elite；准确表述不是“没有进入 elite”，而是“没有在 elite 分布和后续 `mu` 中稳定扩散”。

同期及后续证据：

| generation | best T4 | elite T4 中位数 |
| ---: | ---: | ---: |
| 6 | 9.528637% | 0.050088% |
| 7 | 0.702282% | 0% |
| 8 | 0% | 0% |
| 9 | 0.100326% | 0% |

四消指标不参与 elite 排序或 CEM 更新。gen 6 best 只占十个 elite 均值的十分之一，下一代继续注入较大噪声。gen-10 固定复评评估的是 gen 9 更新后的 `normalize(mu)`，不是 gen 6 best，也不是历史 best-ever archive。

**判断：** gen 6 是五局共同随机数上的瞬时信号。现有日志不能证明它对独立 seeds 泛化，也不能证明其策略在均值向量中保留。

### 3.3 fixed reevaluation 的退化数据流

固定复评为相同的 30 games × 5000 scheduled pieces：

| 指标 | published baseline | candidate | delta |
| --- | ---: | ---: | ---: |
| scoreRate | 636.019333 | 598.673333 | -37.346000（-5.871834%） |
| meanScore | 3,180,096.667 | 2,993,366.667 | -186,730 |
| meanLines | 1,998.600 | 1,998.933 | +0.333 |
| singles | 1,603.233 | 1,860.367 | +257.133 |
| doubles | 195.733 | 68.733 | -127.000 |
| triples | 1.300 | 0.367 | -0.933 |
| tetrises | 0 | 0 | 0 |
| piece-cap games | 30/30 | 30/30 | 0 |
| meanHeight | 3.170720 | 2.638227 | -0.532493 |

当前 engine scorer 的单/双/三/四消基础分为 `100/300/500/800 × level`，最大 level 15。candidate 近似把 127 次双消拆成约 254 次单消。在 level 15：

```text
one double = 300 * 15 = 4500
two singles = 2 * 100 * 15 = 3000
loss per substitution = 1500
127 * 1500 = 190500
```

该近似与实测 `-186730` meanScore 高度一致，剩余差异来自早期等级和消行时序。总消行几乎不变，但消行组合从双消退化为单消，真实 score 降低，再由 `meanScore / 5000` 直接形成 scoreRate 下降。

candidate 的平均高度更低，同时其标准化权重对 `aggregateHeight` 的惩罚从 baseline 的约 `-0.0314` 增强到 `-0.5135`。它保留正的 `lineClearValue`，但 `tetrisReadyRows` 权重为负，实际策略诊断也表现为 clean well 稍深、setup/ready 更低。

**判断：** candidate 学到的是更积极压低棋盘、频繁单消的局部策略，而不是稳定积累高价值消行。固定复评退化不是 survival 损失造成的。

### 3.4 搜索预算与完成深度

固定复评搜索诊断：

| 指标 | baseline | candidate |
| --- | ---: | ---: |
| budget exhaustion | 100% | 100% |
| mean completed depth | 1.890507 | 1.926816 |
| depth 1 | 22,283（10.9493%） | 15,155（7.3184%） |
| depth 2 | 181,227（89.0507%） | 191,926（92.6816%） |
| depth 3 / 4 | 0 / 0 | 0 / 0 |

事实只能证明 metadata 中的最大 depth 4 在真实长局中没有成为提交动作；绝大部分动作来自完整 depth 2，其余来自 depth 1。candidate 完成深度略高却得分更低，因此预算耗尽不能单独解释 candidate 相对 baseline 的退化。

**判断：** 四锁定规划从未实际提交，对“等待 I、保持同井、兑现四消”构成强烈的结构性嫌疑；但现有日志没有逐深度根动作、beam membership 或预算干预后的反事实动作，尚不能确认因果贡献。

### 3.5 根因归类

| 因素 | 证据强度 | 结论 |
| --- | --- | --- |
| CEM 选择分布与 `mu` 代表性 | 高 | fixed candidate 退化的主要原因之一；五局选择、十 elite 均值、仅复评 `mu`，没有代表向量竞争 |
| score-rate fitness 与 T4 资格门错位 | 高 | T4 在训练中完全不参与选择，只在 gen-10 末端拒绝候选；它是闸门而非训练压力 |
| 搜索视野/预算 | 中 | 实际只提交 depth 1/2，结构上不足以稳定规划多块建井；因果尚待干预诊断 |
| 特征与 beam 表达 | 中 | `best well` 可逐状态换列；legacy well penalty、新建井特征和高度压力相互竞争；目标分支可能在即时 beam 中消失 |
| score-rate 标量本身 | 低到中 | 真实 scorer 本来奖励四消，不能称为天然错误；问题是稀疏回报在短视搜索和高方差 CEM 中没有稳定进入选择 |

总体定位是组合问题。下一版不得只提高 budget，也不得直接把人工 T4 bonus 加入 scalar fitness。

## 4. 历史 A+ 方向（D0 后阻塞）

A+ 原由三个彼此可隔离的单元组成：

1. `D0` 最小因果诊断：先确认 horizon、beam、feature 或 CEM 哪条链实际阻塞；
2. horizon-first 搜索：在相同公开信息和精确概率下，用更窄、带策略保留槽的 beam 换取真实 depth 3/4；
3. 小型 reevaluation candidate pool：固定复评 `mu` 加至多两个 archive 向量，避免瞬时优秀向量被均值化后永久丢失。

标量 fitness 继续严格为：

```text
fitness = meanScore / scheduled maxPieces
```

本方向不把 T4 share、Hold 次数、完成深度或策略诊断加入 CEM scalar fitness。

## 5. D0：最小因果诊断

### 5.1 显式公开状态语料

新增版本化 `tetris-opportunity-corpus-v1`，共 32 个只读 `PublicSearchState`：

- 8 个仍需 3–4 个锁定块的安全建井状态；
- 8 个接近 ready、但即时单/双消会破坏同井的状态；
- 8 个覆盖 I 已在 Hold、Hold 为空、I 仍在 unseen mask 和换袋边界的状态；
- 8 个 safety controls：任何四消倾向都不得覆盖近期 top-out/survival 风险。

每个状态只包含 board、current、next、hold、holdAvailable、unseenBagMask。语料不得包含 seed、RNG、隐藏袋序、精确 bag index 或运行时生成顺序。board、字段和顺序一旦改变，corpus id 必须升版。

每个 strategy 状态附带人工审查的动作类别标签，而非唯一坐标答案：

- `preserve-well`：保留同一目标列且不降低近期 survival；
- `complete-tetris`：当前可完成合法四消；
- `destroy-well`：即时低阶消行或落点破坏已标注目标列；
- `safety-only`：任何建井动作均不应优先于存活。

### 5.2 权重与干预矩阵

诊断比较三套现有向量：

- 当前 published baseline 在内存补齐后的 13 维向量；
- gen 6 `bestWeights`；
- gen-10 fixed candidate，即 checkpoint `normalize(mu)` 对应向量。

不得读取或执行受保护 probe。诊断不得写 `public/ai`、run artifacts 或权重文件；成功与失败只输出一个结构化 JSON 到 stdout。

搜索候选配置为固定有限序列。每个 tuple 记为：

```text
(root score slots / root strategy slots,
 child score slots / child strategy slots)
```

按从宽到窄顺序：

```text
16/2, 8/1
12/2, 6/1
 8/2, 4/1
 6/2, 3/1
 4/1, 2/1
```

对每个 tuple，首先只用 `maxWorkUnits=3584`。只有 3584 下没有任何 tuple 通过结构与策略条件，才依次尝试 `3840、4096、4352、4608`；不得超过 4608，也不得跳过较低预算直接选较高预算。

选择顺序固定为：

1. 最低通过的 work-unit budget；
2. 同一 budget 下最宽、且最先出现在上述序列中的 tuple；
3. 完全相同结果按 tuple 文本顺序稳定选择。

通过条件：

- 32/32 状态完整 depth 1，无 unit 透支，动作和值确定；
- 24 个 strategy 状态完整 depth 3，至少 18/24 完整 depth 4；
- 8/8 safety controls 与 v5 survival-first 动作类别一致，或选择的替代动作具有严格更高 survivalProbability；
- 24 个 strategy 状态全部保留至少一个标注目标列的策略动作进入根 beam；
- 与 v5 已提交动作相比，至少 18/24 strategy 状态转为 `preserve-well` 或 `complete-tetris`，且 survivalProbability 不降低；
- 三套权重的逐层 committed action、beam source、target well、value、completed depth 和 work-unit 分类完整输出。

若所有候选直到 4608 都不能通过，A+ 在 D0 阻塞：不得继续提高 budget、降低公平性、运行训练或弱化门槛。下一步必须回到用户设计裁决，比较特征优先方案 B；不能自动转入 B 或 C。

### 5.3 因果判别

- 加深后目标动作稳定从 destroy 转为 preserve/complete：支持 horizon 的因果贡献；
- 提高可完成深度但策略动作从未进入 beam：支持 feature/beam 排序阻塞；
- gen 6 只在训练 generation 数据上高 T4，而相同公开 corpus 与后续固定筛选不泛化：支持 CEM 测量/过拟合；
- 深度、策略槽和 archive 均不能改善信号：否证 A+，不得继续堆 generations。

## 6. A+ horizon-first 搜索草案（未生效）

以下内容是 A+ 的历史草案。由于第 5 节 D0 已 fail-closed，下一版不得采用这些 v6/schema7/v3 标识；它们仅保留为已否证方向的设计边界：

- objective：`score-rate-v6`；
- checkpoint/weight schema：7；
- search contract：`bag-expectimax-hold-v3`；
- feature vector：仍为当前精确 13 项，顺序不变；
- output dir：新的、启动时为空的独立目录；具体 run id 在未来运行授权时选择；
- beam tuple 与 `maxWorkUnits`：采用 D0 按第 5.2 节选出的唯一冻结结果；
- corpus metadata：同时记录 `budget-corpus-v1` 与 `tetris-opportunity-corpus-v1`。

D0 未通过时，上述 v6/schema7/v3 contract 不成立，不得创建兼容 artifacts。

### 6.1 score slots 与 strategy slots

每个决策节点分别构造两组 placement：

1. score slots：沿用当前 immediate 13-feature heuristic 降序与 enumeration index 稳定 tie-break；
2. strategy slots：保护同一目标井的候选，不用人工 T4 bonus 改写其 heuristic value。

两组 placement 做稳定并集并去重。重复 placement 只计算一次，保留 `score`、`strategy` 或 `both` 来源诊断。Hold 分支继续独立保留，不占任何 placement slot。机会节点不设 beam，仍展开 unseen mask 中全部合法类型并使用精确相等概率。

策略槽只保证候选进入完整 expectimax；最终动作仍按 survivalProbability、expectedHeuristicValue、稳定枚举顺序裁决。策略槽不能直接覆盖 survival 或 score value。

### 6.2 同井 intent

搜索内部增加纯值 `targetWellColumn: 0..9 | null`：

- 根节点从 `null` 开始；
- strategy placement 可从其 afterstate 的显式候选井建立一个目标列；
- intent 非空时，后续 strategy slots 只评价同一列的 usableDepth、setupCells 和 readyRows；
- score-slot placement 不凭空创建 intent，但若它与已有 intent 兼容则保留 intent；
- Hold 不消费 lock depth，也不改变 targetWellColumn；
- 完成四消后 intent 重置为 `null`；
- 目标列不再能容纳合法四格竖直 I 带时，该 strategy lane 终止，但 score slots 仍正常搜索；
- targetWellColumn 必须进入 transposition/cache key；部分 intent 路径不得污染无 intent 的缓存值。

该 intent 只由公开 board 和搜索路径确定，不进入环境状态，不读取隐藏信息，也不使用模块级可变状态。浏览器与 simulator 每次实际锁定后仍从新的公开状态重规划；不在两个真实决策之间保存秘密策略状态。

### 6.3 预算、深度与性能

- work-unit 定义、执行前扣费、分类计数、完整层事务和永不透支保持 v5 语义；
- depth 1 静态保证保持；
- depth 2–4 耗尽仍只能返回上一完整深度；
- 不使用 wall-clock 选择动作，不因 worker 数、浏览器速度或机器快慢改变搜索图；
- `maxWorkUnits` 优先保持 3584，只有 D0 证明较低预算无合格 tuple 时才使用不超过 4608 的最小合格值；
- Node 选择/冻结线继续为 140/160 ms；普通浏览器 p95 200 ms 是独立后续验收线；
- 若冻结配置不能通过 Node 结构/性能门或后续 browser p95 200 ms，不允许运行时动态降级，必须回到设计修订。

### 6.4 诊断

搜索和 simulation 聚合新增但不进入 fitness：

- 每个 completed depth 的 committed action kind 与 beam source；
- strategy-slot retained/deduplicated/pruned counts；
- targetWellColumn established/reset/invalidated counts；
- depth 3/4 完成率；
- elite T4 positive candidate count；
- elite T4 p25/p50/p75；
- archive source、generation、training scoreRate、T4 和 survival。

generation log 不写逐动作 board 或隐藏袋信息；只写聚合诊断。D0 JSON 可以写显式 corpus state id，但不得写环境 seed 或未脱敏路径。

## 7. CEM 与固定复评候选池

### 7.1 CEM 更新保持不变

- population 仍按 `meanScore / scheduled maxPieces` 排序；
- elite fraction 仍为 0.1，population 100 时取十个 elite；
- T4、Hold、策略槽、completed depth 和 search diagnostics 不进入 scalar fitness；
- survival 继续通过实际提前死亡的固定分母损失和搜索内 survival-first 语义约束。

本规格不批准 Pareto CEM、T4 bonus 或 curriculum。

### 7.2 两个 archive 向量

checkpoint 在达到 `maxPiecesCap=2000` 后，维护至多两个从上次固定复评以来的代表向量：

1. `scoreChampion`：所有 cap-2000 generations 中 training `bestScoreRate` 最高的单一 candidate；
2. `strategyChampion`：每代先筛选 `pieceCapGames == gamesPerCandidate` 且 `scoreRate >= 0.99 * generationBestScoreRate` 的 candidates，再在所有合格候选中取 T4 share 最高者。

稳定 tie-break：更高 training scoreRate、更早 generation、更小 candidate index。两个 archive 与 `normalize(mu)` 完全相同则去重；两个 archive 互相相同也去重。

archive 只保存向量和可审计来源，不改变 CEM `mu/sigma`。schema 7 checkpoint 必须 exact-key 验证 archive；旧 schema 不兼容。

### 7.3 固定复评

每十代固定复评候选池最多三个唯一向量：

```text
normalize(mu)
scoreChampion
strategyChampion
```

它们必须使用完全相同的 30 个 fixed-reevaluation seeds、5000-piece cap、搜索 contract、beam、budget、Hold 和 bag 概率。首次固定复评还用相同调度建立 immutable published baseline；后续不得重新漂移 baseline。

单一向量只有同时满足下列条件才 qualified：

- `meanScore > baseline.meanScore + 0.001 * max(abs(candidate.meanScore), abs(baseline.meanScore))`；
- `tetrisLineShare >= 0.20`；
- `pieceCapGames >= baseline.pieceCapGames`，在 baseline 30/30 时即 candidate 30/30；
- metadata exact match schema 7 与冻结 v3 search contract。

本规格明确选择严格 score gate：稳定四消 candidate 不使用 0.1% band 内的 lower-height tie-break 绕过得分优势要求。

多个向量 qualified 时，按 meanScore、T4 share、较低 meanHeight、固定 pool 顺序裁决。没有 qualified 向量时：

- `bestQualifiedCandidate` 保持原值或 `null`；
- 不写 `candidate-weights.json`；
- reevaluation event 必须记录每个 pool entry 的独立 qualification reason。

## 8. 方向比较与 reuse / must add / must clarify

| 方向 | reuse | must add | must clarify / 触发条件 | 预期算力 | 最短可否证实验 |
| --- | --- | --- | --- | --- | --- |
| A+ horizon-first（D0 已否证） | 公开状态、精确七袋、标准 Hold、SRS、survival-first、work ledger、13 特征、score-rate fitness | D0 corpus/trace、score+strategy slots、同井 intent、两个 archive、pool reevaluation | 已在 25 个配置、3584..4608 范围内 fail-closed；不得自动加预算、放宽 gate 或进入 Phase B | D0 实际 1070.771 s；正式 run 成本未开放 | 同一 D0 矩阵已运行：全部配置 `strategyDepthThreeComplete=false`、`strategyDepthFourCount=0`，`selectedConfiguration=null` |
| B1 feature-first（当前批准） | v5 搜索、CEM、score-rate fitness、公开信息公平性、Hold、七袋、SRS、survival-first | 4 个 append-only 公开机会特征；pairwise 线性可分性 gate；公开状态 placement-pair witness；最多三个 fixed-pool 向量 | 只有 representation gate 通过后，才另行冻结新 schema/contract/output dir；witness 不自动成为 CEM 初始值；失败即停止，不加预算、不加 T4 bonus | 诊断 gate 为小型 corpus 计算；每次 placement 预计为 v5 的 `1.0–1.1×`，须由独立性能门实测 | 同一公开状态、同一 SRS placement pairs：若 17 维无法同时满足 strategy/safety/LOSO 条件，B1 直接否证 |
| C 约束/Pareto CEM | v5 搜索与 13 特征 | score/T4 双 archive、dominance、更多 seeds 或置信估计 | 本规格不采用；只有 A/B 已证明能产生可泛化 T4 行为、但 score-only CEM 无法保留时才重新提案 | 为稳定估计稀疏 T4，预计需要 `2–6×` game tasks；以 v5 的 19.53 小时十代为基准风险最高 | 在独立固定 seeds 上只筛 gen 6 best、gen 9 best 和 gen-10 `mu`；若代表向量都不能复现非零 T4 且保持 score，则否证 CEM-only 路线 |

未决项均被转化为未来 gate 的明确输入和阻塞规则；本规格没有允许实施者自行选择的性能数字、降级路径或隐藏策略开关。

## 9. 保持不变的不变量

### 9.1 公平性、Hold 与七袋

- 搜索只接收公开 board/current/next/hold/holdAvailable/unseenBagMask；B1 的 `futureIAccessProbability` 也只能从这组公开状态计算；
- 不读取隐藏 bag、bag index、seed 或 RNG；
- unseen mask 每个类型使用精确等概率，mask 为空时开启完整新七袋；
- 标准 Hold 每锁定回合最多一次，Hold 不消耗 lock depth；
- 空 Hold 与非空 Hold 的抽块/交换语义保持；
- 相同公开状态、权重和冻结配置必须产生相同动作、值和诊断。

### 9.2 survival、引擎与纯逻辑

- 搜索值继续先比较 survivalProbability，再比较 expectedHeuristicValue；
- strategy slot 或 target intent 不得覆盖 survival-first；
- 落点继续使用引擎旋转/SRS；
- board rows 不原地修改；
- 浏览器、simulator、训练、fixed reevaluation 和 paired 共用 `src/ai` 纯逻辑；
- `src/ai` 不增加 Node、DOM、filesystem 或模块级可变状态；
- `FEATURE_NAMES` 当前 13 项的顺序保持不变；B1 候选维度只能按批准顺序 append，representation gate 失败时不改变现有 13 维合同。

### 9.3 artifact

- v5 run 保持原地不变；vNext 不 resume、append、迁移或重写 schema 1–6 artifacts；
- 新跑必须使用显式空目录，已有任何条目时 fail closed；
- A+ 未生效的 schema 7 checkpoint/log/candidate 不得创建；B1 只有在 representation gate 通过并另行冻结合同后，才可定义新的 schema/contract metadata，并要求 objective、beam、budget、corpus、cache caps 和 archive keys exact match；
- candidate 只写 run-local；训练器不得改写 `public/ai/best-weights.json` 或 `src/ai/trained-weights.json`；
- published version 3 score-rate-v2 模型在 publication 授权前保持不变；
- stale/TEMP lock 不自动删除；任何删除仍需 fresh PID/process/lock 证据和独立授权。

## 10. 预期算力成本

以下区分已测成本与 B1 设计估算；B1 估算不是已运行 benchmark：

- A+ D0 已实际运行一次：25 个配置 × 32 states × 3 weights，elapsed `1070.771 s`，无诊断错误与透支，但 `status=fail`；该数字只属于历史 D0，不是 B1 预算承诺；
- B1 representation gate 只处理 32-state placement pairs 与确定性线性 witness，预期远低于一次训练代，具体 wall time 必须由独立 code/performance gate 测量；
- B1 per-decision search 保持 v5 depth 4、root/child beams 64/32 与 `maxWorkUnits=3584`，新增特征计算预计为 v5 的 `1.0–1.1×`，不得把估算当作通过；
- generation：v5 十代为 19.53 小时。即使 unit 上限近似不变，若更多 population candidates 存活更久，整代总搜索调用数会增加，因此正式训练可能为 v5 的 `1–3×`；信号门必须先否证，不可直接安排长跑；
- 首次 B1 fixed reevaluation：baseline 加至多三个唯一 pool vectors，最多 4 组，约为 v5 首次 baseline+mu 两组的 `2×`；
- 后续 B1 fixed reevaluation：最多三个唯一 pool vectors，约为单一 `mu` 的 `3×`；去重可降低实际成本；
- 本设计不通过增加 gamesPerCandidate 或 population 来隐藏高方差；若未来要增加，必须另行修改设计和算力预算。

## 11. 分阶段验收门

各门彼此独立；上一门通过不授权执行下一门。

### 11.1 A+ D0 diagnostic gate（已失败）

- 第 5 节 corpus、矩阵、结构条件、策略条件全部满足；本次事实为 25/25 配置均 `strategyDepthThreeComplete=false`、`strategyDepthFourCount=0`，`selectedConfiguration=null`，故 gate fail-closed；
- A+ 未选出任何预算/tuple，已阻塞；
- 不写 `public/ai`、run artifacts 或权重；
- 不接触受保护 probe；
- 结果经独立只读 review，事实、判断与建议可区分。

本门的失败不授权 B1 实现或训练；它只关闭 A+ Phase B，并把下一设计裁决交给用户。B1 的 representation gate 见第 14 节。

### 11.2 Code gate（A+ 历史门；B1 需按第 14 节重定义）

- score/strategy slots、同井 intent、cache key、dedupe 和 stable tie 单测通过；
- exact chance、Hold、survival-first、SRS、公开信息边界回归通过；
- ledger 执行前扣费、分类合计、完整层提交、depth-1 保证和零透支通过；
- archive 选择、去重、schema 7 exact-key、旧 schema 拒绝和 pool reevaluation 测试通过；
- fitness 对 T4/strategy/search diagnostics 保持不敏感；
- focused tests、完整 `npm test`、`npm run lint`、`npm run build`、`npm run typecheck:train`、`git diff --check` fresh 通过；
- whole-change 独立 review 无未处理 Critical/Important finding；
- code gate 不运行训练、bench、paired、发布或 browser acceptance。

### 11.3 Calibration / performance gate（A+ 历史门；B1 未开放）

- 新 tuple 与 work-unit 值按 D0 结果写入共享只读常量和 schema metadata；
- `budget-corpus-v1` 与 `tetris-opportunity-corpus-v1` 均确定、无透支；
- Node `--select` 继续使用 140 ms 选择线，`--verify-frozen` 三 block 继续使用 160 ms 验证线；
- 冻结值优先 3584，只有较低值无合格 tuple 时才取不超过 4608 的最小合格值；
- calibration 是独立只读 gate，不是 training、bench、paired 或 browser acceptance；
- 后续单独授权的普通 browser p95 必须 `<=200 ms`，失败时不得运行时降级。

### 11.4 Signal gate（与 B1 独立）

先由用户在 fresh process/lock/artifact 检查后亲自运行一代独立空目录 smoke。该代只验证：

- worker、checkpoint/log、schema、search metadata 和 archive 边界；
- generation wall time、错误、survival、Hold、完成深度、unit 与 T4 诊断；
- smoke 目录之外 artifacts 和 published weights 不变。

一代 smoke 不是策略信号通过。随后另行授权的信号短跑只有在 cap 已达到 2000 后，连续两个完整 generations 同时满足才通过：

- 十个 elite 中至少 5 个 candidate 的 T4 share `>0`；
- elite T4 中位数 `>=0.01`，即至少 1%；
- best T4 `>=0.01`；
- elite 的所有对局达到 piece cap；
- depth 3/4 完成率、strategy-slot retained rate 与 budget exhaustion 完整记录；
- 没有 worker error、partial generation 或 artifact 越界。

单个 best 的高 T4 不构成通过。任一相邻两代未通过即停止，不靠增加 generations、piece cap 或 budget 绕过。

### 11.5 Fixed reevaluation gate（与 B1 独立）

- 使用同一 immutable baseline、30 个 fixed seeds、5000 cap 和完全相同搜索配置；
- pool 中每个唯一向量单独记录结果和 qualification；
- 最终 candidate 严格通过 `> baseline + 0.1% tolerance` score gate；
- `tetrisLineShare >= 0.20`；
- candidate 30/30 达到 cap，或不低于 baseline；
- 只有 qualified candidate 才能写 run-local `candidate-weights.json`；
- fixed reevaluation 不是 paired 证据。

### 11.6 Paired gate（与 B1 独立）

- 另行授权，使用独立整数 seed，不复用 training 或 fixed-reevaluation seeds；
- baseline 与 candidate 使用相同逐局 seeds、search contract、beam tuple、budget、Hold、bag probability 和 5000 cap；
- candidate 30/30 达到 cap；
- paired score-rate difference 的 95% CI 下界 `>0`；
- paired T4-share difference 的 95% CI 下界 `>0`；
- paired 不修改 candidate、published weights 或 run artifacts。

### 11.7 Publication gate（与 B1 独立）

- 仅允许发布通过 paired gate 的同一 candidate 身份；发布前后记录 candidate 与目标权重文件的内容身份和 metadata；
- runtime 与 bundled 权重必须来自该 candidate，不得重新训练、手改或换向量；
- publication 需要独立授权，不隐含 commit 或 push；
- push 与 browser/runtime acceptance 仍是独立后续门；
- browser/runtime acceptance 必须确认实际加载来源、搜索配置、Hold、动作行为和 p95，不能用 build 或 Node calibration 代替。

## 12. 错误处理与 fail-closed 条件

- A+ D0 到 4608 仍无合格配置，已阻塞；不得重新分类为 PASS、扩大搜索、提高预算或弱化门；
- B1 placement-pair corpus 非法、标签缺失、公开信息边界不明、结果不确定或 witness 不唯一可复现时 representation gate 失败；
- B1 失败后不实现、不训练、不加预算、不加 T4 bonus，也不自动转入 C；
- targetWellColumn 非法、未进入 cache key、跨无关分支泄漏或跨真实决策持久化时失败；
- strategy slot 改写 heuristic、chance probability 或 survival order 时失败；
- archive 来源、向量维度、generation/candidate index、score/T4/survival 证据不完整时拒绝 checkpoint/log；
- fixed pool 任一 entry 使用不同 seeds/config 时整次 reevaluation 失败，不写日志、checkpoint 或 candidate；
- objective/schema/search/corpus/beam/budget/cache metadata 缺失、多余或不一致时，在创建 worker和写 artifact 前失败；
- 任何训练前发现进程、repository lock、非空 output dir、artifact 漂移或 published weight 漂移时停止并请操作员裁决。

## 13. 设计完成定义与下一步边界

本规格完成的判定仅为：

- postmortem 已区分事实、判断与未知因果；
- A+ 的 D0 已执行并 fail-closed，A+ Phase B 与 v6/schema7/v3 标识不成立；
- 用户已选择 B1 feature-first；第 14 节冻结 representation gate、特征语义、算力边界和独立后续 gates；
- C 仍是未采用的远期备选，不能由实施者自动选择；
- 公平性、Hold、七袋概率、survival、shared logic 与 artifact 不变量保持；
- 无训练、benchmark、paired、candidate、publication、push 或 runtime 结果被宣称。

用户已批准本规格中的 B1 方向，但本阶段只完成设计记录。本任务在规格与 continuity checkpoint 更新后停止；不在本阶段调用 `writing-plans`，也不修改代码。

## 14. B1 feature-first 设计（当前批准）

### 14.1 目的与因果假设

A+ D0 的事实是：25/25 配置都能产生完整结果，且没有 diagnostic error 或 unit 透支，但三套权重在全部配置中均不能满足策略 depth 3/4 gate。这否证了批准范围内“只靠窄 beam、策略槽和不超过 4608 units 的 horizon-first 结构就能形成所需信号”，不证明无限预算可行，也不证明 CEM 是唯一根因。

B1 检验更窄的命题：在保持 v5 搜索图、score-rate fitness 和公开信息边界不变时，当前 13 维 afterstate 表达是否缺少“相对于落块前目标井的保留/改善”以及“未来公开 I 可达性”信息。只有新 17 维能在真实合法 placement pairs 上线性区分保井/毁井，并保持安全控制，才值得进入实施与训练设计。

### 14.2 保持 v5 的 reuse 映射

B1 原样复用：

- `score-rate-v5` 的 scalar fitness：`meanScore / scheduled maxPieces`；
- depth 4、root/child beams 64/32、`maxWorkUnits=3584`、`budget-corpus-v1`；
- 标准 Hold、精确七袋概率、引擎 SRS placement、survival-first value order；
- 当前 placement enumeration、work ledger、transactional completed-depth、cache 上限与确定性 tie-break；
- 浏览器、simulator、训练与复评共用 `src/ai` 纯逻辑；
- 当前 13 个 `FEATURE_NAMES` 的值、语义和顺序。

B1 不复用 A+ 的 score/strategy slots、同井 search intent、预算阶梯、`score-rate-v6`、schema 7 或 `bag-expectimax-hold-v3` 标识。A+ Phase A WIP 是历史诊断实现，不因本设计被视为 B1 production code。

### 14.3 must add：四个 append-only 候选特征

当前 13 项之后只能按以下顺序追加四项：

```text
targetLaneUsableDepthDelta
targetLaneSetupProgressDelta
targetLaneReadyRowsDelta
futureIAccessProbability
```

一次 placement evaluation 先从 placement 前 `boardBefore` 调用 `summarizeTetrisWell(boardBefore)`，得到 canonical pre-lane。若 pre-lane 没有有意义的建井机会，即 `usableDepth == 0 && setupCells == 0 && readyRows == 0`，则前三个 delta 均为零；不得从 afterstate 换列制造正增益。

若 pre-lane 有意义，placement 后必须用同一 pre-lane column 调用 column-specific summary，并计算：

```text
targetLaneUsableDepthDelta = clamp((after.usableDepth - before.usableDepth) / 4, -1, 1)
targetLaneSetupProgressDelta = clamp((after.setupCells - before.setupCells) / 36, -1, 1)
targetLaneReadyRowsDelta = clamp((after.readyRows - before.readyRows) / 4, -1, 1)
```

固定上界 4、36、4 来自四行 I-band 的最大 usable depth、四行乘九个井外单元、四个 ready rows。归一化后每项必须位于 `[-1,1]`。前三项只表达相对 placement 前同一 canonical lane 的变化，不携带跨真实决策的 intent。

`futureIAccessProbability` 位于 `[0,1]`，只使用 placement 后公开可见的 next、Hold 和 unseen-bag mask，计算在下一次公开机会中可合法取得 I 的精确概率：

- 若下一块已是 I，则概率为 1；
- 若当前公开 Hold 槽已有 I 且下一回合按标准 Hold 语义可使用，则概率为 1；
- 否则按现有 unseen-mask 相等概率语义计算 I 在下一次 chance 中出现的概率；空 mask 代表完整新七袋，概率为 `1/7`；
- 同一可达事件去重，概率不得超过 1；
- 不读取隐藏 bag order、bag index、seed 或 RNG，不递归展开更深 expectimax。

该概率的精确调用时点、空 Hold 时 next/抽块先后和同一 I 事件的去重属于 must clarify，必须在未来实施计划前用现有 Hold/七袋状态机逐例冻结；在此之前不得自行选择另一种概率定义。

所有四个值只在一次 placement evaluation 内存在；它们不进入真实游戏状态、模块级可变状态或跨回合缓存。缓存若保存 feature/result，identity 必须覆盖这些特征依赖的全部公开输入。

### 14.4 禁止的数据与标签泄漏

- corpus 的 `positive/negative` 标签、state id、pair id 和人工策略类别只用于 representation gate，不得进入 feature vector、runtime state 或 CEM fitness；
- 不得把 seed、RNG、隐藏袋序、精确 bag index、训练 candidate 身份或 secret runtime state 编码为特征；
- corpus state 必须只由公开 board/current/next/hold/holdAvailable/unseenBagMask 与真实 SRS placement 枚举生成；
- placement pair 的正负项必须都在同一公开 pre-state 中合法，且不能通过不同 seed、不同 current piece 或不同 budget 制造差异；
- safety pair 只能标注明确的 survival-preserving placement 为正项，不能为了策略多样性容许已知更差 survival。

### 14.5 representation gate：最短可否证实验

使用现有 32-state corpus 的真实 placement pairs，但 pair 标签独立于任何权重：

- 24 个 strategy states：每个至少一个 `preserve-well` 或 `complete-tetris` 正项，对至少一个 `destroy-well` 或低阶破坏负项；
- 8 个 safety states：每个稳定 survival placement 为正项，冒险建井 placement 为负项；
- 每个状态至少形成一个合法正负 pair；无合法 pair 的状态计为 gate 失败，不能静默丢弃。

对每个 pair 计算 `positiveFeatures - negativeFeatures`。使用确定性、无随机依赖的线性 margin feasibility，寻找一个 witness `w`，使目标 pair 满足 `w · delta >= margin`。固定 margin、权重范数约束、求解顺序、浮点容差和稳定 tie-break 必须在未来实施计划中唯一化；重复提取必须产生逐值相同的特征、pair 顺序、witness 和判定。

representation gate 同时满足才通过：

1. 32/32 状态均存在至少一个合法正负 pair；
2. 8/8 safety states 全部正确，不能用策略准确率抵消 safety regression；
3. strategy states 至少 22/24 正确；
4. leave-one-state-out 的 strategy 泛化率不低于 90%，每一折都不得出现 safety regression；
5. B1 的 17 维相较旧 13 维至少多解决 4 个 strategy state；比较必须使用同一 pairs、margin、范数约束、求解器和折分；
6. 重复 extraction、pair construction、求解与 witness 序列完全确定。

gate 的 stdout/报告只记录版本化 state/pair id、特征差、witness、margin、逐状态判定与汇总；不得写 run artifacts、candidate weights 或 published weights。witness 只是表达能力证据，不自动成为 CEM `mu`、初始化权重或待发布 candidate。

任一条件失败即停止 B1：不实现 production feature contract、不训练、不增加搜索预算、不加入 T4 bonus、不修改 CEM，也不自动切换到 C。

### 14.6 representation 通过后的 must clarify

representation PASS 只允许提出下一份实施计划，不能直接写代码或运行训练。实施计划前必须明确：

- 第 14.3 节 `futureIAccessProbability` 在空 Hold、非空 Hold、next=I、mask 含 I、换袋边界下的精确 truth table；
- 新 objective 名、checkpoint/weight schema、search contract 名与独立空 output dir；不得复用 A+ 的 v6/schema7/v3；
- 17 维归一化、旧 13 维兼容加载只在内存扩展的规则，以及旧 schema 的拒绝/迁移边界；
- placement/cache API 如何显式接收 `boardBefore` 与公开 I-access 输入，同时不建立第二套 training-only 实现；
- representation witness 是否仅作为测试证据；默认不用于 CEM 初始化，若要使用必须另行设计批准；
- 新 artifact metadata 中 representation corpus id、feature order、搜索合同和 fixed-pool provenance 的 exact-key 规则。

### 14.7 B1 的独立验收门

各门相互独立，PASS 不授权执行下一门：

| 门 | PASS 标准 | FAIL / 边界 |
| --- | --- | --- |
| Representation gate | 第 14.5 节六项全部满足，17 维比 13 维净增至少 4 个 strategy states，8/8 safety，无随机性，复跑 witness 完全一致 | 停止；不进入 implementation plan、production code 或训练 |
| Code gate | 现有 13 项逐值与顺序不变；四项顺序/范围/同 lane delta/truth table 单测通过；公开信息、SRS、Hold、七袋、survival-first、cache identity、fitness 不变回归通过；focused/full tracked tests、lint、build、train typecheck、`git diff --check` fresh 通过；独立 whole-change review 无未处理 Critical/Important | 不运行 calibration、training、bench、paired、publication 或 runtime acceptance；受保护 probes 永远不进入命令 |
| Signal gate | 用户另行授权并在 fresh process/lock/artifact 检查后使用独立空目录；先一代 artifact smoke，再在 cap=2000 的连续两个完整 generations 中同时满足：elite 至少 5/10 T4>0、elite T4 median>=1%、best T4>=1%、elite 全部存活到 cap、诊断完整且无越界 | 单个 best 高 T4 不算；任一相邻两代失败即停，不加 generations、piece cap、budget 或 T4 fitness |
| Fixed reevaluation gate | 同一 immutable baseline、30 fixed seeds、5000 cap、同一搜索/feature 合同；最多三个唯一向量 `normalize(mu)`、score champion、strategy champion；每个 entry 单独裁决；最终 candidate score 严格高于 baseline+0.1% tolerance、T4 share>=20%、survival 不低于 baseline | pool 向量去重；任一配置/seed 不一致整门失败；只有 qualified candidate 可写 run-local candidate |
| Paired gate | 另行授权；独立整数 seeds、逐局配对、相同搜索/feature/Hold/七袋/5000 cap；candidate 30/30 存活；paired score-rate 与 T4-share difference 的 95% CI 下界均 `>0` | 不复用 training/fixed seeds；paired 不修改 candidate、published weights 或 run artifacts |
| Publication gate | 另行授权；发布身份与 paired PASS candidate 完全相同；发布前后内容身份和 metadata 一致；bundled/runtime 均来自该 candidate | publication 不隐含 commit、push 或 browser/runtime acceptance；任何身份漂移即失败 |

固定复评 pool 的两个 champion 定义沿用第 7.2 节：archive 只影响代表向量复评，不进入 CEM scalar fitness。B1 合同未冻结前，不得把第 7.2 节历史 schema 7 字样用于新 artifact。

### 14.8 推荐、代价与风险

推荐 B1，而不是重新扩大 A+ 搜索或直接转 Pareto CEM。理由是它以最小诊断先验证当前关键未知项：公开状态是否包含可由线性 heuristic 使用的稳定保井信号。它保持 v5 的得分目标、公平性和搜索预算，最短实验可在任何训练前否证，避免再次投入约 19.53 小时的十代成本。

主要代价是 placement evaluation 需要 `boardBefore` 与公开 next/Hold/bag 信息，feature/cache 接口会变宽；17 维 CEM 的样本效率也可能低于 13 维。主要风险有三类：canonical pre-lane 在相邻动作间跳列；`futureIAccessProbability` 与现有 chance/Hold 语义不一致；corpus pairs 对人工状态过拟合。相同 lane delta、truth table、LOSO、8/8 safety 和 17-vs-13 净增门分别针对这些风险，仍不能替代后续独立 signal、fixed、paired 与 publication 证据。

## 附录 A：continuity 的 protected selectors

continuity helper 默认会为所有 dirty paths 生成内容证据。任何包含以下未跟踪文件的 workspace snapshot 都必须在 helper 进程内排除这些 selectors，只允许普通 `git status` 确认其路径状态；不得读取或哈希其内容：

```gitignore
/training/searchProbe.ts
/training/searchProbeWorker.ts
/training/searchProbe.test.ts
```
