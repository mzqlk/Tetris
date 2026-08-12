# bag-aware expectimax + Hold 四消搜索设计

**日期：** 2026-08-12
**状态：** 设计已批准，等待书面规格复核；尚未实施、训练或验收
**当前发布基线：** gen-40 `score-rate-v2`、10 维权重、depth 2、无 Hold
**当前训练产物：** `public/ai/score-rate-v3/` 已到 gen 10，必须原地保留且不得由本设计续训

## 1. 背景与失败证据

`score-rate-v3` 在原有十维 afterstate 评价尾部增加了 `cleanWellDepth`、`tetrisSetupProgress` 和 `tetrisReadyRows`，但搜索仍只观察当前块和一个预览块。gen-10 固定复评结果为：

| 指标 | gen-40 发布基线 | v3 gen-10 候选 |
|---|---:|---:|
| score rate | 657.849 | 619.531 |
| tetris line share | 0.00667% | 0.07338% |
| 达到 piece cap | 30/30 | 30/30 |

候选四消占比只达到 20% 门槛的约 0.367%，得分率低 5.825%。训练过程中的 elite 四消信号也持续极弱。继续增加代数或 piece cap 不能弥补搜索看不到多块建井收益的问题，因此停止 v3 长训，升级策略架构。

根因位于搜索状态和规划跨度，而不是四消没有被真实计分：同等级下，一次四消的引擎得分高于拆成多次低阶消行；`score-rate` 本应奖励成功四消。当前 depth-2 afterstate 搜索缺少三项关键能力：

- 无法把 I 块保存在 Hold 中等待井完成；
- 无法跨四个锁定块评价建井与兑现；
- 无法在不读取隐藏袋序的前提下利用七袋分布。

## 2. 目标、成功标准与非目标

### 2.1 目标

建立浏览器与 Node 训练共用的公开信息搜索：标准 Hold、七袋剩余集合、精确机会节点、beam 截断和四锁定层 expectimax。AI 必须只使用玩家可见信息，不得读取环境内部的精确袋序或 RNG。

最终候选必须同时满足：

- 固定复评 `tetrisLineShare >= 0.20`；
- 30/30 达到 5000-piece cap，即不低于当前 gen-40 的历史存活表现；
- 保持现有 score-rate 资格规则；
- 独立 paired benchmark 中，候选相对基线的逐局 score-rate 差值 95% CI 下界大于 `0`；
- 同一 paired benchmark 中，逐局 `tetrisLineShare` 差值 95% CI 下界大于 `0`。

### 2.2 非目标

- 不把四消占比、Hold 次数或人工四消 bonus 加入 CEM fitness；
- 不改变引擎消行计分、SRS 或合法落点定义；
- 不让训练搜索读取 simulator 的精确 `bag`；
- 不采样未来袋序来近似机会节点；
- 不在运行时静默降低训练 depth 或 beam；
- 不原地迁移、删除、覆盖或续训现有 v1/v2/v3 产物；
- 本设计批准不授权实现、smoke、正式训练、benchmark、发布或 push。

## 3. 方案选择

采用统一的公开信息 `expectimax + beam`，不在旧搜索外叠加硬编码四消策略层，也不使用深层落点模板。Hold、袋知识、落点和价值传播进入同一状态模型，使训练与浏览器共享同一策略契约。

总体数据流：

```text
EnvironmentState（真实袋序，仅负责实际出块）
        │ projectPublicState
        ▼
PublicSearchState（玩家可见状态）
        │ iterative deepening: 1 -> 2 -> 3 -> 4
        ▼
decision / exact chance / beam search
        │
        ▼
Place(placement) 或 Hold
        │
        ▼
环境执行一个当前可执行动作，再从新公开状态重规划
```

## 4. 信息边界与公开袋知识

### 4.1 环境状态与搜索状态分离

浏览器 store 和训练 simulator 可以在环境层保存精确袋序及 RNG，因为它们必须实际出块；这些字段不得进入搜索接口。

搜索只接收不可变公开快照：

```ts
interface PublicSearchState {
  board: Board;
  current: Piece;
  next: PieceType;
  hold: PieceType | null;
  holdAvailable: boolean;
  unseenBagMask: number;
}
```

`current` 保留当前真实姿态，使浏览器在重力移动后仍能从可达位置重新枚举落点。`next`、`hold` 和 `unseenBagMask` 只描述玩家能观察或由公开历史精确推导的信息。

稳定公开状态始终有一个已公开的 `next`。锁定或空 Hold 后尚未产生新 preview 的中间状态使用独立的内部 `PendingPreviewState`，不能用 `next = null` 混入普通决策节点。

### 4.2 七袋剩余集合

标准七袋中每种方块只出现一次，因此袋知识使用七位 bitmask 表示“已公开 next 所属袋，在 next 之后尚未公开的类型集合”，不记录顺序。这样即使 current 是上一袋最后一块、next 是新袋第一块，状态仍只有一个明确含义：mask 表示下一次抽取前新袋还剩的六种类型。

- 初始公开 current 与 next 后，若两者来自同一袋，mask 是该袋扣除 current 与 next 后的剩余集合；若 current 是上一袋最后一块，则 mask 是 next 所属新袋扣除 next 后的剩余集合；
- 每次机会节点公开新的 next，就从当前 mask 移除该类型；
- 机会节点需要抽取而 mask 为空时，先恢复完整七种，再展开七个等概率分支；
- 环境实际抽到并公开某类型后，公开集合执行同样的确定性转移；
- Hold 非空交换不会抽块，也不会改变集合。

两个隐藏袋序不同、但公开快照相同的环境必须得到完全相同的搜索首动作。这是信息公平性的独立回归契约。

### 4.3 纯逻辑边界

公开状态投影、袋知识转移、Hold 转移和搜索都位于共享 `src/ai/` 纯逻辑中。除现有浏览器专用 `loadWeights.ts` 外，`src/ai/` 不引入 DOM、Node、文件系统或模块级可变状态。所有 board 转移创建新行，不原地修改可能共享的行数组；落点继续走引擎旋转和 SRS。

## 5. 标准 Hold 语义

浏览器与 simulator 共用标准规则：

- 每个锁定回合最多 Hold 一次；
- Hold 为空时，当前块进入 Hold，原 next 提升为 current，并从环境抽取一块公开为新 next；
- Hold 非空时，current 与 hold 交换，不消费 next 或袋中方块；
- Hold 后新 current 从标准出生姿态开始；若出生位置无效则该分支终局；
- Hold 后立即设置 `holdAvailable = false`；
- 当前块锁定后恢复 `holdAvailable = true`。

共享状态转移拆成两个职责清晰的纯操作：

```ts
applyHold(state): HoldTransition
lockPlacement(state, placement): LockTransition
```

它们只完成确定性变换；需要公开新 preview 时返回 `PendingPreviewState`。真实环境负责按隐藏袋序抽块，搜索则进入精确机会节点。这样同一转移语义不会复制成浏览器版和训练版。

浏览器增加可见的 Hold 预览，并让人工 Hold 与 AI Hold 调用同一个 store action。AI 若选择 Hold，只执行 Hold；待环境公开新 preview 后，从新的公开快照重新规划，不提前执行依赖未知 preview 的落点。

## 6. 搜索动作、深度与 Beam

### 6.1 动作模型

决策节点只有两类动作：

```ts
type SearchAction =
  | { kind: 'place'; placement: Placement }
  | { kind: 'hold' };
```

- `Place` 锁定当前块并让剩余锁定深度减一；
- `Hold` 不消耗锁定深度，但把 `holdAvailable` 置为 `false`，所以不能形成 Hold 循环；
- 根调用只返回一个当前可执行动作。浏览器现有定位计划继续负责把 `Placement.moves` 通过 store action 回放并 hard drop。

### 6.2 深度口径

最大深度为四个锁定块，当前块计为第 1 层：

```text
depth 1 = 当前块
depth 2 = 当前块 + 后续 1 个锁定块
depth 3 = 当前块 + 后续 2 个锁定块
depth 4 = 当前块 + 后续 3 个锁定块
```

Hold 属于当前锁定层的动作选择，不额外增加或减少锁定层。每次实际锁定后重新进行滚动深度 4 规划。

### 6.3 Beam 规则

- 根决策节点最多保留 64 个落点；
- 后续每个决策节点最多保留 32 个落点；
- 落点先按当前 13 维 afterstate 评价排序，再按稳定的落点序规则打破同分；
- Hold 分支独立保留，不占落点 beam 名额，也不会被 afterstate 预排序淘汰；
- beam 只截断落点动作，不截断机会节点中的方块类型。

`FEATURE_NAMES` 的 13 维顺序保持不变。搜索升级改变权重的作用语境，因此旧权重只能作为兼容基线，不能把旧 checkpoint 续训为新策略。

## 7. 精确 Expectimax 与价值传播

### 7.1 机会节点

需要公开新 preview 时，对 `unseenBagMask` 中每一种类型各展开一次：

- 七袋内每个剩余类型概率相等；
- 分支状态从集合移除已公开类型；
- 集合为空时先开启完整新袋；
- 分支值按真实概率加权平均；
- 不采样 RNG，不读取环境真实袋序；
- 相同公开状态可通过局部 transposition table 合并。

### 7.2 二元价值

搜索值为：

```ts
interface SearchValue {
  survivalProbability: number;
  expectedHeuristicValue: number;
}
```

机会节点分别对两项求期望。决策节点按字典序比较：先最大化四层范围内的 `survivalProbability`，相同时再最大化 `expectedHeuristicValue`。

`expectedHeuristicValue` 是每个已锁定 afterstate 的 13 维线性评价之和，不新增折扣参数。无合法落点、Hold 后出生失败或机会分支出生失败时，该分支存活值为 `0`。完成全部计划深度的分支存活值为 `1`。因此“某一种未来块会顶出”只按其真实概率降低期望存活，不会被 `-Infinity` 误算成所有未来必死。

搜索中的存活概率只用于处理近期终局，绝不进入 CEM fitness。训练适应度仍精确为：

```text
fitness = meanScore / scheduled maxPieces
```

`tetrisLineShare`、Hold 率和策略诊断也不进入 fitness、精英排序或 CEM 分布更新。

### 7.3 递归语义

```text
V(state, lockedDepth)
  decision:
    Place(p) -> immediateAfterstate(p)
                + (lockedDepth == 1
                   ? leaf value
                   : Chance(next preview)
                     + V(next public state, lockedDepth - 1))

    Hold(non-empty) -> V(swapped state, lockedDepth)

    Hold(empty) -> (lockedDepth == 1
                    ? leaf decision on the known promoted current
                    : Chance(new preview)
                      + V(promoted state, lockedDepth))
```

当 `lockedDepth = 0` 时返回 `(1, 0)`。在 `lockedDepth = 1` 的叶层，Place 不再展开对下一 preview 没有价值影响的机会节点；空 Hold 只对已知的 promoted current 做叶层落点评价，不把未知 next 伪装成稳定公开状态。Hold 后仍使用同一锁定深度，但 `holdAvailable=false` 保证递归前进。

## 8. 预算、缓存与超时回退

### 8.1 注入式预算

搜索核心不直接读取系统时间，而接收调用方预算：

```ts
interface SearchBudget {
  maxRootPlacements: 64;
  maxChildPlacements: 32;
  maxLockedDepth: 4;
  shouldAbort(): boolean;
}
```

- 训练、benchmark 和确定性测试传入永远返回 `false` 的 `shouldAbort`，必须完成固定 depth/beam；
- 浏览器 adapter 使用单调时钟构造 `shouldAbort`；`instant` 目标预算为 100 ms，`normal/slow` 为 200 ms；
- 墙钟预算是协作式软上限，搜索在节点边界检查中止条件；它不承诺硬实时截止。

机器速度不得改变训练或 paired benchmark 的策略。训练路径不接受墙钟截断，也不在超时时静默降级。

### 8.2 迭代加深与回退

浏览器按 `1 -> 2 -> 3 -> 4` 迭代加深：

- 只有一个深度完整计算结束后，才保存其根决策；
- 当前深度中止时，丢弃该深度的全部部分结果；
- 返回最近一个完整深度的决策；
- 若 depth 1 尚未完成，则完整枚举一次根落点并按单步 afterstate 稳定排序，作为应急结果；
- 部分机会节点、部分 Hold 分支或部分 beam 结果不得影响最终动作。

### 8.3 Transposition table

缓存只存在于单次规划调用内，不使用模块级缓存。键至少包含：

```text
board cells + current type/rotation/position + next + hold
+ holdAvailable + unseenBagMask + remainingLockedDepth
+ root/child beam config
```

权重在单次调用中固定，无需写入键。只缓存完整计算的节点；中止节点不得缓存。迭代加深可以复用已完整计算的浅层节点，新一次浏览器规划必须创建新缓存。

搜索返回无副作用诊断：

```ts
interface SearchDiagnostics {
  completedDepth: number;
  expandedDecisionNodes: number;
  expandedChanceNodes: number;
  cacheHits: number;
  aborted: boolean;
}
```

这些诊断用于 smoke 和性能判断，不进入策略分数。

## 9. 浏览器与训练集成

### 9.1 浏览器

GameState 增加 `holdPiece`、`holdAvailable` 和公开 `unseenBagMask`。内部精确 `bag` 继续只供环境抽块。Hold 预览对玩家可见；人工输入和 AI 都调用同一个 Hold action。

AI 规划保持现有自愈语义：定位期间若重力改变 current 姿态，旧计划失效并从新公开快照重规划。选择 Hold 后不复用原定位计划；执行 Hold、等待同步 store 更新，然后重新调用搜索。

### 9.2 训练 simulator

simulator 继续按 seed 保存精确袋序，保证对局可复现；每次决策前仅投影 `PublicSearchState` 给搜索。搜索得到 `Place` 或 `Hold` 后，由 simulator 的真实环境状态执行。任何搜索函数签名、任务 payload 或诊断不得包含精确 `bag`、bag index 或 RNG 状态。

记录以下非适应度诊断：

- `holdActions` 与每锁定块 Hold 率；
- 完成的平均/最小搜索深度；
- decision/chance 节点与 cache hit 汇总；
- 现有 1/2/3/4 消直方图、`tetrisLineShare`、存活和四消井诊断。

逐步节点诊断不写入每个动作日志；benchmark/smoke 只输出聚合值，避免产物膨胀。

## 10. 版本、产物与基线

搜索语义变化使旧训练分布不可续用。先完成纯搜索原型、固定语料吞吐门和跨环境契约测试；只有这些代码门通过并取得新的运行授权后，才创建新训练产物。新契约固定为：

- objective：`score-rate-v4`；
- 搜索契约：`bag-expectimax-hold-v1`；
- checkpoint/新权重 schema version：5；
- 特征：现有精确 13 维，顺序不变；
- 固定训练搜索：四锁定层、根 beam 64、后续 beam 32、精确机会节点、标准 Hold；
- 新训练使用单独且启动时为空的 output dir，具体路径在运行授权时选择。

schema 5 checkpoint、generation log、reevaluation、candidate 和最终权重必须携带搜索契约及固定 depth/beam。配置不一致时 fail closed。schema 1–4 checkpoint 和 v1–v3 日志均不得 resume 或 append。

当前 `public/ai/score-rate-v3/` 的 gen-10 checkpoint/log 保持原地不变；本设计不删除、移动、归档或覆盖它们。现有 bundled/runtime gen-40 权重也不在兼容加载时改写。

### 10.1 新搜索下的不可变基线

paired 比较必须使用相同搜索契约，因此实现完成并获得单独运行授权后，先把当前发布的 gen-40 权重在 `bag-expectimax-hold-v1`、depth 4、相同 beam 下做固定复评，形成 run-local immutable baseline。旧十维权重只在内存补三个零尾维。

这一步衡量的是“gen-40 权重在新公共搜索架构下”的基线，不是历史 depth-2 runtime 的复现。候选与该基线使用完全相同的搜索和 Hold 能力，从而 paired 结果只比较权重策略。历史 gen-40 的 30/30 存活仍是最终存活下限。

固定复评不是独立 paired 证据；二者继续使用不同种子集合。

## 11. 阶段门与验收

### 11.1 代码门

实现后先运行最短相关测试，再分别运行：

```powershell
npm test
npm run lint
npm run build
npm run typecheck:train
```

还需用固定棋盘语料记录 depth、节点数、cache hit 和浏览器预算回退。代码门只能证明契约实现，不能证明搜索吞吐可接受、训练出现四消信号或模型达标。

### 11.2 搜索可行性与短信号门

运行前必须单独获得 smoke/benchmark 授权，并重新核验 Git、进程、代理/`NO_PROXY`、目标目录、checkpoint/log 和发布权重哈希。

短 smoke 必须同时证明：

- Node 固定模式确实完成 depth 4，没有墙钟降级；
- 吞吐可用于后续训练，节点数没有失控；
- Hold 使用率非零；
- 四消占比或四消井诊断出现非零信号；
- smoke 目录之外的训练产物和发布权重未变化。

任一条件失败就停止；不得通过增加 generations、提高 piece cap、降低固定 depth/beam 或改写门槛绕过。性能参数变更需要独立设计修订。

### 11.3 正式候选门

正式训练仍以 `meanScore / scheduled maxPieces` 更新 CEM。只有固定复评候选同时满足以下条件，才允许写 run-local `candidate-weights.json`：

- `tetrisLineShare >= 0.20`；
- `pieceCapGames = 30`；
- 按现有包含边界的 0.1% score tolerance 规则高于新搜索下的 immutable gen-40 基线；
- candidate metadata 精确匹配 schema 5 与 `bag-expectimax-hold-v1`。

未通过四消或存活门的高分模型只能记为诊断，不得成为 qualified candidate。训练器不得自动覆盖 runtime 或 bundled 权重。

### 11.4 独立 paired 门

qualified candidate 与 immutable gen-40 基线使用独立、相同的逐局 seeds、depth 4、beam 和 5000-piece cap。必须同时满足：

- score-rate 逐局差值的 paired 95% CI 下界大于 `0`；
- `tetrisLineShare` 逐局差值的 paired 95% CI 下界大于 `0`；
- 候选 30/30 达到 cap。

固定复评通过不能替代 paired 门。paired 通过后，发布、提交/push 和浏览器 runtime 验收仍分别需要授权。

## 12. 测试矩阵

### 12.1 公开袋与 Hold

- 初始 current/next 从公开集合各移除一次；
- 空 Hold 只抽取并公开一个新 next；
- 非空 Hold 不抽块、不改变 next 或集合；
- 同一回合第二次 Hold 被拒绝；
- Hold 后新块恢复出生姿态并正确处理出生失败；
- 锁定后恢复 Hold；
- 袋末抽取与新袋起点不重复、不丢块；
- 输入状态和 board 行均未被原地修改。

### 12.2 Expectimax 与 Beam

- 手工小树的机会概率和为 1，期望值与解析结果一致；
- “一个坏未来块”按概率降低存活，而不是令整个动作 `-Infinity`；
- 决策节点先比较存活概率，再比较启发式值；
- Hold 分支不占 beam 且不会被淘汰；
- 根 64、后续 32 的边界精确；
- depth 4 包含当前块在内恰好四个锁定；
- 同分动作使用稳定规则；
- 缓存开启/关闭返回相同动作和值；
- 不同隐藏袋序、相同公开快照得到相同首动作。

### 12.3 中止与一致性

- depth 2 完整、depth 3 中止时只返回 depth 2 结果；
- 部分机会节点和部分 Hold 分支不进入缓存或结果；
- depth 1 中止时返回完整单步应急落点；
- 训练预算永不中止且相同输入结果确定；
- 浏览器与 simulator 对相同公开状态、权重和固定预算返回相同首动作；
- 两端执行相同 Hold/锁定序列后公开状态一致；
- 重力导致计划失效时重新规划。

### 12.4 Artifact 与回归

- schema 5 exact-key、finite-number、objective、搜索契约和 beam/depth 校验；
- schema 1–4 resume/append 拒绝；
- 9/10/13 维历史权重只在内存兼容，不改写文件；
- `FEATURE_NAMES` 顺序不变；
- CEM fitness 不受 Hold 率、四消占比或搜索诊断影响；
- candidate、immutable baseline 与 published weights 路径隔离；
- 损坏日志/checkpoint 在创建 worker 或写文件之前失败；
- 现有落点枚举、SRS、路径回放和 hard drop 回归保持通过。

## 13. 错误处理与交付边界

- 非有限启发式值、非法概率、未知 bag mask、无效 Hold 状态或不完整缓存项立即失败；
- 稳定公开状态缺 current/next 时拒绝搜索，不用隐式随机抽块修复；
- 浏览器中止只触发已批准的完整深度回退，不改变训练配置；
- 环境与公开袋集合不一致时在测试/开发诊断中 fail closed，不把精确袋序暴露给搜索来“校正”；
- 任何 artifact 迁移、训练、benchmark、paired、发布或 push 都必须在对应门重新获取授权并刷新现场证据。

本规格完成后的下一步仅是编写实施计划。实施计划获批也不自动授权执行。
