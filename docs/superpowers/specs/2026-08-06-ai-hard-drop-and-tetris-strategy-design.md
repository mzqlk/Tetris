# AI 提前硬降与四消策略表达设计

**日期：** 2026-08-06
**设计时基线（历史）：** `score-rate-v1`、9 维特征、当时已发布 gen 20 权重
**本设计交付契约：** `score-rate-v2`、10 维特征
**后续状态：** 本设计已实施；2026-08-11 当前发布模型为 gen-40 `score-rate-v2`。稳定四消目标尚未完成，后续设计见 [`2026-08-11 score-rate-v3 design`](2026-08-11-score-rate-v3-tetris-strategy-design.md)。
**状态：** 历史设计，现已实施；本文本身不构成新的训练、续训、发布或产物修改授权

## 背景与问题模型

当前系统有三个彼此独立的决策层，不能用同一个 fitness 改动同时解决：

1. **训练目标层**：CEM 使用 `meanScore / scheduled maxPieces` 排序候选。模拟器跳过真实时间、重力和逐键 soft/hard-drop bonus，直接把选定落点锁定。
2. **落点策略层**：`bestPlacement` 用线性特征向量评价最终棋盘，只看当前方块和下一个方块（depth 2）。
3. **浏览器执行层**：`enumeratePlacements` 保存从出生姿态一直走到锁定姿态的 BFS 路径，`useAiPlayer` 回放全部 `down` 后才 hard drop。

因此，网页中“方块下降到底部附近才旋转或横移”不是训练主动选择的时间策略。空棋盘实测中，I 方块的 17 个落点都包含 18–20 次 `down`；中间竖放路径会先下降 18 格再旋转。训练模拟器既看不到这段路径，也不会因其获得更多 fitness。

四消缺失则发生在另一个边界：引擎按 `100 / 300 / 500 / 800 × level` 计算 1/2/3/4 消，但落点评价中的 `linesCleared` 是线性的 `0/1/2/3/4`。训练只能通过长局最终分数间接发现四消策略；depth 2、通用井深惩罚和高度风险特征使“先建立四行井、等待 I 方块、再获取非线性奖励”成为较难跨越的协调策略。

## 目标

- 普通可直落的落点应先完成必要的横移/旋转，并在最后一个预定位动作后立即 hard drop。
- tuck、滑入屋檐等确实依赖下降后移动的落点必须继续可达，且继续使用引擎 SRS 行为。
- 搜索看到的最终落点集合、落点顺序和旧权重的最终棋盘决策保持不变；执行路径优化不得偷偷改变训练策略。
- 保持 `meanScore / scheduled maxPieces` 为训练主目标，不增加存活奖励、时间奖励、高度扣分或人为四消 bonus。
- 让落点评价能表达引擎真实的非线性消行价值，同时保留风险控制特征。
- 让 benchmark、训练日志、固定复评和发布元数据能直接回答“发生了多少次 1/2/3/4 消”以及“多少消行来自四消”。
- 用明确的新目标、特征和产物版本隔离旧 checkpoint 与旧权重。

## 非目标

- 本次不把 fitness 改成每秒得分，也不把浏览器动画速度、重力 tick 或输入间隔带入训练。
- 不使用 `score / survivedPieces`；提前死亡仍必须因固定赛程分母而损失未来得分机会。
- 不删除 `aggregateHeight`、`maxHeight`、`landingHeight`、holes、transitions 或 `wellDepth`。它们是可学习的状态表达，不是硬编码到 fitness 的高度惩罚。
- 不改变 `meanHeight` 的现有发布语义：它仍只在固定复评分数位于包含边界的 0.1% 近似同分区间时作为 tie-breaker。
- 第一阶段不新增“干净四行井”、hold、T-spin、bag 概率或 depth 3+ 特征。若非线性消行特征仍不能产生可测四消，再基于统计另写设计。
- 本文不授权运行 smoke、benchmark、正式训练或恢复任何现有 checkpoint。

## 方案比较与选择

### 方案 A：直接删除存活与高度影响

不采用。当前没有显式存活分，`meanHeight` 也不进入 CEM fitness。删除固定分母造成的早死惩罚会鼓励短命候选；删除高度相关特征则会削弱顶出风险识别，却不能解决网页动作路径或四消的非线性表达。

### 方案 B：路径与策略分层修复，并增加真实消行价值特征

采用。浏览器执行通过 hard-drop 投影缩短路径；训练目标保持不变；搜索新增一个反映引擎基础计分比例的特征；四消是否出现通过明确统计验证。该方案直接对应两个根因，并保持实际游戏得分为最终选择标准。

### 方案 C：fitness 额外奖励四消、惩罚耗时或提升搜索深度

暂不采用。额外四消 bonus 会把“希望看到某种风格”置于真实得分之上；时间项会把纯确定性训练耦合到 UI 节奏；更深搜索则显著增加每个候选的成本。只有方案 B 有测量证据仍不足时，才分别评估受控井特征或更长视野。

## 设计一：保持落点不变，改为最短预定位路径

### Placement 契约

`Placement.piece` 继续表示最终合法锁定姿态；`Placement.moves` 的语义改为：

> 从当前出生姿态到某个“预落姿态”的最短合法按键序列；从该姿态执行一次 hard drop，必须落到 `Placement.piece` 的同一组格子。

`moves` 不再保证自身回放终点就是锁定姿态。调用方需要先回放 `moves`，再 hard drop。

### 枚举算法

状态 BFS 和锁定落点的产生顺序保持不变，以保护搜索 tie 时的稳定选择：

1. 继续从出生姿态按 `left / right / down / rotate` 遍历所有可达 `(x, y, rotation)` 状态，并使用引擎 `rotatePiece` 处理 SRS。
2. 对每个首次访问的状态计算其垂直 hard-drop 投影，并以投影后的最终格子集合 `cellKey` 为键。
3. 同一投影键第一次出现时记录当前 `moves`。因为外层是 BFS，它就是到达该最终落点所需的最短预定位路径。
4. 仍仅在发现“下一格无法下降”的真实锁定状态时创建 `Placement`，并沿用当前 `seenCells` 去重和结果顺序。
5. 创建结果时，从步骤 3 的映射中取该最终 `cellKey` 对应的最短预定位路径；若不存在则视为内部不变量错误，而不是退回旧长路径。

该算法不会退化为简单的“旋转 × 列 + hard drop”：任何 tuck 最终姿态本身也是可达状态，最坏情况下可从该锁定姿态执行零格 hard drop，因此现有可达落点不会丢失。若 tuck 必须先下降再横移，最短预定位路径仍会保留必要的 `down`。

### 浏览器执行

- `AiPlan` 增加最终 `target` 姿态。`planPlacement` 继续用 `projectPath` 验证预定位动作是否合法，并验证“路径终点 hard drop 后与 `target` 同格”。
- normal/slow 模式仍按配置逐个展示预定位动作；执行最后一个预定位动作后，在同一个事件循环回调中立即 hard drop，不再额外等待一个 step delay。
- instant 模式继续在一个回调中执行全部预定位动作和 hard drop。
- 重力若在预定位动作之间改变实时姿态，继续使用现有 `isPlanValid` 自愈式重规划；不得根据过期路径强行落子。
- 训练模拟器继续直接设置 `decision.placement.piece` 并锁定，不回放 `moves`，因此执行优化不参与 fitness。
- 浏览器 UI 分数会因普通 soft drop 变为 hard drop 而提高（当前规则分别为每格 1 分和 2 分）。这是预期的执行语义变化，不代表训练 fitness 提高；前后策略比较不得使用包含 drop bonus 的 UI 总分替代无头模拟分数。

### 路径验收不变量

- 在空棋盘、jagged 棋盘和现有 tuck 棋盘上，修改前后的最终 `cellKey` 集合完全相同。
- 最终结果顺序保持相同，避免线性评价完全并列时改变旧模型决策。
- 每个返回路径都能通过真实引擎回放；回放终点 hard drop 后与 `Placement.piece` 同格且处于 resting position。
- 空棋盘普通落点不包含无必要的 `down`；I 方块中间竖放必须能在出生区旋转后直接 hard drop。
- 现有屋檐 tuck 仍可找到，并且其路径只保留实现该 tuck 必需的下降动作。

## 设计二：统一记录 1/2/3/4 消

### 共享纯类型与计算

在 `src/ai/` 增加纯模块 `lineClears.ts`，不得导入 Node、DOM、文件系统或保存模块级可变状态。它定义：

```ts
interface LineClearCounts {
  singles: number;
  doubles: number;
  triples: number;
  tetrises: number;
}
```

同时提供以下纯计算：

- `lineClearValue(linesCleared)`：先验证整数范围 `0..4`，再通过引擎 `calculateScore(linesCleared, 1) / 100` 得到 `0/1/3/5/8`。不得在 AI 模块复制第二份计分表；非法值明确抛错。
- `totalLinesFromCounts(counts)`：`singles + 2*doubles + 3*triples + 4*tetrises`。
- `tetrisLineShare(counts)`：`4*tetrises / totalLines`；无消行时返回 `0`。
- counts 的零值、累加和按局数求均值函数；所有输入输出保持有限数值。

`SimState` 在每次锁定并清行时更新 counts，`SimResult` 返回 counts。必须始终满足：

```text
result.lines == totalLinesFromCounts(result.clearCounts)
```

worker 失败结果使用四项全零，不能伪造四消或破坏现有零分失败语义。

### Benchmark

每局输出增加紧凑的 `1/2/3/4` 次数。汇总增加：

- 全部游戏的总 `LineClearCounts`；
- `tetrisLineShare`，范围为 `[0, 1]`；
- `tetrisesPer100ScheduledPieces = 100 * totalTetrises / (games * maxPieces)`。

使用 scheduled pieces 作为最后一个指标的分母，使提前死亡不能通过较小实际方块数美化四消速率。原有 score、score rate、lines、height、survival 和 throughput 全部保留。

### 训练、复评与面板

`aggregateFitness` 额外返回每个候选的平均 counts 和 `tetrisLineShare`，但 fitness 计算保持逐字等价：

```text
fitness = meanScore / scheduled maxPieces
```

每代日志增加：

- `bestTetrisLineShare`：当代最高 score-rate 候选的值；
- `medianTetrisLineShare`：全体候选的中位值；
- `eliteTetrisLineShare`：按 score-rate 选出的精英候选之中位值。

控制台增加紧凑的 `bestT4 / eliteT4` 百分比。训练面板只增加 best 与 elite 两个最新摘要值，不新增图表，不改变 score-rate 主图、分布或 sigma 的判断地位。旧日志缺少字段时解析为 `0`；不同 objective 的日志仍不得混画。

固定复评结果、`bestEver`、typed reevaluation 事件和新发布权重元数据保存平均 counts 与 `tetrisLineShare`。四消指标只用于诊断和验收，不参与固定复评发布裁决。

## 设计三：增加非线性消行价值，但保留风险表达

### 新特征

在 `FEATURE_NAMES` 末尾追加 `lineClearValue`，保留现有 `linesCleared`：

```text
旧 9 维：aggregateHeight, holes, bumpiness, maxHeight, linesCleared,
         landingHeight, rowTransitions, colTransitions, wellDepth

新第 10 维：lineClearValue
```

追加而不是替换的理由：

- `linesCleared` 表达线性消行吞吐；
- `lineClearValue` 表达真实规则中 double/triple/tetris 的非线性增益；
- CEM 可以学习二者的相对权重，不需要硬编码“必须四消”；
- 旧九个位置不移动，降低错位迁移风险，但向量长度变化仍必须严格版本化。

`lineClearValue` 使用不含 level 的基础比例。对当前落点，同一时刻的 level 对所有候选动作相同；训练外层仍使用包含实际 level 的真实引擎总分。该特征只是让两层搜索能识别非线性形状，不替代真实计分。

### 高度与井深

现有高度、holes、transitions 和 `wellDepth` 全部保留并继续由训练学习。设计不把任何高度权重锁为零，也不手工把 `wellDepth` 改成正值。四行井必须靠更高的真实消行收益抵消其暂时高度和井深风险；如果做不到，说明现有状态表达或搜索视野仍不足，而不是应该取消全部风险控制。

第一轮只新增 `lineClearValue`。若获准的两代短跑中 `bestTetrisLineShare` 和 `eliteTetrisLineShare` 都持续低于 `0.01`，则按“近零”处理并停止，不投入长跑；后续另行比较“干净单井特征”和更长视野，不能在同一轮无证据叠加。

## 目标、权重与产物兼容

### 新契约

训练目标标识升级为 `score-rate-v2`。它的标量 fitness 与 v1 相同，但该标识代表完整可训练策略契约，包括 10 维特征和四消可观测性。新运行使用：

```text
public/ai/score-rate-v2/
  checkpoint.json
  training-log.jsonl
```

checkpoint schema 升级为 version 3，并要求：

- `objective === "score-rate-v2"`；
- `mu`、`sigma`、`bestEver.weights` 恰好 10 个有限数；
- 新 counts、share 和既有 score-rate 字段通过完整一致性校验；
- `scoreRate === meanScore / evalMaxPieces`；
- `tetrisLineShare` 与 counts 可重新计算且一致。

任何 v1 checkpoint、9 维 checkpoint、缺失新字段或混合目标的日志均在创建 worker 和写文件前拒绝。不得恢复或改写 `public/ai/score-rate-v1/`。

### 旧发布权重的只读兼容

实现完成但尚未训练时，浏览器必须继续使用当前已发布 v1 权重，且决策保持不变：

- version 1（包括未写 version/objective、按 version 1 解释的历史文件）可以保留现有九键 runtime-only 兼容，但必须走单独的 legacy 分支并在内存追加 `lineClearValue: 0`；它不能未经固定赛程重评直接成为训练发布基线。声明 version 2 或更高却缺少 objective 的文件不得借此降级通过。
- version 2 / `score-rate-v1` 权重文件只能在恰好包含旧九个键时进入显式 legacy 适配路径；内存中追加 `lineClearValue: 0`。
- version 3 / `score-rate-v2` 文件必须恰好包含十个当前键；缺项、额外键、非有限值或目标不匹配一律拒绝。
- 不接受“任意缺少一个键就补零”的宽松规则。
- 九维向量追加零不会改变 L2 范数，也不会改变任何点积分数；配合落点集合和顺序不变，当前 bundled/runtime v1 模型应保持确定性结果。
- 在新候选通过既有固定复评发布门之前，不修改 tracked `src/ai/trained-weights.json` 的数值或目标元数据。

v2 第一次固定复评时，当前已发布 v1 权重通过上述零扩展适配，在同一组 30 × 5000 固定种子上重新评估以建立基线；不能沿用 v1 文件中的旧 `meanScore` 直接比较。发布裁决继续 score-first，并保留原 0.1% height tie-breaker。

训练面板默认读取 `/ai/score-rate-v2/training-log.jsonl` 并只接受 v2 generation 行；v1 历史产物保留原位，不迁移、不追加、不删除。

## 数据流

```text
引擎锁定/清行
  -> SimResult(score, lines, height, clearCounts)
  -> aggregateFitness
       -> fitness = meanScore / scheduled maxPieces
       -> best/median/elite tetrisLineShare（诊断）
  -> 固定复评
       -> score-first 发布裁决
       -> counts/share 进入审计事件与权重元数据

出生姿态 + 棋盘
  -> BFS 可达状态
       -> 原顺序的最终锁定落点
       -> 每个最终落点的最短 hard-drop 预定位路径
  -> bestPlacement 只按最终棋盘选择
  -> 浏览器回放预定位动作并立即 hard drop
```

## 错误处理与安全边界

- hard-drop 投影映射缺少某个已发现锁定落点时立即抛出内部错误；不静默退回旧全程 soft-drop 路径。
- `lineClearValue` 只接受整数 `0..4`。逐局 counts 必须是非负整数；按局平均后的 counts 可以是非负有限小数；二者都必须与各自的 line 总数一致。
- 旧权重兼容仅限明确的 legacy/runtime 九键分支以及 version 2 + v1 + 九键组合；新权重严格验证 objective、version 和十键集合。
- 训练 fresh-run/resume 检查继续先于目录创建、worker 启动和任何写入。
- `src/ai/` 继续保持纯函数边界；不新增 Node、DOM、文件系统依赖或模块级可变状态。
- 棋盘行不可原地修改；hard-drop 投影只能生成新的 `Piece` 姿态。
- 本设计及其实现验证不读取、移动、归档或删除已有 checkpoint/log，也不运行真实训练。

## 文件边界

预计涉及：

- `src/ai/placements.ts`、`placements.test.ts`：hard-drop 投影路径与落点顺序/完整性测试；
- `src/ai/replay.ts`、`src/hooks/useAiPlayer.ts` 及测试：携带 target、预定位路径验证与最后动作后立即硬降；
- 新建 `src/ai/lineClears.ts` 及测试：counts、真实消行价值和比例纯函数；
- `src/ai/features.ts`、`features.test.ts`：追加第 10 个特征；
- `src/ai/simulate.ts` 及测试：按真实锁定结果累计 counts；
- `src/ai/weights.ts` 及测试：严格 v1 九维适配和 v2 十维解析；
- `training/pool.ts`、worker 类型与测试：传递或构造合法 counts；
- `training/cem.ts`、`train.ts` 及测试：诊断聚合和日志字段，保持 fitness 不变；
- `training/benchSummary.ts`、`bench.ts` 及测试：四消统计输出；
- `training/objective.ts`、`runArtifacts.ts`、publication/reevaluation 类型与测试：v2/schema 3/复评元数据；
- `src/training/dashboard/`：读取 v2 日志并显示两个 tetris share 摘要；
- `docs/ai-training-handoff.md`：实现验证完成后更新当前契约与授权边界。

不新增运行时依赖，不创建第二套训练专用 AI 逻辑。

## 测试策略

实现阶段按红—绿顺序使用最短相关测试：

1. **路径测试**
   - 修改前后固定棋盘/全部七种方块的最终 cell-key 列表完全相同且顺序相同；
   - 每条预定位路径合法，hard drop 后命中声明落点；
   - 空棋盘普通落点消除无必要 `down`；
   - tuck 落点和 SRS 路径仍存在；
   - normal/slow 最后一个预定位动作后同回调 hard drop，重力偏移仍触发重规划。
2. **特征与兼容测试**
   - `lineClearValue` 精确为 `0/1/3/5/8`；
   - `FEATURE_NAMES` 固定十项且旧九项位置不变；
   - v1 九键权重只追加零并保持原向量范数和决策；
   - v2 缺键、多键、九维 checkpoint 和错误 objective 全部拒绝且无写入。
3. **模拟与统计测试**
   - single/double/triple/tetris fixture 同时钉住 score、lines 和 counts；
   - `lines == totalLinesFromCounts`；
   - share 的零分母和边界正确；
   - worker 失败结果为零 score、零 counts、最差诊断高度；
   - benchmark 与 CEM 聚合使用 scheduled denominator，fitness 数值与 v1 逐字一致。
4. **日志与发布测试**
   - generation、fixed reevaluation、bestEver 和权重元数据携带一致的 counts/share；
   - 四消指标不改变 score-first 与 0.1% height tie-breaker；
   - dashboard 只接收 v2 generation 行，兼容缺少新增诊断字段的同目标旧行。

完整代码验证命令仍为：

```powershell
npm test
npm run build
npm run typecheck:train
```

这些命令不启动训练。实现完成不能仅凭测试宣称四消策略已出现。

## 分阶段验收与授权门

### 阶段 1：代码与执行路径

无需训练即可验收：

- 完整测试、构建和训练侧类型检查通过；
- 当前 v1 权重经零扩展后，固定小种子模拟结果保持确定性；
- 浏览器 normal/slow 模式普通落点表现为提前预定位并立即硬降；
- tuck 回放仍成功；
- Git diff 不包含生成权重或 `public/ai/` 产物。

### 阶段 2：隔离 smoke（需要单独授权）

只有用户明确授权后，才可在空的新目录执行 2 代短跑。启动前仍需检查进程、目标目录、checkpoint/log、发布权重和 tracked 权重 diff。smoke 只验证：

- score-rate 分布和 sigma 为有限数并具有可见差异；
- counts/share 与 lines 一致，日志和面板能观察；
- 最佳/精英候选是否产生非零四消信号；
- smoke 目录之外的 checkpoint、日志和两份发布权重保持原哈希。

若两代中 `bestTetrisLineShare` 和 `eliteTetrisLineShare` 都持续低于 `0.01`，则停止，不投入正式长跑，并为“干净单井特征或更长视野”另写设计。

### 阶段 3：正式候选与独立验收（均需单独授权）

正式训练、固定复评写入、发布以及独立 benchmark 仍分别受现有授权门控制。若产生 v2 候选，只有独立 30 局 × 5000 pieces、相同 seeds/depth/cap 的 paired benchmark 才能支持“优于当前发布权重”的结论。

四消策略目标的验收条件为：

- 候选与基线使用逐局配对统计，候选 score-rate 差值的 95% paired 区间下界大于 `0`；
- 候选 30/30 达到 piece cap，或至少不低于基线存活表现；
- 候选 `tetrisLineShare >= 0.20`；这等价于至少 20% 的消行来自四消，在接近理论消行上限时约对应每 100 个方块至少 2 次四消，足以把偶发四消与可见策略区分开；
- 候选相对基线的逐局 `tetrisLineShare` 差值 95% paired 区间下界大于 `0`。

四消指标不参与 CEM fitness 或发布裁决。若分数提高但未达到四消门槛，可以认定模型得分改进，但不能宣称本设计的“四消策略可见”目标已经完成。

## 风险与后续决策

- **局部最优仍可能存在**：新特征让四消奖励可表达，但 depth 2 未必足以维持长期井。统计无改善时停止，而不是盲目延长训练。
- **特征尺度变化**：`lineClearValue` 最大为 8，高于 `linesCleared` 的 4，但 CEM 权重归一化并不等于特征归一化；短跑需观察该维权重和 sigma 是否立即支配搜索。
- **旧模型兼容错误**：任何非显式的补零或键重排都可能静默错位，必须用严格 schema 和端到端固定种子回归锁定。
- **执行与训练意外耦合**：hard-drop 路径实现必须保持落点集合及顺序；否则即使权重不变也可能改变 tie 决策。
- **风格与真实目标冲突**：若四消占比提高但 score-rate 下降，不发布、不把四消 bonus 加进 fitness 掩盖问题。

只有在上述分阶段证据表明线性真实消行价值仍不足时，下一份设计才比较受控单井特征、bag/hold 信息或更深的 beam/expectimax 搜索。
