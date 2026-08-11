# score-rate-v3 稳定四消策略设计

**日期：** 2026-08-11
**状态：** 已批准设计，代码契约已实施；训练、验收与发布尚未发生
**当前发布基线：** gen-40 `score-rate-v2`、10 维特征、depth 2
**当前代码/训练器契约：** `score-rate-v3`、13 维特征、权重/checkpoint schema version 4

本次状态更新只关闭代码实现与代码门，不构成模型接受：没有运行训练、benchmark 或 paired benchmark，没有产出 `candidate-weights.json`，没有完成候选验收或发布，也没有进行浏览器/runtime 验收。当前已发布模型仍是 gen-40 score-rate-v2；加载时只在内存中为三个 v3 尾维补 `0`，不改写发布文件。

## 1. 背景与现场证据

设计冻结时，Git HEAD 为 `99a796a feat(ai): publish gen-40 score-rate-v2 weights`。当时 tracked bundled 权重 `src/ai/trained-weights.json` 与 runtime 权重 `public/ai/best-weights.json` 的 SHA-256 同为 `062552496E7E1101502E62B8570DFDAF2A60B54EF4FEF1EA539723B910550D90`；该历史快照不替代每次交付或运行前的现场哈希核验。

gen-40 在固定 30 局 × 5000 pieces、depth 2 复评中，相对 gen-20 基线：

| 指标 | gen-20 基线 | gen-40 v2 |
|---|---:|---:|
| mean score | 3,104,830 | 3,289,243.33 |
| score rate | 620.966 | 657.8487 |
| mean height | 3.35646 | 4.07848 |
| singles / game | 1,708.77 | 1,454.60 |
| doubles / game | 139.43 | 264.77 |
| triples / game | 3.57 | 4.60 |
| tetrises / game | 0 | 0.0333 |
| tetris line share | 0 | 0.00667% |

gen-40 的得分率提高了约 5.61%，但 30 局共 150,000 个调度方块只产生 1 次四消。它主要学会了用更多双消提高得分，不能称为稳定或可见的四消策略。当前可审计产物中也没有 gen-40 相对 gen-20 的独立 paired benchmark，因此“已发布”“固定复评更高分”和“已独立配对验收”必须继续分开。

根因不是落点枚举或执行路径：浏览器与训练共享 `src/ai/` 的纯逻辑，落点枚举使用引擎旋转/SRS，并在定位后立即 hard drop。主要缺口位于策略层：

- `lineClearValue` 只在完成消行后产生信号；
- depth 2 只看当前块和下一块，无法直接看到多块建井收益；
- 通用 `wellDepth` 不能区分干净四消井与危险坑洞，当前 gen-40 权重还对它取负值；
- CEM 只按真实 score rate 选择精英，四消占比只是诊断，因此会优先收敛到更容易获得的双消局部最优。

## 2. 目标与非目标

### 2.1 目标

在不牺牲真实得分率或存活表现的前提下，让策略形成跨随机种子稳定、可见的四消行为：

- 候选 `tetrisLineShare >= 0.20`；
- 候选 30/30 达到 5000-piece cap，或存活表现不低于 gen-40；
- 候选相对 gen-40 的逐局 score-rate 差值 95% paired 区间下界大于 `0`；
- 候选相对 gen-40 的逐局 `tetrisLineShare` 差值 95% paired 区间下界大于 `0`。

同等级下，消掉相同四行时，四次单消得 400、两次双消得 600、一次四消得 800。因此成功的稳定四消策略应通过真实计分提高 score rate；不接受以总分下降换取表面四消占比。

### 2.2 非目标

- 不把 `tetrisLineShare` 或人为四消 bonus 加入 CEM fitness；
- 不在第一阶段同时实现更深 beam/expectimax；
- 不修改引擎计分、SRS、落点枚举或浏览器执行语义；
- 不启动训练、benchmark、固定复评或发布；这些仍需分别授权；
- 不重写或原地迁移现有 v1/v2 checkpoint、日志和发布权重。

## 3. 总体方案

采用“特征优先、搜索按失败证据升级”的受控路线：

```text
boardAfter
  -> summarizeTetrisWell
  -> 13 维 afterstate 特征
  -> 线性落点评价
  -> 当前块 + 下一块 depth-2 搜索
  -> 模拟真实消行得分
  -> meanScore / scheduled maxPieces
  -> CEM 精英更新
```

第一阶段只补充能够连续表达建井进度的状态特征，保留 depth 2、CEM 和真实 score-rate fitness。若两代隔离短跑仍没有四消信号，则停止，不靠增加代数或 piece cap 绕过；下一份独立设计再比较 bag 信息和更深 beam/expectimax。

## 4. 四消井摘要

新增纯函数：

```ts
interface TetrisWellSummary {
  column: number;
  usableDepth: number;
  setupCells: number;
  readyRows: number;
}

function summarizeTetrisWell(board: Board): TetrisWellSummary;
```

### 4.1 单列候选

对每一列 `c`：

1. 令 `targetHeight` 为该列当前高度，并以该列最高方块之上的位置为井底；若顶部不足以容纳竖直 I 块的四个连续格，则该列候选值全为零。
2. 取竖直 I 块能够从顶部到达的最低四个连续空格作为目标带。目标带在 `boardAfter` 上计算，因此已经反映本次锁定和消行结果。
3. 缺失的左右邻列按实体边墙处理，与现有 `wellDepth` 的边界语义一致。
4. `usableDepth = clamp(min(leftHeight, rightHeight) - targetHeight, 0, 4)`。
5. `setupCells` 是目标带四行中、井列以外已经填充的格数，范围为 `0..36`。
6. `readyRows` 是目标带中井列为空且其余九格均已填满的行数，范围为 `0..4`。

已有 `holes`、`rowTransitions` 和 `colTransitions` 继续负责惩罚井外的不可填空洞与破碎表面；新摘要只表达“同一列四格入口周围已经准备到什么程度”，不复制整套安全性评价。

### 4.2 唯一候选井

按以下稳定顺序选择唯一候选：

1. `readyRows` 更大；
2. `setupCells` 更大；
3. `usableDepth` 更大；
4. 列号更小。

三个新特征必须来自同一个摘要，不能分别对十列取最大值，否则可能把不同井的优势拼成棋盘上不存在的状态。空棋盘的三个数值都为零；列号 tie-break 只保证确定性，不给空棋盘凭空增加策略奖励。

## 5. 特征契约

保留现有十个 `FEATURE_NAMES` 的顺序，并在尾部依次追加：

1. `cleanWellDepth = usableDepth`，范围 `0..4`；
2. `tetrisSetupProgress = setupCells / 9`，范围 `0..4`；
3. `tetrisReadyRows = readyRows`，范围 `0..4`。

`tetrisSetupProgress` 每正确填充一个井外目标格增加 `1/9`，提供连续中间信号；`cleanWellDepth` 表达可用的四格井深；`tetrisReadyRows` 表达非线性的整行准备度。完成消行仍由现有 `lineClearValue` 和真实引擎分数负责。

`extractFeatures` 仍然是纯函数，不修改棋盘行，不访问 Node、DOM 或文件系统，也不依赖模块级可变状态。

## 6. 版本与兼容边界

- 新 objective 为 `score-rate-v3`；
- `FEATURE_NAMES` 为精确 13 维；
- 权重文件和 checkpoint schema version 为 4；
- version 1 历史九维文件在内存中补 `lineClearValue = 0` 和三个新特征零值；
- version 2 / `score-rate-v1` 九维文件采用同样的内存补零；
- version 3 / `score-rate-v2` 十维文件只对三个新特征补零；
- version 4 / `score-rate-v3` 必须精确包含十三个当前键，缺键、多键、非有限值或 objective 不匹配一律拒绝；
- `FEATURE_NAMES` 的历史位置不能重排；
- 旧文件只在内存适配，绝不改写原文件。

v3 训练使用独立的 `public/ai/score-rate-v3/`。v1/v2/v3 旧 checkpoint 和日志不得由新训练器 resume 或 append；默认目录含有任何条目时，新跑继续 fail closed。

当前 gen-40 权重补零后必须保持行为兼容：在固定种子、depth 和 piece cap 下，决策、得分、消行计数、平均高度和结束原因与迁移前完全相同。

## 7. 策略诊断数据流

新增纯诊断结构：

```ts
interface StrategyDiagnostics {
  meanCleanWellDepth: number;
  meanTetrisSetupProgress: number;
  meanTetrisReadyRows: number;
}

interface SurvivalDiagnostics {
  pieceCapGames: number;
  gameoverGames: number;
}
```

模拟器在每次锁定并消行后对新棋盘采样，按本局锁定方块数平均；未锁定任何方块时三个值均为零。现有 `SimResult.reason` 同时汇总为 `pieceCapGames` 与 `gameoverGames`，使“30/30 达到 cap”成为可直接验证的候选字段，而不是从平均 pieces 推测。诊断随 `SimResult` 经过 worker、benchmark、CEM 汇总、generation 日志、固定复评事件、checkpoint candidate 和 dashboard 传递，但不得进入：

- `fitness`；
- CEM 精英排序或分布更新；
- 固定复评的 score 比较；
- paired score-rate 统计。

它们用于区分三种失败：特征从未激活、AI 建井但不能完成四消、AI 能四消但存活或真实分数下降。

## 8. 训练阶段门

### 8.1 代码门

纯函数、特征、搜索兼容、schema、checkpoint、日志、candidate 边界、paired CLI 和 dashboard 回归已经实现。Task 10 的 fresh focused/full gate 结果记录在独立执行报告中；即使完整代码门通过，也只能单独申请运行授权，不能据此宣称训练信号、候选质量或模型接受。

### 8.2 两代隔离信号短跑

短跑必须使用空的新 v3 output dir，并在启动前记录进程、目录、checkpoint/log、两份发布权重状态和哈希。短跑只验证信号与产物边界，不构成模型验收。

若两代中 `bestTetrisLineShare` 和 `eliteTetrisLineShare` 始终都低于 `0.01`，则判定特征表示没有产生可用四消信号：

- 立即停止；
- 不投入正式长跑；
- 不通过提高 piece cap 或增加 generations 规避；
- 为 bag 信息和更深 beam/expectimax 另写设计。

短跑目录之外的 checkpoint、日志和两份发布权重必须保持原哈希。

### 8.3 正式候选

只有短跑出现明确非零信号后，才可另行授权正式训练。每十代在固定 30 × 5000、depth 2 调度上复评。schema 4 checkpoint 将已发布 gen-40 基线与新的 `bestQualifiedCandidate` 分开保存。

只有同时满足下列固定复评条件的候选，才写入当前 run dir 下的 `candidate-weights.json`：

- `meanScore` 高于 gen-40 基线，并超过现有包含边界的 0.1% score tolerance；
- `tetrisLineShare >= 0.20`；
- `pieceCapGames = 30`，或至少不低于同场基线。

未满足四消门槛的更高分模型可以记录为诊断事件，但不能替代 qualified candidate。训练器不得自动写入 `public/ai/best-weights.json` 或 `src/ai/trained-weights.json`。

### 8.4 独立 paired 验收与发布

qualified candidate 使用与 gen-40 相同的独立 seeds、depth 2 和 5000-piece cap 逐局配对。验收必须同时通过第 2.1 节四项门槛。固定复评只负责筛出候选，不能替代独立 paired 置信区间。

`npm run bench:paired -- --baseline <published> --candidate <qualified>` CLI 已实现；本次 code-only 交付没有运行它。命令存在只证明验收工具入口存在，不证明任何候选通过 paired 门。

通过验收后仍需单独获得发布授权，才能把经过验收的同一份候选同步到 runtime 与 bundled 权重；提交、push 和运行时/browser 验收继续是独立边界。

## 9. 错误处理与产物安全

- 新特征或诊断出现非有限数时立即失败，不写 checkpoint/log/权重；
- feature vector、`mu`、`sigma` 或权重维度不是精确 13 时拒绝；
- objective、schema、配置或固定复评调度不匹配时拒绝 resume；
- generation/log 不连续、JSONL 损坏或 checkpoint 与日志末代不一致时，在创建 worker 和写文件前拒绝；
- 没有合法目标带时返回零摘要，不抛出或伪造井；
- 棋盘摘要只读取 `boardAfter`，不得保留跨落子的隐藏状态；
- 训练和候选写入不获得发布路径写权限；
- 任何训练、benchmark、产物移动/删除、发布或浏览器验收均需对应授权。

## 10. 测试与验证

### 10.1 纯函数与特征

- 空棋盘；
- 左边井、右边井和中间井；
- 部分准备、四行准备完成、被堵井与含洞棋盘；
- 有效填充一个井外格时 `tetrisSetupProgress` 精确增加 `1/9`；
- 消行后按新棋盘重算，不保留历史；
- 候选选择稳定且三个值来自同一列；
- 新特征始终落在约定范围内；
- `FEATURE_NAMES` 精确等于旧十维加三个尾维。

### 10.2 搜索与兼容

- 只启用新特征时，构造棋盘上优先选择增加同井准备度的合法落点；
- depth 1 / depth 2 继续使用相同落点枚举；
- gen-40 权重补零后的固定种子决策和模拟结果与迁移前完全一致；
- 不改变 BFS landing 顺序、SRS、最短 pre-drop 路径或 hard-drop 时机。

### 10.3 训练与产物

- 旧九维、旧十维和新十三维权重解析；
- version 4 exact-key、finite-number 和 metadata 失败用例；
- schema 4 checkpoint/log round trip；
- v2 checkpoint/log resume 拒绝；
- strategy diagnostics 的 worker/CEM/reevaluation/dashboard 传递；
- `pieceCapGames` / `gameoverGames` 与逐局 `reason` 精确重建；
- `tetrisLineShare` 和新诊断不影响 CEM fitness；
- smoke/formal 模式不写发布路径；
- qualified candidate 与 published baseline 分离；
- 损坏产物在任何写入和 worker 创建之前失败。

实现后的验证顺序为：最短相关单测、完整 `npm test`、`npm run lint`、`npm run build`、`npm run typecheck:train`，每项单独运行并读取退出码。训练、benchmark 和 paired benchmark 不属于代码验证命令，不随实现自动运行。

## 11. 文档与交付边界

`README.md` 和 `docs/ai-training-handoff.md` 必须同时区分：

- 当前已发布 gen-40 `score-rate-v2`；
- gen-40 固定复评得到更高 score rate；
- gen-40 尚未形成稳定四消；
- 当前未找到 gen-40 独立 paired benchmark；
- `score-rate-v3` 代码/训练器契约已实施为 13 维、schema 4，默认新轮次路径为 `public/ai/score-rate-v3/`；
- 训练器只在固定复评资格门通过后写 run-local `candidate-weights.json`，不会自动发布；
- 两代信号门、20% 最终四消门与独立 paired 门仍彼此独立；
- paired CLI 已实现但未运行；训练、benchmark、candidate 产出、验收、发布和浏览器/runtime 验收均未发生。

本设计已经形成并完成代码实现；beam/expectimax 明确不在同一计划内，只有特征信号门失败后才进入下一轮设计。仍开放的授权门依次是：两代隔离信号 smoke、正式训练、固定复评 candidate 创建、独立 paired 验收、发布、push 与浏览器/runtime 验收。
