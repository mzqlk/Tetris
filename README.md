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
访问 `http://localhost:5173` 查看游戏

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

## 📁 项目结构

```
src/
├── main.tsx           # 应用入口
├── App.tsx            # 主组件
├── index.css          # 全局样式
├── types.ts           # TypeScript 类型定义
├── constants.ts       # 游戏常量和配置
└── store/             # Zustand 状态管理
    ├── hooks.ts       # 自定义 React hooks
    └── useTetris.ts   # 游戏状态管理逻辑
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