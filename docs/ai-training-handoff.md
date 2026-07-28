# Tetris AI 训练系统 — 交接文档

**写于**：2026-07-28（同日更新：适应度加入棋盘整洁度，旧 checkpoint 退役）
**代码状态**：46 个提交已合并到本地 `master`（HEAD `ccd95bd`），**尚未推送**（`git pull` 当时 SSL 握手失败）；整洁度这一批改动**尚未提交**
**测试**：159 个，全绿，约 5 秒
**设计文档**：[`docs/superpowers/specs/2026-07-27-tetris-ai-training-design.md`](superpowers/specs/2026-07-27-tetris-ai-training-design.md)
**实施计划**：[`docs/superpowers/plans/2026-07-27-tetris-ai-training.md`](superpowers/plans/2026-07-27-tetris-ai-training.md)（约 5000 行，含每个模块的完整代码与理由）

---

## 1. 一句话现状

AI 已经能打得很好（30 局 × 5000 步全程未死），训练系统完整可用。**消行数这个指标会封顶**，所以适应度已经改成 `消行 - 平均堆叠高度`——高度不封顶，能把「都不会死」的候选排出高下（细节见第 4 节）。指标本身现在是可用的；**「训练比手调好多少」仍未被证明**：按新指标量，当前这版训练权重（平均高度 3.23）还略逊于手调权重（3.12），需要用新适应度重跑一轮训练才能下结论。

---

## 2. 代码地图

### `src/ai/` — AI 核心（纯函数，浏览器与 Node 共用同一份）

| 文件 | 作用 |
|---|---|
| `rng.ts` | `mulberry32(seed)` 确定性随机源；`hashSeed(...)` 派生种子 |
| `features.ts` | `FEATURE_NAMES`（9 项，顺序即权重向量顺序）与 `extractFeatures` |
| `weights.ts` | 权重对象 ↔ 向量、L2 归一化、权重文件校验、内置权重 |
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
| `cem.ts` | CEM 纯数学：采样、精英更新、噪声、局长调度、`aggregateFitness` |
| `pool.ts` | worker 池，**任务粒度是「一局」而非「一个候选」** |
| `worker.ts` | worker 入口，只跑 `simulateGame` |
| `train.ts` | 主循环、共同随机数、日志、断点、复评、CLI |
| `bench.ts` | 用指定权重跑 N 局并报告成绩与吞吐 |

### 展示层

- `src/hooks/useAiPlayer.ts` — AI 托管，走和键盘完全相同的 store action，含自愈式重规划
- `src/components/AiControls.tsx` — 网页里的 AI 面板
- `training.html` + `src/training/dashboard/` — 训练面板（Vite 第二入口，四张手写 SVG 图）

### 产物（`public/ai/`，已 gitignore）

- `training-log.jsonl` — 每代一行，面板每秒轮询它
- `checkpoint.json` — 断点续训用
- `best-weights.json` — 运行时 `fetch`，重训后无需 rebuild 即可生效

---

## 3. 常用命令

```bash
npm test                    # 148 个测试，约 17 秒
npm run build               # 产出 dist/index.html 与 dist/training.html
npm run typecheck:train     # 单独检查 training/（与主应用 tsconfig 分开）

npm run dev                 # http://localhost:5190/          游戏 + AI 面板
                            # http://localhost:5190/training.html  训练面板

npm run bench -- --games 30 --depth 2 --max-pieces 2000 --weights public/ai/best-weights.json
npm run train -- --generations 20
npm run train -- --resume
npm run train               # 无限跑，Ctrl-C 存盘退出
```

`npm run lint` **在 master 上本来就是坏的**（缺 `eslint.config.*`），与本次工作无关。

---

## 4. 最重要的一件事：适应度会封顶

这是整个项目最关键的发现，**不看这段会白跑几小时**。

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

### 处置一：给局长上限封顶

`maxPiecesCap` 已压到 **2000**，并且复评的消行项饱和时会打印提示。**消行**这一项仍然是饱和量——它只是在复述局长上限，别拿它判断收敛。

### 处置二：棋盘整洁度（已实现）

适应度现在是组合式的：

```
fitness = meanLines - heightPenalty * meanHeight
```

`meanHeight` 是**每次锁定后（且消行之后）最高列高度**的全局平均，由 `simulate.ts` 累加、`SimResult` 带出。这个量**没有上限也不会饱和**：既然大家都不会死，就比谁活得漂亮——平均把堆压在 3 行的，明显强于常年顶到 15 行才勉强不死的。且它**保留真实的 7-bag 分布**，练出的权重能直接迁移回真游戏。

`heightPenalty = 1.0`，是量出来的，不是拍的。把训练权重按 sigma 0.1 扰动（模拟收敛后的精英池）后两项的跨度：

| 局长上限 | 消行跨度 | 高度跨度 | 饱和候选 |
|---|---|---|---|
| 300 | 3.33 | 2.93 | 12/12 |
| 1200 | 6.00 | 4.38 | 10/12 |

两项量级相当，且**局长上限翻倍后仍然相当**，所以后期不会退化成只看消行。权重不能调太大：高度上限是 `TOTAL_ROWS = 22`，而活满全场值 `0.4 × maxPieces` 分；一旦 `22 × heightPenalty` 逼近 `0.4 × initialMaxPieces`（当前是 120），**5 个方块就顶死的候选因为棋盘几乎全空反而显得最整洁**，CEM 会开始偏爱「干净地速死」。理由与算术都写在 `training/config.ts` 的 `heightPenalty` 注释里。

实测确实区分出来了（`npm run bench --games 3 --depth 2 --max-pieces 600`）：

| 权重 | 消行 | 占天花板 | 平均高度 |
|---|---|---|---|
| 手调 | 238.0 | 99.2% | **3.12** |
| 训练（gen 10） | 238.7 | 99.4% | **3.23** |

消行仍然分不出（差 0.3%），高度分得出（差 3.5%）——顺带说明**当前这版训练权重并不比手调的更整洁**。

冒烟跑（`npm run train -- --generations 2`）里信号也在动：精英中位高度 gen 0 是 7.0，gen 1 降到 3.5，而同期全体中位高度是 14.3。

配套改动：

- `aggregateFitness` 现在返回 `{ fitness, meanLines, meanPieces, meanHeight }`，多收一个 `heightPenalty` 参数
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

### 有毒的 checkpoint（已处理，2026-07-28）

那个 `maxPieces = 76800` 的 checkpoint **已经退役归档**，现在 `public/ai/` 是干净的：直接 `npm run train` 从 gen 0、上限 300 开始；`--resume` 会立刻报 `--resume but no checkpoint at ...` 而不是闷头跑三小时。

退役的那轮在仓库根目录的 `training-archive/`（同目录 README 记了原委）。**不放在 `public/ai/` 下**：Vite 会把 `public/` 原样拷进 `dist/`，死掉的运行没必要跟着发布。当时的状态与判断：

| | |
|---|---|
| `maxPieces` | 76800——`--resume` 会先跑一个约 3 小时的世代（76800 步/局 × 500 局），之后才被 2000 的新上限拉回来 |
| `bestEver` | 无。8 代没跑到第 10 代，没复评过，**一个模型都没发布** |
| `sigma` | 仍在 0.61–0.68，几乎没收敛 |
| `mu` | 按新指标实测（depth 2、cap 600、3 局）平均高度 **3.18**，介于手调 3.12 与已发布训练权重 3.23 之间——8 代什么也没换来 |

加上适应度已经换成组合式，旧日志里 cap 38400 下的 `best = 15358` 与新目标的百位数值混在同一个 `training-log.jsonl` 里会让面板的图彻底失真，所以选择了归档重来而不是把 `maxPieces` 改回 300。

**下次再遇到跑飞的 checkpoint**，两条路：

```bash
# 改回 300，保留已有的 mu/sigma 进度（仅当目标函数没变过）
node -e "const f='public/ai/checkpoint.json';const c=require('./'+f);c.maxPieces=300;require('fs').writeFileSync(f,JSON.stringify(c,null,2))"

# 或者归档重来（目标函数变过就只能走这条）
mkdir -p training-archive && mv public/ai/checkpoint.json public/ai/training-log.jsonl training-archive/
```

`.gitignore` 现在忽略整个 `public/ai/`（原先只列了三个文件名）与 `training-archive/`，两边都不会漏进 git。

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

复评产出更好的权重时会覆写它（这是被跟踪的文件）。跑冒烟测试后记得 `git checkout src/ai/trained-weights.json`，别把测试产物当成模型提交上去。

### 训练与 GPU 无关

CEM 是搜索式演化，「模型」只有 9 个浮点数，算力全花在博弈树搜索上。**吃满 CPU、GPU 全程闲置是符合预期的**，不是配置错误。要用 GPU 得换神经网络方案，那是另一个项目。

---

## 6. 不变量（改代码前务必知道）

- **AI 逻辑只有一份。** 浏览器和训练器 import 同一批 `src/ai/` 文件。任何「为了训练快一点」的第二实现都会让训出的权重在真游戏里失效。
- **棋盘绝不可原地修改。** 引擎的 `clearLines` 用 `filter`，返回的棋盘与输入**共享行数组引用**，原地写会污染无关状态。
- `src/ai/` 必须保持纯净：无 `node:` 导入、无 DOM API、无文件系统、无模块级可变状态。唯一的例外是 `loadWeights.ts`（浏览器专用），已在 `tsconfig.train.json` 排除。
- `FEATURE_NAMES` 是特征顺序的唯一真相。权重向量是**按位置**点乘特征向量的。
- 落点枚举必须走引擎的 `rotatePiece`，否则会漏掉靠踢墙才能到达的落点。
- 运行时依赖只有 react / react-dom / zustand，devDependency 只加了 vitest / tsx / @types/node。**面板的四张图是手写 SVG，不要引图表库。**

---

## 7. 已知的小问题（都不阻塞）

- `App.tsx` 丢弃了 `useTrainingLog` 返回的 `error`，fetch 失败是静默的
- `training/pool.ts` 的 `'error'` 监听没有 `destroyed` 保护（`'exit'` 有）；在 Node 的 `terminate()` 语义下不可达，但属于不对称
- 权重文件里的 `searchDepth` 元数据没有任何地方读取——它本来是为了防止「2 层练的权重拿去 1 层跑」这个已知失效模式
- `parseWeightsFile` 对损坏的**元数据**字段（gen / trainedAt）静默取默认值，只有权重向量本身是严格校验的
- `simulate.ts` 的 `lockAndSpawn` 有一个不可达的 `preview ? ... : drawFromBag(state)` 兜底分支
- 没有任何测试覆盖「同一次锁定里跨越等级边界的消行」——这是「计分用消行前的等级」唯一可观测的场景。实际无害：模拟器跳过重力，等级只影响 score，而适应度读的是 lines

---

## 8. 一个新会话可以直接接手的任务

按价值排序：

1. **用新适应度重跑一轮训练**——指标已经就位（第 4 节），旧 checkpoint 也已退役（第 5 节），`npm run train` 直接就是干净的从头开始。跑起来之后看 `eliteH` 这一列是否持续下降；判断标准不是 `best`（它的消行部分仍然饱和）
2. **推送到远端**（当时 SSL 握手失败，46 个提交还在本地）
3. 修复 `npm run lint`（补 `eslint.config.js`）——这是 master 上本来就有的问题
4. 让 `searchDepth` 元数据真正起作用：权重文件的深度与 UI 当前深度不一致时给出提示
