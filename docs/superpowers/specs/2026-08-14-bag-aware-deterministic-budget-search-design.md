# bag-aware expectimax + Hold v2 确定性预算搜索设计

**日期：** 2026-08-14
**状态：** 用户已批准；Task 1-2 已实施，旧 Task 3 精确整数校准门已阻塞，2026-08-20 稳定性修订已批准；尚未训练、benchmark、发布或运行时验收
**新契约：** `score-rate-v5` / schema 6 / `bag-expectimax-hold-v2`

## 1. 背景与结论

`bag-expectimax-hold-v1` 的公开七袋、标准 Hold、精确机会节点和
survival-first 价值语义已经实现，但固定 depth 4、root beam 64、child
beam 32 的完整搜索在普通低堆局面上不可执行。两轮保持语义不变的优化已经加入紧凑状态键、落点原型复用、有界缓存、等价公开状态合并和安全存活上界剪枝，仍未跨过负载门：

- 10 万次有界检查约耗时 2.9 秒，峰值约 281 MiB；
- 512 MiB 隔离 worker 约 10.5 秒后发生 Node/V8 native fatal；
- 搜索没有返回完整 depth-4 结果；
- 一代训练会在首批 worker 任务上持续耗尽内存，无法产生有效 generation 结果。

因此 v1 的“每次决策必须完整算完 depth 4”不再是生产可行契约。本设计选择新的
`bag-expectimax-hold-v2`：保留公开信息、精确概率、4/64/32 最大搜索范围和价值语义，但用确定性 work-unit 上限约束每次决策，并且只提交完整完成的深度。

v2 不声称与 v1 的完整 depth-4 结果等价。它是新的训练计算图，必须与旧 checkpoint、日志和候选完全隔离。

## 2. 目标与非目标

### 2.1 目标

- 每次搜索都有严格、可复现的 work-unit 上限，不以 wall clock 决定动作；
- 训练、benchmark 和所有浏览器速度使用同一搜索配置和同一纯逻辑；
- 任意合法公开状态都能完整完成 depth 1；
- 在预算允许时依次完整完成 depth 2、3、4，只返回最后一个完整深度；
- 普通参考机的浏览器决策 p95 不高于 200 ms；Node 校准以 140 ms 选择线保留余量，再以 160 ms 冻结值验证线验收；
- 保留精确七袋机会节点、标准 Hold、root beam 64、child beam 32 和 survival-first 比较；
- 保持 scalar fitness 为 `meanScore / scheduled maxPieces`，搜索诊断不进入 CEM 排序。

### 2.2 非目标

- 不恢复 v1 的完整 depth-4 等价性；
- 不按浏览器速度、机器快慢或 worker 数动态调整预算；
- 不使用 wall-clock deadline、采样袋序、隐藏 RNG、隐藏精确 bag 或概率近似；
- 不降低最大 depth、root beam 或 child beam；
- 不给四消、Hold、存活时长或完成深度增加额外 fitness bonus；
- 不修改 SRS、引擎计分、落点合法性或 13 维 `FEATURE_NAMES` 顺序；
- 不迁移、续接、删除或覆盖 v1-v4 训练产物；
- 本规格与实施计划不授权训练、benchmark、paired benchmark、发布、push 或浏览器运行时验收。

## 3. 固定不变的搜索语义

搜索输入仍只有：

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

搜索不得读取环境的有序 bag、bag index、seed 或 RNG。机会节点枚举
`unseenBagMask` 中每一种方块，使用精确相等条件概率；mask 为空时按完整新七袋展开。Hold 仍是每锁定回合一次：空 Hold 消耗并公开一个 preview，非空 Hold 交换，锁定后恢复。

价值仍按以下顺序比较：

1. `survivalProbability`；
2. `expectedHeuristicValue`；
3. 现有稳定枚举顺序。

当前块计为 lock depth 1；Hold 不消耗 lock depth。每层仍先按立即启发式值降序、枚举索引升序选择 beam，根 64、子层 32；Hold 在 placement beam 之外。现有等价状态合并和存活概率上界剪枝只能在已证明不会改变完整层结果的位置生效。

## 4. 选择的架构

采用“全局预算账本 + 完整深度事务提交”。一次决策创建一个纯函数作用域内的
`WorkBudgetLedger`、一个有界 placement prototype cache 和一个有界 transposition cache。depth 1 到 depth 4 共用这三个对象。

```ts
type WorkUnitKind =
  | 'placementEvaluation'
  | 'chanceExpansion'
  | 'cacheHit';

interface WorkBudgetLedger {
  readonly limit: number;
  readonly used: number;
  tryConsume(kind: WorkUnitKind): boolean;
}
```

`tryConsume` 只能把 `used` 从 `n` 变为 `n + 1`，且永远不能超过
`limit`。账本没有时钟、随机数或模块级状态。

一次搜索的数据流是：

```text
validate public state / weights / v2 limits
        |
create one ledger + bounded caches
        |
complete depth 1 -> commit action/value
        |
complete depth 2 -> replace committed result
        |
complete depth 3 -> replace committed result
        |
complete depth 4 -> replace committed result
        |
return the deepest complete result
```

如果某层预算耗尽，“不完整”沿递归调用栈向上传播并停止本次搜索。当前层的部分值、部分机会期望和部分 cache 条目都不能成为可提交结果。上一完整层的动作和值保持不变。

## 5. Work-unit 精确定义

以下操作在执行前各扣 1 unit：

1. 对一个已经枚举为合法的落点调用一次 `evaluatePlacement`，包括 lock、clear、特征提取和权重点积；
2. 展开一个精确机会结果，包括公开该 preview 并进入对应 child；即使 child 立即终局也计费；
3. placement prototype cache 或 transposition cache 命中并使用其结果完成一次分支遍历。

如果 `tryConsume` 返回 `false`，对应操作不得执行。cache miss、键构造、稳定排序、公开状态的常数级转移和最终值比较不单独计费；它们受棋盘尺寸、beam 和已计费分支数约束，并由 wall-clock 验收捕捉实现回归。

机会分支若随后命中 transposition cache，会先为机会展开扣 1 unit，再为 cache-hit 遍历扣 1 unit。placement prototype cache 命中按一次列表复用扣 1 unit，不重新按列表内落点收费；首次构建时仍对每个实际启发式评估收费。

现有剪枝和缓存使实际 unit 用量下降，但不会产生免费递归。缓存容量和策略会影响同一预算能完成的深度，因此是 v2 搜索配置的一部分，必须固定并写入 schema 6 metadata。

## 6. Depth-1 保证与预算耗尽

生产配置若低于 depth-1 静态上界，必须在搜索开始前 fail closed。不得进入搜索后再执行预算外 fallback。

令 `P` 为单一方块在固定 10 x 22 棋盘中的合法锁定姿态数上界。`P` 从方块每个 rotation 的边界盒推导：

```text
P = max over piece types of
    sum over rotations (
      (boardWidth - rotationWidth + 1)
      * (boardHeight - rotationHeight + 1)
    )
```

真实 SRS 可达且能锁定的落点集合是该有限姿态集合的子集。depth 1 最多需要评估当前块和一次 Hold 后的新当前块两个 placement 集合；不会在叶后公开下一 preview。因此：

```text
DEPTH_ONE_REQUIRED_WORK_UNITS = 2 * P
```

若两个集合复用 cache，cache-hit 的 1 unit 小于被上界替代的 `P` 次评估，所以该式仍安全。实现必须从共享棋盘/shape 常量计算该值，并用测试固定；不得从 96 状态语料的观察最大值猜测。

固定 `maxWorkUnits` 必须满足：

```text
maxWorkUnits >= DEPTH_ONE_REQUIRED_WORK_UNITS
```

depth 1 若仍意外耗尽，视为实现不变量破坏并抛错，不选择单步应急落点。depth 2-4 耗尽属于正常结果：返回上一完整层并设置诊断。无合法动作的终局不是预算耗尽。

## 7. Cache 与事务边界

v2 延续每次搜索私有、容量固定的 cache，不增加跨搜索或模块级可变 cache。初始配置继续使用：

- transposition cache 上限 65,536 entries；
- placement prototype cache 上限 16,384 entries。

placement prototype 列表只有在该状态的全部合法落点评估完成后才能原子写入 cache。中途耗尽时丢弃正在构建的列表。transposition cache 只写完整、非 dominated 的值；部分机会期望、被预算终止的节点和 dominated partial value 都不写入。

完整的较浅层 cache 可供更深层使用。更深层已经完整计算出的子问题可以正常写入 cache，即使整层随后因另一个分支耗尽；这些条目只影响诊断和本次已消耗工作，不会修改上一层已提交动作。生产 cache 开关和容量固定，不暴露用户可调选项。

## 8. 统一生产入口与消费者

v2 的唯一生产决策入口是确定性迭代搜索。训练 simulator、普通 benchmark、paired benchmark 和浏览器 AI 都必须调用该入口并传同一个冻结配置。v1 的完整 `searchFixed` 可以保留为受限单元测试 oracle，但不能被生产消费者导入，也不能绕过 work-unit 上限。

当前受保护的未跟踪 `training/searchProbe*.ts` 仍静态导入 v1 名称。实施在未获清理授权前保留带 `@deprecated` 注释的 `searchFixed`、`FIXED_SEARCH_LIMITS` 和只供该 probe 编译的 `diagnostics.aborted` 兼容别名；`aborted` 等于 v2 的 `budgetExhausted`，不得写入 schema 6 diagnostics。生产代码不得导入这些兼容符号，验证也不得执行旧 probe。

共享只读常量是生产搜索参数的唯一来源。`TrainConfig` 和 CLI 不再携带或覆盖
`searchDepth`、root/child beam、`maxWorkUnits` 或 cache cap；这些值只作为独立的固定搜索 metadata 写入 artifacts，避免 checkpoint config 与真实执行参数形成两份来源。

浏览器不再创建 `performance.now()` deadline，也不向搜索传 `shouldAbort`。`instant`、`normal`、`slow` 只控制选定动作的回放延迟；三者对相同公开状态和权重必须返回相同动作、完成深度和 unit 诊断。

训练 worker 不读取 wall clock，也不因机器较快而搜索更多节点。worker 数只改变并行吞吐，不改变任何一局的决策图。

## 9. 固定预算校准

新增版本化显式快照语料 `budget-corpus-v1`，共 96 个 `PublicSearchState`：

- 低堆、中堆、高堆、危险堆各 24；
- 覆盖 7 种 current 和 next；
- 覆盖 Hold 为空/非空、可用/已用；
- 覆盖 unseen-bag mask 的不同基数和换袋边界；
- 只包含 board/current/next/hold/holdAvailable/unseenBagMask，不包含隐藏袋序、seed 或 RNG。

语料以显式、可审查的 board row mask 和公开字段提交，不从运行时 seed 动态再生。任何状态内容或顺序变化都必须把 corpus id 升版，并重新校准预算。

校准程序只执行共享搜索，不运行 game simulation、训练、bench 或 paired，不写
`public/ai`。旧的“对 wall-clock 资格谓词做逐整数二分，并要求候选 + 1 失败”方案已经退役：2026-08-20 两次有效运行分别选择 4390 和 3998，证明 1-unit 性能边界小于调度、GC、频率和热状态带来的观测噪声。确定性 work-unit 不意味着 wall-clock 资格谓词严格单调，也不能用一次相邻失败证明精确性能边界。

校准改为两个显式模式：

- `--select`：在候选阶梯上提出一个有安全余量的预算，不修改源文件；
- `--verify-frozen`：只验证共享常量中已经冻结的预算，不重新选择整数。

候选阶梯步长固定为 256 units，从第一个不小于静态 depth-1 下界的倍数开始，即 1536。候选按升序测量；每个候选先完整预热 96 个状态一轮，再测量 5 轮。每轮依次运行 96 状态并计算 p50/p95/max。候选只有同时满足下列结构条件才可进入性能裁决：

- 96 个状态全部完整完成 depth 1；
- 每次 `workUnitsUsed <= maxWorkUnits`；
- 同一状态跨轮的动作、值、完成深度和 unit 诊断一致。

`--select` 只把 5 轮最差 p95 不高于 140 ms 的结构合格候选列为可选。扫描持续到所有语料状态都完整完成 depth 4，或连续两个候选的 5 轮最差 p95 都高于 160 ms；后者是保守停止条件，不声称更大预算在另一次噪声样本中必然更慢。单次选择最多测量 32 个阶梯候选；若此前没有触发任一正常停止条件则 fail closed，防止在 140-160 ms 噪声带内无界扫描。最终提出已扫描候选中最大的可选阶梯值。若没有可选候选、最低候选未完成 depth 1，或任何候选出现透支/非确定结果，选择失败。

冻结提出值后，`--verify-frozen` 必须在同一只读进程中顺序执行 3 个相互隔离的验证 block。每个 block 都重新预热整个语料一轮，再测量 5 轮；搜索本身没有跨决策可变 cache，因此 block 不共享搜索状态。冻结值只有在每个 block 中都满足结构条件且各 block 的最差 p95 都不高于 160 ms 时才通过。验证不要求重新运行选择器，也不要求另一次 `--select` 提出相同预算；可重复性的契约是“同一个冻结预算反复安全通过”，不是“含噪选择器反演出同一个临界整数”。

选择和验证都必须输出单个结构化 JSON。成功与失败输出都包含 mode、corpus id、256-unit 步长、140/160 ms 阈值、Node/OS/CPU、每个已测候选或 block 的完整五轮 p50/p95/max、资格/失败原因、depth histogram、完成深度、work-unit 分类/总量/最大值/分布、透支计数和确定性状态。选择输出 proposed budget 与完整 candidate trace；验证输出 frozen budget 与 3 个 block。不得把先前测量覆盖后丢弃，也不得只打印一句失败消息。命令退出码必须与 JSON 的通过/失败状态一致。

最终整数只有在 `--select` 成功、写入共享常量、随后 `--verify-frozen` 的 3 个 block 全部成功后，才能写入 schema 6 metadata 和本规格的校准证据附录。若最低阶梯预算无法通过 140 ms 选择线，或冻结值无法通过 160 ms 验证线，实施在校准门阻塞。

140 ms 是预算选择线，160 ms 是冻结值验证线；200 ms 仍是单独的普通浏览器运行时验收线。Node 校准通过不等于浏览器验收通过。浏览器验收仍需独立授权；失败时另行修订并重新冻结预算、重跑代码门，不允许运行时按速度动态退化。

## 10. 诊断与训练信号

搜索诊断新增并严格区分正常终局与预算耗尽：

```ts
interface SearchDiagnostics {
  completedDepth: 0 | 1 | 2 | 3 | 4;
  attemptedDepth: 1 | 2 | 3 | 4;
  workUnitsUsed: number;
  workUnitsLimit: number;
  placementEvaluationUnits: number;
  chanceExpansionUnits: number;
  cacheHitUnits: number;
  budgetExhausted: boolean;
  // existing node/cache/reduction/pruning counters remain
}
```

三类 unit 之和必须等于 `workUnitsUsed`。simulation、generation、reevaluation 和 candidate diagnostics 至少汇总：search calls、mean/max used units、budget-exhaustion count/rate、completed-depth 0-4 histogram，以及现有 Hold、node、cache 和策略诊断。

这些字段只用于性能和策略分析，不进入：

- `aggregateFitness`；
- 精英排序；
- CEM `mu`/`sigma` 更新；
- 0.1% 得分并列时的 mean-height tie-break 之外的任何裁决。

## 11. 新训练与 artifact 契约

训练计算图升级并隔离为：

- objective：`score-rate-v5`；
- checkpoint/weight schema：6；
- search contract：`bag-expectimax-hold-v2`；
- 默认 output dir：`public/ai/score-rate-v5/`；
- fitness：仍为 `meanScore / scheduled maxPieces`；
- `FEATURE_NAMES`：仍为精确 13 项且顺序不变。

schema 6 的 checkpoint、generation log、reevaluation schedule/log、candidate 和发布权重 metadata 必须 exact-key 校验以下搜索字段：

```text
searchContract
searchDepth
rootBeamWidth
childBeamWidth
maxWorkUnits
budgetCorpus
transpositionCacheEntries
placementCacheEntries
```

固定值分别对应 `bag-expectimax-hold-v2`、4、64、32、校准后冻结整数、
`budget-corpus-v1`、65,536、16,384。缺失、错误、非整数、额外 key 或互相不一致都 fail closed，并且必须发生在创建 worker、追加日志或写 checkpoint 之前。

schema 1-5、`score-rate-v1` 至 `score-rate-v4` 和
`bag-expectimax-hold-v1` 的 checkpoint/log 一律禁止 resume 或 append。历史 9/10/13 维已发布权重仍可按现有规则只在内存中兼容加载；不得改写原文件。当前 version 3、`score-rate-v2` gen-40 发布模型保持不动。

## 12. Trainer 取消与 checkpoint 边界

v1 性能诊断已经证明当前 SIGINT 处理器并不能中止正在等待的 `pool.run()`：它只设置布尔值，却提前打印“writing checkpoint”。v2 在允许一代 smoke 前必须完成原性能修复规格中已批准的取消契约。

`WorkerPool.run(tasks, { signal })` 接受可选 `AbortSignal`。取消必须以独立的
`WorkerPoolAbortError` 拒绝当前 run，停止喂任务、重试和替换 worker，通过幂等
`destroy()` 终止 in-flight worker，并且不能把取消转换为零 fitness 的失败对局。

trainer 第一次收到 SIGINT 时：

1. 标记停止并 abort 当前 generation 或 reevaluation；
2. 丢弃该未完整边界的全部结果，不更新 CEM、不追加 generation/reevaluation log；
3. 写入最后一个完整 generation 边界的 schema 6 checkpoint；
4. 通过现有 finally 路径销毁 pool、移除 listener 并释放 repository lock。

fresh gen 0 中断时保存初始 `gen: 0` checkpoint，resume 使用相同 seed 重新执行完整 gen 0。第二次 SIGINT 可以请求非零退出，但不能声称 checkpoint 或清理已经完成。

现有失主锁不得自动回收。锁只含 PID、没有 process-start identity，PID 复用使自动删除不安全；任何删除仍需刷新 PID/process/lock 证据并获得独立授权。

## 13. 错误处理

- 非正整数 budget、低于 depth-1 静态下界、错误 cache cap 或不匹配 metadata 立即抛错；
- 非有限权重、非法 bag mask、无效 Hold/公开状态继续 fail closed；
- depth 2-4 的正常预算耗尽返回最后完整深度，`budgetExhausted = true`；
- depth 4 完整时 `budgetExhausted = false`；
- 无合法动作返回终局，不伪装成 budget exhaustion；
- 不完整 placement list、chance expectation 或 transposition value 永远不能缓存；
- 校准脚本发生 nondeterminism、超时、进程错误或字段不一致时退出非零且不写产物。

## 14. 测试与验收门

### 14.1 代码与确定性门

- ledger 的执行前扣费、分类计数、恰好耗尽和永不透支；
- depth-1 姿态上界公式和生产预算下界；
- placement/chance/cache-hit 三类操作精确扣费；
- depth 2-4 中途耗尽只返回上一完整层；
- depth 1 不执行预算外 fallback；
- partial cache 不发布，完整 cache 可跨深度复用；
- 精确袋概率、Hold、beam、stable tie、survival-first 和公开信息边界保持；
- 浏览器与 simulator 对相同输入返回相同动作和诊断；
- 三种浏览器速度不改变搜索参数；
- schema 6 exact keys 与 schema 1-5 resume/append 拒绝；
- fitness 对搜索诊断保持不敏感；
- pool abort 不重试、不产生失败 fitness，worker teardown 幂等；
- trainer SIGINT 不提交 partial generation，保存可恢复边界并释放测试仓库锁；
- 全套 test、lint、build、training typecheck 和 diff check 通过。

### 14.2 校准与性能门

- `budget-corpus-v1` 结构、分层和公开字段覆盖测试通过；
- `--select` 在 256-unit 阶梯上以 140 ms 选择线产生一个提出值；
- 冻结值在 3 个独立 block 中分别满足 5 轮最差 p95 <= 160 ms；
- units 无透支，结果与诊断确定；
- 最终冻结预算不低于静态 depth-1 下界；
- 成功与失败 JSON 都能审计候选/block、资格原因、完整 timing 和 unit 分布；
- 后续单独授权的普通浏览器验收 p95 <= 200 ms。

### 14.3 训练信号门

代码和校准通过后，由用户亲自执行独立空目录的一代 smoke。助手只在运行前核验进程、锁、目标目录和已有 artifacts，提供命令，并在运行后分析：

- generation wall time 与 worker 错误；
- score-rate 分布和 sigma，而非只看 best；
- completed-depth histogram、mean/max units 和 exhaustion rate；
- survival、Hold 和四消诊断；
- checkpoint/log 的 schema 6 连续性。

一代 smoke 不是候选资格或发布证据。

### 14.3.1 Calibration evidence（2026-08-20）

参考机环境为 Node `v24.14.0`、Windows `10.0.22631` x64、
`13th Gen Intel(R) Core(TM) i9-13980HX`；语料为 `budget-corpus-v1`（96 状态），
候选步长 256、选择线 140 ms、冻结验证线 160 ms。执行
`npm run calibrate:search -- --select` 后退出码为 0，提出并冻结 **3584 units**。
选择 trace 如下；`depth` 为 `[0, 1, 2, 3, 4]` 完成深度直方图，三个 unit 列依次为
placement/chance/cache-hit 五轮合计。每个候选均保留 480 个 unit 观测，分布均为
`[budget × 480]`，三类合计严格等于该分布总量，且均为确定性、depth 1 完整、零透支。

| budget | 五轮 p95 ms | worst | depth | placement | chance | cache-hit |
| ---: | --- | ---: | --- | ---: | ---: | ---: |
| 1536 | 64.0896 / 66.4162 / 65.7881 / 65.8968 / 63.7357 | 66.4162 | 0/305/175/0/0 | 693810 | 27590 | 15880 |
| 1792 | 74.8086 / 75.0349 / 74.8278 / 74.1151 / 76.2298 | 76.2298 | 0/265/215/0/0 | 803645 | 35105 | 21410 |
| 2048 | 85.1499 / 87.1081 / 85.9388 / 86.6867 / 88.4306 | 88.4306 | 0/235/245/0/0 | 913020 | 42660 | 27360 |
| 2304 | 91.6950 / 92.8028 / 93.2382 / 94.8695 / 90.8815 | 94.8695 | 0/200/280/0/0 | 1021830 | 50515 | 33575 |
| 2560 | 96.4782 / 96.5007 / 97.9886 / 98.8094 / 98.5935 | 98.8094 | 0/185/295/0/0 | 1129915 | 58665 | 40220 |
| 2816 | 110.0055 / 106.1864 / 110.2026 / 108.1577 / 111.1684 | 111.1684 | 0/155/325/0/0 | 1238175 | 66685 | 46820 |
| 3072 | 116.6478 / 115.4371 / 113.9788 / 116.0060 / 113.2640 | 116.6478 | 0/140/340/0/0 | 1345595 | 75110 | 53855 |
| 3328 | 121.8174 / 122.2191 / 119.5464 / 121.5143 / 121.4883 | 122.2191 | 0/115/365/0/0 | 1452260 | 83955 | 61225 |
| **3584** | **129.0767 / 127.9355 / 126.4894 / 128.5926 / 132.0482** | **132.0482** | **0/100/380/0/0** | **1557890** | **93235** | **69195** |
| 3840 | 133.0240 / 134.8721 / 148.2512 / 151.7207 / 154.3720 | 154.3720 | 0/100/380/0/0 | 1662355 | 103080 | 77765 |
| 4096 | 143.5884 / 138.7160 / 144.2718 / 142.2053 / 145.9810 | 145.9810 | 0/85/395/0/0 | 1765435 | 113685 | 86960 |
| 4352 | 159.9313 / 157.0397 / 149.3618 / 150.5734 / 152.2545 | 159.9313 | 0/70/410/0/0 | 1867500 | 124685 | 96775 |
| 4608 | 161.3583 / 158.2318 / 163.6486 / 161.0408 / 164.2998 | 164.2998 | 0/60/420/0/0 | 1969055 | 136010 | 106775 |
| 4864 | 173.3243 / 171.4644 / 171.6159 / 174.3386 / 170.7646 | 174.3386 | 0/50/430/0/0 | 2069600 | 147950 | 117170 |

选择在 4608 与 4864 连续两个候选高于 160 ms 后按正常条件停止；3584 是所有已扫描候选中最大的
`worst p95 <= 140 ms` 候选，不需要相邻 `+1` 失败证明。

冻结后执行 `npm run calibrate:search -- --verify-frozen`，退出码为 0。三个独立 block
的五轮 p95 分别为：

1. `128.0362 / 127.0659 / 125.0680 / 131.0009 / 126.9730`（worst `131.0009`）；
2. `132.0458 / 132.4942 / 132.0222 / 132.4106 / 127.5154`（worst `132.4942`）；
3. `130.7095 / 126.1156 / 131.8559 / 129.3378 / 132.7468`（worst `132.7468`）。

每个验证 block 的 depth histogram 都是 `0/100/380/0/0`，480 个 unit 值均为 3584；
分类合计均为 placement `1557890`、chance `93235`、cache-hit `69195`，合计
`1720320 = 3584 × 480`。三个 block 全部 depth 1 完整、零透支、动作/价值/完成深度/unit
诊断确定一致。旧的 4390 与 3998 是已拒绝的历史逐整数边界尝试，不是当前冻结或验收证据。

### 14.4 策略与发布门

更长训练、固定复评、30/30 达到 5000-piece cap、
`tetrisLineShare >= 0.20`、score-rate 资格、matched-seed paired score-rate 与
tetris-share 95% CI 下界均大于 0，仍是互相独立的后续门。训练、bench、paired、candidate 生成、发布权重修改和 push 各自需要新的现场核验与授权。

## 15. 实施与授权边界

实施可以修改共享 AI、浏览器消费者、simulator、训练 schema/诊断、测试、README/交接文档，并运行 focused/full test、lint、build、typecheck、`git diff --check` 及只读/不写产物的预算校准程序。

实施不得：

- 运行 `npm run train`、`npm run bench` 或 `npm run bench:paired`；
- 修改、删除或移动 `public/ai/`、`src/ai/trained-weights.json` 或发布权重；
- 清理、暂存或吸收现有未跟踪 `training/searchProbe*.ts` WIP；
- 删除现有失主训练锁；
- 执行 publication、push 或浏览器运行时验收。

## 16. 完成定义

v2 代码只有在以下条件全部成立后才可交给用户做一代 smoke：

1. 固定预算账本、完整层提交和 depth-1 静态保证均通过测试；
2. 所有生产消费者使用同一 v2 配置且没有 wall-clock 决策；
3. `budget-corpus-v1` 以 256-unit 阶梯和 140 ms 选择线提出冻结值，且冻结值通过 3-block、160 ms 验证门；
4. schema 6 / score-rate-v5 隔离和诊断传播通过 exact-key 回归；
5. fresh test、lint、build、training typecheck、diff check 全部通过；
6. controlled SIGINT 测试证明 partial generation 被丢弃、边界 checkpoint 可恢复且测试锁已释放；
7. whole-change review 没有未处理的 Critical/Important finding；
8. 受保护 artifacts、probe WIP 和失主锁保持不变；
9. 交接明确列出未运行的训练、benchmark、paired、发布与浏览器验收门。

达到以上条件只证明确定性预算搜索可以进入训练 smoke，不证明已经训练出稳定四消策略。
