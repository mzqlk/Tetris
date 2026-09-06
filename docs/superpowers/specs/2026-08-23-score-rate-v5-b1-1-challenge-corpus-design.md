# score-rate-v5 B1.1 challenge corpus design

**日期：** 2026-08-23  
**状态：** 用户已批准设计方向；本文只冻结 B1.1 的诊断设计，不授权实现、训练、benchmark、paired、发布或 runtime acceptance。

## 1. 背景与诊断结论

B1 representation diagnostic 已在 fresh process/lock/artifact/weight refresh 后执行一次，结果为 fail-closed：

| 指标 | old13 | new17 |
| --- | ---: | ---: |
| strategy correct | 24/24 | 24/24 |
| safety correct | 8/8 | 8/8 |
| leave-one-state-out strategy rate | 95.8333% | 100% |
| safety regressions | 0 | 0 |

两次运行 deterministic，唯一 failure reason 为 `strategy-gain-below-4`。因此可以确认：四个追加特征在当前 24 个 strategy pairs 上没有达到至少 4 个 strategy-state 的净增；不能据此确认四个特征在更有区分度的公开状态上完全无效，因为 old13 在当前 corpus 已经饱和为 24/24。

B1.1 的目的不是放宽 gate，也不是重写旧标签，而是建立第二个预注册、独立、公开的 challenge corpus，先验证旧表示是否真的被挑战，再在同一 solver/protocol 下重新测量 new17 的增益。

## 2. 目标与非目标

### 目标

- 保留现有 `b1-placement-pair-corpus-v1` 原样，新增独立版本化 challenge corpus；
- 让 old13 有真实的错误或边界案例，避免 `24/24` 饱和掩盖表示差异；
- 保持 pair 标签独立于任何候选特征、权重、CEM 结果和训练日志；
- 使用与 B1 完全相同的特征提取、margin solver、LOSO、safety 和 deterministic protocol；
- 以最短、低算力的只读诊断否证“公开机会特征是否有可泛化的策略增益”。

### 非目标

- 不修改 active v5 的 13 个 `FEATURE_NAMES`、score-rate fitness、CEM、search contract、schema 6 或 weights；
- 不把 challenge 标签、旧表示错误、T4 share 或任何人工奖励注入 feature vector 或 fitness；
- 不增加 search budget，不运行训练，不创建 schema 7/v6/v3 artifacts；
- 不自动切换到 constrained/Pareto CEM；那是独立的后续设计决策。

## 3. 推荐方案：独立 challenge corpus

### 3.1 Corpus 形状

建立新的 `b1-1-challenge-corpus-v1`，包含 32 个全新的 public states：

- 24 个 strategy states，分为三组，每组 8 个：
  - lane-preservation：同一目标列的可用深度、setup 进度或 ready rows 处于临界边界；
  - completion-versus-lower-order：可兑现四消的 placement 与即时单/双消 placement 共享同一 pre-state；
  - public I-access/Hold：current、next、Hold 和 unseen mask 的公开组合改变兑现机会，但不暴露隐藏 bag 顺序；
- 8 个 safety controls：高堆或近期 top-out 风险下，策略正项必须保持 survival，负项必须是可审查的 risky-survival placement。

每个 state 至少有一个人工审阅的合法 positive/negative placement pair。正负 placement 必须来自同一个公开 pre-state、同一 current piece、同一 next/Hold/unseen mask，并通过真实 SRS placement enumeration 和 shared `lockPlacement` 物化。

### 3.2 预注册与防止后验挑选

challenge state 的 board、公开字段、placement cell keys 和正负类别必须在运行 solver 前冻结。状态选择依据只允许使用结构性规则和人工审阅：目标井临界性、四消完成关系、公开 I-access 分支和 survival 风险。

不得使用以下信息反向挑选或修改 pair：

- old13/new17 的 solver accuracy、margin 或 witness；
- 当前 gen-10 训练日志、candidate 向量、T4 share 或固定复评分数；
- seed、RNG、隐藏 bag、bag index 或运行时生成顺序。

冻结后先测量 old13。challenge-validity gate 要求 old13 strategy accuracy 不高于 `20/24`；若 old13 仍为 `21/24` 或更高，则 corpus 没有提供足够的可证伪空间，结果标记为 `challenge-inconclusive`，不得改标签、放宽 B1 门或宣称特征失败/通过。

### 3.3 表示判定

challenge corpus 使用 B1 相同的 scale、margin、L2 norm cap、更新顺序、exclusion enumeration、LOSO folds、safety 保留和序列化协议。通过条件为：

1. 32/32 state 都有合法正负 pair；
2. challenge-validity gate：old13 strategy `<=20/24`；
3. new17 strategy `>=22/24`；
4. `new17 - old13 >= 4`；
5. new17 safety `8/8`；
6. new17 LOSO strategy rate `>=0.90`，每一折 safety regression 为 0；
7. repeated extraction、pair order、witness 和 result digest 完全一致。

`challenge-inconclusive`、solver error、非法 placement、safety regression、NaN/Infinity、非确定性或任一阈值失败都 fail-closed。不得把 challenge corpus 的结果与旧 B1 corpus 合并后平均，也不得用两个 corpus 中较好的一个掩盖另一个失败。

## 4. 复用 / 必须新增 / 必须澄清

| 类别 | 内容 |
| --- | --- |
| reuse | `extractFeatures` 的旧 13 维顺序；B1 四个候选特征；SRS placement enumeration；shared `lockPlacement`；公开 `PublicSearchState`；Hold、精确七袋概率、survival-first；margin/LOSO/safety/deterministic gate；stdout-only 输出 |
| must add | 新 corpus id 与 32 个全新 literal public states；24/8 分层 descriptor；challenge-validity 统计；独立 materialization 测试；人工 pair-label review package；旧 corpus 与 challenge corpus 的分开报告 |
| must clarify | 三组 strategy 每组的确切 state 数和结构覆盖清单；临界 lane 的可复现定义；I-access truth-table 的最终空 Hold/next/mask 顺序；challenge corpus 是否需要第二套 safety controls；production integration 前的 17 维归一化与 schema 命名 |

这些 must-clarify 项在 implementation plan 前冻结；不得由实施者在代码中自行决定。

## 5. 不变量

以下内容在 B1.1 全部阶段保持不变：

- v5 `FEATURE_NAMES` 精确 13 项及顺序；B1 特征只作为诊断候选，不接入生产权重；
- `score-rate-v5`、schema 6、`bag-expectimax-hold-v2`、depth 4、root/child beams 64/32、`maxWorkUnits=3584`、`budget-corpus-v1`；
- scalar fitness 精确为 `meanScore / scheduled maxPieces`；T4、pair label、margin、LOSO、challenge-validity 不进入 fitness/CEM；
- 标准 Hold、精确七袋、公开 unseen mask、SRS 行为和 survival-first value order；
- board rows 不原地修改，浏览器与 Node 继续复用同一 `src/ai` 纯逻辑；
- challenge gate 只输出 stdout，不写 `public/ai`、`training-archive`、checkpoint、training log、weights 或 published files；
- protected probes 只能通过普通 `git status` 确认路径状态，不得读取、执行、哈希、修改、移动、删除、暂存或提交；
- 当前 gen-10 artifacts、published weights、TEMP locks 原地保留，不删除、不移动、不归档。

## 6. 方案比较

### 方案 A：B1.1 challenge corpus（推荐）

代价最低，直接回答“旧表示是否因 corpus 饱和而看不出增益”。它不改变 CEM 语义，诊断可在秒到分钟级完成。主要风险是人工结构标签仍可能遗漏真实游戏分布；challenge-validity gate 和独立 pair review 用于限制该风险。

### 方案 B：重新标注现有 B1 pairs

不推荐。它可能很快改善 old13 的错误率，但会把当前已审阅的 corpus 历史标签混入新的目标，难以区分真实表示能力与标签重写效果，也破坏旧结果的可追溯性。

### 方案 C：直接进入 constrained/Pareto CEM

不推荐作为当前下一步。它更直接触及 score-rate 与四消资格门错位，但会改变 CEM 选择分布、archive 和训练解释，算力与回归面显著扩大；在没有先证明 representation corpus 能表达目标行为前，无法区分“特征不足”和“选择机制不足”。

## 7. 最短可否证实验与成本

最短实验是一次只读 challenge diagnostic：物化 32 个 public states，运行 old13/new17 同协议 solver，重复运行并比较 digest。预期不写任何 artifact，也不启动 worker pool。

主要成本为人工构造与独立审阅 32 个 state/pair；运行成本远低于一次 generation，预计为秒到分钟级。若 challenge-validity 不成立，实验立即判为 `challenge-inconclusive`，不继续求解或扩大 corpus。

## 8. 独立验收门

| 门 | 独立 PASS 标准 | 失败后的边界 |
| --- | --- | --- |
| Corpus code gate | literal states、descriptor schema、shared SRS/lock materialization、public-only 校验、确定性测试通过；未改 v5/CEM/artifacts | 修复或停止；不运行诊断 |
| Corpus review gate | 每个 positive/negative pair 均由独立 reviewer 依据 pre-state、SRS、post-clear 和 survival 复核；无 Critical/Important | 只改 descriptor/test；不得改 solver 阈值 |
| Challenge diagnostic gate | old13 `<=20/24`、new17 `>=22/24`、净增 `>=4`、safety `8/8`、LOSO `>=0.90`、deterministic；输出单行 stdout-only JSON | `challenge-inconclusive` 或 fail-closed；不进入 production/CEM/训练 |
| Production design gate | 仅在 challenge diagnostic PASS 后提出新的 production feature/schema/search integration spec，并重新获得用户批准 | 不写 implementation plan，不改 active v5 |
| Training/signal/fixed/paired/publication gates | 仍分别需要独立授权和各自 fresh evidence；沿用现有公平性、survival、artifact 和 seed 不变量 | 任一失败即停止，不自动改变方案 |

## 9. 后续决策点

- 若 challenge corpus `challenge-inconclusive`：B1.1 不能证明特征能力，停止并由用户选择扩大结构覆盖或转向 C；不得后验挑选 pairs。
- 若 old13 被挑战但 new17 仍无 `+4`：B1 representation 假设被否证，下一设计应比较 constrained/Pareto CEM 或不同特征族；不得继续堆 budget。
- 若 challenge diagnostic PASS：只允许写 production integration design；不自动把 17 维写入 active v5，不创建 schema 7/v6/v3 artifact。

## 10. 终止状态

本文完成 B1.1 的设计记录即停止。实现授权、implementation plan、diagnostic execution、training、benchmark、paired、publication、push 和 runtime acceptance 均为独立后续门。
