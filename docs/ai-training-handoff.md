# Tetris AI 训练系统 — 交接文档

**写于**：2026-07-28；**更新于**：2026-09-12（手调候选 T2 通过独立 paired 验收并已发布；已发布模型由 `score-rate-v2` gen-40 换为 `score-rate-v5` 手调 T2，本项目首次越过 20% 四消门）
**当前状态的读取方式**：每次先运行 `git status` / `git log`，检查 `public/ai/` 产物与训练进程，再决定操作。旧 HEAD、未推送状态和固定测试数都只是历史快照，不是本交接的持久指令。
**验证**：分别运行当前 `npm test`、`npm run lint`、`npm run build` 与 `npm run typecheck:train`；以实际输出为准。
**当前 score-rate-v5 设计**：[`2026-08-14 bag-aware deterministic budget search design`](superpowers/specs/2026-08-14-bag-aware-deterministic-budget-search-design.md)
**历史 score-rate-v4 设计**：[`2026-08-12 bag-aware search design`](superpowers/specs/2026-08-12-bag-aware-tetris-search-design.md)
**历史 score-rate-v3 设计**：[`2026-08-11 score-rate-v3 design`](superpowers/specs/2026-08-11-score-rate-v3-tetris-strategy-design.md)
**历史 score-rate-v2 设计与实施计划**：[`2026-08-06 design`](superpowers/specs/2026-08-06-ai-hard-drop-and-tetris-strategy-design.md) / [`AI hard-drop plan`](superpowers/plans/2026-08-06-ai-hard-drop-execution.md) / [`score-rate-v2 plan`](superpowers/plans/2026-08-06-score-rate-v2-tetris-strategy.md)
**score-rate-v1 历史目标设计与计划**：[`2026-07-30 design`](superpowers/specs/2026-07-30-fixed-schedule-score-rate-design.md) / [`2026-07-30 plan`](superpowers/plans/2026-07-30-fixed-schedule-score-rate.md)
**复评证据设计与计划**：[`2026-08-02 design`](superpowers/specs/2026-08-02-score-rate-reevaluation-observability-design.md) / [`2026-08-02 plan`](superpowers/plans/2026-08-02-score-rate-reevaluation-observability.md)
**原始训练系统设计**：[`2026-07-27 design`](superpowers/specs/2026-07-27-tetris-ai-training-design.md) / [`2026-07-27 plan`](superpowers/plans/2026-07-27-tetris-ai-training.md)；其中目标函数与产物路径部分是历史设计，不代表当前状态。

---

## 1. 一句话现状

### 当前 score-rate-v5 代码门

当前实现契约为 **`score-rate-v5` / schema 6 / `bag-expectimax-hold-v2`**。搜索仅使用公开局面信息，采用标准 Hold、精确 bag chance、depth 4、beams 64/32、冻结 `maxWorkUnits = 3584` 与 `budget-corpus-v1`；fitness 仍严格为 `meanScore / scheduled maxPieces`。默认训练日志路径为 `public/ai/score-rate-v5/training-log.jsonl`。

已发布模型于 2026-09-12 更新为 **version 6、`score-rate-v5`、手调 T2**（`gen: -1`，非训练产物），依据是独立 paired 验收四项全过；`score-rate-v2` gen-40 就此成为历史基线。详见下面的「2026-09-12 发布」一节。历史训练产物（`score-rate-v1`~`v5` 目录、D2 冻结源）保持原地未修改。

代码与训练器的当前契约是 **`score-rate-v5`**：checkpoint schema version 6、`FEATURE_NAMES` 为精确 13 维且顺序不变。搜索契约为 `bag-expectimax-hold-v2`，只使用公开局面信息，采用标准 Hold、精确 bag chance、depth 4、beams 64/32、冻结预算 3584 与 `budget-corpus-v1`；仍在固定 piece schedule 下以

```
fitness = meanScore / maxPieces
```

选择候选。分母是调度给每局的 `maxPieces`，不是候选实际存活的 pieces；提前死亡不会因为分母变小而得到虚高分。`lineClearValue` 继续表达引擎真实的非线性消行价值，三个新增特征连续表达干净四消井的深度、准备进度和完整行数。1/2/3/4 消直方图、四消消行占比、策略诊断、搜索诊断与存活诊断都不进入 fitness、精英排序或 CEM 分布更新。

当前 tracked bundled 权重和 runtime 已发布权重是 **version 6、`score-rate-v5` 的手调 T2 模型**。2026-09-12 发布后现场核验，`src/ai/trained-weights.json` 与 `public/ai/best-weights.json` 的 SHA-256 均为 `B5D8E76DFE9D907260DE8B1B7AF7B9A9CE4760193B17053E0943EAC684B250B2`，与候选源文件逐字节相同；上一版 gen-40 十维模型的哈希是 `062552496E7E1101502E62B8570DFDAF2A60B54EF4FEF1EA539723B910550D90`。**注意 `core.autocrlf=true`**：git 里存的 blob 是 LF，全新 checkout 出来的工作副本会变成 CRLF，那时字节哈希与上面对不上——跨 checkout 核验请用 `git show HEAD:<path> | sha256sum`。加载旧十维文件时代码仅在内存中对三个尾维补 `0`，旧九维文件还会同时补 `lineClearValue = 0`，都不改写原文件。version 1–5 checkpoint/log（包括历史 v4 产物）不是 score-rate-v5 schema 6 可恢复或可追加产物。

（历史，已被取代）2026-09-06 那次是**代码-only handoff**：没有运行训练、benchmark 或 paired benchmark，没有产出 candidate，也没有发布。`bench:paired` CLI 当时已实现但未运行。这段话在 2026-09-12 起不再描述现状——paired 验收已跑完、模型已发布，见下一节。

### 2026-09-12 发布：手调 T2，首次通过四消门

**已发布模型现为手调候选 T2**（源文件 `public/ai/handtuned-tetris-T2-20260911/candidate-weights.json`，SHA-256 `B5D8E76DFE9D907260DE8B1B7AF7B9A9CE4760193B17053E0943EAC684B250B2`）。它**不是训练产物**：`gen: -1` 是诚实标记，权重由人手调出，CEM 未参与。

#### 为什么是手调而不是训练

2026-09-06~10 的 CEM 训练（gen 12→40，约 90 小时，12 workers）四消占比只有 **0.027%**、scoreRate 676.41，被 20% 四消门挡下。2026-09-11 的 spike 定位了原因：**不是搜索深度、不是特征、不是 fitness，是 CEM 卡在局部最优**。奖励是阶跃的——井挖到 1/2/3 层不给钱，只有满 4 层再等到 I 才付款，中间全是堆高与风险成本，高斯采样跨不过这道山谷。手调 20 分钟就到 31.87%。

关键构造：`lineClearValue` 把 n 行映射到 `[1,3,5,8]`，所以 `w_linesCleared·n + w_lineClearValue·value(n)` 取 `(-1,+1)` 得 `{0,+1,+2,+4}`——单/双/三消不亏也不赚、四消独赚；再配强正的 `cleanWellDepth`/`tetrisSetupProgress`/`tetrisReadyRows` 与强负的 `holes`。取 `(-2,+1)`（`{-1,-1,-1,0}`，即"不到四消就别消"）的 T1 更教条，均值更低且遇到不配合的序列会掉到 10.83%。**"偏好但不禁止"优于"只等四消"。**

#### 独立 paired 验收（唯一的验收依据）

`seed 20260911`，与全部 500 个历史 seed（训练 gen 0-9、固定复评、历史 paired `20260803`、C0 `20260824`、D1 的 40 behavior + 320 label）以及调参用的 `20260910` 派生集合**零交集**。30 局 × 5000 手 × 2 个权重，`training/pairedBench.ts` 单线程串行，约 33 小时，由操作者执行。完整输出存于 `public/ai/handtuned-tetris-T2-20260911/paired-20260911.txt`；`public/ai/` 已 gitignore，所以 git 里的证据只有这份文档。

| 门 | 判定 | 实测 |
| --- | --- | --- |
| `scoreQualified` | ✓ | 配对 scoreRate 差 95% 区间 `[+262.675, +267.877]`，均值 `+265.276` |
| `tetrisQualified` | ✓ | 候选合计四消占比 `32.03%`，门限 20% |
| `survivalQualified` | ✓ | 候选 30/30 pieceCap，基线 30/30 |
| `pairedTetrisQualified` | ✓ | 配对四消占比差区间 `[+0.31471, +0.32593]`，均值 `+0.32032` |

`accepted: true`。逐局 **30 胜 0 平 0 负**（两个指标都是）。基线四消占比是**精确的 0**：gen-40 在这 30 局共 150,000 个调度方块里一次四消都没打出来。从区间半宽反推，逐局 score-rate 差的样本标准差约 6.97，而均值 265.28。

跨种子复现：污染过的复评上 `900.27 − 636.02 = +264.25`，独立种子上 `+265.28`，差 0.4%。

#### 浏览器/runtime 验收（2026-09-12，已通过）

`npm run build` 后 `vite preview` 起 `dist/`，用 Playwright 驱动真实 Chrome（headless）跑 90 秒 instant 自动游玩：

- `/ai/best-weights.json` 返回 200，`dist/ai/best-weights.json` 哈希与已发布文件相同；控制台**没有** `[ai] … failed validation — falling back to built-in weights`。这条必须显式确认：`parseWeightsFile` 返回 `null` 时 `weights.ts` 会**静默**回退到 `HANDCRAFTED_WEIGHTS`，界面不会报错。
- Weights 选择器停在 `runtime` 档（`usingRuntime === true`），说明驱动 AI 的确实是 fetch 来的发布文件而不是打包副本。
- 说明文字显示 `runtime · hand-tuned · 1996 lines · height 5.4`。
- 90 秒内消行 183 行 / 89 次消行事件，用页面内采样器按 `Δlines` 统计：单 37、双 26、三 10、**四消 16**（校验：`37+52+30+64 = 183`，无并档）。**浏览器内四消占比 34.97%**，与离线的 31.87% / 32.03% 同量级。最终 295,286 分 / level 15。

唯一的控制台报错是 `/favicon.ico` 404——`index.html` 本来就没声明图标，`public/` 下只有 `ai/`。与本次发布无关，未处理。

#### 必须诚实携带的限制

- **T2 的"入选"曾用过固定复评种子。** 先在 800 手的其他种子上筛掉 T3，又用复评种子上的 4 局在 T1/T2 之间做选择。独立 paired 解毒的是"T2 够不够格"，**不是**"T2 是三个里最好的"。发布不需要最优，只需要合格且优于基线——但别把它讲成"最佳权重"。
- **只有一个种子族的 30 个 piece schedule。** 搜索是确定性的，区间衡量的是 schedule 间差异而非运行噪声；跨种子族泛化未测。以约 38 个标准差的效应量看，种子族敏感性不是可信的替代解释，但它确实没被测过。
- **基线是在当前 v5 契约（depth 4 / beams 64/32 / 预算 3584）下评的**，不是它原生的 `score-rate-v2` depth 2。这对"今天该发布什么"是正确口径，不等于 gen-40 在自己的训练契约下也这么差。
- 候选自带诊断显示 `completedDepthHistogram = [0, 17442, 189734, 0, 0]`、`budgetExhaustionRate = 1`：3584 预算下实际几乎只跑满 depth 2，从没到 3/4。**31.87% 是在这个前提下拿到的**——深度不是当前瓶颈。

#### 发布顺带改动

`src/ai/simulate.test.ts` 的 `keeps the bundled default model deterministic` 是钉打包模型身份的回归测试，随发布更新（做法与上次发布 `99a796a` 一致）：三个尾维守卫由 `toBe(0)` 改为新模型的实际值，`DEFAULT_WEIGHTS_META` 由 `{version: 3, score-rate-v2, gen: 40}` 改为 `{version: 6, score-rate-v5, gen: -1}`，三个 seed 的金标准结果重新实测写入。**这些期望值是从实现测出来的，不是独立推导的**；该测试的用途是钉确定性，不是证明策略正确。

`src/components/AiControls.tsx` 的模型来源标签也随发布修正。原逻辑会把 `gen: -1` 印成 `trained · gen -1`——正好抵消 `gen: -1` 这个诚实标记的用意——而回退分支的条件是 `gen > 0`，对 `-1` 为假，会落到 `bundled · handcrafted`，那是 Dellacherie 先验的标签而不是 T2。现在按 `gen < 0` 走 `hand-tuned`，并把运行时那一档的前缀与按钮由 `trained` 改为 `runtime`，与 `bundled` 成对。`weights.ts:188` 的 `integerAtLeast(d.gen, -1)` 本来就允许 `-1`，schema 侧无需改动。

#### 剩余天花板

消行数早已饱和（`meanLines = 1996.1`，理论上限 2000），唯一剩下的杠杆是每行单价。按 level-1 折算，T2 的消行得分 `311,026.67`，全四消天花板 `399,220`，即已吃到 **77.9%**。从 T2 播种再训 CEM 可作独立课题，但剩余空间只有约 22%，且会引入"成绩里多少是人类先验"的归因问题。

### 无预算 depth-4：已测量，不可行（2026-09-12）

**结论先行：不要再提"把冻结预算调大，好让 depth 4 真正跑满"。没有可达的目标。**

2026-08-14 的 `training/searchProbe*.ts`（与当天的 bag-aware budget 设计同一批产出）问的就是这个：无 work-unit 预算的 depth-4 定深搜索到底跑不跑得完、要多少时间和内存。它写完从没被跑过，也从没提交。2026-09-12 补跑，结论是**它按写法永远不可能通过**：

| 跑法 | 结果 |
| --- | --- |
| 原样（worker，512 MB old-gen 上限，30 s 超时） | 约 9 秒 V8 fatal，`Check failed: (location_) != nullptr` |
| 进程内重跑（4 GB 堆，无 worker、无上限） | 约 7 分钟、RSS 2958 MB，仍未算完，人工杀掉 |

两个数都是在**空盘开局**上测的——按 §5 的记载那是全局最便宜的局面，中后期堆高带井要贵几倍。所以这是**下界**。

让它无界而不只是慢的，是两件事叠加：`search.ts` 的 `legacyLimits` 给 `searchFixed` 的是
`maxWorkUnits = Number.MAX_SAFE_INTEGER`，等于没有预算；而接口上那个看起来像逃生口的
`shouldAbort` **在 `search.ts` 里从来没有被调用过**，搜索一旦开始就无法中断。

**因此要修正一个容易产生的误解。** `maxWorkUnits = 3584` 确实是
`training/calibrateSearchBudget.ts` 按延迟选出来的——`selectBudgetFromLadder` 从 1536 起
每步 +256 往上爬，取最坏 p95 ≤ 140 ms（`SELECTION_P95_LIMIT_MS`）里最大的那个，连续两次
超过 160 ms 就停。但**不能**由此推论"预算只是个人为的交互上限，拿掉就有真 depth 4"。
beams 64/32 × depth 4 × 精确 bag chance 的树是组合爆炸的：**work-unit 预算不是拧在一个
本来就能收敛的搜索上的限流阀，它就是让 depth 4 能够终止的那个机制。** 加预算只能买到更深
的**部分**搜索，成本线性上涨，不存在某个预算能让 depth 4 完成。

还没有被否定的是一个窄得多的问题：同样 beams 下，只给离线（训练/bench）更大的预算，
打得会不会更好。那是递减收益的问题，而且要付"浏览器和离线用不同预算 = 用浏览器付不起的
搜索去调模型"这个代价。若真要提升搜索强度，**杠杆更可能在 beams 而不是 work units**，
因为爆炸来自分支因子——但那同样是改冻结契约，要走自己的设计门。

三个探针文件已由 `05e4d2a` 提交进历史留档，随后删除：结论属于本文档，不属于一个跑不得的
脚本（`searchFixed` 挂着 `@deprecated Never import from production consumers or execute
in verification`）。`searchFixed` 本身保留——`src/ai/search.test.ts` 拿它当精确 oracle
校验有预算搜索，那是正当用法。探针退场后 `shouldAbort` 失去了唯一的存在理由（它只是为了
让受保护文件能编译），已一并删除。

### gen-40 固定复评证据（历史基线，2026-09-12 起不再是已发布模型）

- 固定复评：30 局 × 5000 pieces、depth 2、`fixed-reevaluation-v1` 种子策略；gen-40 `meanScore = 3,289,243.33`、`scoreRate = 657.8487`、`meanHeight = 4.07848`。
- 当时的 gen-20 已发布基线为 `meanScore = 3,104,830`、`scoreRate = 620.966`、`meanHeight = 3.35646`；gen-40 的固定复评 score rate 高约 5.61%，裁决为 `publish / higher-score`。
- gen-40 每局平均 singles/doubles/triples/tetrises 为 `1454.6 / 264.77 / 4.6 / 0.0333`，`tetrisLineShare = 0.00667%`。30 局共 150,000 个调度方块只产生 1 次四消；得分提升主要来自更多双消，**不能证明稳定四消策略已经出现**。
- 当前可审计 `benchmark-inputs` 只包含 v1/gen-20 基线，未找到 gen-40 相对 gen-20 的独立 paired benchmark。因而目前可以确认“gen-40 已发布且固定复评更高分”，不能把它扩写成“已完成独立配对验收”。

发布权重由提交 `99a796a feat(ai): publish gen-40 score-rate-v2 weights` 纳入 Git。该 SHA、哈希和产物内容是 2026-08-11 快照；接手时仍须现场核实。

### action-conditioned listwise 诊断：已完结，裁决 FAIL（2026-09-04）

**结论先行：不要采用 action24 表示，也不要按这个结果去重跑 D2。**

D2 分片诊断 `d2-a4b01fc869c486c1` 跑完 261/261 shard，裁决
`fail-joint-selection-not-shown`，`resultDigest`
`955f5ec9c89b41a8259dfa66b598616f8c641ef69959b8ff0d566d21460a1b62`。48 个
held-out subset 上，action24 的 `sumScore` 13,834,700 对 afterstate13 的
13,884,400（−0.36 %），`tetrisShare` 0.06097 对 0.06409（相对 −4.9 %），
front hits **打平 19:19**。

按设计 §10.3(a)，这个裁决**关闭 action-conditioned representation 假设**，且
预注册地禁止事后修改 placements / subsets / splits / features / lambda grid /
cardinality / thresholds 去追一个 PASS。

**但要按字面读，不要读过头。** 裁决名就是准确的概括：**not shown**，不是
"更差"。设计 §9 明确不宣称 p-value 或置信区间，而该门要求在 score 与
tetris share 上**严格**更优——真实差异为零的表示也会有约一半的概率过不了。
真正有信息量的一条是 19:19 那个平局：两个模型选出的 placement 基本相同，
多出来的 11 个 action-conditioned 特征很少改变决策，因此这次实验在任何方向上
都难以测出差异。

**七个门里有四个本来就无法判别**（这一点在裁决产生**之前**就已记录）：

- 两个 survival 门是饱和的。2,208 个 test label 里 2,203 个撑满 128 手，
  每个候选的 survival tuple 几乎都是 `(4, 128, 512)`，subset oracle 与它们相等。
  这两个门只能惩罚、无法奖励。
- 36/48 的 front-hit floor 够不到：两个表示都是 19，**任何结果都过不了这个门**。
- `+8` 的 gain 随之落空：从 19:19 出发需要 27 对 19。

**这就是本项目已经退役过一次的封顶问题**（见 §"历史根因：消行数封顶"），只是
上移了一层：那次是精英并列在 `0.4 × cap`，这次是候选并列在 `(4, 128, 512)`。
**抬 cap 同样无效**，理由与当年完全一致。

完整报告（含每个门的取值、post-flight 27 项、以及运行跨两个代码版本的说明）见
`.superpowers/sdd/2026-09-02-score-rate-v5-d2-sharded-held-out-listwise/final-report.md`。

诊断证据在 `diagnostics/d2-a4b01fc869c486c1/`（已 gitignore）。本次运行未创建
仓库 trainer lock，未生成 candidate，四个产物哈希与运行前逐字节相同。

### gen-20 发布依据（历史）

- 固定复评：30 局 × 5000 pieces、depth 2、固定复评种子策略；gen 20 候选 `meanScore = 3,104,830`、`scoreRate = 620.966`、`meanHeight = 3.35646`，相对当时已发布权重的 `scoreRate = 611.653`，裁决为 `publish / higher-score`。
- 独立 paired benchmark：使用新 seed `20260803`，旧已发布权重与 gen 20 各跑 30 局 × 5000 pieces、depth 2；两组都 30/30 达到 cap。旧权重 `scoreRate = 612.228`，gen 20 `621.272`；gen 20 逐局 30 胜、0 平、0 负，平均差 `+9.044 score/piece`，95% paired 区间 `[+7.813, +10.275]`。
- 因而“优于旧已发布权重”的结论来自独立同参数 paired 证据，**不是**由某代训练日志里的 `bestScoreRate` 推出。固定复评负责候选发布门，独立 paired benchmark 负责相对基线的验收，二者不能混为一谈。

gen-20 权重由提交 `ef3cbac feat(ai): publish gen-20 score-rate weights` 纳入 Git。该 SHA、测试数、ahead/push 状态都只是当时快照；它现在是 gen-40 的历史基线，不再是当前发布模型。

---

## 2. 代码地图

### `src/ai/` — AI 核心（纯函数，浏览器与 Node 共用同一份）

| 文件 | 作用 |
|---|---|
| `rng.ts` | `mulberry32(seed)` 确定性随机源；`hashSeed(...)` 派生种子 |
| `tetrisStrategy.ts` | 纯函数 `summarizeTetrisWell`；从同一个候选井提取可用深度、准备格与 ready rows |
| `features.ts` | `FEATURE_NAMES`（13 项，顺序即权重向量顺序）与 `extractFeatures`；在历史十维尾部追加三个四消井特征 |
| `weights.ts` | 权重对象 ↔ 向量、L2 归一化、权重文件校验、内置权重；读取旧九维/十维文件时仅在内存中尾随补零 |
| `trained-weights.json` | **模型本体**，已提交进 git，打包进构建 |
| `placements.ts` | BFS 落点枚举（走引擎的 `rotatePiece`，含 SRS 踢墙），按最终格子集合去重 |
| `replay.ts` | 按键序列的状态投影，网页回放与落点测试共用 |
| `search.ts` | active `searchIterative`：v2 公开 bag chance、标准 Hold、固定 depth 4、beams 64/32、预算 3584；`searchFixed` / `evalMove` / `bestPlacement` 是历史 compatibility helpers |
| `simulate.ts` | 无头对局：`createSimState` / `applyAction` / `simulateGame` |
| `loadWeights.ts` | **唯一的浏览器专用文件**（用 `fetch`），已在 `tsconfig.train.json` 里排除 |
| `testUtils.ts` | 测试用 ASCII 棋盘构造器 |

### `training/` — 训练器（仅 Node，可用 `node:` 导入）

| 文件 | 作用 |
|---|---|
| `config.ts` | 全部超参数。**改这里调训练** |
| `cem.ts` | CEM 纯数学：采样、精英更新、噪声、局长调度、score-rate `aggregateFitness` |
| `pool.ts` | worker 池，**任务粒度是「一局」而非「一个候选」** |
| `worker.ts` | worker 入口，只跑 `simulateGame` |
| `train.ts` | 主循环、共同随机数、日志、断点、复评、CLI；资格门通过后只写 run-local candidate |
| `bench.ts` | 用指定权重跑 N 局并报告成绩与吞吐 |
| `pairedBench.ts` | 对发布基线与 qualified candidate 使用同 seeds/depth/cap 做逐局 paired 统计；CLI 已实现但本次未运行 |

### 展示层

- `src/hooks/useAiPlayer.ts` — AI 托管，走和键盘完全相同的 store action，含自愈式重规划
- `src/components/AiControls.tsx` — 网页里的 AI 面板
- `training.html` + `src/training/dashboard/` — 训练面板（Vite 第二入口，四张手写 SVG 图）

### 产物（`public/ai/`，已 gitignore）

- `score-rate-v2-first-run-20260809/training-log.jsonl` — 当前 gen-40 v2 轮次日志；包含 gen 0–39 generation 记录与 gen 10/20/30/40 typed reevaluation 事件
- `score-rate-v2-first-run-20260809/checkpoint.json` — 当前 v2 checkpoint；schema version 3、`score-rate-v2`、10 维、gen 40、`maxPieces = 2000`
- `score-rate-v5/` — 当前训练器的默认新轮次 output dir；只有 schema version 6、objective `score-rate-v5`、搜索 metadata 与冻结预算 3584 全部匹配的完整连续产物才可能恢复
- `score-rate-v3/`、`score-rate-v4/` — 历史 run；不是当前训练器默认路径，运行前仍须现场检查其 live 状态
- `<historical-run>/candidate-weights.json` — 历史 run-local 候选路径；不是当前 v5 候选路径，也不是已发布权重
- `best-weights.json` — 当前 runtime 已发布的 version 3、`score-rate-v2` gen-40 权重
- `../src/ai/trained-weights.json` — 当前 tracked bundled 的 version 3、`score-rate-v2` gen-40 权重；加载时仅在内存中补 v5 所需的三个尾维
- 根目录的 `checkpoint.json` / `training-log.jsonl` — 退役 `lines-height-v1` 的 legacy 产物；不得与当前目标混用
- `score-rate-v1-smoke/` — 目标实现阶段的隔离 smoke 产物；不是当前可续训轮次

---

## 3. 常用命令

```powershell
npm run calibrate:search -- --select         # 只读校准选择；不是训练、benchmark 或浏览器验收
npm run calibrate:search -- --verify-frozen  # 只读冻结值核验；不是训练、benchmark 或浏览器验收
npm test                    # 以当前收集数和实际输出为准
npm run lint
npm run build               # 产出 dist/index.html 与 dist/training.html
npm run typecheck:train     # 单独检查 training/（与主应用 tsconfig 分开）

npm run dev                 # http://localhost:5190/          游戏 + AI 面板
                            # http://localhost:5190/training.html  训练面板

npm run bench -- --games 30 --max-pieces 2000  # 内置手调基线；固定 v2 depth 4、beams 64/32、预算 3584
# 仅在文件存在且已核验时追加：--weights <权重文件>
npm run train -- --generations 20 --output-dir public/ai/<new-v5-run-id>  # 仅限已授权的空目录
npm run train -- --generations 20 --workers 8 --output-dir public/ai/<new-v5-run-id>
npm run train -- --resume   # 默认 score-rate-v5；必须先完整核验并获得授权，且仅接受 schema 6 v5 产物
# --seed 必须是独立整数，不得复用训练或固定复评 seed，并在本次基线/候选配对中固定使用
npm run bench:paired -- --baseline <published> --candidate <qualified> --seed <independent-integer>  # CLI 已实现；本次未运行
```

训练命令会修改 run-local checkpoint/log，并可能在资格门通过后写入同一 run dir 的 `candidate-weights.json`；它不会自动改写两份发布权重。不能把上面的示例当成顺序执行清单。默认输出目录包含任何条目时（包括空日志或其他遗留文件），新跑都会拒绝；不要通过删除文件绕过保护。运行前先读第 5 节的 checkpoint 决策门。校准只共享搜索、只读且不写 `public/ai/`，不能当作训练、benchmark 或 browser acceptance。

`npm run lint` 的可用性也应在当前分支实测；不要继承旧会话的“本来就是坏的”结论。

### 下一次用户运行的一代 smoke（只提供，不执行）

这是后续的独立授权门，不是本次交接的执行清单。先在**新的现场检查**中确认没有相关训练进程、刷新 lock 状态和目标 artifact 状态，并由操作员明确确认 `public/ai/score-rate-v5/` 为空；现有条目绝不通过删除、移动或归档绕过。只有这些条件和用户授权均成立后，才把下列命令提供给用户运行：

```powershell
npm run train -- --generations 1 --output-dir public/ai/score-rate-v5
```

助手不得执行这条命令。一代结果只是 v5 的 signal gate：它不证明训练完成、candidate 合格、相对基线优势、可发布性，或 browser/runtime acceptance。

第一次 SIGINT 必须标记停止并 abort 当前 generation 或 reevaluation，丢弃该未完整边界的全部结果，不更新 CEM 或追加 generation/reevaluation log；随后写入最后一个完整 generation 边界的 schema 6 checkpoint，并经 finally 路径销毁 pool、移除 listener、释放 repository lock。fresh gen 0 的第一次中断保存初始 `gen: 0` checkpoint；用相同 seed resume 时重新执行完整 gen 0。stale lock 绝不自动删除：锁只含 PID，PID 可复用；任何删除都需要刷新 PID/process/lock 证据与独立操作员授权。

---

## 4. 目标演进：消行封顶、旧高度目标与 score-rate-v5

这是整个项目最关键的演进，**不看这段会白跑几小时**。

### 当前目标：固定调度 score rate

`score-rate-v5` 保留历史 score-rate-v2/v4 的真实得分目标，直接使用引擎一致的对局分数并按调度 cap 归一化：

```
fitness = meanScore / maxPieces
```

模拟器跳过真实时间和重力，并把选定落点直接赋给当前方块后锁定，因此这里优化的是每个**调度方块**带来的确定性模拟分数，而不是每秒分数。这个分数使用引擎的消行计分规则，但不包含浏览器逐键回放可能累积的 soft/hard-drop bonus；它是 score-rate-v3 沿用的既定契约，不是浏览器 UI 总分的逐分预测。若候选提前死亡，分母仍是相同的 scheduled `maxPieces`；用 survived pieces 作分母会奖励提前退出。`lineClearValue` 和三个新建井特征都是落点评价特征，不是 fitness 额外奖励；clear histogram、`tetrisLineShare`、策略诊断和存活诊断也不参与 CEM 选择。

v3 的两代隔离信号门与最终候选门不得混用：若两代中 `bestTetrisLineShare` 和 `eliteTetrisLineShare` 始终都低于 `0.01`，立即停止并为 bag-aware beam/expectimax 另写设计；即使有信号，也只有固定复评候选达到 `tetrisLineShare >= 0.20`，同时通过得分和存活资格门，才允许写 run-local `candidate-weights.json`。candidate 仍需独立 paired CLI 证明逐局 score rate 与 `tetrisLineShare` 的 95% 区间下界都大于 `0`，之后发布也要单独授权。

训练过程中的 `bestScoreRate` 只是在当代共同随机数下对候选排序；它既不是固定复评，也不是独立 baseline 对照。判断收敛要结合整代 score-rate 分布与 sigma；判断是否优于旧发布权重要使用同 seeds、depth、piece cap 的独立 paired benchmark。

### 历史根因：消行数封顶

### 现象

称职的 2 层搜索候选**根本不会死**。所以「带上限的消行数」这个指标，对任何值得选进精英的候选，恒等于 `0.4 × 局长上限`——因为每个方块 4 格、每行 10 格，消行数/方块数的**数学上限就是 0.4**。

实测三处，全部顶在天花板 99% 以上：

| 测量 | 天花板 | 实测 | 占比 |
|---|---|---|---|
| 训练适应度（上限 300） | 120 | 118.8，**连续 15 代不动** | 99.0% |
| 模型复评（上限 5000） | 2000 | 1998.2 | 99.9% |
| bench 手调权重（上限 1000） | 400 | 398.4 | 99.6% |
| bench 训练权重（上限 1000） | 400 | 398.8 | 99.7% |

最后两行是最要命的：**手调权重和训练权重区分不出来**。

### 后果

CEM 是按前 10% 的精英拟合下一代分布的。精英全部并列在天花板上时，它分不出第 1 名和第 10 名，选择压力消失。

局长上限翻倍也救不了——只是把天花板抬高，精英照样并列。实测一次真实运行：精英存活步数**每一代都恰好等于当时的上限**（300 → 600 → 1200 → 2400 → 4800 → 9600 → 19200 → 38400），翻倍永不停止，单代耗时 34s → 121s → 273s → 326s → …… → 1647s，7 代烧掉 1 小时 07 分还在涨。

已经有三版触发条件先后撞在同一堵墙上：中位消行数（数学上不可达）、中位存活步数（可达但实际到不了）、精英中位存活步数（触发正确，但**永远触发**）。**问题从来不在触发条件，在指标本身。**

### 历史处置一：给局长上限封顶

`maxPiecesCap` 已压到 **2000**，并且复评的消行项饱和时会打印提示。**消行**这一项仍然是饱和量——它只是在复述局长上限，别拿它判断收敛。

### 历史处置二：棋盘整洁度（已退役）

`lines-height-v1` 当时采用组合式适应度：

```
fitness = meanLines - heightPenalty * meanHeight
```

`meanHeight` 是**每次锁定后（且消行之后）最高列高度**的全局平均，由 `simulate.ts` 累加、`SimResult` 带出。它的范围受 `TOTAL_ROWS = 22` 限制，但不会仅因为所有候选活到 piece cap 就自动取同一值：平均把堆压在 3 行的候选仍可与常年顶到 15 行的候选区分。这个指标仍保留在当前系统中用于诊断，但不再直接从 score-rate fitness 中扣除。

`heightPenalty = 1.0`，是量出来的，不是拍的。把训练权重按 sigma 0.1 扰动（模拟收敛后的精英池）后两项的跨度：

| 局长上限 | 消行跨度 | 高度跨度 | 饱和候选 |
|---|---|---|---|
| 300 | 3.33 | 2.93 | 12/12 |
| 1200 | 6.00 | 4.38 | 10/12 |

两项量级相当，且**局长上限翻倍后仍然相当**，所以当时预计后期不会退化成只看消行。权重不能调太大：高度上限是 `TOTAL_ROWS = 22`，而活满全场值 `0.4 × maxPieces` 分；一旦 `22 × heightPenalty` 逼近 `0.4 × initialMaxPieces`（当时 `initialMaxPieces = 300`，对应 120 行天花板），**5 个方块就顶死的候选因为棋盘几乎全空反而显得最整洁**，CEM 会开始偏爱「干净地速死」。这是 lines-height-v1 的历史设计约束；当前 `training/config.ts` 已不再包含 `heightPenalty`。

实测确实区分出来了（历史命令等价于当前固定搜索的 `npm run bench -- --games 3 --max-pieces 600`）：

| 权重 | 消行 | 占天花板 | 平均高度 |
|---|---|---|---|
| 手调 | 238.0 | 99.2% | **3.12** |
| 训练（gen 10） | 238.7 | 99.4% | **3.23** |

消行仍然分不出（差 0.3%），高度分得出（差 3.5%）——顺带说明**当前这版训练权重并不比手调的更整洁**。

冒烟跑（`npm run train -- --generations 2`）里信号也在动：精英中位高度 gen 0 是 7.0，gen 1 降到 3.5，而同期全体中位高度是 14.3。

以下配套改动描述的是 `lines-height-v1` 历史快照；随后曾由 `score-rate-v1`、`score-rate-v2`、`score-rate-v3` 与历史 `score-rate-v4` 依次取代，当前代码、日志与候选产物契约已迁移至 `score-rate-v5`：

- `aggregateFitness` 当时返回 `{ fitness, meanLines, meanPieces, meanHeight }`，多收一个 `heightPenalty` 参数
- 日志每代多写 `medianLines / medianHeight / eliteHeight / heightPenalty`，控制台多打一列 `eliteH`
- 复评与 `bestEver` **改用组合分 `score` 排名**。只按消行排名的话，复评一饱和（实测 1998.2/2000）就此永远并列，模型再也不会更新
- 旧 checkpoint 没有 `score` 字段，`--resume` 时会把标杆清零（旧的 `meanLines` 是另一套目标下量的，不可比），下次复评重新发布
- 池子里失败的任务记为 `meanHeight = TOTAL_ROWS` 而不是 0——适应度是**减**高度的，记 0 会让崩掉的一局显得像史上最整洁的棋盘
- `bench` 每局和汇总都报高度，并把消行天花板的占比直接打出来
- 训练面板的指标改叫 Fitness（它早就不是消行了），并加了 Median lines 与 Elite height

### 备选（仍未实现）

敌对方块序列（S/Z 洪水，强 AI 也会死）——差异化最彻底，但权重是针对敌对分布练的，未必迁移得回真游戏。

---

## 5. 坑（会浪费时间的那种）

### Checkpoint 决策门

当前训练器默认使用 `public/ai/score-rate-v5/`，也可通过 `--output-dir` 选择隔离目录。只有 objective `score-rate-v5`、schema version 6、精确 13 维且顺序不变、搜索 metadata（v2/4/64/32/3584/`budget-corpus-v1`）与 config/log 连续的产物可恢复；`score-rate-v1/`、`score-rate-v2/`、`score-rate-v3/`、`score-rate-v4/` 及 schema version 1–5 checkpoint/log 都是历史产物，v5 绝不恢复或追加。根 `public/ai/checkpoint.json` / `training-log.jsonl` 是更旧目标产物，`score-rate-v1-smoke/` 是历史隔离冒烟产物；路径相邻不表示目标兼容。

**2026-08-03 收口快照（历史）**：score-rate-v1 checkpoint 为 gen 20，日志包含 gen 0–19 的 20 条 generation 记录和一条 gen 20 reevaluation；当时发布权重写入了根 `best-weights.json` 与 tracked `src/ai/trained-weights.json`。这些权重现已被 gen-40 v2 替代，该快照只保留为历史证据，不是当前 v5 resume/append 的依据。

任何训练前都按以下顺序判断：

1. 检查 Node 命令行、CPU 和内存，确认没有训练进程正在写目标目录或发布权重。
2. 明确实际 output dir；读取其中 checkpoint 的 schema version、`objective`、`gen`、`maxPieces`、完整 `config`、`publishedBaseline` 与 `bestQualifiedCandidate`，并检查 candidate 文件是否与 `bestQualifiedCandidate` 一致（无 qualified candidate 时不得存在 candidate 文件），同时检查日志全部记录的 objective、generation/reevaluation schema、连续 generation、固定复评历史和最终换行。
3. 如果恢复 v5 本轮，只能在 score-rate-v5 schema version 6、精确 13 维且顺序不变的权重、冻结搜索 metadata、配置/日志连续和完整诊断元数据全部校验后显式使用 `--resume`；旧 objective/schema checkpoint/log 一律拒绝恢复或追加。
4. 如果新跑，先取得用户授权并选择空的独立 output dir；归档、移动或删除任何已有产物都需要单独授权。
5. 训练只可改写 run-local checkpoint/log，并在资格门通过后写 run-local candidate；两份发布权重不在训练器写入边界内。启动前仍必须记录二者状态和哈希，以便证明边界未漂移。

**不要在已有产物时省略 `--resume`。** 当前 `assertFreshRun` 会在创建 worker 或写文件前拒绝 output dir 中的任何现有条目；不要通过删除、清空或迁移文件绕过它。

### Legacy 高 cap 轮次（历史背景）

退役的 76800-cap 历史轮次位于仓库根目录的 `training-archive/`（同目录 README 记录原委）。不放在 `public/ai/` 下：Vite 会把 `public/` 原样拷进 `dist/`。当时的状态与判断：

| | |
|---|---|
| `maxPieces` | 76800——`--resume` 会先跑一个约 3 小时的世代（76800 步/局 × 500 局），之后才被 2000 的新上限拉回来 |
| `bestEver` | 无。8 代没跑到第 10 代，没复评过，**一个模型都没发布** |
| `sigma` | 仍在 0.61–0.68，几乎没收敛 |
| `mu` | 按新指标实测（depth 2、cap 600、3 局）平均高度 **3.18**，介于手调 3.12 与已发布训练权重 3.23 之间——8 代什么也没换来 |

加上适应度当时已经换成组合式，旧日志里 cap 38400 下的 `best = 15358` 与 lines-height 目标的百位数值混在同一个 `training-log.jsonl` 里会让面板的图彻底失真，所以当时选择了归档重来而不是把 `maxPieces` 改回 300。

**下次再遇到跑飞的 checkpoint**，只能在停止写入进程、核对目标函数并获得用户授权后选择修正或成组归档。以下是历史示例，不是可直接粘贴的默认操作：

```bash
# 改回 300，保留已有的 mu/sigma 进度（仅当目标函数没变过）
node -e "const f='public/ai/checkpoint.json';const c=require('./'+f);c.maxPieces=300;require('fs').writeFileSync(f,JSON.stringify(c,null,2))"

# 或者归档重来（目标函数变过就只能走这条）
mkdir -p training-archive && mv public/ai/checkpoint.json public/ai/training-log.jsonl training-archive/
```

`.gitignore` 忽略整个 `public/ai/` 与 `training-archive/`。Git 状态看不到这些产物并不表示它们不存在；必须直接检查目录。

### 杀训练进程要按内存/CPU 找，不能 grep 命令行

真正干活的 node 进程命令行显示的是 `tsx/dist/preflight.cjs --import ...`，**不含 `train.ts` 字样**。`ps aux | grep train.ts` 会漏掉它，误以为已经停了。曾经因此让它多跑了一个多小时、累计吃掉 92 CPU·小时。

正确做法（PowerShell）：

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Select-Object ProcessId,
    @{n='CPUsec';e={[math]::Round((Get-Process -Id $_.ProcessId -EA SilentlyContinue).CPU,1)}},
    @{n='MemMB';e={[math]::Round($_.WorkingSetSize/1MB,0)}}, CommandLine
```

内存几个 GB、CPU 几万秒的那个就是它。

### worker 必须带 `execArgv`

`new Worker(url, { execArgv: ['--import', 'tsx'] })` 里的 `execArgv` 是**必需的，不是可选优化**。tsx 只在父进程本身跑在 tsx 下时才让 worker 继承 loader；`vitest run` 起的是普通 Node，从中派生的 worker 什么都不继承，会退回原生类型剥离，解析不了 `../src/ai/simulate` 这种无扩展名导入。

### 训练只写 run-local candidate，不自动发布

score-rate-v5 固定复评只有在候选同时通过得分、`tetrisLineShare >= 0.20` 与存活资格门后，才写当前 run dir 的 `candidate-weights.json`。训练器不会覆写 tracked `src/ai/trained-weights.json` 或 runtime `public/ai/best-weights.json`。训练前后仍要记录这两份文件的 diff 与哈希；若发生漂移且无法明确归因，停止并请用户决定，绝不使用无条件的 `git checkout` 或 `git restore` 覆盖工作树文件。

### 不想让训练占满 CPU

`--workers N`。worker 池是这个脚本里唯一吃多核的东西，N 个 worker 就是 N 个忙碌核心——这是结构上的上限，不是调优建议。缺省是 `核心数 - 1`（上限 31）。

**代价比想象的小得多。** 同一代（同种子、结果完全一致：best 114.4、eliteH 7.0）：

| workers | gen 0 耗时 |
|---|---|
| 31（缺省） | 34.5s |
| 8 | 39.9s |
| 4 | 54.2s |

核心砍到 1/4，只慢 16%。原因是**一代的墙钟时间由少数几局长对局的尾巴决定，而不是由总吞吐决定**：大部分候选 40 步就死了，精英要打满 300 步，最后总有几局在单独跑。31 个核心里大半时间是闲着的。

想再温和一点，可以叠加降优先级。worker 是 `worker_threads`——**同一个进程里的线程**，所以设一次进程优先级就覆盖所有 worker：

```powershell
# 训练跑起来之后执行（进程命令行不含 train.ts，只能按 CPU 找最忙的那个）
$p = Get-Process node | Sort-Object CPU -Descending | Select-Object -First 1
$p.PriorityClass = 'BelowNormal'
```

两者的区别：`--workers` 是**硬性**留出空闲核心，随时都留着；降优先级是让训练**在你不用机器时照样吃满**，你一动它就让路。想安静地后台跑，两个一起用。

### 训练与 GPU 无关

CEM 是搜索式演化，「模型」当前有 13 个浮点数，算力全花在博弈树搜索上。**CPU 吃满、GPU 全程闲置是符合预期的**，不是配置错误（不想吃满见上一条）。要用 GPU 得换神经网络方案，那是另一个项目。

---

## 6. 不变量（改代码前务必知道）

- **AI 逻辑只有一份。** 浏览器和训练器 import 同一批 `src/ai/` 文件。任何「为了训练快一点」的第二实现都会让训出的权重在真游戏里失效。
- **棋盘绝不可原地修改。** 引擎的 `clearLines` 用 `filter`，返回的棋盘与输入**共享行数组引用**，原地写会污染无关状态。
- `src/ai/` 必须保持纯净：无 `node:` 导入、无 DOM API、无文件系统、无模块级可变状态。唯一的例外是 `loadWeights.ts`（浏览器专用），已在 `tsconfig.train.json` 排除。
- `FEATURE_NAMES` 是十三维特征顺序的唯一真相。权重向量是**按位置**点乘特征向量的；历史位置不得重排，旧九维/十维权重只可在内存中尾随补零适配。
- 落点枚举必须走引擎的 `rotatePiece`，否则会漏掉靠踢墙才能到达的落点。
- AI/训练改动不应增加新的运行时依赖；训练面板的四张图是手写 SVG，**不要为它们引入图表库。**

---

## 7. 已知的小问题（都不阻塞）

- `App.tsx` 丢弃了 `useTrainingLog` 返回的 `error`，fetch 失败是静默的
- `training/pool.ts` 的 `'error'` 监听没有 `destroyed` 保护（`'exit'` 有）；在 Node 的 `terminate()` 语义下不可达，但属于不对称
- 权重文件里的 `searchDepth` 元数据没有任何地方读取——它本来是为了防止「2 层练的权重拿去 1 层跑」这个已知失效模式
- `simulate.ts` 的 `lockAndSpawn` 有一个不可达的 `preview ? ... : drawFromBag(state)` 兜底分支
- 浏览器 `/favicon.ico` 404：`index.html` 没声明图标，`public/` 下只有 `ai/`。纯外观问题
- **测试套件有 flake，失败集合每轮都不同。** 2026-09-12 两轮全量（一轮默认并发、一轮 `--maxWorkers=4`）失败集合不一致。稳定失败只有两个，都是既有且不要修的：`featureRepresentationChallengeGate > preserves the baseline package bytes`（package.json 字节断言，基线早于四个后加的 script，且 CRLF/LF 不一致）与 `featureRepresentationStructuralChallengeCorpus > discloses future I access as same-state-pair constant`。其余三个是满载下撞 5 s 默认超时：`simulate.test.ts > observes the first real pre-action decision`、`featureRepresentationStructuralChallengeBuilder > replays the frozen grammar`（实测 7242 ms）、`d2ShardedHeldOutListwise > takes over a dead lock with no predicate injected at all`。**这三个单独跑全过**——判断一个失败是不是真的，先隔离重跑那一个文件，不要按失败数对账
- 默认并发下全量测试会 OOM（`FATAL ERROR: Zone Allocation failed`）。用 `--maxWorkers=4` 可跑完，代价是慢一点

---

## 8. 后续会话的接手顺序

按价值排序：

1. **先审计 Git、进程和全部 `public/ai/` 产物**——Git 干净不代表 ignored 产物没变；没有用户授权不要启动训练/benchmark，也不要归档、删除或覆盖产物。
2. **当前已发布基线是 2026-09-12 的手调 T2，不再是 gen-40**——未来候选必须与它做相同 seeds、depth、piece cap 的独立 paired 对比，且不能用训练 `bestScoreRate` 代替基线验收。注意新基线的 scoreRate 约 900、四消占比约 32%，门槛比 gen-40 时代高得多。
3. **历史 v4 交接记录（不可作为当前指令）**：当时获准运行 v4 时须先明确 resume 或隔离新跑，默认 output dir 为 `public/ai/score-rate-v4/`；resume 仅可指向经完整校验的 score-rate-v4 schema 5 checkpoint。当前 v5 不恢复或追加此类产物。
4. 运行当前 `npm run lint`、`npm test`、`npm run typecheck:train` 和 `npm run build`；不要继承旧测试数或成功结论。
5. **按独立授权门推进**——两代信号 smoke、正式训练、固定复评 candidate 产出、独立 paired 验收、发布、push 与浏览器/runtime 验收不能合并；`bench:paired` CLI 已存在，但本次未运行。
6. **action-conditioned 假设已按 §10.3(a) 关闭，不要重跑 D2**——也不要把它写成"已被证伪"。若要问一个**新的**问题，先修测量再谈假设：需要一个称职玩家真的会死的 horizon（抬 cap 无效）、按可达范围重新校准的阈值、以及事前而非事后的效力论证；这些都要走自己的设计门。
6. 浏览器验收时区分 bundled 与 runtime：bundled 来自 tracked JSON，runtime 来自 `/ai/best-weights.json`；二者可以同内容但来源标签不同。2026-09-12 的手调 T2 已完成浏览器/runtime 验收（见 §1）；核验时必须显式确认控制台没有 fallback 警告，因为 `parseWeightsFile` 失败是静默回退。
7. 让 `searchDepth` 元数据真正起作用：权重文件的深度与 UI 当前深度不一致时给出提示。
