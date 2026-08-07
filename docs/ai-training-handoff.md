# Tetris AI 训练系统 — 交接文档

**写于**：2026-07-28；**更新于**：2026-08-07（score-rate-v2 恢复产物与执行路径审查修复；未运行训练或发布）
**当前状态的读取方式**：每次先运行 `git status` / `git log`，检查 `public/ai/` 产物与训练进程，再决定操作。旧 HEAD、未推送状态和固定测试数都只是历史快照，不是本交接的持久指令。
**验证**：运行当前 `npm test`、`npm run build` 与 `npm run typecheck:train`；以实际输出为准。
**当前 score-rate-v2 设计**：[`2026-08-06 design`](superpowers/specs/2026-08-06-ai-hard-drop-and-tetris-strategy-design.md)
**当前 score-rate-v2 实施计划**：[`AI hard-drop plan`](superpowers/plans/2026-08-06-ai-hard-drop-execution.md) / [`score-rate-v2 plan`](superpowers/plans/2026-08-06-score-rate-v2-tetris-strategy.md)
**score-rate-v1 历史目标设计与计划**：[`2026-07-30 design`](superpowers/specs/2026-07-30-fixed-schedule-score-rate-design.md) / [`2026-07-30 plan`](superpowers/plans/2026-07-30-fixed-schedule-score-rate.md)
**复评证据设计与计划**：[`2026-08-02 design`](superpowers/specs/2026-08-02-score-rate-reevaluation-observability-design.md) / [`2026-08-02 plan`](superpowers/plans/2026-08-02-score-rate-reevaluation-observability.md)
**原始训练系统设计**：[`2026-07-27 design`](superpowers/specs/2026-07-27-tetris-ai-training-design.md) / [`2026-07-27 plan`](superpowers/plans/2026-07-27-tetris-ai-training.md)；其中目标函数与产物路径部分是历史设计，不代表当前状态。

---

## 1. 一句话现状

代码与训练器的当前契约是 **`score-rate-v2`**：checkpoint schema version 3、`FEATURE_NAMES` 为 10 维；它仍在固定 piece schedule 下以

```
fitness = meanScore / maxPieces
```

选择候选。分母是调度给每局的 `maxPieces`，不是候选实际存活的 pieces；提前死亡不会因为分母变小而得到虚高分。新增的 `lineClearValue` 让落点评价表达引擎真实的非线性消行价值；1/2/3/4 消直方图与四消消行占比只用于诊断，不能改变 fitness、精英选择或发布裁决。`meanHeight` 继续记录，但只是诊断指标，并仅在固定复评分数落入包含边界的 0.1% 近似平分区间时作为发布 tie-breaker。

当前 tracked bundled 权重和 runtime 已发布权重仍是 **version 2、`score-rate-v1` 的 gen-20 模型**；只有另行获得授权的 v2 训练通过发布门后才能替换。读取旧 v1 九键权重时，代码仅在内存中补 `lineClearValue = 0`，不改写原文件；v1 checkpoint/log 绝不由 v2 `--resume`，也绝不向其中追加。本次实现没有运行 smoke、benchmark、训练、固定复评或发布；代码测试只能证明代码契约，**不能证明已经出现四消策略**。

### gen 20 发布依据

- 固定复评：30 局 × 5000 pieces、depth 2、固定复评种子策略；gen 20 候选 `meanScore = 3,104,830`、`scoreRate = 620.966`、`meanHeight = 3.35646`，相对当时已发布权重的 `scoreRate = 611.653`，裁决为 `publish / higher-score`。
- 独立 paired benchmark：使用新 seed `20260803`，旧已发布权重与 gen 20 各跑 30 局 × 5000 pieces、depth 2；两组都 30/30 达到 cap。旧权重 `scoreRate = 612.228`，gen 20 `621.272`；gen 20 逐局 30 胜、0 平、0 负，平均差 `+9.044 score/piece`，95% paired 区间 `[+7.813, +10.275]`。
- 因而“优于旧已发布权重”的结论来自独立同参数 paired 证据，**不是**由某代训练日志里的 `bestScoreRate` 推出。固定复评负责候选发布门，独立 paired benchmark 负责相对基线的验收，二者不能混为一谈。

发布权重由提交 `ef3cbac feat(ai): publish gen-20 score-rate weights` 纳入 Git。该 SHA、测试数、ahead/push 状态都只是发布时快照；接手时仍须现场核实。

---

## 2. 代码地图

### `src/ai/` — AI 核心（纯函数，浏览器与 Node 共用同一份）

| 文件 | 作用 |
|---|---|
| `rng.ts` | `mulberry32(seed)` 确定性随机源；`hashSeed(...)` 派生种子 |
| `features.ts` | `FEATURE_NAMES`（10 项，顺序即权重向量顺序）与 `extractFeatures`；新增 `lineClearValue` |
| `weights.ts` | 权重对象 ↔ 向量、L2 归一化、权重文件校验、内置权重；读取 v1 九键文件时仅在内存中以 `lineClearValue = 0` 适配 |
| `trained-weights.json` | **模型本体**，已提交进 git，打包进构建 |
| `placements.ts` | BFS 落点枚举（走引擎的 `rotatePiece`，含 SRS 踢墙），按最终格子集合去重 |
| `replay.ts` | 按键序列的状态投影，网页回放与落点测试共用 |
| `search.ts` | `evalMove` / `bestPlacement`，1–2 层前瞻 |
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
| `train.ts` | 主循环、共同随机数、日志、断点、复评、CLI |
| `bench.ts` | 用指定权重跑 N 局并报告成绩与吞吐 |

### 展示层

- `src/hooks/useAiPlayer.ts` — AI 托管，走和键盘完全相同的 store action，含自愈式重规划
- `src/components/AiControls.tsx` — 网页里的 AI 面板
- `training.html` + `src/training/dashboard/` — 训练面板（Vite 第二入口，四张手写 SVG 图）

### 产物（`public/ai/`，已 gitignore）

- `score-rate-v2/training-log.jsonl` — 新训练的默认日志位置；每代一行，另含稀疏的 typed reevaluation 事件；resume 会在创建目录/worker 或写入前严格校验完整 JSONL、统一 v2 objective、两类 schema、连续 generation 与 checkpoint.gen；面板每秒轮询并只绘制 generation 记录
- `score-rate-v2/checkpoint.json` — 新训练的默认 checkpoint；必须是 schema version 3、`score-rate-v2`、10 维以及完整固定发布调度才可能 resume；v1 checkpoint/log 绝不兼容或追加
- `best-weights.json` — 当前 runtime 已发布的仍是 version 2、`score-rate-v1` gen-20 权重；只有经授权的 v2 固定复评通过发布门后才可替换
- `../src/ai/trained-weights.json` — 当前 tracked bundled 的仍是 version 2、`score-rate-v1` gen-20 权重；构建无需 runtime fetch 也能工作，不能因代码迁移而改写
- 根目录的 `checkpoint.json` / `training-log.jsonl` — 退役 `lines-height-v1` 的 legacy 产物；不得与当前目标混用
- `score-rate-v1-smoke/` — 目标实现阶段的隔离 smoke 产物；不是当前可续训轮次

---

## 3. 常用命令

```bash
npm test                    # 以当前收集数和实际输出为准
npm run build               # 产出 dist/index.html 与 dist/training.html
npm run typecheck:train     # 单独检查 training/（与主应用 tsconfig 分开）

npm run dev                 # http://localhost:5190/          游戏 + AI 面板
                            # http://localhost:5190/training.html  训练面板

npm run bench -- --games 30 --depth 2 --max-pieces 2000  # 内置手调基线
# 仅在文件存在且已核验时追加：--weights <权重文件>
npm run train -- --generations 20 --output-dir public/ai/<new-run-id>  # 仅限已授权的空目录
npm run train -- --generations 20 --workers 8 --output-dir public/ai/<new-run-id>
npm run train -- --resume   # 默认 score-rate-v2；必须先完整核验并获得授权，且绝不恢复/追加 v1 checkpoint/log
```

训练命令会修改 score-rate checkpoint/log，并可能同时改写发布权重，不能把上面的示例当成顺序执行清单。默认输出目录包含任何条目时（包括空日志或其他遗留文件），新跑都会拒绝；不要通过删除文件绕过保护。运行前先读第 5 节的 checkpoint 决策门。

`npm run lint` 的可用性也应在当前分支实测；不要继承旧会话的“本来就是坏的”结论。

---

## 4. 目标演进：消行封顶、旧高度目标与 score-rate-v2

这是整个项目最关键的演进，**不看这段会白跑几小时**。

### 当前目标：固定调度 score rate

`score-rate-v2` 直接使用引擎一致的对局分数，并按调度 cap 归一化：

```
fitness = meanScore / maxPieces
```

模拟器跳过真实时间和重力，并把选定落点直接赋给当前方块后锁定，因此这里优化的是每个**调度方块**带来的确定性模拟分数，而不是每秒分数。这个分数使用引擎的消行计分规则，但不包含浏览器逐键回放可能累积的 soft/hard-drop bonus；它是 score-rate-v2 的既定契约，不是浏览器 UI 总分的逐分预测。若候选提前死亡，分母仍是相同的 scheduled `maxPieces`；用 survived pieces 作分母会奖励提前退出。`lineClearValue` 是落点评价特征，不是 fitness 额外奖励；clear histogram 与 `tetrisLineShare` 也是诊断而非发布输入。高度继续输出用于诊断，在固定复评中只有候选与当前最佳的 `meanScore` 差距落入包含边界的 0.1% 容差时，更低高度才决定是否发布。

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

实测确实区分出来了（`npm run bench --games 3 --depth 2 --max-pieces 600`）：

| 权重 | 消行 | 占天花板 | 平均高度 |
|---|---|---|---|
| 手调 | 238.0 | 99.2% | **3.12** |
| 训练（gen 10） | 238.7 | 99.4% | **3.23** |

消行仍然分不出（差 0.3%），高度分得出（差 3.5%）——顺带说明**当前这版训练权重并不比手调的更整洁**。

冒烟跑（`npm run train -- --generations 2`）里信号也在动：精英中位高度 gen 0 是 7.0，gen 1 降到 3.5，而同期全体中位高度是 14.3。

以下配套改动描述的是 `lines-height-v1` 历史快照；随后曾由 `score-rate-v1` 取代，当前类型、日志与发布代码的契约已迁移至 `score-rate-v2`：

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

当前训练器默认使用 `public/ai/score-rate-v2/`，也可通过 `--output-dir` 选择隔离目录。`score-rate-v1/` 及其 checkpoint/log 是 legacy 产物，v2 绝不恢复或追加；根 `public/ai/checkpoint.json` / `training-log.jsonl` 是更旧目标产物，`score-rate-v1-smoke/` 是历史隔离冒烟产物；路径相邻不表示目标兼容。

**2026-08-03 收口快照（历史）**：score-rate-v1 checkpoint 为 gen 20，日志包含 gen 0–19 的 20 条 generation 记录和一条 gen 20 reevaluation，发布权重已经写入根 `best-weights.json` 与 tracked `src/ai/trained-weights.json`。它说明当前仍发布 version 2、score-rate-v1 gen-20 模型，却不是未来可跳过现场检查的许可，更不是 v2 resume/append 的依据。

任何训练前都按以下顺序判断：

1. 检查 Node 命令行、CPU 和内存，确认没有训练进程正在写目标目录或发布权重。
2. 明确实际 output dir；读取其中 checkpoint 的 schema version、`objective`、`gen`、`maxPieces`、完整 `config` 与 `bestEver`，并检查日志全部记录的 objective、generation/reevaluation schema、连续 generation、固定复评历史和最终换行。
3. 如果保留 v2 本轮，只能在 score-rate-v2 schema version 3、固定发布调度、10 维权重与完整诊断元数据全部校验后显式使用 `--resume`；v1 checkpoint/log 一律拒绝恢复或追加。
4. 如果新跑，先取得用户授权并选择空的独立 output dir；归档、移动或删除任何已有产物都需要单独授权。
5. 训练还可能改写 `public/ai/best-weights.json` 与 tracked `src/ai/trained-weights.json`；启动前必须记录二者状态和哈希。

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

### 训练会写 `src/ai/trained-weights.json`

复评产出更好的权重时会覆写这个被跟踪的文件。训练前先记录
`git diff -- src/ai/trained-weights.json`，确认是否已有用户修改。训练后只撤销能够
明确归因于本次运行的生成差异；若训练前已有修改或无法区分来源，停止并请用户决定，
绝不使用无条件的 `git checkout` 或 `git restore` 覆盖工作树文件。

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

CEM 是搜索式演化，「模型」当前有 10 个浮点数，算力全花在博弈树搜索上。**CPU 吃满、GPU 全程闲置是符合预期的**，不是配置错误（不想吃满见上一条）。要用 GPU 得换神经网络方案，那是另一个项目。

---

## 6. 不变量（改代码前务必知道）

- **AI 逻辑只有一份。** 浏览器和训练器 import 同一批 `src/ai/` 文件。任何「为了训练快一点」的第二实现都会让训出的权重在真游戏里失效。
- **棋盘绝不可原地修改。** 引擎的 `clearLines` 用 `filter`，返回的棋盘与输入**共享行数组引用**，原地写会污染无关状态。
- `src/ai/` 必须保持纯净：无 `node:` 导入、无 DOM API、无文件系统、无模块级可变状态。唯一的例外是 `loadWeights.ts`（浏览器专用），已在 `tsconfig.train.json` 排除。
- `FEATURE_NAMES` 是十维特征顺序的唯一真相。权重向量是**按位置**点乘特征向量的；v1 九键权重只可在内存中通过尾随 `lineClearValue = 0` 适配。
- 落点枚举必须走引擎的 `rotatePiece`，否则会漏掉靠踢墙才能到达的落点。
- AI/训练改动不应增加新的运行时依赖；训练面板的四张图是手写 SVG，**不要为它们引入图表库。**

---

## 7. 已知的小问题（都不阻塞）

- `App.tsx` 丢弃了 `useTrainingLog` 返回的 `error`，fetch 失败是静默的
- `training/pool.ts` 的 `'error'` 监听没有 `destroyed` 保护（`'exit'` 有）；在 Node 的 `terminate()` 语义下不可达，但属于不对称
- 权重文件里的 `searchDepth` 元数据没有任何地方读取——它本来是为了防止「2 层练的权重拿去 1 层跑」这个已知失效模式
- `simulate.ts` 的 `lockAndSpawn` 有一个不可达的 `preview ? ... : drawFromBag(state)` 兜底分支

---

## 8. 后续会话的接手顺序

按价值排序：

1. **先审计 Git、进程和全部 `public/ai/` 产物**——Git 干净不代表 ignored 产物没变；没有用户授权不要启动训练/benchmark，也不要归档、删除或覆盖产物。
2. **把 gen 20 当作当前已发布候选，而不是永久最优真理**——本轮发布证据见第 1 节；未来若比较另一候选，必须用相同 seeds、depth、piece cap 的 paired 设计，且不能用训练 `bestScoreRate` 代替基线验收。
3. **若获准继续训练，先明确 resume 还是隔离新跑**——resume 只能指向经完整校验的 score-rate-v2 schema 3 checkpoint，绝不恢复或追加 v1 checkpoint/log；新跑必须使用空 output dir。观察 score-rate 分布、固定复评与 sigma；高度与 clear histogram 只作诊断。
4. 运行当前 `npm run lint`、`npm test`、`npm run typecheck:train` 和 `npm run build`；不要继承旧测试数或成功结论。
5. 浏览器验收时区分 bundled 与 runtime：bundled 来自 tracked JSON，runtime 来自 `/ai/best-weights.json`；二者可以同内容但来源标签不同。
6. 让 `searchDepth` 元数据真正起作用：权重文件的深度与 UI 当前深度不一致时给出提示。
