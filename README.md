# Cyberpunk Tetris

一个使用 React + TypeScript + Zustand 和 Vite 构建的赛博朋克风格俄罗斯方块游戏。

## 🎮 游戏特性

### 核心功能
- **完整的俄罗斯方块游戏逻辑**
  - 所有 7 种标准方块类型 (I, O, T, S, Z, J, L)
  - 硬降（Hard Drop）和软降（Soft Drop）
  - 旋转系统（SRS 旋转规则）
  - 墙踢（Wall Kick）系统
  - 行消除动画

- **游戏机制**
  - 分数系统
  - 等级系统（1-15级）
  - 速度递增
  - 下一个方块预览
  - 游戏状态管理（空闲、游戏中、暂停、游戏结束）

### 视觉效果
- **赛博朋克主题设计**
  - 霓虹光效
  - 发光边框
  - 动态颜色
  - 黑色背景配合亮色方块

- **流畅的动画**
  - 方块移动动画
  - 行消除闪烁效果
  - 硬降轨迹显示

## 🛠️ 技术栈

- **前端框架**: React 18.3.1
- **状态管理**: Zustand 5.0.14
- **构建工具**: Vite 6.0.7
- **类型系统**: TypeScript 5.6.2
- **代码规范**: ESLint 9.17.0
- **样式**: CSS（内联样式 + CSS 变量）

## 🚀 快速开始

### 环境要求
- Node.js 18+ 
- npm 或 yarn

### 安装依赖
```bash
npm install
```

### 开发模式
```bash
npm run dev
```
访问 `http://localhost:5190` 查看游戏

### 构建生产版本
```bash
npm run build
```

### 预览生产版本
```bash
npm run preview
```

### 代码检查
```bash
npm run lint
```

## 🎯 游戏控制

| 按键 | 动作 |
|------|------|
| **←/→** | 左右移动 |
| **↓** | 软降（加速下落） |
| **↑** | 顺时针旋转 |
| **Shift** | 逆时针旋转 |
| **Space** | 硬降（直接落到底部） |
| **P** | 暂停/继续 |
| **R** | 重新开始 |

## 🤖 AI 自动对战

游戏内置一个 AI 面板，可以让内置的 AI 接管游戏：

- **Autoplay 开关** — 开启/关闭 AI 自动对战。
- **Speed** — 出手速度：`instant`（立即落子）、`normal`、`slow`。
- **Lookahead** — 当前固定的 4-lock bag-aware 搜索（`bag-expectimax-hold-v1`，root/child beams 64/32）；旧的 1/2-ply helpers 仅作兼容保留。
- **Weights** — 权重来源：
  - `bundled`：打包进构建产物的权重（`src/ai/trained-weights.json`，训练产出，缺省时回退到手工设定的 Dellacherie 式权重）。
  - `trained`：运行时从 `public/ai/best-weights.json` 拉取的最新训练权重，无需重新构建即可生效；训练尚未产出该文件前此选项不可用。

面板会显示当前实际生效的权重来源。`bundled` 会显示打包权重的代数；运行时 `trained` 权重还会显示固定复评的平均消行数与平均堆叠高度，便于确认 AI 到底在用哪一套权重下棋。

## 🧠 AI 训练与评测

`src/ai/` 是纯函数的 AI 评估引擎（特征提取、落子搜索、权重校验），不依赖 DOM、文件系统或 Node 内置模块，因此可以同时在浏览器和 Node 训练脚本中运行。`training/` 目录下是围绕它构建的训练与评测工具链：

```bash
# 运行全部单元测试
npm test

# 对一组权重跑基准评测（搜索固定为 depth 4、beams 64/32）
npm run bench -- --games 20 --max-pieces 5000

# 新建 CEM（交叉熵方法）训练轮次 —— 仅在已授权且 output dir 为空时
npm run train -- --generations 200 --output-dir public/ai/<new-run-id>

# 新轮次只用 8 个核心跑，把机器留给自己用（缺省是核心数 - 1）
# 代价很小：实测 31 → 8 个 worker，单代只慢 16%（一代的耗时由少数长对局的尾巴决定）
npm run train -- --generations 200 --workers 8 --output-dir public/ai/<new-run-id>

# 从默认 score-rate-v4 checkpoint 继续训练（须先完整核验并获得授权）
npm run train -- --resume

# 对已产出的 qualified candidate 与发布基线做独立逐局配对（命令已实现；仍须单独授权）
# seed 必须是独立整数，不得复用训练或固定复评 seed，并在本次基线/候选配对中固定使用
npm run bench:paired -- --baseline <baseline-weights> --candidate <candidate-weights> --seed <independent-integer>

# 只对训练脚本做类型检查（与主应用的 tsconfig 分开）
npm run typecheck:train
```

当前代码与训练器契约是 **`score-rate-v4`、checkpoint schema 5、13 维特征**，搜索契约为 `bag-expectimax-hold-v1`：搜索仅使用公开局面信息，采用标准 Hold、精确 bag chance、depth 4、beams 64/32。标量 fitness 仍严格为 `meanScore / scheduled maxPieces`；clear histogram、`tetrisLineShare`、策略诊断、搜索诊断与存活诊断都不进入 CEM 排序或分布更新。

新轮次默认把 checkpoint 和每代统计写入 `public/ai/score-rate-v4/`；目录中只要已有任何条目，新跑就会 fail closed。只有固定复评同时通过得分、四消与存活资格门后，训练器才会在当前 run dir 写入 `candidate-weights.json`，不会自动改写 `public/ai/best-weights.json` 或 `src/ai/trained-weights.json`。当前已经发布的 bundled/runtime 模型仍是 **version 3、`score-rate-v2` gen-40**；加载时只在内存中补齐 v4 特征尾维，不会改写发布文件。`score-rate-v1` / `score-rate-v2` / `score-rate-v3` checkpoint 和日志均不是 schema 5 v4 可恢复产物。

访问 `training.html`（开发模式下即 `npm run dev` 后的 `/training.html`）可以打开训练可视化面板，它会持续轮询 `/ai/score-rate-v4/training-log.jsonl`，训练运行时图表随日志增长自动刷新，无需手动刷新页面。

> **动手改训练之前，请先读 [`docs/ai-training-handoff.md`](docs/ai-training-handoff.md)。**
> 它记录了当前进度、几个会浪费数小时的坑，以及最关键的一点：**消行数这个指标会封顶**——称职的候选根本不会死，消行数恒等于 `0.4 × 局长上限`，任何只看消行的基准都区分不出它们。项目曾使用 `平均消行 - heightPenalty × 平均堆叠高度`，但该目标现已退役；当前 `score-rate-v4` 继续在固定调度下优化 `meanScore / maxPieces`，新增建井特征与所有四消指标仍不直接改写 fitness。

当前发布的 gen-40 `score-rate-v2` 权重在固定 `30 × 5000`、depth 2 复评中取得 `meanScore = 3,289,243.33`、`scoreRate = 657.8487`，相对 gen-20 基线 `620.966` 提高约 5.61%。但它每局平均只有 `0.0333` 次四消，`tetrisLineShare = 0.00667%`；得分提升主要来自双消增加，不能描述为已经形成稳定四消。当前可审计产物中未找到 gen-40 相对 gen-20 的独立 paired benchmark，因此固定复评更高分不能替代独立配对验收。

作为历史证据，gen-20 曾以新 seed `20260803` 对它当时的旧发布基线进行独立 paired benchmark：旧权重 `612.228`、gen-20 `621.272`，逐局 `30` 胜 `0` 负，平均差 `+9.044 score/piece`，95% paired 区间为 `[+7.813, +10.275]`。新的稳定四消策略设计见 [`2026-08-11 score-rate-v3 design`](docs/superpowers/specs/2026-08-11-score-rate-v3-tetris-strategy-design.md)；其代码契约现已实施，但这次代码工作**没有运行训练、benchmark 或 paired benchmark，也没有产出 candidate、完成验收、发布权重或进行浏览器/runtime 验收**。

后续门仍彼此独立：先另行授权两代隔离信号短跑；若两代中的 `bestTetrisLineShare` 与 `eliteTetrisLineShare` 始终都低于 `0.01`，立即停止并另写搜索设计。只有正式训练的固定复评候选达到 `tetrisLineShare >= 0.20`，同时通过得分与存活资格门，才可产出 run-local candidate。随后还必须用已实现但本次未运行的 `bench:paired` CLI 证明逐局 score rate 与 `tetrisLineShare` 的 95% paired 区间下界都大于 `0`，再分别申请发布、push 与浏览器/runtime 验收。

当前实现契约为 **`score-rate-v4` / schema 5 / `bag-expectimax-hold-v1`**：搜索仅使用公开局面信息，采用标准 Hold、精确 bag chance、depth 4、beams 64/32；fitness 严格为 `meanScore / scheduled maxPieces`。默认日志路径为 `public/ai/score-rate-v4/training-log.jsonl`。

已发布模型保持 version 3、`score-rate-v2` gen-40 不变；受保护的 `public/ai/score-rate-v3/` gen-10 产物保持原地未修改。本次交接未执行 search smoke、training、benchmark、paired acceptance、publication、push 或 browser/runtime acceptance，也未生成 v4 checkpoint、log、candidate 或权重文件。

## 📁 项目结构

```
src/
├── main.tsx           # 应用入口
├── App.tsx            # 主组件
├── index.css          # 全局样式
├── types.ts           # TypeScript 类型定义
├── constants.ts       # 游戏常量和配置
├── ai/                # AI 评估引擎（纯函数，无 DOM / 文件系统 / node: 依赖）
│   ├── features.ts    # 局面特征提取
│   ├── search.ts      # active searchIterative/searchFixed：公开 bag chance + Hold，固定 4-lock、beams 64/32；旧 evalMove/bestPlacement 为 legacy compatibility
│   ├── weights.ts     # 权重加载、校验与内置默认权重
│   └── trained-weights.json  # 训练产出的默认权重，构建时打包进 dist
├── training/dashboard/  # 训练可视化面板（training.html 的入口）
└── store/             # Zustand 状态管理
    ├── hooks.ts       # 自定义 React hooks
    └── useTetris.ts   # 游戏状态管理逻辑

training/               # 训练与评测 CLI（仓库根目录，与 src/ 平级，用 tsx 直接运行）
├── train.ts           # CEM 训练主循环
├── bench.ts           # 权重基准评测 CLI
├── cem.ts             # 交叉熵方法（CEM）核心算法
├── pool.ts            # 基于 worker_threads 的对局并行工作池
├── worker.ts          # 单局游戏模拟 worker
└── config.ts          # 训练超参数
```

## 🎮 游戏规则

### 基础规则
- 方块从顶部生成并向下移动
- 玩家可以移动、旋转和加速方块下落
- 当一行被填满时，该行会被消除
- 消除行越多，得分越高

### 计分系统
- 单行消除：40 分 × 当前等级
- 双行消除：100 分 × 当前等级
- 三行消除：300 分 × 当前等级
- 四行消除：1200 分 × 当前等级

### 等级系统
- 每消除 10 行升一级
- 等级越高，下落速度越快
- 最高等级为 15 级

## 🔧 构建和部署

### 开发环境

使用 Vite 提供的热重载开发服务器：

```bash
npm run dev
```

### 生产构建
```bash
npm run build
```
构建产物位于 `dist/` 目录。

### 类型检查
项目使用 TypeScript，构建时会自动进行类型检查。

## 🎨 自定义

### 修改游戏配置
在 `constants.ts` 中可以调整：
- 游戏板尺寸（`BOARD_WIDTH`, `BOARD_HEIGHT`）
- 方块大小（`CELL_SIZE`）
- 颜色主题（`PIECE_COLORS`, `PIECE_GLOW_COLORS`）
- 速度参数（`getSpeedInterval`）

### 添加新功能
游戏状态管理使用 Zustand，在 `store/useTetris.ts` 中可以：
- 添加新的游戏状态
- 实现新的游戏机制
- 自定义计分规则

## 📄 许可证

MIT License

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 🔗 相关链接

- [Vite 文档](https://vitejs.dev/)
- [React 文档](https://react.dev/)
- [Zustand 文档](https://docs.pmnd.rs/zustand/)
- [TypeScript 文档](https://www.typescriptlang.org/docs/)
