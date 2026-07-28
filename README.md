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
- **Lookahead** — 搜索深度，`1 ply`（只看当前方块）或 `2 ply`（同时看一步之后的下一个方块，决策更好但更慢）。
- **Weights** — 权重来源：
  - `bundled`：打包进构建产物的权重（`src/ai/trained-weights.json`，训练产出，缺省时回退到手工设定的 Dellacherie 式权重）。
  - `trained`：运行时从 `public/ai/best-weights.json` 拉取的最新训练权重，无需重新构建即可生效；训练尚未产出该文件前此选项不可用。

面板上会显示当前实际生效的权重来源及其代数（gen）和平均消行数，便于确认 AI 到底在用哪一套权重下棋。

## 🧠 AI 训练与评测

`src/ai/` 是纯函数的 AI 评估引擎（特征提取、落子搜索、权重校验），不依赖 DOM、文件系统或 Node 内置模块，因此可以同时在浏览器和 Node 训练脚本中运行。`training/` 目录下是围绕它构建的训练与评测工具链：

```bash
# 运行全部单元测试
npm test

# 对一组权重跑基准评测（局数/搜索深度/单局最大方块数可调）
npm run bench -- --games 20 --depth 2 --max-pieces 5000

# 启动 CEM（交叉熵方法）训练循环 —— 多小时级、会持续运行直至达到代数上限或 Ctrl-C
npm run train -- --generations 200

# 从上次的 checkpoint 继续训练
npm run train -- --resume

# 只对训练脚本做类型检查（与主应用的 tsconfig 分开）
npm run typecheck:train
```

训练过程会把每一代的统计数据追加写入 `public/ai/training-log.jsonl`，并在每次刷新最佳权重时同步更新 `public/ai/best-weights.json` 与 `src/ai/trained-weights.json`。

访问 `training.html`（开发模式下即 `npm run dev` 后的 `/training.html`）可以打开训练可视化面板，它会持续轮询 `public/ai/training-log.jsonl`，训练运行时图表随日志增长自动刷新，无需手动刷新页面。

> **动手改训练之前，请先读 [`docs/ai-training-handoff.md`](docs/ai-training-handoff.md)。**
> 它记录了当前进度、几个会浪费数小时的坑，以及最关键的一点：适应度函数在当前设计下会封顶——称职的候选根本不会死，导致消行数恒等于 `0.4 × 局长上限`，训练权重与手调权重在任何封顶基准上都区分不出来。

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
│   ├── search.ts      # 1/2-ply 落子搜索
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