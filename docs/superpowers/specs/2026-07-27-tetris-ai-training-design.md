# Tetris AI 训练系统 — Design Spec

日期：2026-07-27

## 1. 目标

为现有 Tetris 游戏训练一个 AI，具体交付三样东西：

1. **AI 核心** —— 一套能对任意局面选出最优落点的纯函数模块，浏览器与 Node 共用同一份代码。
2. **训练器** —— 用 CEM（交叉熵方法）进化评估函数的权重，多核并行，支持断点续训，可运行数小时。
3. **成果展示** —— 网页内的「AI 托管」模式（AI 实时接管当前游戏），以及一个训练可视化面板（适应度曲线、权重演化、分布收缩）。

非目标见第 11 节。

## 2. 现有代码的约束事实

这些事实直接决定了下面的设计，实现时不得违背：

| 事实 | 影响 |
|---|---|
| `src/engine/*` 全是无副作用纯函数，不依赖 DOM | 训练可直接复用真实游戏逻辑，不存在「模拟器与真游戏分叉」的风险 |
| 棋盘为 `number[][]`，`TOTAL_ROWS = 22`（20 可见 + 2 缓冲），`BOARD_WIDTH = 10`，row 0 在顶部 | 所有特征计算以 22 行为准 |
| `generateBag()` 硬编码 `Math.random()` | **必须**改为可注入随机源，否则同代个体面对不同方块序列，适应度全是噪声 |
| 无 hold，有 next 预览 | 搜索空间为「当前块落点 × 下一块落点」，2 层前瞻，无需 hold 策略 |
| SRS 踢墙已实现（`rotatePiece`） | 落点枚举必须走 `rotatePiece` 而非自己算旋转，否则会漏掉踢墙才能到达的落点 |
| 项目当前无测试框架 | 需新增 `vitest` |
| `clearLines` 用 `filter` 返回行引用（与原棋盘共享行数组） | 模拟器**绝不可**原地修改棋盘行，必须保持引擎的不可变约定 |

## 3. 架构总览

```
                    ┌─────────────────────────────┐
                    │   src/ai/  (纯函数, 无环境依赖)  │
                    │  rng / features / weights    │
                    │  placements / search /       │
                    │  simulate                    │
                    └──────┬───────────────┬───────┘
                           │               │
              浏览器 import │               │ Node import
                           ▼               ▼
              ┌────────────────────┐  ┌──────────────────────┐
              │ useAiPlayer hook   │  │ training/train.ts    │
              │  → zustand store   │  │  CEM 主循环           │
              │ AiControls UI      │  │  ↕ worker_threads×N  │
              └────────────────────┘  └──────────┬───────────┘
                                                 │ 写
                                                 ▼
                                      public/ai/*.json(l)
                                                 │ 轮询
                                                 ▼
                                      training.html 面板
```

核心原则：**AI 逻辑只有一份**。网页托管和训练器 import 的是同一批文件。任何「为了训练快一点」而复制一份简化逻辑的做法都会导致训练出的权重在真游戏里失效。

## 4. 对现有代码的改动

改动面刻意压到最小，只有两处：

### 4.1 `src/engine/piece.ts` — 可注入随机源

```ts
export function generateBag(rng: () => number = Math.random): PieceType[]
```

内部 Fisher-Yates 用 `rng()` 替换 `Math.random()`。默认参数保证 `gameStore` 的调用点行为完全不变。

### 4.2 `src/components/Game.tsx` — 挂载 AI 控件

引入 `useAiPlayer` hook 与 `<AiControls />`。不改动任何既有游戏逻辑。

### 4.3 新增依赖

| 包 | 用途 | 类型 |
|---|---|---|
| `tsx` | 直接运行 TS 训练脚本 | devDependency |
| `vitest` | 测试框架 | devDependency |

图表**不引入任何库**，手写 SVG（见 8.2）。

## 5. AI 核心模块规格（`src/ai/`）

### 5.1 `rng.ts`

确定性伪随机数发生器，训练可复现的基础。

```ts
export function mulberry32(seed: number): () => number
```

32 位整数种子 → `() => number`（[0,1) 均匀分布）。选 mulberry32 是因为它状态只有一个 u32、速度快、统计性质对本用途足够。

### 5.2 `features.ts`

```ts
export const FEATURE_NAMES = [
  'aggregateHeight', 'holes', 'bumpiness', 'maxHeight', 'linesCleared',
  'landingHeight', 'rowTransitions', 'colTransitions', 'wellDepth',
] as const;

export type FeatureVector = number[];  // 长度 9，顺序同上

export function extractFeatures(
  boardAfter: Board,        // 落子并消行之后的棋盘
  linesCleared: number,
  placedCells: Position[],  // 落子占据的格子（消行前坐标）
): FeatureVector
```

各特征的**精确**定义（测试按此断言，不允许「差不多」）：

设 `h[c]` = 第 c 列高度 = `TOTAL_ROWS - (该列最上方非空格的行号)`，空列为 0。

| 特征 | 定义 |
|---|---|
| `aggregateHeight` | `Σ h[c]`，c ∈ [0,10) |
| `holes` | 空格数量，且该格所在列上方至少有一个非空格 |
| `bumpiness` | `Σ |h[c] − h[c+1]|`，c ∈ [0,9) |
| `maxHeight` | `max h[c]` |
| `linesCleared` | 本次落子消掉的行数（0–4），直接由参数传入 |
| `landingHeight` | `TOTAL_ROWS − (minRow + maxRow) / 2`，minRow/maxRow 取自 `placedCells` 的行号，即落子重心距地面的高度 |
| `rowTransitions` | 逐行扫描填充↔空的翻转次数，**左右边界视为填充** |
| `colTransitions` | 逐列扫描填充↔空的翻转次数，**地板视为填充，天花板视为空** |
| `wellDepth` | 对每个「井」（左右邻居或墙都是填充的连续空格柱），累加 `d(d+1)/2`，d 为该井深度 |

`landingHeight`、`linesCleared` 描述的是**这一步棋**，其余七项描述**落子后的棋盘**。

### 5.3 `weights.ts`

```ts
export type Weights = Record<typeof FEATURE_NAMES[number], number>;

export function toVector(w: Weights): number[];
export function fromVector(v: number[]): Weights;
export function normalize(v: number[]): number[];   // L2 归一化
export const HANDCRAFTED_WEIGHTS: Weights;          // 阶段②的临时权重，Dellacherie 风格
export const DEFAULT_WEIGHTS: Weights;              // 由 import './trained-weights.json' 得到（见 7.1）
```

**归一化的理由**：评估函数是线性打分后取 argmax，整体缩放不改变任何决策。不归一化的话 CEM 会在无意义的尺度维度上游走，浪费搜索预算并干扰 σ 的解读。

### 5.4 `placements.ts` — BFS 落点枚举

```ts
export interface Placement {
  piece: Piece;        // 最终锁定位姿
  moves: AiMove[];     // 从出生位置到该位姿的按键序列
}
export type AiMove = 'left' | 'right' | 'rotate' | 'down';

export function enumeratePlacements(board: Board, spawn: Piece): Placement[]
```

从出生位姿出发，在 `(x, y, rotation)` 状态图上做 BFS，边为四种动作：

- `left` / `right`：`movePiece(board, s, ∓1, 0)`
- `down`：`movePiece(board, s, 0, 1)`
- `rotate`：`rotatePiece(board, s)`（复用 SRS 踢墙，返回值 `=== s` 表示旋转失败）

凡是 `down` 不可行的可达状态，即为一个合法锁定点。同一 `(x, y, rotation)` 只访问一次，BFS 天然给出**最短按键序列**。

**落点必须按「最终占据的格子集合」去重**。不同 `(x, y, rotation)` 状态可能锁定出完全相同的格子：I 块的 rotation 0 与 2 都是水平条，只差矩阵内的行偏移，硬降后落在同一行；O 块四个旋转态形状全同，会产出 4 倍冗余。去重键取排序后的最终格子坐标列表，BFS 先到者胜（即保留最短按键序列的那个）。不去重会让 2 层搜索的分支数无谓翻 2–4 倍。

**为什么不用「枚举 rotation × 目标列 + 硬降」**：
1. 会漏掉**卡位**（方块降到底后横向滑入悬垂空腔）——这是俄罗斯方块里一整类关键落点，堆高时尤其重要；
2. 无法判断落点是否**真的从出生点可达**——顶部堆积时很多列已经进不去，简单枚举会产出幻觉落点；
3. BFS 顺带产出按键序列，网页托管可以据此回放真实按键，而不是让方块凭空瞬移。

状态上界约 10 × 22 × 4 = 880，开销可忽略。

### 5.5 `search.ts`

```ts
export interface Decision { placement: Placement; score: number; }

export function evalMove(board: Board, placement: Placement, w: number[]):
  { score: number; boardAfter: Board; linesCleared: number };

export function bestPlacement(
  board: Board, current: Piece, next: Piece | null,
  w: number[], depth: 1 | 2,
): Decision | null;
```

- `evalMove`：`lockPiece` → `clearLines` → `extractFeatures` → 与权重点乘。
- **1 层**：`argmax_{p1} evalMove(board, p1).score`
- **2 层**：`argmax_{p1} [ evalMove(board, p1).score + max_{p2} evalMove(board1, p2).score ]`
- 若某个 `p1` 导致下一块无法生成（game over），该分支记 `-Infinity`。
- 若 `enumeratePlacements` 返回空数组，`bestPlacement` 返回 `null`（无处可放 = 游戏结束）。
- `depth: 2` 但 `next === null` 时自动退化为 1 层。

**搜索深度与权重是绑定的**：用 1 层训出的权重放进 2 层会明显跑偏，因为两者对「留井等 I 块」这类行为的估值逻辑不同。训练与网页托管默认都用 depth=2。

### 5.6 `simulate.ts` — 无头对局

```ts
export interface SimResult {
  lines: number; score: number; pieces: number;
  reason: 'gameover' | 'pieceCap';
}

export function simulateGame(opts: {
  weights: number[]; seed: number; maxPieces: number; depth: 1 | 2;
}): SimResult
```

用 `mulberry32(seed)` 驱动 `generateBag`，复刻 `gameStore` 的 lock → clear → score → spawn 流程，但**跳过重力与计时**——AI 全程硬降，重力永远不会触发锁定，模拟它没有意义且会拖慢数十倍。

达到 `maxPieces` 时以 `reason: 'pieceCap'` 正常返回（不算失败）。

## 6. 训练器（`training/`）

### 6.1 算法：CEM

维护 9 维高斯分布的均值 `μ` 和逐维标准差 `σ`。初始 `μ = 0`（全零，即不带任何人工先验，让进化自己找方向）、`σ = 1`（各维相同）。每代：

1. 采样 N 个候选 `x_i ~ N(μ, diag(σ²))`，每个 L2 归一化；
2. 评估每个候选，得 `fitness_i`；
3. 取 fitness 最高的 `⌈ρN⌉` 个为精英；
4. `μ ← mean(elites)`；`σ² ← var(elites) + Z_t`；
5. `Z_t = max(noiseFloor, initialNoise · decay^gen)`，附加噪声防止分布过早坍缩。

**为什么不用遗传算法**：GA 在 Tetris 上是可行的经典方案，但旋钮多（交叉率、变异率、锦标赛规模、替换比例），收敛噪声大。CEM 只有三个旋钮（种群规模、精英比例、噪声下限），且其「分布收缩」过程可直接可视化为 σ 逐维下降，与本项目的面板需求天然契合。

### 6.2 适应度

**fitness = 平均消行数**，不用分数——分数被等级系数放大，会诱导 AI 追求与生存无关的行为。

**共同随机数（关键）**：同一代内所有候选必须面对**完全相同的 K 局方块序列**，种子由 `hash(baseSeed, gen, j)` 生成，j ∈ [0,K)。否则测量到的差异主要是运气而非策略优劣，进化直接失效。每代更换种子集，防止过拟合到特定序列。

**渐进式局长上限**：`maxPieces` 初始 300；当某代 fitness 中位数 > `0.8 × maxPieces` 时翻倍并记入日志。不做这件事的话，训练后期少数强个体单局能跑几分钟、消十几万行，会吃光全部时间预算。

### 6.3 并行

主线程跑 CEM，`worker_threads` 起 `min(31, cpus-1)` 个 worker。

**任务粒度是「一局」而非「一个个体」**：任务队列装 `N × K` 个 `(候选索引, 种子)` 二元组，worker 空闲即取。原因是强弱个体单局耗时可差两个数量级，按个体切块会导致收尾阶段绝大多数核空转。

worker 协议：

```ts
// 主 → worker
{ taskId: number; weights: number[]; seed: number; maxPieces: number; depth: 1 | 2 }
// worker → 主
{ taskId: number; lines: number; score: number; pieces: number; reason: string }
```

### 6.4 断点续训

每代结束写 `public/ai/checkpoint.json`。`SIGINT` 处理器落盘后退出。`npm run train -- --resume` 从 checkpoint 恢复 `gen / μ / σ / baseSeed / maxPieces / bestEver` 继续。

### 6.5 最优权重的复评

当代 fitness 最高的个体很可能只是运气好。因此：

- 每 10 代，取当前 `μ`（归一化后）用 **30 个全新种子**、`maxPieces = 5000` 复评；
- 仅当复评均值高于已记录的 `bestEver.meanLines` 时，才覆写 `public/ai/best-weights.json`。

### 6.6 CLI

```
npm run train                          # 全新训练，跑到 Ctrl-C
npm run train -- --generations 200     # 跑满 200 代后停
npm run train -- --resume              # 从 checkpoint 继续
npm run bench -- --weights public/ai/best-weights.json --games 50
```

`training/config.ts` 集中所有超参数并给出默认值：`population=100, eliteFrac=0.1, gamesPerCandidate=5, depth=2, initialMaxPieces=300, initialNoise=0.5, noiseDecay=0.95, noiseFloor=0.01`。

## 7. 数据格式（`public/ai/`）

训练器每次更新最优权重时**写两份完全相同的内容**：

| 路径 | 用途 | git |
|---|---|---|
| `src/ai/trained-weights.json` | 被 `weights.ts` 以 JSON import 打包进构建，保证 `dist` 独立可跑 | **提交**（这是模型本体） |
| `public/ai/best-weights.json` | 运行时 `fetch`，重新训练后无需 rebuild 即可生效 | gitignore |

（`public/` 下的文件由 Vite 原样拷贝，不应被 `import`，故必须分开两份而不是一份。）

### 7.1 权重文件内容（两份相同）

```json
{
  "version": 1,
  "weights": { "aggregateHeight": -0.51, "holes": -0.72, "bumpiness": -0.18,
               "maxHeight": -0.09, "linesCleared": 0.31, "landingHeight": -0.22,
               "rowTransitions": -0.15, "colTransitions": -0.24, "wellDepth": -0.06 },
  "meanLines": 45210, "evalGames": 30, "gen": 120,
  "searchDepth": 2, "trainedAt": "2026-07-27T10:00:00.000Z"
}
```

用具名对象而非裸数组，避免特征顺序变更时静默错位。加载时校验 key 集合完整，缺失则拒绝加载并回退到内置权重。

### 7.2 `training-log.jsonl`（gitignore）

每代追加一行：

```json
{"gen":12,"ts":1785000000000,"best":1234.5,"mean":420.1,"median":380.0,"worst":12.0,
 "std":210.3,"mu":[...9],"sigma":[...9],"bestWeights":[...9],
 "maxPieces":600,"gamesPerCandidate":5,"elapsedMs":48210}
```

### 7.3 `checkpoint.json`（gitignore）

```json
{"version":1,"gen":12,"mu":[...9],"sigma":[...9],"baseSeed":123456,"maxPieces":600,
 "config":{...},
 "bestEver":{"weights":[...9],"meanLines":45210,"gen":10,"evalGames":30}}
```

## 8. 展示层

### 8.1 网页 AI 托管

**`src/hooks/useAiPlayer.ts`**

```ts
useAiPlayer(opts: { enabled: boolean; depth: 1 | 2; speed: 'instant' | 'normal' | 'slow'; weights: Weights })
```

`enabled && status === 'playing'` 时，对 `currentPiece` 规划落点，然后把 `moves` 序列派发给 store 的 `moveLeft / moveRight / rotate / softDrop`，末尾 `hardDrop`。AI 走的是和键盘完全相同的 action 路径，没有后门。

**自愈式回放（必须实现）**：回放按键序列期间，重力会同时把方块往下拽，序列可能失配（依赖精确 y 的卡位落点尤其脆弱）。因此每一步执行前校验 `currentPiece` 是否等于预期的中间状态；不等则**丢弃剩余序列，从当前状态重新规划**。

`speed` 控制每步间隔：`instant` 单帧内执行完，`normal` ≈ 40ms/步，`slow` ≈ 150ms/步（用于看清决策过程）。

**`src/components/AiControls.tsx`**：托管开关、速度三档、搜索深度 1↔2、权重来源（内置 / 加载训练产物）。

**权重加载策略**：`DEFAULT_WEIGHTS` 来自打包进构建的 `src/ai/trained-weights.json`（保证 `dist` 独立可跑）；启动时额外尝试 `fetch('/ai/best-weights.json')`，成功且校验通过则覆盖——这样重新训练后无需 rebuild 即可看到新 AI。fetch 失败或校验不过则静默沿用内置权重。两份文件的关系见 7.1。

### 8.2 训练可视化面板

Vite 第二入口 `training.html`（`vite.config.ts` 增加 `build.rollupOptions.input`），源码在 `src/training/dashboard/`。

每 1000ms `fetch('/ai/training-log.jsonl', { cache: 'no-store' })` 全量拉取并按行解析。日志规模为「每代一行」，数百代量级下体积微不足道，无需增量协议。训练器直接写入 `public/ai/`，因此**训练进行中即可实时看曲线**，不需要任何服务端代码。

四块内容：

1. **适应度曲线** —— 逐代 best / median / worst，min-max 带状图
2. **权重演化** —— 9 条 μ 分量随代数的轨迹
3. **σ 收缩热力图** —— 9 维 × 代数，展示分布如何从发散走向确信
4. **当前最优权重条形图** + 关键指标行（代数、最优消行、已用时长、当前 maxPieces）

**手写 SVG，不引图表库**：项目现有依赖仅 react + zustand 三个，为四张图引入 recharts 不划算；且需与游戏本体的霓虹风格统一。实现时先读 `dataviz` skill 确定配色与图表规范。

空状态：日志不存在或为空时显示「尚未开始训练」，而非空白页或报错。

## 9. 错误处理

| 场景 | 处理 |
|---|---|
| worker 崩溃 | 该任务重试一次；再失败记 fitness 0 并 `console.warn` 记录 taskId 与错误——**不静默吞掉** |
| `bestPlacement` 返回 null | 判定 game over，结算当前 lines |
| Ctrl-C | 写 checkpoint 后 `process.exit(0)` |
| `best-weights.json` 缺失/格式错误 | 面板与网页均回退到内置权重，控制台提示 |
| 面板读不到日志 | 显示空状态 |
| 网页 AI 规划耗时超过重力间隔 | 自愈式回放自动重规划，无需特殊处理 |

## 10. 测试策略

新增 `vitest`。`npm test` 运行全部。

1. **特征函数**（`features.test.ts`）—— 在手工构造的棋盘上断言**确定值**：空洞数、井深、行/列 transitions、bumpiness。这类函数错一个边界条件，训练照样能跑但结果全错，必须逐项钉死。
2. **BFS 落点**（`placements.test.ts`）—— 空棋盘上**去重后**的落点数：O 块 9、I 块 17（横 7 + 竖 10）、S/Z 各 17、T/J/L 各 34（横向 3 宽 × 8 位 × 2 态 + 纵向 2 宽 × 9 位 × 2 态）。这组数字同时验证了去重逻辑：不去重时 O 会是 36、I 会是 34。另需断言：返回的每个 `placement.piece` 都满足 `isValidPosition` 且下移一格非法；按 `moves` 序列从出生位置重放必然抵达 `placement.piece`。
3. **差分测试**（`simulate.test.ts`）—— **信任基石**：同一段随机操作序列，`simulate.ts` 与真实 `gameStore` 必须产出逐格相同的棋盘、相同的 lines 与 score。这条挂了说明训练环境已与真游戏分叉，训练出的权重无意义。
4. **确定性**（`rng.test.ts`）—— 同种子的 `simulateGame` 必产出完全相同的 `SimResult`。适应度不可复现则训练结果无法证伪。
5. **权重序列化** —— `fromVector(toVector(w))` 恒等；`normalize` 后 L2 范数为 1。

## 11. 非目标（明确排除）

hold 功能、T-spin 识别与计分、DAS/ARR 手感模拟、神经网络/深度强化学习、对战与垃圾行、训练结果的云端存储。

## 12. 实施阶段

| 阶段 | 内容 | 可验证的里程碑 |
|---|---|---|
| ① | `src/ai/` 核心 + 全部测试 + `generateBag` 改动 | 差分测试通过；`bench` 能用手调权重跑出成绩 |
| ② | `useAiPlayer` + `AiControls` | 打开网页点「AI 托管」，能看见 AI 用手调权重实际游玩 |
| ③ | `training/` 训练器 | `npm run train` 跑起来，日志显示 fitness 逐代上升 |
| ④ | 训练面板 | `training.html` 实时显示四张图 |

每阶段结束都是一个独立可用、可验证的状态。阶段②刻意排在训练之前——先让 AI 在网页里真的动起来，能尽早暴露 BFS 与回放逻辑的问题，避免把 bug 一路带进训练。

## 13. 已知风险

- **权重可能收敛到「苟活但不消行」的局部最优**（堆平不清行）。缓解：fitness 用消行数而非存活块数；若出现，`linesCleared` 特征需要更强的先验或改用「每块消行率」做适应度。
- **2 层前瞻在浏览器高等级下的耗时**未实测。若单次规划超过 100ms 影响观感，网页端降为 depth=1（训练仍用 2 层，但需注意 5.5 节所述的深度—权重绑定问题，届时应另训一套 1 层权重）。
- **差分测试的操作序列覆盖度**依赖随机生成。需保证序列包含旋转踢墙、消行、多行同消等场景，而非只有平移与硬降。
