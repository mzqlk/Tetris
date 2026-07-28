# Tetris AI 训练系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为现有 Tetris 游戏交付一套纯函数 AI 核心、一个 CEM 并行训练器，以及网页内的 AI 托管模式与训练可视化面板。

**Architecture:** `src/ai/` 是唯一一份 AI 逻辑，浏览器与 Node 共用；它复用 `src/engine/` 的真实游戏函数，因此训练环境不可能与真游戏分叉。训练器在 `training/` 下用 `worker_threads` 并行跑无头对局，把结果写进 `public/ai/`；浏览器侧一个 hook 把 AI 的按键序列派发给现有 zustand store，面板轮询 `public/ai/` 里的日志。

**Tech Stack:** TypeScript 5.6 · React 18 · zustand 5 · Vite 6 · vitest（新增）· tsx（新增）· Node `worker_threads`。图表手写 SVG，不引图表库。

## Global Constraints

- 棋盘 `TOTAL_ROWS = 22`（20 可见 + 2 缓冲）、`BOARD_WIDTH = 10`、row 0 在顶部。所有特征以 22 行为准。
- `src/engine/*` 的不可变约定不得破坏：`clearLines` 用 `filter` 返回**与原棋盘共享的行数组引用**，因此任何代码都**绝不可**原地修改棋盘行。
- 落点枚举必须走 `rotatePiece`（复用 SRS 踢墙），不得自行计算旋转。
- AI 逻辑只有一份。禁止为「训练快一点」复制简化逻辑。
- 特征顺序由 `FEATURE_NAMES` 单一定义，权重文件用**具名对象**而非裸数组。
- 新增依赖仅限：`vitest`、`tsx`、`@types/node`（均为 devDependency）。不引图表库。
- 已验证环境：Node 24.14.0 / npm 11.9.0 / 32 核；tsx 4.23.1 支持 TS worker_threads 与 JSON import。
- 非目标（不实现）：hold、T-spin、DAS/ARR、神经网络、对战、云端存储。

---

## 设计评审结论

实施前对 `docs/superpowers/specs/2026-07-27-tetris-ai-training-design.md` 做了代码级核对。**设计整体成立**，§10.2 的落点计数已用真实引擎逐一验证无误。以下是与 spec 的差异，均已并入下面的任务：

| # | 发现 | 处置 |
|---|---|---|
| 1 | **`gameStore` 每次锁定丢弃已预览的方块**（`spawnNextPiece` 抽两张，预览的那张永不出场）。§5.5 的 2 层前瞻建立在预览真实之上，否则 AI 按一个永不到来的方块规划，且 §10.3 的差分测试会把 bug 固化进训练器 | **Task 1** 修复：预览方块晋升为当前方块，只补抽一张。顺带修复了被破坏的 7-bag 公平性 |
| 2 | spec §4 称「改动面只有两处」，实际还需 `resolveJsonModule`（否则 §7.1 的 JSON import 无法通过 `tsc -b`）、`@types/node`、`vite.config.ts` 第二入口、`package.json` 脚本 | 各任务内就地处理，Task 1 集中做工程配置 |
| 3 | §5.4 的 BFS 状态键必须容纳**负的 x 和 y**——SRS 踢墙可把方块向上顶。实测空棋盘 x∈[-2,8]，受阻棋盘可达 y<0 | Task 5 用带偏移的整数键，偏移取足余量 |
| 4 | §5.4 称状态上界 880，实为 ~1300（x 13 档 × y 25 档 × 4 转态）。实测单次枚举访问 667–756 个状态 | Task 5 注释更正，不影响实现 |
| 5 | §5.6 的 `simulateGame` 接口无法驱动 §10.3 的差分测试（后者需要逐个动作对拍） | Task 7 额外导出 `createSimState` / `applyAction` 低层驱动 API，`simulateGame` 建在其上 |
| 6 | §10.3 需要控制 `gameStore` 的随机源，但 spec §4 只给 `generateBag` 加了参数——store 内部仍调用无参版本 | 差分测试用 `vi.spyOn(Math, 'random')` 注入 mulberry32，**不动 store**，保住最小改动原则 |
| 7 | `normalize` 对零向量会产生 NaN | Task 4 加零向量保护并写测试 |
| 8 | §6 的超参数（`initialMaxPieces` 等）未经性能实测。depth=2 每步约 34×34 次 `evalMove`，maxPieces 翻倍到 4800 时单代耗时是初始的 16 倍 | Task 8 的 `bench` 输出 `pieces/sec`，作为 Task 13 启动前的标定手段；风险登记见文末 |
| 9 | 仓库根目录有一个 Windows 重定向残留的 `nul` 文件（未跟踪） | Task 1 删除 |
| 10 | **§6.2 的渐进式局长上限永远不会触发**。条件是「fitness 中位数 > 0.8 × maxPieces」，但 fitness 的单位是**消行数**、maxPieces 的单位是**方块数**。每个方块 4 格、每行 10 格，所以消行数/方块数 ≤ **0.4 是数学上限**，`lines > 0.8 × pieces` 恒不成立。实测手调权重 depth=2 的比值为 0.399，已贴着上限。后果是局长永远停在 300，个体一旦普遍打满上限，fitness 就饱和、CEM 失去梯度——正是这条规则本该防止的事 | Task 12 改判据为**中位存活方块数** > 0.8 × maxPieces（`SimResult.pieces` 已有此数据），语义就是「上限已成为瓶颈」 |

**性能预算（实测，单核 Node 24）**：depth=1 约 **2 900 步/秒**，depth=2 约 **115 步/秒**（慢 25 倍）。按 31 worker 计，spec §6.6 的默认超参（population=100、gamesPerCandidate=5、initialMaxPieces=300、depth=2）单代约 **42 秒**；局长翻倍到 4 800 后约 **11 分钟/代**。Task 8 的 `bench` 会在实机复测这两个数，作为 Task 13 启动前的标定。

**未采纳的改动**：spec §5.4 的落点去重键、§5.2 的九项特征定义、§6.1 的 CEM 公式、§6.2 的共同随机数方案均已核对无误，原样实现。

---

## File Structure

**新建 — AI 核心（浏览器与 Node 共用，纯函数）**

| 文件 | 职责 |
|---|---|
| `src/ai/rng.ts` | `mulberry32` 确定性随机源、`hashSeed` 种子派生 |
| `src/ai/features.ts` | `FEATURE_NAMES` 与九项特征提取 |
| `src/ai/weights.ts` | 权重对象 ↔ 向量互转、L2 归一化、权重文件校验、内置权重 |
| `src/ai/trained-weights.json` | 模型本体，打包进构建（**提交进 git**） |
| `src/ai/placements.ts` | BFS 落点枚举，按最终格子集合去重 |
| `src/ai/replay.ts` | 按键序列的状态投影与位姿比较（网页回放与落点测试共用） |
| `src/ai/search.ts` | `evalMove` / `bestPlacement`，1–2 层前瞻 |
| `src/ai/simulate.ts` | 无头对局：低层 `applyAction` 驱动 + `simulateGame` |
| `src/ai/loadWeights.ts` | 运行时 `fetch` 训练产物（仅浏览器） |
| `src/ai/testUtils.ts` | 测试用 ASCII 棋盘构造器 |

**新建 — 训练器（仅 Node）**

| 文件 | 职责 |
|---|---|
| `training/config.ts` | 全部超参数与默认值 |
| `training/cem.ts` | CEM 的纯数学部分（采样、精英更新、噪声、局长调度） |
| `training/pool.ts` | worker 池：按局分发、失败重试一次 |
| `training/worker.ts` | worker 入口，只做 `simulateGame` |
| `training/train.ts` | CEM 主循环、日志、断点、复评、CLI |
| `training/bench.ts` | 用指定权重跑 N 局并报告成绩与吞吐 |

**新建 — 展示层**

| 文件 | 职责 |
|---|---|
| `src/hooks/useAiPlayer.ts` | AI 托管：规划 → 派发按键 → 自愈重规划 |
| `src/components/AiControls.tsx` + `.module.css` | 托管开关、速度、深度、权重来源 |
| `training.html` | Vite 第二入口 |
| `src/training/dashboard/main.tsx` | 面板入口 |
| `src/training/dashboard/useTrainingLog.ts` | 轮询并解析 jsonl |
| `src/training/dashboard/scales.ts` | 线性比例尺与刻度算法（纯函数，有测试） |
| `src/training/dashboard/charts.tsx` | 四张手写 SVG 图 |
| `src/training/dashboard/App.tsx` + `.module.css` | 面板布局与空状态 |

**修改**

| 文件 | 改动 |
|---|---|
| `src/store/gameStore.ts` | 修复预览方块晋升（Task 1） |
| `src/engine/piece.ts` | `generateBag` 接受可注入随机源（Task 2） |
| `src/components/Game.tsx` | 挂载 `<AiControls />`（Task 10） |
| `tsconfig.json` | 加 `resolveJsonModule`（Task 1） |
| `tsconfig.node.json` | 纳入 `vitest.config.ts`、加 `types: ["node"]`（Task 1） |
| `vite.config.ts` | 第二入口 `training.html`（Task 14） |
| `package.json` | 新依赖与脚本（Task 1、8、13） |
| `.gitignore` | 忽略 `public/ai/` 产物（Task 13） |

---

## Task 1: 工程配置与 next 预览修复

**Files:**
- Modify: `package.json`（依赖 + `test` 脚本）
- Modify: `tsconfig.json`（`resolveJsonModule`）
- Modify: `tsconfig.node.json`（`types`、`include`）
- Create: `vitest.config.ts`
- Create: `tsconfig.train.json`
- Modify: `src/store/gameStore.ts:33-97, 114-133, 170-202, 213-254`
- Test: `src/store/gameStore.test.ts`
- Delete: `nul`

**Interfaces:**
- Consumes: 无
- Produces: `npm test` 可运行；`gameStore` 的 `nextPiece` 保证是下一个真正登场的方块 —— 这是 Task 6 `bestPlacement(board, current, next, ...)` 与 Task 7 差分测试的前提。

- [ ] **Step 1: 安装依赖并删除残留文件**

```bash
npm install --save-dev vitest@^3 @types/node@^22 tsx@^4
rm -f nul
```

- [ ] **Step 2: 加 `test` 脚本**

在 `package.json` 的 `scripts` 中加入（保留既有项）：

```json
"test": "vitest run",
"test:watch": "vitest",
"typecheck:train": "tsc -p tsconfig.train.json"
```

- [ ] **Step 3: 建 `vitest.config.ts`**

不复用 `vite.config.ts`，避免 React 插件拖慢纯 Node 测试。

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'training/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: 打开 `resolveJsonModule`**

`tsconfig.json` 的 `compilerOptions` 中，在 `"isolatedModules": true,` 之后插入一行：

```json
    "resolveJsonModule": true,
```

（Task 4 的 `src/ai/weights.ts` 会 `import trained from './trained-weights.json'`，没有这一行 `npm run build` 的 `tsc -b` 会报 TS2732。）

- [ ] **Step 5: 让 `tsconfig.node.json` 认识 vitest 配置与 Node 类型**

把 `tsconfig.node.json` 末尾的 `"include"` 改为下面这样，并在 `compilerOptions` 里加 `"types"`：

```json
    "noUncheckedSideEffectImports": true,
    "types": ["node"]
  },
  "include": ["vite.config.ts", "vitest.config.ts"]
}
```

- [ ] **Step 6: 新建 `tsconfig.train.json`**

`tsconfig.json` 的 `include` 只有 `src`，`training/` 不会被 `npm run build` 检查，需要独立配置。

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["training", "src/ai", "src/types.ts", "src/constants.ts", "src/engine"]
}
```

- [ ] **Step 7: 写会失败的测试**

新建 `src/store/gameStore.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { useGameStore } from './gameStore';
import { createEmptyBoard } from '../engine/board';
import type { PieceType } from '../types';

describe('gameStore piece queue', () => {
  it('promotes the previewed piece to current on lock', () => {
    useGameStore.getState().startGame();

    for (let i = 0; i < 5; i++) {
      expect(useGameStore.getState().status).toBe('playing');
      const previewed = useGameStore.getState().nextPiece!.type;
      useGameStore.getState().hardDrop();
      expect(useGameStore.getState().currentPiece!.type).toBe(previewed);
    }
  });

  it('plays each of the 7 piece types exactly once per bag', () => {
    useGameStore.getState().startGame();
    const played: PieceType[] = [useGameStore.getState().currentPiece!.type];

    for (let i = 0; i < 6; i++) {
      // Reset the board each lock so the stack never reaches the spawn area.
      useGameStore.setState({ board: createEmptyBoard() });
      useGameStore.getState().hardDrop();
      played.push(useGameStore.getState().currentPiece!.type);
    }

    expect([...played].sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('spawns the current piece at the spawn position, not the previewed position', () => {
    useGameStore.getState().startGame();
    useGameStore.getState().hardDrop();
    const p = useGameStore.getState().currentPiece!;
    expect(p.rotation).toBe(0);
    expect(p.position).toEqual({ x: 3, y: 0 });
  });
});
```

- [ ] **Step 8: 运行测试，确认失败**

Run: `npm test -- src/store/gameStore.test.ts`
Expected: 前两条 FAIL —— `promotes the previewed piece` 报 `expected 3 to be 5`（类似的类型编号不符），`plays each of the 7 piece types` 报数组含重复值。第三条 PASS。

- [ ] **Step 9: 修复 `gameStore.ts` 的方块队列**

把 `src/store/gameStore.ts` 中的 `spawnNextPiece`（第 33–53 行）整个替换为下面两个函数：

```ts
/** Initial spawn: draw two pieces — one to play, one to preview. */
function spawnInitial(bag: PieceType[], board: Board): {
  currentPiece: Piece;
  nextPiece: Piece;
  bag: PieceType[];
  gameOver: boolean;
} {
  const first = drawFromBag(bag);
  const second = drawFromBag(first.newBag);

  const currentPiece = createPiece(first.type);
  const nextPiece = createPiece(second.type);

  return {
    currentPiece,
    nextPiece,
    bag: second.newBag,
    gameOver: isGameOver(board, currentPiece),
  };
}

/**
 * After a lock: the piece the player was shown becomes the piece they play,
 * and exactly one new piece is drawn for the preview. Drawing two here would
 * silently discard the previewed piece and break the 7-bag guarantee.
 */
function promoteNextPiece(bag: PieceType[], board: Board, preview: Piece): {
  currentPiece: Piece;
  nextPiece: Piece;
  bag: PieceType[];
  gameOver: boolean;
} {
  const currentPiece = createPiece(preview.type);
  const drawn = drawFromBag(bag);

  return {
    currentPiece,
    nextPiece: createPiece(drawn.type),
    bag: drawn.newBag,
    gameOver: isGameOver(board, currentPiece),
  };
}
```

- [ ] **Step 10: 让 `lockAndSpawn` 接收预览方块**

在 `lockAndSpawn` 的参数列表末尾加 `preview: Piece | null`，并把函数体里的 `const result = spawnNextPiece(bag, boardAfterClear);` 换成：

```ts
  const result = preview
    ? promoteNextPiece(bag, boardAfterClear, preview)
    : spawnInitial(bag, boardAfterClear);
```

签名变为：

```ts
function lockAndSpawn(
  board: Board,
  piece: Piece,
  bag: PieceType[],
  score: number,
  level: number,
  lines: number,
  preview: Piece | null
): { /* 返回类型不变 */ }
```

- [ ] **Step 11: 更新三个调用点**

`startGame` 中把 `spawnNextPiece(initialBag, board)` 改为 `spawnInitial(initialBag, board)`。

`hardDrop` 中：

```ts
    const spawned = lockAndSpawn(
      board, dropped, get().bag, score + hardDropScore, get().level, get().lines, get().nextPiece
    );
```

`tick` 的重力锁定分支中：

```ts
        const spawned = lockAndSpawn(
          state.board, state.currentPiece, state.bag, state.score, state.level, state.lines, state.nextPiece
        );
```

- [ ] **Step 12: 运行测试确认通过**

Run: `npm test -- src/store/gameStore.test.ts`
Expected: 3 passed

- [ ] **Step 13: 确认既有构建未被破坏**

Run: `npm run build`
Expected: 成功，无 TS 报错

- [ ] **Step 14: Commit**

```bash
git add package.json package-lock.json tsconfig.json tsconfig.node.json tsconfig.train.json vitest.config.ts src/store/gameStore.ts src/store/gameStore.test.ts
git rm --cached nul 2>/dev/null || true
git commit -m "fix: previewed piece now becomes the next played piece

The spawn helper drew two pieces on every lock, so the piece shown in the
Next panel was discarded and never played — the preview was decorative
noise and the 7-bag guarantee was broken. Also adds vitest and the
TypeScript config needed by the AI work."
```

---

## Task 2: 确定性随机源与可注入的 `generateBag`

**Files:**
- Create: `src/ai/rng.ts`
- Test: `src/ai/rng.test.ts`
- Modify: `src/engine/piece.ts:48-56`

**Interfaces:**
- Consumes: 无
- Produces:
  - `mulberry32(seed: number): () => number` —— 返回 [0,1) 均匀分布
  - `hashSeed(...values: number[]): number` —— 返回 u32，Task 13 用它生成共同随机数种子
  - `generateBag(rng?: () => number): PieceType[]` —— 默认参数为 `Math.random`，既有调用点行为不变

- [ ] **Step 1: 写会失败的测试**

新建 `src/ai/rng.test.ts`：

```ts
import { describe, it, expect, vi } from 'vitest';
import { mulberry32, hashSeed } from './rng';
import { generateBag } from '../engine/piece';

describe('mulberry32', () => {
  it('is deterministic for a given seed', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    const seqA = Array.from({ length: 50 }, () => a());
    const seqB = Array.from({ length: 50 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it('produces different streams for different seeds', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect(Array.from({ length: 10 }, () => a())).not.toEqual(
      Array.from({ length: 10 }, () => b()),
    );
  });

  it('stays within [0, 1)', () => {
    const r = mulberry32(99);
    for (let i = 0; i < 10000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('has roughly uniform mean', () => {
    const r = mulberry32(7);
    let sum = 0;
    for (let i = 0; i < 100000; i++) sum += r();
    expect(sum / 100000).toBeCloseTo(0.5, 2);
  });
});

describe('hashSeed', () => {
  it('is deterministic and order-sensitive', () => {
    expect(hashSeed(1, 2, 3)).toBe(hashSeed(1, 2, 3));
    expect(hashSeed(1, 2, 3)).not.toBe(hashSeed(3, 2, 1));
  });

  it('returns a uint32', () => {
    for (const v of [hashSeed(0), hashSeed(-1), hashSeed(2 ** 31, 5)]) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(2 ** 32);
    }
  });

  it('spreads nearby inputs apart', () => {
    const seen = new Set<number>();
    for (let gen = 0; gen < 200; gen++) {
      for (let j = 0; j < 5; j++) seen.add(hashSeed(42, gen, j));
    }
    expect(seen.size).toBe(1000);
  });
});

describe('generateBag', () => {
  it('always returns a permutation of the 7 piece types', () => {
    const rng = mulberry32(3);
    for (let i = 0; i < 200; i++) {
      expect([...generateBag(rng)].sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    }
  });

  it('is deterministic for a given rng seed', () => {
    expect(generateBag(mulberry32(555))).toEqual(generateBag(mulberry32(555)));
  });

  it('defaults to Math.random so existing callers are unchanged', () => {
    const spy = vi.spyOn(Math, 'random');
    generateBag();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('does not touch Math.random when an rng is injected', () => {
    const spy = vi.spyOn(Math, 'random');
    generateBag(mulberry32(1));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- src/ai/rng.test.ts`
Expected: FAIL —— `Failed to resolve import "./rng"`

- [ ] **Step 3: 实现 `src/ai/rng.ts`**

```ts
/**
 * mulberry32 — a PRNG with a single u32 of state. Chosen because training only
 * needs speed, reproducibility, and a state small enough to drop into a
 * checkpoint; its statistical quality is more than adequate here.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * FNV-1a over the little-endian bytes of each value. Used to derive a game seed
 * from (baseSeed, generation, gameIndex) so every candidate in a generation
 * faces the identical set of piece sequences.
 */
export function hashSeed(...values: number[]): number {
  let h = 0x811c9dc5;
  for (const value of values) {
    let x = value >>> 0;
    for (let byte = 0; byte < 4; byte++) {
      h ^= x & 0xff;
      h = Math.imul(h, 0x01000193) >>> 0;
      x >>>= 8;
    }
  }
  return h >>> 0;
}
```

- [ ] **Step 4: 让 `generateBag` 接受随机源**

`src/engine/piece.ts` 第 48–56 行替换为：

```ts
export function generateBag(rng: () => number = Math.random): PieceType[] {
  const bag: PieceType[] = [1, 2, 3, 4, 5, 6, 7];
  // Fisher-Yates shuffle
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  return bag;
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npm test`
Expected: all passed（含 Task 1 的 store 测试）

- [ ] **Step 6: Commit**

```bash
git add src/ai/rng.ts src/ai/rng.test.ts src/engine/piece.ts
git commit -m "feat: add deterministic rng and injectable bag generation"
```

---

## Task 3: 特征提取

**Files:**
- Create: `src/ai/features.ts`
- Create: `src/ai/testUtils.ts`
- Test: `src/ai/features.test.ts`

**Interfaces:**
- Consumes: `Board`、`Position`（`src/types.ts`）、`BOARD_WIDTH`/`TOTAL_ROWS`（`src/constants.ts`）
- Produces:
  - `FEATURE_NAMES`（9 个字面量的 readonly 元组）、`type FeatureName`、`FEATURE_COUNT = 9`
  - `extractFeatures(boardAfter: Board, linesCleared: number, placedCells: Position[]): number[]` —— 长度 9，顺序同 `FEATURE_NAMES`
  - `columnHeights(board: Board): number[]`
  - `boardFrom(rows: string[]): Board`（`testUtils.ts`）—— Task 5/6/7 的测试都用它

- [ ] **Step 1: 写棋盘构造器**

新建 `src/ai/testUtils.ts`：

```ts
import type { Board } from '../types';
import { BOARD_WIDTH, TOTAL_ROWS } from '../constants';
import { createEmptyBoard } from '../engine/board';

/**
 * Build a board from bottom-anchored ASCII rows: '#' filled, '.' empty.
 * The LAST string is the bottom row, so a 3-row argument describes rows
 * 19, 20, 21 and leaves everything above empty.
 */
export function boardFrom(rows: string[]): Board {
  const board = createEmptyBoard();
  rows.forEach((row, i) => {
    if (row.length !== BOARD_WIDTH) {
      throw new Error(`row ${i} has ${row.length} chars, expected ${BOARD_WIDTH}`);
    }
    const r = TOTAL_ROWS - rows.length + i;
    for (let c = 0; c < BOARD_WIDTH; c++) {
      board[r][c] = row[c] === '#' ? 1 : 0;
    }
  });
  return board;
}
```

- [ ] **Step 2: 写会失败的测试**

每个数字都是按 §5.2 的定义手工推导的。新建 `src/ai/features.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import {
  FEATURE_NAMES, FEATURE_COUNT, extractFeatures, columnHeights,
  countHoles, rowTransitions, colTransitions, wellDepth,
} from './features';
import { boardFrom } from './testUtils';
import { createEmptyBoard } from '../engine/board';

const idx = (name: (typeof FEATURE_NAMES)[number]) => FEATURE_NAMES.indexOf(name);

describe('FEATURE_NAMES', () => {
  it('has 9 unique names in the documented order', () => {
    expect(FEATURE_COUNT).toBe(9);
    expect(new Set(FEATURE_NAMES).size).toBe(9);
    expect(FEATURE_NAMES).toEqual([
      'aggregateHeight', 'holes', 'bumpiness', 'maxHeight', 'linesCleared',
      'landingHeight', 'rowTransitions', 'colTransitions', 'wellDepth',
    ]);
  });
});

describe('empty board', () => {
  const empty = createEmptyBoard();

  it('has zero height, holes and wells', () => {
    expect(columnHeights(empty)).toEqual(Array(10).fill(0));
    expect(countHoles(empty)).toBe(0);
    expect(wellDepth(empty, columnHeights(empty))).toBe(0);
  });

  it('counts 44 row transitions — 22 rows x 2 wall boundaries', () => {
    expect(rowTransitions(empty)).toBe(44);
  });

  it('counts 10 column transitions — one floor boundary per column', () => {
    expect(colTransitions(empty)).toBe(10);
  });
});

describe('overhang board', () => {
  //  row 19:  ..#.......
  //  row 20:  ..........
  //  row 21:  ##.#######
  const board = boardFrom([
    '..#.......',
    '..........',
    '##.#######',
  ]);
  const h = columnHeights(board);

  it('measures column heights from the topmost filled cell', () => {
    expect(h).toEqual([1, 1, 3, 1, 1, 1, 1, 1, 1, 1]);
  });

  it('counts the two cells buried under the overhang', () => {
    expect(countHoles(board)).toBe(2);
  });

  it('counts row transitions with both walls treated as filled', () => {
    // 19 empty rows x 2 = 38, plus row19 = 4, row20 = 2, row21 = 2
    expect(rowTransitions(board)).toBe(46);
  });

  it('counts column transitions with a filled floor and an empty ceiling', () => {
    // nine 1-transition columns + column 2 contributing 3
    expect(colTransitions(board)).toBe(12);
  });

  it('reports the full feature vector', () => {
    const f = extractFeatures(board, 0, [{ x: 2, y: 18 }, { x: 2, y: 19 }]);
    expect(f).toHaveLength(9);
    expect(f[idx('aggregateHeight')]).toBe(12);
    expect(f[idx('holes')]).toBe(2);
    expect(f[idx('bumpiness')]).toBe(4);
    expect(f[idx('maxHeight')]).toBe(3);
    expect(f[idx('linesCleared')]).toBe(0);
    expect(f[idx('landingHeight')]).toBe(22 - 18.5);
    expect(f[idx('rowTransitions')]).toBe(46);
    expect(f[idx('colTransitions')]).toBe(12);
    expect(f[idx('wellDepth')]).toBe(0);
  });
});

describe('wellDepth', () => {
  it('sums d(d+1)/2 for an interior well', () => {
    // column 1 is a depth-2 well between two height-2 stacks
    const board = boardFrom(['#.#.......', '#.#.......']);
    expect(wellDepth(board, columnHeights(board))).toBe(3);
  });

  it('treats the side walls as infinitely tall', () => {
    // column 0 is a depth-3 well against the left wall
    const board = boardFrom(['.#........', '.#........', '.#........']);
    expect(wellDepth(board, columnHeights(board))).toBe(6);
  });

  it('ignores columns that are not wells', () => {
    const board = boardFrom(['##########']);
    expect(wellDepth(board, columnHeights(board))).toBe(0);
  });
});

describe('landingHeight', () => {
  it('measures the centre of the placed cells above the floor', () => {
    const f = extractFeatures(createEmptyBoard(), 0, [
      { x: 4, y: 20 }, { x: 5, y: 20 }, { x: 4, y: 21 }, { x: 5, y: 21 },
    ]);
    expect(f[idx('landingHeight')]).toBe(22 - 20.5);
  });

  it('uses the pre-clear rows it was handed, not the post-clear board', () => {
    // the board is empty because the row cleared; the placement still landed low
    const f = extractFeatures(createEmptyBoard(), 1, [{ x: 0, y: 21 }]);
    expect(f[idx('landingHeight')]).toBe(1);
    expect(f[idx('linesCleared')]).toBe(1);
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npm test -- src/ai/features.test.ts`
Expected: FAIL —— `Failed to resolve import "./features"`

- [ ] **Step 4: 实现 `src/ai/features.ts`**

```ts
import type { Board, Position } from '../types';
import { BOARD_WIDTH, TOTAL_ROWS } from '../constants';

export const FEATURE_NAMES = [
  'aggregateHeight', 'holes', 'bumpiness', 'maxHeight', 'linesCleared',
  'landingHeight', 'rowTransitions', 'colTransitions', 'wellDepth',
] as const;

export type FeatureName = (typeof FEATURE_NAMES)[number];
export type FeatureVector = number[];
export const FEATURE_COUNT = FEATURE_NAMES.length;

/** Height of each column: TOTAL_ROWS minus the row index of its topmost filled cell. */
export function columnHeights(board: Board): number[] {
  const heights = new Array<number>(BOARD_WIDTH).fill(0);
  for (let c = 0; c < BOARD_WIDTH; c++) {
    for (let r = 0; r < TOTAL_ROWS; r++) {
      if (board[r][c] !== 0) {
        heights[c] = TOTAL_ROWS - r;
        break;
      }
    }
  }
  return heights;
}

/** Empty cells with at least one filled cell somewhere above them in the same column. */
export function countHoles(board: Board): number {
  let holes = 0;
  for (let c = 0; c < BOARD_WIDTH; c++) {
    let covered = false;
    for (let r = 0; r < TOTAL_ROWS; r++) {
      if (board[r][c] !== 0) covered = true;
      else if (covered) holes++;
    }
  }
  return holes;
}

/** Filled/empty flips scanning each row, with both side walls counted as filled. */
export function rowTransitions(board: Board): number {
  let transitions = 0;
  for (let r = 0; r < TOTAL_ROWS; r++) {
    let prev = 1;
    for (let c = 0; c < BOARD_WIDTH; c++) {
      const cur = board[r][c] !== 0 ? 1 : 0;
      if (cur !== prev) transitions++;
      prev = cur;
    }
    if (prev !== 1) transitions++;
  }
  return transitions;
}

/** Filled/empty flips scanning each column, with the floor filled and the ceiling empty. */
export function colTransitions(board: Board): number {
  let transitions = 0;
  for (let c = 0; c < BOARD_WIDTH; c++) {
    let prev = 0;
    for (let r = 0; r < TOTAL_ROWS; r++) {
      const cur = board[r][c] !== 0 ? 1 : 0;
      if (cur !== prev) transitions++;
      prev = cur;
    }
    if (prev !== 1) transitions++;
  }
  return transitions;
}

/**
 * Cumulative well depth. A column is a well to the extent it sits below both
 * neighbours; the side walls count as infinitely tall. A well of depth d costs
 * d(d+1)/2 so deep single-column wells are penalised super-linearly.
 */
export function wellDepth(board: Board, heights: number[]): number {
  let total = 0;
  for (let c = 0; c < BOARD_WIDTH; c++) {
    const left = c === 0 ? TOTAL_ROWS : heights[c - 1];
    const right = c === BOARD_WIDTH - 1 ? TOTAL_ROWS : heights[c + 1];
    const depth = Math.min(left, right) - heights[c];
    if (depth > 0) total += (depth * (depth + 1)) / 2;
  }
  return total;
}

/**
 * `boardAfter` is the board once the piece has locked and full rows have been
 * cleared. `linesCleared` and `placedCells` describe the move itself, so
 * `placedCells` carries PRE-clear row indices.
 */
export function extractFeatures(
  boardAfter: Board,
  linesCleared: number,
  placedCells: Position[],
): FeatureVector {
  const heights = columnHeights(boardAfter);

  let aggregateHeight = 0;
  let maxHeight = 0;
  let bumpiness = 0;
  for (let c = 0; c < BOARD_WIDTH; c++) {
    aggregateHeight += heights[c];
    if (heights[c] > maxHeight) maxHeight = heights[c];
    if (c < BOARD_WIDTH - 1) bumpiness += Math.abs(heights[c] - heights[c + 1]);
  }

  let minRow = Infinity;
  let maxRow = -Infinity;
  for (const cell of placedCells) {
    if (cell.y < minRow) minRow = cell.y;
    if (cell.y > maxRow) maxRow = cell.y;
  }
  const landingHeight = TOTAL_ROWS - (minRow + maxRow) / 2;

  return [
    aggregateHeight,
    countHoles(boardAfter),
    bumpiness,
    maxHeight,
    linesCleared,
    landingHeight,
    rowTransitions(boardAfter),
    colTransitions(boardAfter),
    wellDepth(boardAfter, heights),
  ];
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npm test -- src/ai/features.test.ts`
Expected: all passed

- [ ] **Step 6: Commit**

```bash
git add src/ai/features.ts src/ai/features.test.ts src/ai/testUtils.ts
git commit -m "feat: add board feature extraction for the AI evaluator"
```

---

## Task 4: 权重表示与序列化

**Files:**
- Create: `src/ai/weights.ts`
- Create: `src/ai/trained-weights.json`（**提交进 git** —— 这是模型本体）
- Test: `src/ai/weights.test.ts`

**Interfaces:**
- Consumes: `FEATURE_NAMES` / `FEATURE_COUNT` / `FeatureName`（Task 3）
- Produces:
  - `type Weights = Record<FeatureName, number>`
  - `interface WeightsFile { version; weights; meanLines; evalGames; gen; searchDepth; trainedAt }`
  - `toVector(w: Weights): number[]` / `fromVector(v: number[]): Weights`
  - `normalize(v: number[]): number[]` —— L2 归一化，零向量原样返回
  - `parseWeightsFile(data: unknown): WeightsFile | null` —— 校验失败返回 `null`
  - `HANDCRAFTED_WEIGHTS: Weights`、`DEFAULT_WEIGHTS: Weights`、`DEFAULT_WEIGHTS_META: WeightsFile | null`

- [ ] **Step 1: 写会失败的测试**

新建 `src/ai/weights.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import {
  toVector, fromVector, normalize, parseWeightsFile,
  HANDCRAFTED_WEIGHTS, DEFAULT_WEIGHTS, type Weights,
} from './weights';
import { FEATURE_NAMES, FEATURE_COUNT } from './features';

const sample: Weights = {
  aggregateHeight: -1, holes: -2, bumpiness: -3, maxHeight: -4, linesCleared: 5,
  landingHeight: -6, rowTransitions: -7, colTransitions: -8, wellDepth: -9,
};

const l2 = (v: number[]) => Math.sqrt(v.reduce((s, x) => s + x * x, 0));

describe('toVector / fromVector', () => {
  it('round-trips a weights object', () => {
    expect(fromVector(toVector(sample))).toEqual(sample);
  });

  it('orders the vector by FEATURE_NAMES', () => {
    expect(toVector(sample)).toEqual([-1, -2, -3, -4, 5, -6, -7, -8, -9]);
  });

  it('rejects a vector of the wrong length', () => {
    expect(() => fromVector([1, 2, 3])).toThrow();
  });
});

describe('normalize', () => {
  it('produces a unit vector', () => {
    expect(l2(normalize([3, 4, 0, 0, 0, 0, 0, 0, 0]))).toBeCloseTo(1, 12);
    expect(l2(normalize(toVector(sample)))).toBeCloseTo(1, 12);
  });

  it('preserves direction', () => {
    const n = normalize([2, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(n[0]).toBeCloseTo(1, 12);
  });

  it('returns the zero vector unchanged instead of NaN', () => {
    const zeros = Array(FEATURE_COUNT).fill(0);
    expect(normalize(zeros)).toEqual(zeros);
    expect(normalize(zeros).every(Number.isFinite)).toBe(true);
  });

  it('does not mutate its input', () => {
    const input = [3, 4, 0, 0, 0, 0, 0, 0, 0];
    normalize(input);
    expect(input).toEqual([3, 4, 0, 0, 0, 0, 0, 0, 0]);
  });
});

describe('parseWeightsFile', () => {
  const valid = {
    version: 1,
    weights: Object.fromEntries(FEATURE_NAMES.map((n, i) => [n, i - 4])),
    meanLines: 100, evalGames: 30, gen: 12, searchDepth: 2,
    trainedAt: '2026-07-27T10:00:00.000Z',
  };

  it('accepts a complete file', () => {
    const parsed = parseWeightsFile(valid);
    expect(parsed).not.toBeNull();
    expect(parsed!.weights.holes).toBe(valid.weights.holes);
    expect(parsed!.gen).toBe(12);
  });

  it('rejects a missing feature key', () => {
    const { holes, ...rest } = valid.weights;
    expect(parseWeightsFile({ ...valid, weights: rest })).toBeNull();
  });

  it('rejects an unknown extra key', () => {
    expect(parseWeightsFile({ ...valid, weights: { ...valid.weights, tspins: 1 } })).toBeNull();
  });

  it('rejects non-finite and non-numeric values', () => {
    expect(parseWeightsFile({ ...valid, weights: { ...valid.weights, holes: NaN } })).toBeNull();
    expect(parseWeightsFile({ ...valid, weights: { ...valid.weights, holes: 'x' } })).toBeNull();
  });

  it('rejects junk', () => {
    expect(parseWeightsFile(null)).toBeNull();
    expect(parseWeightsFile('nope')).toBeNull();
    expect(parseWeightsFile({})).toBeNull();
  });
});

describe('built-in weights', () => {
  it('are complete and finite', () => {
    for (const w of [HANDCRAFTED_WEIGHTS, DEFAULT_WEIGHTS]) {
      expect(Object.keys(w).sort()).toEqual([...FEATURE_NAMES].sort());
      expect(toVector(w).every(Number.isFinite)).toBe(true);
    }
  });

  it('are normalised', () => {
    expect(l2(toVector(HANDCRAFTED_WEIGHTS))).toBeCloseTo(1, 6);
    expect(l2(toVector(DEFAULT_WEIGHTS))).toBeCloseTo(1, 6);
  });

  it('penalise holes and reward line clears', () => {
    expect(HANDCRAFTED_WEIGHTS.holes).toBeLessThan(0);
    expect(HANDCRAFTED_WEIGHTS.linesCleared).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- src/ai/weights.test.ts`
Expected: FAIL —— `Failed to resolve import "./weights"`

- [ ] **Step 3: 建初始权重文件**

训练还没跑过，先用 Dellacherie 风格的手调权重占位，这样 `import` 从第一天起就能解析。新建 `src/ai/trained-weights.json`。

数值必须是 `[-0.3,-0.6,-0.2,-0.1,0.25,-0.35,-0.3,-0.4,-0.2]` 做 L2 归一化后的**全精度**结果——本任务的测试断言 L2 范数精确到 6 位小数（`toBeCloseTo(1, 6)`，即误差 < 5e-7），而把各分量四舍五入到 6 位小数会让范数偏离 1 约 1.35e-6，刚好过不了。照抄下面的数字，不要再四舍五入：

```json
{
  "version": 1,
  "weights": {
    "aggregateHeight": -0.30382181012509996,
    "holes": -0.6076436202501999,
    "bumpiness": -0.20254787341673333,
    "maxHeight": -0.10127393670836667,
    "linesCleared": 0.25318484177091666,
    "landingHeight": -0.3544587784792833,
    "rowTransitions": -0.30382181012509996,
    "colTransitions": -0.40509574683346666,
    "wellDepth": -0.20254787341673333
  },
  "meanLines": 0,
  "evalGames": 0,
  "gen": 0,
  "searchDepth": 2,
  "trainedAt": "2026-07-27T00:00:00.000Z"
}
```

- [ ] **Step 4: 实现 `src/ai/weights.ts`**

```ts
import { FEATURE_NAMES, FEATURE_COUNT, type FeatureName } from './features';
import trainedWeightsJson from './trained-weights.json';

export type Weights = Record<FeatureName, number>;

export interface WeightsFile {
  version: number;
  weights: Weights;
  meanLines: number;
  evalGames: number;
  gen: number;
  searchDepth: 1 | 2;
  trainedAt: string;
}

export function toVector(w: Weights): number[] {
  return FEATURE_NAMES.map((name) => w[name]);
}

export function fromVector(v: number[]): Weights {
  if (v.length !== FEATURE_COUNT) {
    throw new Error(`expected ${FEATURE_COUNT} weights, got ${v.length}`);
  }
  const out = {} as Weights;
  FEATURE_NAMES.forEach((name, i) => {
    out[name] = v[i];
  });
  return out;
}

/**
 * L2-normalise. The evaluator is a linear score followed by an argmax, so
 * scaling the whole vector changes no decision — normalising stops CEM from
 * wandering along a meaningless magnitude axis and keeps sigma interpretable.
 */
export function normalize(v: number[]): number[] {
  let sumSq = 0;
  for (const x of v) sumSq += x * x;
  const norm = Math.sqrt(sumSq);
  if (!Number.isFinite(norm) || norm === 0) return v.slice();
  return v.map((x) => x / norm);
}

/**
 * Validate an untrusted weights file. Returns null rather than throwing so the
 * browser and the dashboard can quietly fall back to the built-in weights.
 */
export function parseWeightsFile(data: unknown): WeightsFile | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;

  if (typeof d.weights !== 'object' || d.weights === null) return null;
  const raw = d.weights as Record<string, unknown>;
  if (Object.keys(raw).length !== FEATURE_COUNT) return null;

  const weights = {} as Weights;
  for (const name of FEATURE_NAMES) {
    const value = raw[name];
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    weights[name] = value;
  }

  const num = (v: unknown, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback;

  return {
    version: num(d.version, 1),
    weights,
    meanLines: num(d.meanLines, 0),
    evalGames: num(d.evalGames, 0),
    gen: num(d.gen, 0),
    searchDepth: d.searchDepth === 1 ? 1 : 2,
    trainedAt: typeof d.trainedAt === 'string' ? d.trainedAt : '',
  };
}

/** Dellacherie-style priors. Used until training produces something better. */
export const HANDCRAFTED_WEIGHTS: Weights = fromVector(
  normalize([-0.3, -0.6, -0.2, -0.1, 0.25, -0.35, -0.3, -0.4, -0.2]),
);

const trained = parseWeightsFile(trainedWeightsJson);

/** Bundled into the build so `dist` runs standalone with no network fetch. */
export const DEFAULT_WEIGHTS: Weights = trained ? trained.weights : HANDCRAFTED_WEIGHTS;
export const DEFAULT_WEIGHTS_META: WeightsFile | null = trained;
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npm test -- src/ai/weights.test.ts`
Expected: all passed

- [ ] **Step 6: 确认 JSON import 通过类型检查**

Run: `npm run build`
Expected: 成功。若报 TS2732，说明 Task 1 Step 4 的 `resolveJsonModule` 没加上。

- [ ] **Step 7: Commit**

```bash
git add src/ai/weights.ts src/ai/weights.test.ts src/ai/trained-weights.json
git commit -m "feat: add weight serialisation, normalisation and file validation"
```

---

## Task 5: BFS 落点枚举

**Files:**
- Create: `src/ai/placements.ts`
- Create: `src/ai/replay.ts`
- Test: `src/ai/placements.test.ts`

**Interfaces:**
- Consumes: `getPieceCells` / `isValidPosition`（`src/engine/board.ts`）、`movePiece` / `rotatePiece` / `createPiece`（`src/engine/piece.ts`）、`boardFrom`（Task 3）
- Produces:
  - `type AiMove = 'left' | 'right' | 'rotate' | 'down'`
  - `interface Placement { piece: Piece; moves: AiMove[] }`
  - `enumeratePlacements(board: Board, spawn: Piece): Placement[]`
  - `cellKey(piece: Piece): string` —— 去重键，测试也用它
  - `projectPath(board: Board, start: Piece, moves: AiMove[]): Piece[]`（`replay.ts`）—— Task 9 的自愈式回放靠它
  - `samePiece(a: Piece | null, b: Piece | null): boolean`（`replay.ts`）

**已验证的事实**（用真实引擎实测，见评审记录）：空棋盘去重后 O=9、I=17、S=17、Z=17、T=34、J=34、L=34；不去重时 O=36、I=34。

- [ ] **Step 1: 写会失败的测试**

新建 `src/ai/placements.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { enumeratePlacements, cellKey } from './placements';
import { projectPath, samePiece } from './replay';
import { boardFrom } from './testUtils';
import { createEmptyBoard, createEmptyBoard as _e, isValidPosition } from '../engine/board';
import { createPiece, movePiece } from '../engine/piece';
import { BOARD_WIDTH } from '../constants';
import type { Board, Piece, PieceType } from '../types';

const EMPTY = createEmptyBoard();
const ALL_TYPES: PieceType[] = [1, 2, 3, 4, 5, 6, 7];

/** Rotate-then-hard-drop enumeration: the naive alternative BFS has to beat. */
function naiveKeys(board: Board, spawn: Piece): Set<string> {
  const out = new Set<string>();
  for (let rotation = 0; rotation < 4; rotation++) {
    for (let x = -3; x <= BOARD_WIDTH; x++) {
      const start: Piece = { type: spawn.type, rotation, position: { x, y: spawn.position.y } };
      if (!isValidPosition(board, start)) continue;
      let cur = start;
      for (;;) {
        const down = movePiece(board, cur, 0, 1);
        if (!down) break;
        cur = down;
      }
      out.add(cellKey(cur));
    }
  }
  return out;
}

describe('enumeratePlacements on an empty board', () => {
  // Verified against the real engine. Without cell-set dedup O would be 36
  // (four identical rotations) and I would be 34 (two identical bar states).
  const EXPECTED: Record<PieceType, number> = { 1: 17, 2: 9, 3: 34, 4: 17, 5: 17, 6: 34, 7: 34 };

  for (const type of ALL_TYPES) {
    it(`finds ${EXPECTED[type]} deduplicated placements for piece ${type}`, () => {
      expect(enumeratePlacements(EMPTY, createPiece(type))).toHaveLength(EXPECTED[type]);
    });
  }

  it('returns no duplicate cell sets', () => {
    for (const type of ALL_TYPES) {
      const placements = enumeratePlacements(EMPTY, createPiece(type));
      expect(new Set(placements.map((p) => cellKey(p.piece))).size).toBe(placements.length);
    }
  });
});

describe('placement invariants', () => {
  const BOARDS: [string, Board][] = [
    ['empty', EMPTY],
    ['tuck', boardFrom(['....######', '....######', '.....#####'])],
    ['jagged', boardFrom(['..#.......', '..#....#..', '##.#####.#'])],
  ];

  for (const [name, board] of BOARDS) {
    it(`every placement on the ${name} board is a resting position`, () => {
      for (const type of ALL_TYPES) {
        for (const p of enumeratePlacements(board, createPiece(type))) {
          expect(isValidPosition(board, p.piece)).toBe(true);
          expect(movePiece(board, p.piece, 0, 1)).toBeNull();
        }
      }
    });

    it(`replaying the move sequence on the ${name} board reproduces the placement`, () => {
      for (const type of ALL_TYPES) {
        const spawn = createPiece(type);
        for (const p of enumeratePlacements(board, spawn)) {
          const path = projectPath(board, spawn, p.moves);
          expect(path).toHaveLength(p.moves.length);
          const landed = path.length === 0 ? spawn : path[path.length - 1];
          expect(samePiece(landed, p.piece)).toBe(true);
        }
      }
    });
  }
});

describe('reachability', () => {
  it('returns an empty array when the spawn position is blocked', () => {
    const full = boardFrom(Array(22).fill('##########'));
    expect(enumeratePlacements(full, createPiece(1))).toEqual([]);
  });

  it('finds tuck placements that rotate-then-hard-drop cannot reach', () => {
    //  row 19:  ....######
    //  row 20:  ....######
    //  row 21:  .....#####     <- (21,4) is roofed over by (19,4)/(20,4)
    const board = boardFrom(['....######', '....######', '.....#####']);
    const spawn = createPiece(1); // I piece

    const bfs = new Set(enumeratePlacements(board, spawn).map((p) => cellKey(p.piece)));
    const naive = naiveKeys(board, spawn);

    // Slide down columns 0-3, then step right to tuck into the roofed cell.
    const tuck = [21 * BOARD_WIDTH + 1, 21 * BOARD_WIDTH + 2,
                  21 * BOARD_WIDTH + 3, 21 * BOARD_WIDTH + 4].join(',');

    expect(bfs.has(tuck)).toBe(true);
    expect(naive.has(tuck)).toBe(false);
    expect(bfs.size).toBeGreaterThan(naive.size);
  });

  it('gives the shortest key sequence for each placement', () => {
    // The far-left O placement needs exactly four lefts from spawn x=3.
    const placements = enumeratePlacements(EMPTY, createPiece(2));
    const leftmost = placements.reduce((a, b) =>
      a.piece.position.x <= b.piece.position.x ? a : b);
    expect(leftmost.moves.filter((m) => m === 'left')).toHaveLength(4);
    expect(leftmost.moves.filter((m) => m === 'right')).toHaveLength(0);
  });
});

describe('samePiece', () => {
  it('compares type, rotation and position', () => {
    const a = createPiece(3);
    expect(samePiece(a, { ...a, position: { ...a.position } })).toBe(true);
    expect(samePiece(a, { ...a, rotation: 1 })).toBe(false);
    expect(samePiece(a, { ...a, position: { x: 9, y: 0 } })).toBe(false);
    expect(samePiece(a, null)).toBe(false);
    expect(samePiece(null, null)).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- src/ai/placements.test.ts`
Expected: FAIL —— `Failed to resolve import "./placements"`

- [ ] **Step 3: 实现 `src/ai/replay.ts`**

```ts
import type { Board, Piece } from '../types';
import { movePiece, rotatePiece } from '../engine/piece';
import type { AiMove } from './placements';

export function samePiece(a: Piece | null, b: Piece | null): boolean {
  return (
    a !== null && b !== null &&
    a.type === b.type &&
    a.rotation === b.rotation &&
    a.position.x === b.position.x &&
    a.position.y === b.position.y
  );
}

/**
 * Replay `moves` from `start` against `board` and return the state after each
 * move. Stops early if a move turns out to be illegal, so the caller can detect
 * a diverged plan by comparing `path.length` with `moves.length`.
 */
export function projectPath(board: Board, start: Piece, moves: AiMove[]): Piece[] {
  const path: Piece[] = [];
  let cur = start;
  for (const move of moves) {
    const next =
      move === 'left' ? movePiece(board, cur, -1, 0)
      : move === 'right' ? movePiece(board, cur, 1, 0)
      : move === 'down' ? movePiece(board, cur, 0, 1)
      : rotatePiece(board, cur);
    // rotatePiece returns the same object when the rotation fails
    if (next === null || next === cur) return path;
    cur = next;
    path.push(cur);
  }
  return path;
}
```

- [ ] **Step 4: 实现 `src/ai/placements.ts`**

```ts
import type { Board, Piece } from '../types';
import { BOARD_WIDTH, TOTAL_ROWS } from '../constants';
import { getPieceCells, isValidPosition } from '../engine/board';
import { movePiece, rotatePiece } from '../engine/piece';

export type AiMove = 'left' | 'right' | 'rotate' | 'down';

export interface Placement {
  /** The locked pose: valid, and one row further down is not. */
  piece: Piece;
  /** Shortest key sequence from the spawn pose to this pose. */
  moves: AiMove[];
}

// A 4x4 matrix can have up to 3 empty leading rows/columns, so piece.position
// ranges over x in [-3, BOARD_WIDTH) and y in [-3, TOTAL_ROWS). y really can go
// negative: an SRS kick may push a piece upward out of the spawn row. The
// offsets below give that range room on both sides.
const X_OFFSET = 4;
const Y_OFFSET = 4;
const X_SPAN = BOARD_WIDTH + X_OFFSET + 1;
const Y_SPAN = TOTAL_ROWS + Y_OFFSET + 1;

function stateKey(p: Piece): number {
  return (p.rotation * X_SPAN + (p.position.x + X_OFFSET)) * Y_SPAN + (p.position.y + Y_OFFSET);
}

/** Sorted flat indices of the cells a piece occupies — the deduplication key. */
export function cellKey(piece: Piece): string {
  return getPieceCells(piece)
    .map((c) => c.y * BOARD_WIDTH + c.x)
    .sort((a, b) => a - b)
    .join(',');
}

/**
 * Breadth-first search over (x, y, rotation) from the spawn pose. Any reachable
 * state that cannot move down is a legal lock.
 *
 * BFS rather than "rotation x column + hard drop" because the latter (1) misses
 * tucks — sliding sideways under an overhang after descending, a whole class of
 * placements that matters once the stack is high; (2) cannot tell whether a
 * placement is actually reachable from spawn, so it invents phantom placements
 * when the top is congested; and (3) yields no key sequence, leaving the browser
 * AI to teleport pieces instead of playing them.
 *
 * Results are deduplicated by final cell set: distinct states can lock into
 * identical cells (all four O rotations are the same shape; I rotations 0 and 2
 * are the same bar at different matrix rows), and leaving those in would double
 * to quadruple the branching factor of the 2-ply search for nothing. Visiting in
 * BFS order means the survivor is the one with the shortest key sequence.
 */
export function enumeratePlacements(board: Board, spawn: Piece): Placement[] {
  if (!isValidPosition(board, spawn)) return [];

  const visited = new Set<number>([stateKey(spawn)]);
  const seenCells = new Set<string>();
  const results: Placement[] = [];
  let frontier: Placement[] = [{ piece: spawn, moves: [] }];

  while (frontier.length > 0) {
    const nextFrontier: Placement[] = [];

    for (const node of frontier) {
      const down = movePiece(board, node.piece, 0, 1);

      if (down === null) {
        const key = cellKey(node.piece);
        if (!seenCells.has(key)) {
          seenCells.add(key);
          results.push(node);
        }
      }

      const rotated = rotatePiece(board, node.piece);
      const candidates: [Piece | null, AiMove][] = [
        [movePiece(board, node.piece, -1, 0), 'left'],
        [movePiece(board, node.piece, 1, 0), 'right'],
        [down, 'down'],
        // rotatePiece returns the same object when every kick fails
        [rotated === node.piece ? null : rotated, 'rotate'],
      ];

      for (const [piece, move] of candidates) {
        if (piece === null) continue;
        const key = stateKey(piece);
        if (visited.has(key)) continue;
        visited.add(key);
        nextFrontier.push({ piece, moves: [...node.moves, move] });
      }
    }

    frontier = nextFrontier;
  }

  return results;
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npm test -- src/ai/placements.test.ts`
Expected: all passed（含 7 个计数断言与 tuck 断言）

- [ ] **Step 6: Commit**

```bash
git add src/ai/placements.ts src/ai/replay.ts src/ai/placements.test.ts
git commit -m "feat: add BFS placement enumeration with cell-set dedup"
```

---

## Task 6: 评估与前瞻搜索

**Files:**
- Create: `src/ai/search.ts`
- Test: `src/ai/search.test.ts`

**Interfaces:**
- Consumes: `enumeratePlacements` / `Placement`（Task 5）、`extractFeatures`（Task 3）、`getPieceCells` / `lockPiece` / `clearLines` / `isValidPosition`、`createPiece`
- Produces:
  - `interface EvalResult { score: number; boardAfter: Board; linesCleared: number }`
  - `interface Decision { placement: Placement; score: number }`
  - `evalMove(board: Board, placement: Placement, w: number[]): EvalResult`
  - `bestPlacement(board, current: Piece, next: Piece | null, w: number[], depth: 1 | 2): Decision | null`

- [ ] **Step 1: 写会失败的测试**

新建 `src/ai/search.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { evalMove, bestPlacement } from './search';
import { enumeratePlacements, cellKey } from './placements';
import { boardFrom } from './testUtils';
import { FEATURE_NAMES, FEATURE_COUNT } from './features';
import { createEmptyBoard, isValidPosition } from '../engine/board';
import { createPiece } from '../engine/piece';

const zeros = () => Array(FEATURE_COUNT).fill(0);
const only = (name: (typeof FEATURE_NAMES)[number], value = 1) => {
  const w = zeros();
  w[FEATURE_NAMES.indexOf(name)] = value;
  return w;
};

describe('evalMove', () => {
  it('scores the dot product of features and weights', () => {
    const board = boardFrom(['.#########']);
    const placement = enumeratePlacements(board, createPiece(1))
      .find((p) => cellKey(p.piece) === String(21 * 10 + 0))!;
    expect(placement).toBeDefined();
    expect(evalMove(board, placement, only('linesCleared')).score).toBe(1);
  });

  it('reports the cleared line count and the post-clear board', () => {
    const board = boardFrom(['.#########']);
    let cleared = 0;
    for (const p of enumeratePlacements(board, createPiece(1))) {
      const r = evalMove(board, p, zeros());
      if (r.linesCleared > 0) {
        cleared = r.linesCleared;
        expect(r.boardAfter[21].every((c) => c === 0)).toBe(true);
      }
    }
    expect(cleared).toBe(1);
  });

  it('does not mutate the board it is given', () => {
    const board = boardFrom(['.#########']);
    const before = JSON.stringify(board);
    for (const p of enumeratePlacements(board, createPiece(1))) {
      evalMove(board, p, only('holes'));
    }
    expect(JSON.stringify(board)).toBe(before);
  });
});

describe('bestPlacement', () => {
  it('returns null when there is nowhere to put the piece', () => {
    const full = boardFrom(Array(22).fill('##########'));
    expect(bestPlacement(full, createPiece(1), null, zeros(), 1)).toBeNull();
  });

  it('picks the line clear when line clears are all that is rewarded', () => {
    const board = boardFrom(['.#########']);
    const decision = bestPlacement(board, createPiece(1), null, only('linesCleared'), 1)!;
    expect(evalMove(board, decision.placement, only('linesCleared')).linesCleared).toBe(1);
  });

  it('always returns one of the enumerated placements', () => {
    const board = boardFrom(['..#.......', '..#....#..', '##.#####.#']);
    const legal = new Set(
      enumeratePlacements(board, createPiece(6)).map((p) => cellKey(p.piece)),
    );
    const decision = bestPlacement(board, createPiece(6), createPiece(3), only('holes', -1), 2)!;
    expect(legal.has(cellKey(decision.placement.piece))).toBe(true);
  });

  it('falls back to depth 1 when there is no next piece', () => {
    const board = boardFrom(['..#.......', '##.#####.#']);
    const w = only('holes', -1);
    const d1 = bestPlacement(board, createPiece(7), null, w, 1)!;
    const d2 = bestPlacement(board, createPiece(7), null, w, 2)!;
    expect(cellKey(d2.placement.piece)).toBe(cellKey(d1.placement.piece));
    expect(d2.score).toBe(d1.score);
  });

  it('avoids a placement that leaves the next piece unable to spawn', () => {
    // Rows 2..21 are full except column 0, so column 0 is a 20-deep shaft.
    // Weights reward a TALLER board, which lures depth 1 into resting a
    // horizontal I on top of the stack — that fills the spawn area and ends
    // the game. Depth 2 sees the dead end and drops into the shaft instead.
    const board = boardFrom(Array(20).fill('.#########'));
    const piece = createPiece(1);
    const w = only('maxHeight');

    const d1 = bestPlacement(board, piece, piece, w, 1)!;
    const d2 = bestPlacement(board, piece, piece, w, 2)!;

    const after1 = evalMove(board, d1.placement, w);
    const after2 = evalMove(board, d2.placement, w);

    expect(isValidPosition(after1.boardAfter, createPiece(1))).toBe(false);
    expect(isValidPosition(after2.boardAfter, createPiece(1))).toBe(true);
    expect(after2.linesCleared).toBe(4);
  });

  it('still returns a placement when every branch is a dead end', () => {
    const board = boardFrom(Array(20).fill('.#########'));
    // No next piece can ever spawn, so every 2-ply branch scores -Infinity.
    const decision = bestPlacement(board, createPiece(2), createPiece(2), zeros(), 2);
    expect(decision).not.toBeNull();
  });
});

describe('empty board sanity', () => {
  it('keeps the board flat when bumpiness is penalised', () => {
    const w = only('bumpiness', -1);
    const decision = bestPlacement(createEmptyBoard(), createPiece(1), null, w, 1)!;
    // A horizontal I on a flat floor leaves bumpiness at 4; vertical leaves 8.
    expect(decision.placement.piece.rotation % 2).toBe(0);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- src/ai/search.test.ts`
Expected: FAIL —— `Failed to resolve import "./search"`

- [ ] **Step 3: 实现 `src/ai/search.ts`**

```ts
import type { Board, Piece } from '../types';
import { getPieceCells, lockPiece, clearLines, isValidPosition } from '../engine/board';
import { createPiece } from '../engine/piece';
import { extractFeatures } from './features';
import { enumeratePlacements, type Placement } from './placements';

export interface EvalResult {
  score: number;
  boardAfter: Board;
  linesCleared: number;
}

export interface Decision {
  placement: Placement;
  score: number;
}

/** lock -> clear -> extract features -> dot with the weight vector. */
export function evalMove(board: Board, placement: Placement, w: number[]): EvalResult {
  const placedCells = getPieceCells(placement.piece);
  const locked = lockPiece(board, placement.piece);
  const { clearedRows, newBoard } = clearLines(locked);
  const features = extractFeatures(newBoard, clearedRows.length, placedCells);

  let score = 0;
  for (let i = 0; i < features.length; i++) score += features[i] * w[i];

  return { score, boardAfter: newBoard, linesCleared: clearedRows.length };
}

/**
 * depth 1: argmax over placements of the current piece.
 * depth 2: argmax over p1 of [score(p1) + max over p2 of score(p2)].
 *
 * A p1 that leaves the next piece unable to spawn scores -Infinity. If every
 * branch is a dead end we still return the first placement rather than null —
 * null means "nowhere to put this piece at all", which is the game-over signal.
 *
 * Search depth and weights are coupled: weights trained at depth 1 misbehave at
 * depth 2, because the two value behaviours like "keep a well open for an I"
 * differently. Train and play at the same depth.
 */
export function bestPlacement(
  board: Board,
  current: Piece,
  next: Piece | null,
  w: number[],
  depth: 1 | 2,
): Decision | null {
  const options = enumeratePlacements(board, current);
  if (options.length === 0) return null;

  const lookahead = depth === 2 && next !== null;
  let best: Decision | null = null;

  for (const placement of options) {
    const { score, boardAfter } = evalMove(board, placement, w);
    let total = score;

    if (lookahead) {
      const nextSpawn = createPiece(next!.type);
      if (!isValidPosition(boardAfter, nextSpawn)) {
        total = -Infinity;
      } else {
        const followUps = enumeratePlacements(boardAfter, nextSpawn);
        if (followUps.length === 0) {
          total = -Infinity;
        } else {
          let bestNext = -Infinity;
          for (const followUp of followUps) {
            const s = evalMove(boardAfter, followUp, w).score;
            if (s > bestNext) bestNext = s;
          }
          total = score + bestNext;
        }
      }
    }

    if (best === null || total > best.score) best = { placement, score: total };
  }

  return best;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- src/ai/search.test.ts`
Expected: all passed

- [ ] **Step 5: Commit**

```bash
git add src/ai/search.ts src/ai/search.test.ts
git commit -m "feat: add 1- and 2-ply placement search"
```

---

## Task 7: 无头模拟器与差分测试

这是整个项目的**信任基石**。差分测试挂掉就意味着训练环境已与真游戏分叉，训出的权重毫无意义。

**Files:**
- Create: `src/ai/simulate.ts`
- Test: `src/ai/simulate.test.ts`

**Interfaces:**
- Consumes: `mulberry32`（Task 2）、`bestPlacement`（Task 6）、engine 的 `lockPiece` / `clearLines` / `isGameOver` / `movePiece` / `rotatePiece` / `createPiece` / `generateBag`、scorer 的四个函数
- Produces:
  - `type SimAction = 'left' | 'right' | 'rotate' | 'softDrop' | 'hardDrop'`
  - `interface SimState { board; currentPiece; nextPiece; bag; score; level; lines; status; pieces; rng }`
  - `createSimState(seed: number): SimState`
  - `applyAction(state: SimState, action: SimAction): void` —— 逐个动作驱动，供差分测试与网页外的任何回放使用
  - `interface SimResult { lines: number; score: number; pieces: number; reason: 'gameover' | 'pieceCap' }`
  - `simulateGame(opts: { weights: number[]; seed: number; maxPieces: number; depth: 1 | 2 }): SimResult` —— Task 11 的 worker 调用它

- [ ] **Step 1: 写会失败的测试**

新建 `src/ai/simulate.test.ts`：

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createSimState, applyAction, simulateGame, type SimAction } from './simulate';
import { mulberry32 } from './rng';
import { toVector, HANDCRAFTED_WEIGHTS } from './weights';
import { useGameStore } from '../store/gameStore';
import { FEATURE_COUNT } from './features';
import { enumeratePlacements } from './placements';
import { boardFrom } from './testUtils';
import { getPieceCells } from '../engine/board';
import { createPiece } from '../engine/piece';
import { BOARD_WIDTH } from '../constants';
import type { PieceType } from '../types';

afterEach(() => {
  vi.restoreAllMocks();
});

const STORE_ACTION: Record<SimAction, keyof ReturnType<typeof useGameStore.getState>> = {
  left: 'moveLeft',
  right: 'moveRight',
  rotate: 'rotate',
  softDrop: 'softDrop',
  hardDrop: 'hardDrop',
};

/**
 * Emit an arbitrary but board-covering action sequence.
 *
 * A symmetric random walk from the spawn column does NOT work here: every piece
 * piles up around x=3, the stack tops out after roughly five locks, and no row
 * ever fills — measured over 50,000 seeds, zero line clears. That leaves the
 * clear / score / level-up paths, which are exactly where the simulator and the
 * store could diverge, completely unexercised.
 *
 * Steering each piece toward a random target column fills rows instead, while
 * still being an arbitrary sequence: the rotations kick off walls, the moves
 * that fail are no-ops on both sides, and neither side gets any hint of what
 * the other is doing.
 */
function* actionScript(rand: () => number): Generator<SimAction> {
  for (;;) {
    const rotations = Math.floor(rand() * 4);
    for (let i = 0; i < rotations; i++) yield 'rotate';

    // Pieces spawn at x=3; walk toward a random column.
    const dx = Math.floor(rand() * BOARD_WIDTH) - 3;
    for (let i = 0; i < Math.abs(dx); i++) yield dx < 0 ? 'left' : 'right';

    if (rand() < 0.3) yield 'softDrop';
    yield 'hardDrop';
  }
}

describe('differential test against the real gameStore', () => {
  it('matches the store cell-for-cell over random action sequences', () => {
    let totalClears = 0;
    let totalKicks = 0;
    let totalLocks = 0;

    for (let seed = 1; seed <= 20; seed++) {
      // Both sides consume the same mulberry32 stream in the same order.
      vi.spyOn(Math, 'random').mockImplementation(mulberry32(seed));
      useGameStore.getState().startGame();
      const sim = createSimState(seed);
      const pick = mulberry32(seed ^ 0x9e3779b9);

      const script = actionScript(pick);

      for (let step = 0; step < 400; step++) {
        if (useGameStore.getState().status !== 'playing') break;
        if (sim.status !== 'playing') break;

        const action = script.next().value as SimAction;

        const before = useGameStore.getState();
        const linesBefore = before.lines;
        const pieceBefore = before.currentPiece;

        (before[STORE_ACTION[action]] as () => void)();
        applyAction(sim, action);

        const after = useGameStore.getState();

        expect(sim.board).toEqual(after.board);
        expect(sim.currentPiece).toEqual(after.currentPiece);
        expect(sim.nextPiece).toEqual(after.nextPiece);
        expect(sim.score).toBe(after.score);
        expect(sim.lines).toBe(after.lines);
        expect(sim.level).toBe(after.level);
        expect(sim.status).toBe(after.status);

        // Coverage bookkeeping — a differential test that never clears a line
        // or kicks off a wall proves much less than it appears to.
        const gained = after.lines - linesBefore;
        if (gained > 0) totalClears++;
        if (action === 'hardDrop') totalLocks++;
        if (
          action === 'rotate' && pieceBefore && after.currentPiece &&
          after.currentPiece.rotation !== pieceBefore.rotation &&
          (after.currentPiece.position.x !== pieceBefore.position.x ||
           after.currentPiece.position.y !== pieceBefore.position.y)
        ) {
          totalKicks++;
        }
      }

      vi.restoreAllMocks();
    }

    // §13 flags coverage as the weak point of a randomised differential test,
    // so assert the corpus actually exercised the interesting paths. Multi-row
    // clears are pinned down deterministically below instead — they are too rare
    // under random play to rely on.
    expect(totalLocks).toBeGreaterThan(100);
    expect(totalClears).toBeGreaterThan(0);
    expect(totalKicks).toBeGreaterThan(0);
  });
});

describe('line-clear parity', () => {
  // Random play produces single clears but essentially never a double or a
  // tetris, so the multi-row scoring and level-up paths get pinned down here
  // instead. Both sides start from an identical board and an identical
  // non-empty bag, so neither consumes any RNG.
  const CASES: [string, string[], number][] = [
    ['single', ['.#########'], 1],
    ['double', ['.#########', '.#########'], 2],
    ['tetris', ['.#########', '.#########', '.#########', '.#########'], 4],
  ];

  for (const [name, rows, expectedLines] of CASES) {
    it(`matches the store on a ${name} clear`, () => {
      const board = boardFrom(rows);
      const current = createPiece(1); // I piece
      const next = createPiece(2);
      const bag: PieceType[] = [3, 4, 5, 6, 7];

      const seeded = () => ({
        board: board.map((row) => [...row]),
        currentPiece: { ...current, position: { ...current.position } },
        nextPiece: { ...next, position: { ...next.position } },
        bag: [...bag],
        score: 0,
        level: 1,
        lines: 0,
        status: 'playing' as const,
      });

      useGameStore.setState(seeded());
      const sim = createSimState(1);
      Object.assign(sim, seeded());

      // The vertical I dropped into the column-0 shaft completes every seeded row.
      const placement = enumeratePlacements(board, current).find((p) =>
        getPieceCells(p.piece).every((c) => c.x === 0),
      );
      expect(placement).toBeDefined();

      const actions: SimAction[] = [
        ...placement!.moves.map((m) => (m === 'down' ? 'softDrop' : m) as SimAction),
        'hardDrop',
      ];

      for (const action of actions) {
        (useGameStore.getState()[STORE_ACTION[action]] as () => void)();
        applyAction(sim, action);
      }

      const after = useGameStore.getState();
      expect(after.lines).toBe(expectedLines);
      expect(sim.lines).toBe(expectedLines);
      expect(sim.board).toEqual(after.board);
      expect(sim.score).toBe(after.score);
      expect(sim.level).toBe(after.level);
      expect(sim.status).toBe(after.status);
    });
  }
});

describe('createSimState', () => {
  it('starts with a current piece and a preview', () => {
    const s = createSimState(42);
    expect(s.currentPiece).not.toBeNull();
    expect(s.nextPiece).not.toBeNull();
    expect(s.status).toBe('playing');
    expect(s.pieces).toBe(0);
  });

  it('promotes the previewed piece on lock, like the store', () => {
    const s = createSimState(42);
    for (let i = 0; i < 5; i++) {
      const previewed = s.nextPiece!.type;
      applyAction(s, 'hardDrop');
      expect(s.currentPiece!.type).toBe(previewed);
    }
  });
});

describe('simulateGame', () => {
  const weights = toVector(HANDCRAFTED_WEIGHTS);

  // depth-2 search runs ~115 pieces/sec/core, so a 200-piece game takes a couple
  // of seconds and these two-game tests blow past vitest's 5s default.
  const SLOW = 45_000;

  it('is fully deterministic for a given seed', () => {
    const a = simulateGame({ weights, seed: 7, maxPieces: 200, depth: 2 });
    const b = simulateGame({ weights, seed: 7, maxPieces: 200, depth: 2 });
    expect(a).toEqual(b);
  }, SLOW);

  it('produces different results for different seeds', () => {
    const a = simulateGame({ weights, seed: 1, maxPieces: 200, depth: 2 });
    const b = simulateGame({ weights, seed: 2, maxPieces: 200, depth: 2 });
    expect(a).not.toEqual(b);
  }, SLOW);

  it('stops at the piece cap without calling it a loss', () => {
    const r = simulateGame({ weights, seed: 3, maxPieces: 30, depth: 2 });
    expect(r.pieces).toBe(30);
    expect(r.reason).toBe('pieceCap');
  }, SLOW);

  it('plays better than a deliberately terrible weight vector', () => {
    const bad = Array(FEATURE_COUNT).fill(0);
    bad[1] = 1; // reward holes
    const good = simulateGame({ weights, seed: 11, maxPieces: 500, depth: 2 });
    const awful = simulateGame({ weights: bad, seed: 11, maxPieces: 500, depth: 2 });
    expect(good.lines).toBeGreaterThan(awful.lines);
  }, SLOW);

  it('rejects a weight vector of the wrong length', () => {
    expect(() => simulateGame({ weights: [1, 2, 3], seed: 1, maxPieces: 10, depth: 1 }))
      .toThrow(/9/);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- src/ai/simulate.test.ts`
Expected: FAIL —— `Failed to resolve import "./simulate"`

- [ ] **Step 3: 实现 `src/ai/simulate.ts`**

这段代码逐行对照 `src/store/gameStore.ts` 写成——两边的调用顺序、随机数消耗次数、计分时机必须完全一致，否则 Step 4 的差分测试会立刻失败。

```ts
import type { Board, Piece, PieceType } from '../types';
import { createEmptyBoard, lockPiece, clearLines, isGameOver } from '../engine/board';
import { createPiece, generateBag, movePiece, rotatePiece } from '../engine/piece';
import {
  calculateScore, calculateSoftDropScore, calculateHardDropScore, calculateLevel,
} from '../engine/scorer';
import { FEATURE_COUNT } from './features';
import { mulberry32 } from './rng';
import { bestPlacement } from './search';

export type SimAction = 'left' | 'right' | 'rotate' | 'softDrop' | 'hardDrop';

export interface SimState {
  board: Board;
  currentPiece: Piece | null;
  nextPiece: Piece | null;
  bag: PieceType[];
  score: number;
  level: number;
  lines: number;
  status: 'playing' | 'gameover';
  pieces: number;
  rng: () => number;
}

export interface SimResult {
  lines: number;
  score: number;
  pieces: number;
  reason: 'gameover' | 'pieceCap';
}

function drawFromBag(state: SimState): PieceType {
  if (state.bag.length === 0) state.bag = generateBag(state.rng);
  return state.bag.shift()!;
}

export function createSimState(seed: number): SimState {
  const rng = mulberry32(seed);
  const state: SimState = {
    board: createEmptyBoard(),
    currentPiece: null,
    nextPiece: null,
    bag: generateBag(rng),
    score: 0,
    level: 1,
    lines: 0,
    status: 'playing',
    pieces: 0,
    rng,
  };

  const first = drawFromBag(state);
  const second = drawFromBag(state);
  state.currentPiece = createPiece(first);
  state.nextPiece = createPiece(second);
  if (isGameOver(state.board, state.currentPiece)) state.status = 'gameover';

  return state;
}

/** Mirrors gameStore's lockAndSpawn: lock, clear, score, promote the preview. */
function lockAndSpawn(state: SimState, piece: Piece): void {
  const locked = lockPiece(state.board, piece);
  const { clearedRows, newBoard } = clearLines(locked);
  const linesCleared = clearedRows.length;

  // Line score uses the level from BEFORE this clear, same as the store.
  state.score += calculateScore(linesCleared, state.level);
  state.lines += linesCleared;
  state.level = calculateLevel(state.lines);
  state.board = newBoard;
  state.pieces += 1;

  const preview = state.nextPiece;
  const current = createPiece(preview ? preview.type : drawFromBag(state));
  state.currentPiece = current;
  state.nextPiece = createPiece(drawFromBag(state));
  if (isGameOver(state.board, current)) state.status = 'gameover';
}

/** One player action, with exactly the semantics of the matching store action. */
export function applyAction(state: SimState, action: SimAction): void {
  if (state.status !== 'playing' || state.currentPiece === null) return;
  const { board, currentPiece } = state;

  switch (action) {
    case 'left': {
      const moved = movePiece(board, currentPiece, -1, 0);
      if (moved) state.currentPiece = moved;
      break;
    }
    case 'right': {
      const moved = movePiece(board, currentPiece, 1, 0);
      if (moved) state.currentPiece = moved;
      break;
    }
    case 'rotate': {
      const rotated = rotatePiece(board, currentPiece);
      if (rotated !== currentPiece) state.currentPiece = rotated;
      break;
    }
    case 'softDrop': {
      const moved = movePiece(board, currentPiece, 0, 1);
      if (moved) {
        state.currentPiece = moved;
        state.score += calculateSoftDropScore(1);
      }
      break;
    }
    case 'hardDrop': {
      let dropped = currentPiece;
      let cellsDropped = 0;
      for (;;) {
        const next = movePiece(board, dropped, 0, 1);
        if (!next) break;
        dropped = next;
        cellsDropped++;
      }
      state.score += calculateHardDropScore(cellsDropped);
      lockAndSpawn(state, dropped);
      break;
    }
  }
}

/**
 * Headless game driven entirely by the evaluator. Gravity and timing are
 * skipped: the AI always hard-drops, so gravity could never be what locks a
 * piece — simulating it would change nothing and cost tens of times the runtime.
 *
 * The planned pose is assigned directly rather than replayed key by key, so the
 * hard-drop and soft-drop bonuses differ from a browser game. Fitness is measured
 * in lines, not score, so this does not affect training.
 */
export function simulateGame(opts: {
  weights: number[];
  seed: number;
  maxPieces: number;
  depth: 1 | 2;
}): SimResult {
  if (opts.weights.length !== FEATURE_COUNT) {
    throw new Error(`expected ${FEATURE_COUNT} weights, got ${opts.weights.length}`);
  }

  const state = createSimState(opts.seed);

  while (state.status === 'playing' && state.pieces < opts.maxPieces) {
    const decision = bestPlacement(
      state.board, state.currentPiece!, state.nextPiece, opts.weights, opts.depth,
    );
    if (decision === null) {
      state.status = 'gameover';
      break;
    }
    state.currentPiece = decision.placement.piece;
    applyAction(state, 'hardDrop');
  }

  return {
    lines: state.lines,
    score: state.score,
    pieces: state.pieces,
    reason: state.status === 'gameover' ? 'gameover' : 'pieceCap',
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- src/ai/simulate.test.ts`
Expected: all passed。若差分测试报某一步棋盘不符，先看 `nextPiece` 是否一致——最可能的原因是 Task 1 的方块队列改动没有在两边同步。

- [ ] **Step 5: 跑全量测试**

Run: `npm test`
Expected: all passed

- [ ] **Step 6: Commit**

```bash
git add src/ai/simulate.ts src/ai/simulate.test.ts
git commit -m "feat: add headless simulator with differential test against the store"
```

---

## Task 8: `bench` CLI —— 阶段①的里程碑

跑完这个任务，`src/ai/` 就是一个独立可用、可验证的产物：用手调权重能跑出成绩，并给出后续超参标定所需的吞吐数据。

**Files:**
- Create: `training/bench.ts`
- Modify: `package.json`（`bench` 脚本）

**Interfaces:**
- Consumes: `simulateGame`（Task 7）、`parseWeightsFile` / `toVector` / `HANDCRAFTED_WEIGHTS`（Task 4）、`hashSeed`（Task 2）
- Produces: `npm run bench` CLI。无导出，是可执行脚本。

- [ ] **Step 1: 加脚本**

`package.json` 的 `scripts` 中加入：

```json
"bench": "tsx training/bench.ts"
```

- [ ] **Step 2: 实现 `training/bench.ts`**

```ts
import { readFileSync } from 'node:fs';
import { simulateGame } from '../src/ai/simulate';
import { hashSeed } from '../src/ai/rng';
import { parseWeightsFile, toVector, HANDCRAFTED_WEIGHTS } from '../src/ai/weights';

interface Args {
  weights: string | null;
  games: number;
  depth: 1 | 2;
  maxPieces: number;
  seed: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { weights: null, games: 10, depth: 2, maxPieces: 5000, seed: 1 };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (value === undefined) throw new Error(`missing value for ${key}`);
    switch (key) {
      case '--weights': args.weights = value; break;
      case '--games': args.games = Number(value); break;
      case '--depth': args.depth = Number(value) === 1 ? 1 : 2; break;
      case '--max-pieces': args.maxPieces = Number(value); break;
      case '--seed': args.seed = Number(value); break;
      default: throw new Error(`unknown flag ${key}`);
    }
  }
  return args;
}

function loadWeights(path: string | null): number[] {
  if (path === null) {
    console.log('weights: built-in handcrafted');
    return toVector(HANDCRAFTED_WEIGHTS);
  }
  const parsed = parseWeightsFile(JSON.parse(readFileSync(path, 'utf8')));
  if (parsed === null) throw new Error(`${path} is not a valid weights file`);
  console.log(`weights: ${path} (gen ${parsed.gen}, meanLines ${parsed.meanLines})`);
  return toVector(parsed.weights);
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

const args = parseArgs(process.argv.slice(2));
const weights = loadWeights(args.weights);
console.log(`games=${args.games} depth=${args.depth} maxPieces=${args.maxPieces}\n`);

const started = Date.now();
const lines: number[] = [];
let totalPieces = 0;
let capped = 0;

for (let i = 0; i < args.games; i++) {
  const result = simulateGame({
    weights,
    seed: hashSeed(args.seed, i),
    maxPieces: args.maxPieces,
    depth: args.depth,
  });
  lines.push(result.lines);
  totalPieces += result.pieces;
  if (result.reason === 'pieceCap') capped++;
  console.log(
    `  game ${String(i + 1).padStart(3)}  lines ${String(result.lines).padStart(7)}` +
    `  pieces ${String(result.pieces).padStart(7)}  ${result.reason}`,
  );
}

const elapsedMs = Date.now() - started;
const sorted = [...lines].sort((a, b) => a - b);
const mean = lines.reduce((s, x) => s + x, 0) / lines.length;

console.log(`
mean    ${mean.toFixed(1)}
median  ${quantile(sorted, 0.5).toFixed(1)}
min     ${sorted[0]}
max     ${sorted[sorted.length - 1]}
capped  ${capped}/${args.games} games hit the piece cap

throughput  ${Math.round(totalPieces / (elapsedMs / 1000))} pieces/sec (single core)
elapsed     ${(elapsedMs / 1000).toFixed(1)}s`);
```

- [ ] **Step 3: 跑起来，确认 AI 真的会玩**

Run: `npm run bench -- --games 5 --depth 2 --max-pieces 1000`
Expected: 每局都打到 1000 步上限（`pieceCap`），mean 约 380–420 行。手调权重在 1000 步内不该死。

- [ ] **Step 4: 记录吞吐基线**

Run: `npm run bench -- --games 3 --depth 1 --max-pieces 1000` 与 `npm run bench -- --games 3 --depth 2 --max-pieces 1000`
Expected: depth=1 约 3 000 步/秒，depth=2 约 115 步/秒。把实测值记下来——Task 13 启动训练前用它估算单代耗时。若 depth=2 显著低于 100 步/秒，先复核 `enumeratePlacements` 的去重是否生效（不去重会让分支数翻 2–4 倍）。

- [ ] **Step 5: 确认坏权重确实打不好**

Run: `npm run bench -- --games 3 --depth 1 --max-pieces 1000 --weights src/ai/trained-weights.json`
Expected: 与内置手调权重成绩相当（此刻两者数值相同），且 `--weights` 路径解析正常。

- [ ] **Step 6: Commit**

```bash
git add training/bench.ts package.json
git commit -m "feat: add bench CLI for evaluating weight vectors"
```

**阶段①里程碑达成**：差分测试通过，`bench` 能用手调权重跑出成绩。

---

## Task 9: AI 托管 hook

**Files:**
- Create: `src/hooks/useAiPlayer.ts`
- Test: `src/hooks/useAiPlayer.test.ts`

**Interfaces:**
- Consumes: `useGameStore`、`bestPlacement`（Task 6）、`projectPath` / `samePiece`（Task 5）、`toVector` / `Weights`（Task 4）、`AiMove`（Task 5）
- Produces:
  - `interface AiPlayerOptions { enabled: boolean; depth: 1 | 2; speed: AiSpeed; weights: Weights }`
  - `type AiSpeed = 'instant' | 'normal' | 'slow'`
  - `useAiPlayer(opts: AiPlayerOptions): void`
  - `planPlacement(state, weights, depth): AiPlan | null` —— 导出以便单测，hook 只是它的定时器外壳
  - `interface AiPlan { moves: AiMove[]; path: Piece[]; cursor: number; origin: Piece }`

- [ ] **Step 1: 写会失败的测试**

规划与校验逻辑是纯函数，可以脱离 React 直接测。新建 `src/hooks/useAiPlayer.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { planPlacement, expectedPose, isPlanValid } from './useAiPlayer';
import { boardFrom } from '../ai/testUtils';
import { toVector, HANDCRAFTED_WEIGHTS } from '../ai/weights';
import { samePiece } from '../ai/replay';
import { createEmptyBoard } from '../engine/board';
import { createPiece, movePiece } from '../engine/piece';

const W = toVector(HANDCRAFTED_WEIGHTS);

describe('planPlacement', () => {
  it('returns a plan whose path matches its move list', () => {
    const board = createEmptyBoard();
    const plan = planPlacement(board, createPiece(3), createPiece(5), W, 2)!;
    expect(plan).not.toBeNull();
    expect(plan.path).toHaveLength(plan.moves.length);
    expect(plan.cursor).toBe(0);
  });

  it('ends at a pose that cannot move down', () => {
    const board = boardFrom(['..#.......', '##.#####.#']);
    const plan = planPlacement(board, createPiece(7), null, W, 1)!;
    const last = plan.path.length === 0 ? plan.origin : plan.path[plan.path.length - 1];
    expect(movePiece(board, last, 0, 1)).toBeNull();
  });

  it('returns null when the piece cannot be placed anywhere', () => {
    const full = boardFrom(Array(22).fill('##########'));
    expect(planPlacement(full, createPiece(1), null, W, 1)).toBeNull();
  });
});

describe('plan validation', () => {
  it('expects the origin pose before the first move', () => {
    const board = createEmptyBoard();
    const plan = planPlacement(board, createPiece(6), null, W, 1)!;
    expect(samePiece(expectedPose(plan), plan.origin)).toBe(true);
  });

  it('expects the previous path entry once execution has started', () => {
    const board = createEmptyBoard();
    const plan = planPlacement(board, createPiece(6), null, W, 1)!;
    plan.cursor = 2;
    expect(samePiece(expectedPose(plan), plan.path[1])).toBe(true);
  });

  it('accepts a plan while the piece is where the plan expects it', () => {
    const board = createEmptyBoard();
    const plan = planPlacement(board, createPiece(6), null, W, 1)!;
    expect(isPlanValid(plan, plan.origin)).toBe(true);
  });

  it('rejects a plan once gravity has pulled the piece down', () => {
    const board = createEmptyBoard();
    const origin = createPiece(6);
    const plan = planPlacement(board, origin, null, W, 1)!;
    const pulled = movePiece(board, origin, 0, 1)!;
    expect(isPlanValid(plan, pulled)).toBe(false);
  });

  it('rejects a plan when the piece type changed underneath it', () => {
    const board = createEmptyBoard();
    const plan = planPlacement(board, createPiece(6), null, W, 1)!;
    expect(isPlanValid(plan, createPiece(7))).toBe(false);
  });

  it('rejects a finished plan so the caller hard-drops instead of stepping past the end', () => {
    const board = createEmptyBoard();
    const plan = planPlacement(board, createPiece(6), null, W, 1)!;
    plan.cursor = plan.moves.length + 1;
    expect(isPlanValid(plan, plan.origin)).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- src/hooks/useAiPlayer.test.ts`
Expected: FAIL —— `Failed to resolve import "./useAiPlayer"`

- [ ] **Step 3: 实现 `src/hooks/useAiPlayer.ts`**

```ts
import { useEffect, useRef } from 'react';
import type { Board, Piece } from '../types';
import { useGameStore } from '../store/gameStore';
import { bestPlacement } from '../ai/search';
import { projectPath, samePiece } from '../ai/replay';
import type { AiMove } from '../ai/placements';
import { toVector, type Weights } from '../ai/weights';

export type AiSpeed = 'instant' | 'normal' | 'slow';

export interface AiPlayerOptions {
  enabled: boolean;
  depth: 1 | 2;
  speed: AiSpeed;
  weights: Weights;
}

export interface AiPlan {
  moves: AiMove[];
  /** path[i] is the pose after moves[i]. */
  path: Piece[];
  cursor: number;
  origin: Piece;
}

const STEP_DELAY_MS: Record<AiSpeed, number> = {
  instant: 0,
  normal: 40,
  slow: 150,
};

/** Delay used while idling — game over, paused, or nowhere to place the piece. */
const IDLE_DELAY_MS = 120;

export function planPlacement(
  board: Board,
  current: Piece,
  next: Piece | null,
  weights: number[],
  depth: 1 | 2,
): AiPlan | null {
  const decision = bestPlacement(board, current, next, weights, depth);
  if (decision === null) return null;

  const moves = decision.placement.moves;
  const path = projectPath(board, current, moves);
  // projectPath replays through the same engine BFS used, so this should never
  // happen. Bail to a fresh plan rather than executing a half-valid sequence.
  if (path.length !== moves.length) return null;

  return { moves, path, cursor: 0, origin: current };
}

/** The pose the board must be in for the plan's next move to make sense. */
export function expectedPose(plan: AiPlan): Piece {
  return plan.cursor === 0 ? plan.origin : plan.path[plan.cursor - 1];
}

export function isPlanValid(plan: AiPlan, currentPiece: Piece | null): boolean {
  if (plan.cursor > plan.moves.length) return false;
  return samePiece(expectedPose(plan), currentPiece);
}

/**
 * Drives the game through the same store actions the keyboard uses — no back
 * door, no teleporting pieces.
 *
 * Gravity keeps pulling the piece down while a key sequence is being replayed,
 * so a plan can go stale mid-flight (tuck placements, which depend on an exact
 * y, are the most fragile). Every step therefore checks the live piece against
 * the pose the plan expects and re-plans from scratch on any mismatch.
 */
export function useAiPlayer(opts: AiPlayerOptions): void {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    if (!opts.enabled) return;

    let cancelled = false;
    let timer: number | undefined;
    let plan: AiPlan | null = null;

    const schedule = (delay: number) => {
      if (cancelled) return;
      timer = window.setTimeout(step, delay);
    };

    const dispatch = (move: AiMove) => {
      const store = useGameStore.getState();
      if (move === 'left') store.moveLeft();
      else if (move === 'right') store.moveRight();
      else if (move === 'rotate') store.rotate();
      else store.softDrop();
    };

    const step = () => {
      if (cancelled) return;

      const { depth, weights, speed } = optsRef.current;
      const store = useGameStore.getState();

      if (store.status !== 'playing' || store.currentPiece === null) {
        plan = null;
        schedule(IDLE_DELAY_MS);
        return;
      }

      let active = plan;
      if (active === null || !isPlanValid(active, store.currentPiece)) {
        active = planPlacement(
          store.board, store.currentPiece, store.nextPiece, toVector(weights), depth,
        );
        plan = active;
        if (active === null) {
          // Nowhere to put this piece; let gravity end the game.
          schedule(IDLE_DELAY_MS);
          return;
        }
      }

      if (speed === 'instant') {
        // Run the whole placement in one turn of the event loop, so gravity
        // cannot interleave and invalidate the plan.
        while (active.cursor < active.moves.length) {
          dispatch(active.moves[active.cursor]);
          active.cursor++;
        }
        useGameStore.getState().hardDrop();
        plan = null;
        schedule(0);
        return;
      }

      if (active.cursor >= active.moves.length) {
        store.hardDrop();
        plan = null;
        schedule(STEP_DELAY_MS[speed]);
        return;
      }

      dispatch(active.moves[active.cursor]);
      active.cursor++;
      schedule(STEP_DELAY_MS[speed]);
    };

    schedule(0);

    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [opts.enabled]);
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- src/hooks/useAiPlayer.test.ts`
Expected: all passed

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useAiPlayer.ts src/hooks/useAiPlayer.test.ts
git commit -m "feat: add AI autoplay hook with self-healing key replay"
```

---

## Task 10: AI 控件与运行时权重加载 —— 阶段②的里程碑

**Files:**
- Create: `src/ai/loadWeights.ts`
- Create: `src/components/AiControls.tsx`
- Create: `src/components/AiControls.module.css`
- Modify: `src/components/Game.tsx`

**Interfaces:**
- Consumes: `useAiPlayer` / `AiSpeed`（Task 9）、`parseWeightsFile` / `DEFAULT_WEIGHTS` / `Weights`（Task 4）
- Produces:
  - `fetchRuntimeWeights(url?: string): Promise<WeightsFile | null>`（`loadWeights.ts`）
  - `<AiControls />` —— 自带状态，内部调用 `useAiPlayer`

- [ ] **Step 1: 实现 `src/ai/loadWeights.ts`**

```ts
import { parseWeightsFile, type WeightsFile } from './weights';

export const RUNTIME_WEIGHTS_URL = '/ai/best-weights.json';

/**
 * Try to pick up a freshly trained weights file at runtime, so retraining takes
 * effect without a rebuild. Any failure is non-fatal: the caller keeps the
 * weights bundled into the build.
 */
export async function fetchRuntimeWeights(
  url: string = RUNTIME_WEIGHTS_URL,
): Promise<WeightsFile | null> {
  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) return null;

    const parsed = parseWeightsFile(await response.json());
    if (parsed === null) {
      console.warn(`[ai] ${url} failed validation — falling back to built-in weights`);
    }
    return parsed;
  } catch {
    // No trained weights published yet; that is the normal case before training.
    return null;
  }
}
```

- [ ] **Step 2: 写样式**

新建 `src/components/AiControls.module.css`，沿用 `ScoreBoard.module.css` 的霓虹词汇：

```css
.panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  background: #0a0e1a;
  border: 1px solid #1a1e3a;
  border-radius: 4px;
}

.label {
  font-family: 'Fira Code', 'JetBrains Mono', 'Courier New', monospace;
  font-size: 12px;
  color: #4488aa;
  text-transform: uppercase;
  letter-spacing: 2px;
}

.toggle {
  font-family: 'Fira Code', 'JetBrains Mono', 'Courier New', monospace;
  font-size: 13px;
  letter-spacing: 1px;
  text-transform: uppercase;
  padding: 8px 10px;
  cursor: pointer;
  color: #4488aa;
  background: #0d1220;
  border: 1px solid #1a1e3a;
  border-radius: 3px;
  transition: color 120ms, border-color 120ms, box-shadow 120ms;
}

.toggle:hover {
  color: #00f0ff;
  border-color: #00f0ff;
}

.toggleOn {
  color: #00f0ff;
  border-color: #00f0ff;
  box-shadow: 0 0 10px rgba(0, 240, 255, 0.3), inset 0 0 10px rgba(0, 240, 255, 0.08);
}

.row {
  display: flex;
  gap: 6px;
}

.segment {
  flex: 1;
  font-family: 'Fira Code', 'JetBrains Mono', 'Courier New', monospace;
  font-size: 11px;
  padding: 5px 0;
  cursor: pointer;
  color: #4488aa;
  background: #0d1220;
  border: 1px solid #1a1e3a;
  border-radius: 3px;
}

.segment:hover {
  color: #00f0ff;
}

.segmentActive {
  color: #0a0e1a;
  background: #00f0ff;
  border-color: #00f0ff;
}

.source {
  font-family: 'Fira Code', 'JetBrains Mono', 'Courier New', monospace;
  font-size: 10px;
  line-height: 1.5;
  color: #33607a;
}
```

- [ ] **Step 3: 实现 `src/components/AiControls.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { useAiPlayer, type AiSpeed } from '../hooks/useAiPlayer';
import { DEFAULT_WEIGHTS, DEFAULT_WEIGHTS_META, type Weights, type WeightsFile } from '../ai/weights';
import { fetchRuntimeWeights } from '../ai/loadWeights';
import styles from './AiControls.module.css';

const SPEEDS: AiSpeed[] = ['instant', 'normal', 'slow'];

export default function AiControls() {
  const [enabled, setEnabled] = useState(false);
  const [speed, setSpeed] = useState<AiSpeed>('normal');
  const [depth, setDepth] = useState<1 | 2>(2);
  const [runtime, setRuntime] = useState<WeightsFile | null>(null);
  const [useRuntime, setUseRuntime] = useState(true);

  useEffect(() => {
    let alive = true;
    fetchRuntimeWeights().then((file) => {
      if (alive) setRuntime(file);
    });
    return () => {
      alive = false;
    };
  }, []);

  const active: Weights = useRuntime && runtime ? runtime.weights : DEFAULT_WEIGHTS;

  useAiPlayer({ enabled, depth, speed, weights: active });

  const source = useRuntime && runtime
    ? `trained · gen ${runtime.gen} · ${Math.round(runtime.meanLines)} lines`
    : DEFAULT_WEIGHTS_META && DEFAULT_WEIGHTS_META.gen > 0
      ? `bundled · gen ${DEFAULT_WEIGHTS_META.gen}`
      : 'bundled · handcrafted';

  return (
    <div className={styles.panel}>
      <div className={styles.label}>AI</div>

      <button
        type="button"
        className={`${styles.toggle} ${enabled ? styles.toggleOn : ''}`}
        onClick={() => setEnabled((v) => !v)}
      >
        {enabled ? 'Autoplay on' : 'Autoplay off'}
      </button>

      <div className={styles.label}>Speed</div>
      <div className={styles.row}>
        {SPEEDS.map((s) => (
          <button
            key={s}
            type="button"
            className={`${styles.segment} ${speed === s ? styles.segmentActive : ''}`}
            onClick={() => setSpeed(s)}
          >
            {s}
          </button>
        ))}
      </div>

      <div className={styles.label}>Lookahead</div>
      <div className={styles.row}>
        {([1, 2] as const).map((d) => (
          <button
            key={d}
            type="button"
            className={`${styles.segment} ${depth === d ? styles.segmentActive : ''}`}
            onClick={() => setDepth(d)}
          >
            {d} ply
          </button>
        ))}
      </div>

      <div className={styles.label}>Weights</div>
      <div className={styles.row}>
        <button
          type="button"
          className={`${styles.segment} ${!useRuntime ? styles.segmentActive : ''}`}
          onClick={() => setUseRuntime(false)}
        >
          bundled
        </button>
        <button
          type="button"
          className={`${styles.segment} ${useRuntime ? styles.segmentActive : ''}`}
          onClick={() => setUseRuntime(true)}
          disabled={runtime === null}
        >
          trained
        </button>
      </div>
      <div className={styles.source}>{source}</div>
    </div>
  );
}
```

- [ ] **Step 4: 挂到 `Game.tsx`**

把 `src/components/Game.tsx` 整个替换为：

```tsx
import { useKeyboardControls } from '../hooks/useGameLoop';
import GameCanvas from './GameCanvas';
import ScoreBoard from './ScoreBoard';
import GameOverlay from './GameOverlay';
import AiControls from './AiControls';
import styles from './Game.module.css';

export default function Game() {
  useKeyboardControls();

  return (
    <div className={styles.gameContainer}>
      <div className={styles.canvasWrapper}>
        <GameCanvas />
        <GameOverlay />
      </div>
      <div className={styles.sidebar}>
        <ScoreBoard />
        <AiControls />
      </div>
    </div>
  );
}
```

在 `src/components/Game.module.css` 末尾追加：

```css
.sidebar {
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-width: 160px;
}
```

- [ ] **Step 5: 类型检查与测试**

Run: `npm run build && npm test`
Expected: 均通过

- [ ] **Step 6: 人工验证 —— 阶段②的里程碑**

Run: `npm run dev`，浏览器打开页面，开始游戏后点 **Autoplay on**。

Expected：
- AI 接管，方块逐格横移、旋转，然后硬降——看得出是在「按键」而不是瞬移。
- 切到 `slow` 能看清每一步；切到 `instant` 一块一块地飞。
- 切到 `1 ply` 明显更容易堆出洞。
- Next 预览里的方块，就是下一个真正登场的方块（Task 1 的修复在这里肉眼可见）。
- 控制台不该有报错；`/ai/best-weights.json` 的 404 是预期的（还没训练），且不应打印 warning。

- [ ] **Step 7: Commit**

```bash
git add src/ai/loadWeights.ts src/components/AiControls.tsx src/components/AiControls.module.css src/components/Game.tsx src/components/Game.module.css
git commit -m "feat: add in-page AI autoplay controls"
```

**阶段②里程碑达成**：网页里点「AI 托管」，AI 用手调权重实际游玩。BFS 与回放逻辑的问题会在这里暴露，而不是被带进训练。

---

## Task 11: 超参配置与 worker 池

**Files:**
- Create: `training/config.ts`
- Create: `training/worker.ts`
- Create: `training/pool.ts`
- Test: `training/pool.test.ts`

**Interfaces:**
- Consumes: `simulateGame` / `SimResult`（Task 7）
- Produces:
  - `interface TrainConfig { population; eliteFrac; gamesPerCandidate; depth; initialMaxPieces; maxPiecesCap; initialNoise; noiseDecay; noiseFloor; baseSeed; workers; reevalEvery; reevalGames; reevalMaxPieces }`
  - `DEFAULT_CONFIG: TrainConfig`
  - `interface SimTask { taskId: number; weights: number[]; seed: number; maxPieces: number; depth: 1 | 2 }`
  - `interface SimTaskResult { taskId: number; lines: number; score: number; pieces: number; reason: string; failed: boolean }`
  - `class WorkerPool { constructor(size: number); run(tasks: SimTask[]): Promise<SimTaskResult[]>; destroy(): Promise<void> }`

**已验证**：tsx 4.23.1 + Node 24.14.0 支持在 `worker_threads` 里直接跑 `.ts`，包括传递性的 TS 与 JSON import。无需预编译。

- [ ] **Step 1: 实现 `training/config.ts`**

```ts
import { cpus } from 'node:os';

export interface TrainConfig {
  /** Candidates sampled per generation. */
  population: number;
  /** Fraction kept as elites; ceil(eliteFrac * population). */
  eliteFrac: number;
  /** Games each candidate plays, all against the same seed set. */
  gamesPerCandidate: number;
  depth: 1 | 2;
  /** Starting piece cap per game; doubles as candidates outgrow it. */
  initialMaxPieces: number;
  maxPiecesCap: number;
  /** Extra variance added to sigma^2 each generation. */
  initialNoise: number;
  noiseDecay: number;
  noiseFloor: number;
  baseSeed: number;
  workers: number;
  /** Re-evaluate mu on fresh seeds every N generations. */
  reevalEvery: number;
  reevalGames: number;
  reevalMaxPieces: number;
}

export const DEFAULT_CONFIG: TrainConfig = {
  population: 100,
  eliteFrac: 0.1,
  gamesPerCandidate: 5,
  depth: 2,
  initialMaxPieces: 300,
  maxPiecesCap: 100000,
  initialNoise: 0.5,
  noiseDecay: 0.95,
  noiseFloor: 0.01,
  baseSeed: 20260727,
  workers: Math.max(1, Math.min(31, cpus().length - 1)),
  reevalEvery: 10,
  reevalGames: 30,
  reevalMaxPieces: 5000,
};
```

- [ ] **Step 2: 实现 `training/worker.ts`**

```ts
import { parentPort } from 'node:worker_threads';
import { simulateGame } from '../src/ai/simulate';
import type { SimTask } from './pool';

if (parentPort === null) throw new Error('worker.ts must be run as a worker thread');
const port = parentPort;

port.on('message', (task: SimTask) => {
  try {
    const result = simulateGame({
      weights: task.weights,
      seed: task.seed,
      maxPieces: task.maxPieces,
      depth: task.depth,
    });
    port.postMessage({ taskId: task.taskId, ...result, failed: false });
  } catch (err) {
    port.postMessage({
      taskId: task.taskId,
      lines: 0, score: 0, pieces: 0, reason: 'error',
      failed: true,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});
```

- [ ] **Step 3: 写会失败的测试**

新建 `training/pool.test.ts`：

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { WorkerPool, type SimTask } from './pool';
import { toVector, HANDCRAFTED_WEIGHTS } from '../src/ai/weights';

const W = toVector(HANDCRAFTED_WEIGHTS);
const pool = new WorkerPool(3);

afterAll(async () => {
  await pool.destroy();
});

const task = (taskId: number, seed: number, weights = W): SimTask => ({
  taskId, weights, seed, maxPieces: 60, depth: 1,
});

describe('WorkerPool', () => {
  it('returns one result per task, in task order', async () => {
    const tasks = Array.from({ length: 20 }, (_, i) => task(i, i + 1));
    const results = await pool.run(tasks);

    expect(results).toHaveLength(20);
    results.forEach((r, i) => {
      expect(r.taskId).toBe(i);
      expect(r.failed).toBe(false);
      expect(r.pieces).toBeGreaterThan(0);
    });
  }, 60000);

  it('produces the same numbers as an in-process simulation', async () => {
    const { simulateGame } = await import('../src/ai/simulate');
    const direct = simulateGame({ weights: W, seed: 99, maxPieces: 60, depth: 1 });
    const [viaWorker] = await pool.run([task(0, 99)]);

    expect(viaWorker.lines).toBe(direct.lines);
    expect(viaWorker.score).toBe(direct.score);
    expect(viaWorker.pieces).toBe(direct.pieces);
  }, 60000);

  it('records a failed task as zero fitness instead of hanging or throwing', async () => {
    // A short weight vector makes simulateGame throw inside the worker.
    const results = await pool.run([task(0, 1), task(1, 2, [1, 2, 3]), task(2, 3)]);

    expect(results).toHaveLength(3);
    expect(results[1].failed).toBe(true);
    expect(results[1].lines).toBe(0);
    expect(results[0].failed).toBe(false);
    expect(results[2].failed).toBe(false);
  }, 60000);

  it('handles more tasks than workers without dropping any', async () => {
    const tasks = Array.from({ length: 50 }, (_, i) => task(i, 1000 + i));
    const results = await pool.run(tasks);
    expect(new Set(results.map((r) => r.taskId)).size).toBe(50);
  }, 120000);

  it('accepts an empty task list', async () => {
    expect(await pool.run([])).toEqual([]);
  });
});
```

- [ ] **Step 4: 运行测试确认失败**

Run: `npm test -- training/pool.test.ts`
Expected: FAIL —— `Failed to resolve import "./pool"`

- [ ] **Step 5: 实现 `training/pool.ts`**

```ts
import { Worker } from 'node:worker_threads';

export interface SimTask {
  taskId: number;
  weights: number[];
  seed: number;
  maxPieces: number;
  depth: 1 | 2;
}

export interface SimTaskResult {
  taskId: number;
  lines: number;
  score: number;
  pieces: number;
  reason: string;
  failed: boolean;
  error?: string;
}

const WORKER_URL = new URL('./worker.ts', import.meta.url);

interface QueueItem {
  task: SimTask;
  index: number;
  attempts: number;
}

/**
 * Work-stealing pool over worker_threads.
 *
 * The unit of work is ONE GAME, not one candidate. A strong candidate can take
 * two orders of magnitude longer per game than a weak one, so handing each
 * worker a whole candidate would leave almost every core idle during the tail
 * of a generation.
 */
export class WorkerPool {
  private workers: Worker[] = [];

  constructor(size: number) {
    for (let i = 0; i < size; i++) this.workers.push(this.spawn(i));
  }

  private spawn(i: number): Worker {
    const worker = new Worker(WORKER_URL, { name: `sim-${i}` });
    worker.unref();
    return worker;
  }

  run(tasks: SimTask[]): Promise<SimTaskResult[]> {
    if (tasks.length === 0) return Promise.resolve([]);

    return new Promise((resolveAll, rejectAll) => {
      const results = new Array<SimTaskResult>(tasks.length);
      const queue: QueueItem[] = tasks.map((task, index) => ({ task, index, attempts: 0 }));
      const inFlight = new Map<Worker, QueueItem>();
      let completed = 0;
      let cursor = 0;
      let settled = false;

      const complete = (item: QueueItem, result: SimTaskResult) => {
        results[item.index] = result;
        if (++completed === tasks.length && !settled) {
          settled = true;
          resolveAll(results);
        }
      };

      const feed = (worker: Worker) => {
        if (settled || cursor >= queue.length) return;
        const item = queue[cursor++];
        inFlight.set(worker, item);
        item.attempts++;
        worker.postMessage(item.task);
      };

      const retryOrFail = (item: QueueItem, reason: string) => {
        if (item.attempts < 2) {
          console.warn(`[pool] task ${item.task.taskId} ${reason}; retrying`);
          queue.push(item);
          return;
        }
        console.warn(`[pool] task ${item.task.taskId} ${reason} twice; scoring it 0`);
        complete(item, {
          taskId: item.task.taskId,
          lines: 0, score: 0, pieces: 0, reason: 'error',
          failed: true, error: reason,
        });
      };

      const attach = (worker: Worker, slot: number) => {
        worker.removeAllListeners('message');
        worker.removeAllListeners('error');

        worker.on('message', (result: SimTaskResult) => {
          const item = inFlight.get(worker);
          if (item === undefined) return;
          inFlight.delete(worker);

          if (result.failed) retryOrFail(item, `failed (${result.error ?? 'unknown'})`);
          else complete(item, result);

          feed(worker);
        });

        // A worker that emits 'error' has died; replace it and requeue its task.
        worker.on('error', (err) => {
          const item = inFlight.get(worker);
          inFlight.delete(worker);

          const replacement = this.spawn(slot);
          this.workers[slot] = replacement;
          attach(replacement, slot);

          if (item !== undefined) retryOrFail(item, `crashed the worker (${err.message})`);
          feed(replacement);
        });
      };

      try {
        this.workers.forEach(attach);
        for (const worker of this.workers) feed(worker);
      } catch (err) {
        settled = true;
        rejectAll(err);
      }
    });
  }

  async destroy(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.terminate()));
    this.workers = [];
  }
}
```

- [ ] **Step 6: 运行测试确认通过**

Run: `npm test -- training/pool.test.ts`
Expected: all passed。若报 `Cannot find module ... worker.ts`，说明 tsx 的 loader 没进 worker——先单独跑一遍 `npx tsx -e "new (await import('node:worker_threads')).Worker(new URL('./training/worker.ts', import.meta.url))"` 定位问题。

- [ ] **Step 7: 类型检查训练目录**

Run: `npm run typecheck:train`
Expected: 无错误

- [ ] **Step 8: Commit**

```bash
git add training/config.ts training/worker.ts training/pool.ts training/pool.test.ts
git commit -m "feat: add worker pool with per-game task granularity"
```

---

## Task 12: CEM 数学

全部是纯函数，可脱离 worker 与文件系统独立测试。

**Files:**
- Create: `training/cem.ts`
- Test: `training/cem.test.ts`

**Interfaces:**
- Consumes: `normalize`（Task 4）、`FEATURE_COUNT`（Task 3）
- Produces:
  - `interface CemState { mu: number[]; sigma: number[]; gen: number }`
  - `initCem(dim?: number): CemState`
  - `gaussian(rng: () => number): number`
  - `sampleCandidates(state: CemState, count: number, rng: () => number): number[][]`
  - `noiseAt(gen: number, opts: { initialNoise; noiseDecay; noiseFloor }): number`
  - `updateCem(state, candidates, fitness, opts: { eliteFrac; noise }): CemState`
  - `nextMaxPieces(current: number, medianPieces: number, cap: number): number`
  - `median(values: number[]): number`

- [ ] **Step 1: 写会失败的测试**

新建 `training/cem.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import {
  initCem, gaussian, sampleCandidates, noiseAt, updateCem, nextMaxPieces, median,
} from './cem';
import { mulberry32 } from '../src/ai/rng';
import { FEATURE_COUNT } from '../src/ai/features';

const l2 = (v: number[]) => Math.sqrt(v.reduce((s, x) => s + x * x, 0));

describe('initCem', () => {
  it('starts at the origin with unit sigma and no prior', () => {
    const s = initCem();
    expect(s.mu).toEqual(Array(FEATURE_COUNT).fill(0));
    expect(s.sigma).toEqual(Array(FEATURE_COUNT).fill(1));
    expect(s.gen).toBe(0);
  });
});

describe('gaussian', () => {
  it('has mean 0 and standard deviation 1', () => {
    const rng = mulberry32(4);
    const n = 200000;
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const x = gaussian(rng);
      sum += x;
      sumSq += x * x;
    }
    const mean = sum / n;
    expect(mean).toBeCloseTo(0, 1);
    expect(Math.sqrt(sumSq / n - mean * mean)).toBeCloseTo(1, 1);
  });

  it('never returns a non-finite value', () => {
    const rng = mulberry32(5);
    for (let i = 0; i < 50000; i++) expect(Number.isFinite(gaussian(rng))).toBe(true);
  });
});

describe('sampleCandidates', () => {
  it('returns normalised vectors of the right shape', () => {
    const candidates = sampleCandidates(initCem(), 25, mulberry32(1));
    expect(candidates).toHaveLength(25);
    for (const c of candidates) {
      expect(c).toHaveLength(FEATURE_COUNT);
      expect(l2(c)).toBeCloseTo(1, 10);
    }
  });

  it('is deterministic for a given rng seed', () => {
    expect(sampleCandidates(initCem(), 5, mulberry32(2)))
      .toEqual(sampleCandidates(initCem(), 5, mulberry32(2)));
  });

  it('spreads more widely when sigma is larger', () => {
    const mu = Array(FEATURE_COUNT).fill(0);
    mu[0] = 10;
    const tight = sampleCandidates({ mu, sigma: Array(FEATURE_COUNT).fill(0.01), gen: 0 }, 40, mulberry32(3));
    const loose = sampleCandidates({ mu, sigma: Array(FEATURE_COUNT).fill(5), gen: 0 }, 40, mulberry32(3));
    const spread = (xs: number[][]) => Math.max(...xs.map((c) => c[1])) - Math.min(...xs.map((c) => c[1]));
    expect(spread(loose)).toBeGreaterThan(spread(tight));
  });
});

describe('noiseAt', () => {
  const opts = { initialNoise: 0.5, noiseDecay: 0.95, noiseFloor: 0.01 };

  it('decays geometrically from the initial value', () => {
    expect(noiseAt(0, opts)).toBeCloseTo(0.5, 10);
    expect(noiseAt(1, opts)).toBeCloseTo(0.475, 10);
  });

  it('never drops below the floor', () => {
    expect(noiseAt(1000, opts)).toBe(0.01);
  });
});

describe('updateCem', () => {
  const dim = FEATURE_COUNT;
  const vec = (first: number) => {
    const v = Array(dim).fill(0);
    v[0] = first;
    return v;
  };

  it('moves mu toward the elites', () => {
    const candidates = [vec(10), vec(9), vec(-9), vec(-10)];
    const fitness = [100, 90, 5, 1];
    const next = updateCem(initCem(), candidates, fitness, { eliteFrac: 0.5, noise: 0 });
    expect(next.mu[0]).toBeCloseTo(9.5, 10);
  });

  it('advances the generation counter', () => {
    const next = updateCem(initCem(), [vec(1), vec(2)], [1, 2], { eliteFrac: 0.5, noise: 0 });
    expect(next.gen).toBe(1);
  });

  it('keeps at least one elite even with a tiny fraction', () => {
    const next = updateCem(initCem(), [vec(3), vec(7)], [1, 99], { eliteFrac: 0.001, noise: 0 });
    expect(next.mu[0]).toBeCloseTo(7, 10);
  });

  it('adds the noise floor to the variance so the distribution cannot collapse', () => {
    // All elites identical => zero variance; sigma must still be sqrt(noise).
    const next = updateCem(initCem(), [vec(5), vec(5)], [1, 1], { eliteFrac: 1, noise: 0.25 });
    for (const s of next.sigma) expect(s).toBeCloseTo(0.5, 10);
  });

  it('shrinks sigma as the elites agree', () => {
    const spread = updateCem(initCem(), [vec(-8), vec(8)], [1, 1], { eliteFrac: 1, noise: 0 });
    const tight = updateCem(initCem(), [vec(-0.1), vec(0.1)], [1, 1], { eliteFrac: 1, noise: 0 });
    expect(tight.sigma[0]).toBeLessThan(spread.sigma[0]);
  });

  it('rejects mismatched candidate and fitness lengths', () => {
    expect(() => updateCem(initCem(), [vec(1)], [1, 2], { eliteFrac: 0.5, noise: 0 })).toThrow();
  });
});

describe('nextMaxPieces', () => {
  // The trigger is SURVIVED PIECES, not lines. Each piece is 4 cells and a line
  // is 10, so lines/pieces can never exceed 0.4 — a lines-based trigger of
  // "0.8 * maxPieces" is mathematically unreachable and would never fire.
  it('doubles once the median game is bumping against the cap', () => {
    expect(nextMaxPieces(300, 250, 100000)).toBe(600);
  });

  it('holds steady while games still end on their own', () => {
    expect(nextMaxPieces(300, 100, 100000)).toBe(300);
  });

  it('respects the absolute cap', () => {
    expect(nextMaxPieces(80000, 79000, 100000)).toBe(100000);
  });
});

describe('median', () => {
  it('handles odd and even lengths', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it('returns 0 for an empty list', () => {
    expect(median([])).toBe(0);
  });

  it('does not mutate its input', () => {
    const xs = [3, 1, 2];
    median(xs);
    expect(xs).toEqual([3, 1, 2]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- training/cem.test.ts`
Expected: FAIL —— `Failed to resolve import "./cem"`

- [ ] **Step 3: 实现 `training/cem.ts`**

```ts
import { FEATURE_COUNT } from '../src/ai/features';
import { normalize } from '../src/ai/weights';

export interface CemState {
  mu: number[];
  sigma: number[];
  gen: number;
}

/**
 * Start from the origin with unit sigma — no handcrafted prior at all, so the
 * search finds its own direction rather than inheriting our guesses.
 */
export function initCem(dim: number = FEATURE_COUNT): CemState {
  return { mu: Array(dim).fill(0), sigma: Array(dim).fill(1), gen: 0 };
}

/** Box-Muller transform. */
export function gaussian(rng: () => number): number {
  let u = 0;
  while (u === 0) u = rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function sampleCandidates(
  state: CemState,
  count: number,
  rng: () => number,
): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < count; i++) {
    const candidate = state.mu.map((m, d) => m + state.sigma[d] * gaussian(rng));
    out.push(normalize(candidate));
  }
  return out;
}

/** Extra variance injected each generation to stop the distribution collapsing early. */
export function noiseAt(
  gen: number,
  opts: { initialNoise: number; noiseDecay: number; noiseFloor: number },
): number {
  return Math.max(opts.noiseFloor, opts.initialNoise * Math.pow(opts.noiseDecay, gen));
}

export function updateCem(
  state: CemState,
  candidates: number[][],
  fitness: number[],
  opts: { eliteFrac: number; noise: number },
): CemState {
  if (candidates.length !== fitness.length) {
    throw new Error(`got ${candidates.length} candidates but ${fitness.length} fitness values`);
  }
  if (candidates.length === 0) throw new Error('cannot update from an empty population');

  const eliteCount = Math.max(1, Math.ceil(opts.eliteFrac * candidates.length));
  const elites = candidates
    .map((weights, i) => ({ weights, fit: fitness[i] }))
    .sort((a, b) => b.fit - a.fit)
    .slice(0, eliteCount)
    .map((e) => e.weights);

  const dim = state.mu.length;
  const mu = new Array<number>(dim).fill(0);
  for (const elite of elites) {
    for (let d = 0; d < dim; d++) mu[d] += elite[d] / elites.length;
  }

  const sigma = new Array<number>(dim);
  for (let d = 0; d < dim; d++) {
    let variance = 0;
    for (const elite of elites) {
      const diff = elite[d] - mu[d];
      variance += (diff * diff) / elites.length;
    }
    sigma[d] = Math.sqrt(variance + opts.noise);
  }

  return { mu, sigma, gen: state.gen + 1 };
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Raise the per-game piece cap once it is the binding constraint.
 *
 * The trigger is median SURVIVED PIECES, not fitness. Fitness is measured in
 * lines, and since a piece contributes 4 cells while a line needs 10, the ratio
 * of lines to pieces can never exceed 0.4 — comparing lines against a fraction
 * of the piece cap would be a condition that can never be true.
 *
 * Without this, late-generation candidates run for minutes per game and eat the
 * whole time budget.
 */
export function nextMaxPieces(current: number, medianPieces: number, cap: number): number {
  if (medianPieces <= 0.8 * current) return current;
  return Math.min(current * 2, cap);
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- training/cem.test.ts`
Expected: all passed

- [ ] **Step 5: Commit**

```bash
git add training/cem.ts training/cem.test.ts
git commit -m "feat: add CEM sampling, elite update and piece-cap schedule"
```

---

## Task 13: CEM 主循环 —— 阶段③的里程碑

**Files:**
- Create: `training/train.ts`
- Modify: `package.json`（`train` 脚本）
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `DEFAULT_CONFIG` / `WorkerPool`（Task 11）、`cem.ts` 全部导出（Task 12）、`hashSeed`（Task 2）、`normalize` / `fromVector`（Task 4）
- Produces: `npm run train` CLI；写出 `public/ai/training-log.jsonl`、`public/ai/checkpoint.json`、`public/ai/best-weights.json`、`src/ai/trained-weights.json`

- [ ] **Step 1: 加脚本与 gitignore**

`package.json` 的 `scripts` 中加入：

```json
"train": "tsx training/train.ts"
```

`.gitignore` 末尾追加：

```gitignore
# AI training artifacts. The model itself is committed at
# src/ai/trained-weights.json; everything under public/ai is a run artifact.
public/ai/best-weights.json
public/ai/training-log.jsonl
public/ai/checkpoint.json
```

- [ ] **Step 2: 实现 `training/train.ts`**

```ts
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_CONFIG, type TrainConfig } from './config';
import { WorkerPool, type SimTask } from './pool';
import {
  initCem, sampleCandidates, updateCem, noiseAt, nextMaxPieces, median, type CemState,
} from './cem';
import { hashSeed, mulberry32 } from '../src/ai/rng';
import { fromVector, normalize } from './weightsIo';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** Salt keeping the candidate-sampling stream disjoint from the game seeds. */
const SAMPLE_STREAM = 0xce41;
const PUBLIC_AI = resolve(ROOT, 'public/ai');
const CHECKPOINT = resolve(PUBLIC_AI, 'checkpoint.json');
const LOG = resolve(PUBLIC_AI, 'training-log.jsonl');
const BEST_PUBLIC = resolve(PUBLIC_AI, 'best-weights.json');
const BEST_SRC = resolve(ROOT, 'src/ai/trained-weights.json');

interface BestEver {
  weights: number[];
  meanLines: number;
  gen: number;
  evalGames: number;
}

interface Checkpoint {
  version: 1;
  gen: number;
  mu: number[];
  sigma: number[];
  baseSeed: number;
  maxPieces: number;
  config: TrainConfig;
  bestEver: BestEver;
}

function parseArgs(argv: string[]): { generations: number | null; resume: boolean } {
  const out = { generations: null as number | null, resume: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--resume') out.resume = true;
    else if (argv[i] === '--generations') out.generations = Number(argv[++i]);
    else throw new Error(`unknown flag ${argv[i]}`);
  }
  return out;
}

function writeWeightsFiles(weights: number[], meanLines: number, evalGames: number, gen: number, depth: 1 | 2) {
  const payload = JSON.stringify({
    version: 1,
    weights: fromVector(weights),
    meanLines,
    evalGames,
    gen,
    searchDepth: depth,
    trainedAt: new Date().toISOString(),
  }, null, 2);

  // Two copies on purpose: files under public/ are copied verbatim by Vite and
  // must not be imported, while the bundled copy is what makes `dist` run
  // standalone. Same bytes, different jobs.
  writeFileSync(BEST_PUBLIC, payload);
  writeFileSync(BEST_SRC, payload);
}

const args = parseArgs(process.argv.slice(2));
const cfg = DEFAULT_CONFIG;
mkdirSync(PUBLIC_AI, { recursive: true });

let state: CemState = initCem();
let maxPieces = cfg.initialMaxPieces;
let baseSeed = cfg.baseSeed;
let bestEver: BestEver = { weights: state.mu.slice(), meanLines: -1, gen: -1, evalGames: 0 };

if (args.resume) {
  if (!existsSync(CHECKPOINT)) throw new Error(`--resume but no checkpoint at ${CHECKPOINT}`);
  const cp = JSON.parse(readFileSync(CHECKPOINT, 'utf8')) as Checkpoint;
  state = { mu: cp.mu, sigma: cp.sigma, gen: cp.gen };
  maxPieces = cp.maxPieces;
  baseSeed = cp.baseSeed;
  bestEver = cp.bestEver;
  console.log(`resumed from gen ${cp.gen}, maxPieces ${maxPieces}, bestEver ${bestEver.meanLines}`);
}

const pool = new WorkerPool(cfg.workers);
console.log(`training with ${cfg.workers} workers, depth ${cfg.depth}, population ${cfg.population}`);

function saveCheckpoint() {
  const cp: Checkpoint = {
    version: 1, gen: state.gen, mu: state.mu, sigma: state.sigma,
    baseSeed, maxPieces, config: cfg, bestEver,
  };
  writeFileSync(CHECKPOINT, JSON.stringify(cp, null, 2));
}

let stopping = false;
process.on('SIGINT', () => {
  if (stopping) process.exit(1);
  stopping = true;
  console.log('\ncaught SIGINT — writing checkpoint and exiting');
});

async function runGeneration(): Promise<void> {
  const gen = state.gen;
  const started = Date.now();

  const candidates = sampleCandidates(
    state, cfg.population, mulberry32(hashSeed(baseSeed, gen, SAMPLE_STREAM)),
  );

  // Common random numbers: the seed depends on (baseSeed, gen, gameIndex) and
  // NOT on the candidate, so every candidate this generation faces the exact
  // same piece sequences. Without this, measured differences are mostly luck
  // and the evolution signal disappears. Seeds change each generation so no
  // candidate can overfit one sequence.
  const seeds = Array.from({ length: cfg.gamesPerCandidate }, (_, j) => hashSeed(baseSeed, gen, j));

  const tasks: SimTask[] = [];
  candidates.forEach((weights, i) => {
    seeds.forEach((seed, j) => {
      tasks.push({ taskId: i * cfg.gamesPerCandidate + j, weights, seed, maxPieces, depth: cfg.depth });
    });
  });

  const results = await pool.run(tasks);

  const fitness: number[] = [];
  const meanPieces: number[] = [];
  for (let i = 0; i < candidates.length; i++) {
    let lines = 0;
    let pieces = 0;
    for (let j = 0; j < cfg.gamesPerCandidate; j++) {
      const r = results[i * cfg.gamesPerCandidate + j];
      lines += r.lines;
      pieces += r.pieces;
    }
    fitness.push(lines / cfg.gamesPerCandidate);
    meanPieces.push(pieces / cfg.gamesPerCandidate);
  }

  const best = Math.max(...fitness);
  const worst = Math.min(...fitness);
  const mean = fitness.reduce((s, x) => s + x, 0) / fitness.length;
  const std = Math.sqrt(fitness.reduce((s, x) => s + (x - mean) ** 2, 0) / fitness.length);
  const bestWeights = candidates[fitness.indexOf(best)];
  const elapsedMs = Date.now() - started;

  appendFileSync(LOG, JSON.stringify({
    gen, ts: Date.now(), best, mean, median: median(fitness), worst, std,
    mu: state.mu, sigma: state.sigma, bestWeights,
    maxPieces, medianPieces: median(meanPieces),
    gamesPerCandidate: cfg.gamesPerCandidate, elapsedMs,
  }) + '\n');

  console.log(
    `gen ${String(gen).padStart(4)}  best ${best.toFixed(1).padStart(9)}` +
    `  median ${median(fitness).toFixed(1).padStart(9)}  worst ${worst.toFixed(1).padStart(7)}` +
    `  cap ${maxPieces}  ${(elapsedMs / 1000).toFixed(1)}s`,
  );

  state = updateCem(state, candidates, fitness, {
    eliteFrac: cfg.eliteFrac,
    noise: noiseAt(gen, cfg),
  });

  const raised = nextMaxPieces(maxPieces, median(meanPieces), cfg.maxPiecesCap);
  if (raised !== maxPieces) {
    console.log(`  piece cap ${maxPieces} -> ${raised} (median survival ${median(meanPieces).toFixed(0)})`);
    maxPieces = raised;
  }

  // The top candidate of a generation is often just lucky. Re-score the current
  // mu on fresh seeds and long games before letting it become the published model.
  if (state.gen % cfg.reevalEvery === 0) {
    const mu = normalize(state.mu);
    const evalTasks: SimTask[] = Array.from({ length: cfg.reevalGames }, (_, j) => ({
      taskId: j,
      weights: mu,
      seed: hashSeed(baseSeed ^ 0x5eed, state.gen, j),
      maxPieces: cfg.reevalMaxPieces,
      depth: cfg.depth,
    }));
    const evalResults = await pool.run(evalTasks);
    const meanLines = evalResults.reduce((s, r) => s + r.lines, 0) / evalResults.length;
    console.log(`  re-eval of mu over ${cfg.reevalGames} fresh seeds: ${meanLines.toFixed(1)} lines`);

    if (meanLines > bestEver.meanLines) {
      bestEver = { weights: mu, meanLines, gen: state.gen, evalGames: cfg.reevalGames };
      writeWeightsFiles(mu, meanLines, cfg.reevalGames, state.gen, cfg.depth);
      console.log(`  new best — wrote best-weights.json and trained-weights.json`);
    }
  }

  saveCheckpoint();
}

while (!stopping) {
  if (args.generations !== null && state.gen >= args.generations) break;
  await runGeneration();
}

saveCheckpoint();
await pool.destroy();
console.log(`stopped at gen ${state.gen}; bestEver ${bestEver.meanLines.toFixed(1)} lines (gen ${bestEver.gen})`);
process.exit(0);
```

- [ ] **Step 3: 建 `training/weightsIo.ts`**

`train.ts` 需要 `fromVector` 输出普通对象、`normalize` 复用 AI 核心的实现。为了不让 Node 侧被 `weights.ts` 的 JSON import 牵连，单独提一个薄封装：

```ts
import { FEATURE_NAMES } from '../src/ai/features';

export { normalize } from '../src/ai/weights';

/** Plain object keyed by feature name — the on-disk weights format. */
export function fromVector(v: number[]): Record<string, number> {
  if (v.length !== FEATURE_NAMES.length) {
    throw new Error(`expected ${FEATURE_NAMES.length} weights, got ${v.length}`);
  }
  return Object.fromEntries(FEATURE_NAMES.map((name, i) => [name, v[i]]));
}
```

- [ ] **Step 4: 冒烟测试 —— 用极小超参跑两代**

临时把 `training/config.ts` 的 `DEFAULT_CONFIG` 改成 `population: 8, gamesPerCandidate: 2, initialMaxPieces: 60, depth: 1, reevalEvery: 1, reevalGames: 4, reevalMaxPieces: 200`。

Run: `npm run train -- --generations 2`

Expected：
- 打印两行 `gen 0 ...` / `gen 1 ...`
- `public/ai/training-log.jsonl` 有 2 行，每行都能 `JSON.parse`
- `public/ai/checkpoint.json` 存在且 `gen` 为 2
- `public/ai/best-weights.json` 与 `src/ai/trained-weights.json` 都被写过，且两者内容逐字节相同

- [ ] **Step 5: 验证断点续训**

Run: `npm run train -- --resume --generations 4`
Expected: 打印 `resumed from gen 2`，接着输出 `gen 2` / `gen 3`；日志累计 4 行。

- [ ] **Step 6: 验证 Ctrl-C 落盘**

Run: `npm run train`，等第一代打印完后按 Ctrl-C。
Expected: 打印 `caught SIGINT — writing checkpoint and exiting`，进程退出码 0，`checkpoint.json` 的 `gen` 已更新。

- [ ] **Step 7: 恢复真实超参并确认权重可用**

把 `training/config.ts` 改回 Step 1 之前的 `DEFAULT_CONFIG` 原值。删掉冒烟测试产生的产物：

```bash
rm -f public/ai/training-log.jsonl public/ai/checkpoint.json public/ai/best-weights.json
git checkout src/ai/trained-weights.json
```

- [ ] **Step 8: 类型检查与全量测试**

Run: `npm run typecheck:train && npm test && npm run build`
Expected: 均通过

- [ ] **Step 9: 真正跑一段训练 —— 阶段③的里程碑**

Run: `npm run train -- --generations 15`

Expected：fitness 的 median 逐代上升（前几代噪声大是正常的，看趋势不看单点）。用 Task 8 记下的吞吐估算单代耗时；若明显更慢，先确认 `workers` 取到了 31 而不是 1。

- [ ] **Step 10: Commit**

```bash
git add training/train.ts training/weightsIo.ts package.json .gitignore src/ai/trained-weights.json
git commit -m "feat: add CEM training loop with checkpointing and re-evaluation"
```

**阶段③里程碑达成**：`npm run train` 跑起来，日志显示 fitness 逐代上升。

---

## Task 14: 面板骨架与数据加载

**Files:**
- Create: `training.html`
- Create: `src/training/dashboard/main.tsx`
- Create: `src/training/dashboard/types.ts`
- Create: `src/training/dashboard/useTrainingLog.ts`
- Create: `src/training/dashboard/scales.ts`
- Create: `src/training/dashboard/App.tsx`
- Create: `src/training/dashboard/App.module.css`
- Test: `src/training/dashboard/scales.test.ts`
- Test: `src/training/dashboard/useTrainingLog.test.ts`
- Modify: `vite.config.ts`

**Interfaces:**
- Consumes: `FEATURE_NAMES`（Task 3）、`public/ai/training-log.jsonl`（Task 13 写出）
- Produces:
  - `interface LogEntry { gen; ts; best; mean; median; worst; std; mu; sigma; bestWeights; maxPieces; medianPieces; gamesPerCandidate; elapsedMs }`
  - `parseLog(text: string): LogEntry[]`
  - `useTrainingLog(pollMs?: number): { entries: LogEntry[]; error: string | null }`
  - `linearScale(d0, d1, r0, r1): (v: number) => number`
  - `niceTicks(min, max, count?): number[]`
  - `extent(values: number[]): [number, number]`

- [ ] **Step 1: 加第二入口**

`vite.config.ts` 整个替换为：

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        training: fileURLToPath(new URL('./training.html', import.meta.url)),
      },
    },
  },
})
```

- [ ] **Step 2: 建 `training.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Tetris AI — Training</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/training/dashboard/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 3: 写会失败的测试**

新建 `src/training/dashboard/scales.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { linearScale, niceTicks, extent } from './scales';

describe('linearScale', () => {
  it('maps the domain onto the range', () => {
    const s = linearScale(0, 10, 0, 100);
    expect(s(0)).toBe(0);
    expect(s(5)).toBe(50);
    expect(s(10)).toBe(100);
  });

  it('supports an inverted range, as SVG y axes need', () => {
    const s = linearScale(0, 10, 200, 0);
    expect(s(0)).toBe(200);
    expect(s(10)).toBe(0);
  });

  it('does not divide by zero on a degenerate domain', () => {
    const s = linearScale(5, 5, 0, 100);
    expect(Number.isFinite(s(5))).toBe(true);
  });
});

describe('niceTicks', () => {
  it('produces round numbers inside the domain', () => {
    const ticks = niceTicks(0, 100, 5);
    expect(ticks[0]).toBeGreaterThanOrEqual(0);
    expect(ticks[ticks.length - 1]).toBeLessThanOrEqual(100);
    expect(ticks).toContain(50);
  });

  it('handles small ranges', () => {
    expect(niceTicks(0, 1, 5).length).toBeGreaterThan(1);
  });

  it('handles a degenerate range without looping forever', () => {
    expect(niceTicks(7, 7)).toEqual([7]);
  });

  it('handles negative domains', () => {
    const ticks = niceTicks(-1, 1, 4);
    expect(ticks).toContain(0);
  });
});

describe('extent', () => {
  it('returns min and max', () => {
    expect(extent([3, 1, 4, 1, 5])).toEqual([1, 5]);
  });

  it('returns [0, 1] for an empty list', () => {
    expect(extent([])).toEqual([0, 1]);
  });

  it('ignores non-finite values', () => {
    expect(extent([1, NaN, 3, Infinity])).toEqual([1, 3]);
  });
});
```

新建 `src/training/dashboard/useTrainingLog.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { parseLog } from './useTrainingLog';

const line = (gen: number) => JSON.stringify({
  gen, ts: 1785000000000 + gen, best: 100 + gen, mean: 50, median: 40, worst: 1, std: 10,
  mu: Array(9).fill(0.1), sigma: Array(9).fill(0.5), bestWeights: Array(9).fill(0.2),
  maxPieces: 300, medianPieces: 120, gamesPerCandidate: 5, elapsedMs: 1000,
});

describe('parseLog', () => {
  it('parses one entry per line', () => {
    const entries = parseLog(`${line(0)}\n${line(1)}\n`);
    expect(entries).toHaveLength(2);
    expect(entries[1].gen).toBe(1);
    expect(entries[0].mu).toHaveLength(9);
  });

  it('returns an empty array for empty input', () => {
    expect(parseLog('')).toEqual([]);
    expect(parseLog('\n\n')).toEqual([]);
  });

  it('skips a truncated trailing line instead of throwing', () => {
    // The trainer appends while the dashboard reads; a partial last line is normal.
    const entries = parseLog(`${line(0)}\n{"gen":1,"best":`);
    expect(entries).toHaveLength(1);
  });

  it('skips lines missing required fields', () => {
    expect(parseLog(`{"gen":0}\n${line(1)}`)).toHaveLength(1);
  });

  it('sorts by generation', () => {
    const entries = parseLog(`${line(3)}\n${line(1)}\n${line(2)}`);
    expect(entries.map((e) => e.gen)).toEqual([1, 2, 3]);
  });
});
```

- [ ] **Step 4: 运行测试确认失败**

Run: `npm test -- src/training/dashboard`
Expected: FAIL —— 两个模块都无法解析

- [ ] **Step 5: 实现 `src/training/dashboard/scales.ts`**

```ts
export function linearScale(d0: number, d1: number, r0: number, r1: number): (v: number) => number {
  const span = d1 - d0 || 1;
  return (v: number) => r0 + ((v - d0) / span) * (r1 - r0);
}

export function extent(values: number[]): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (min === Infinity) return [0, 1];
  return [min, max];
}

/** Round tick values inside [min, max], roughly `count` of them. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return [min];

  const rough = (max - min) / count;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  const normalised = rough / magnitude;
  const step = (normalised >= 5 ? 10 : normalised >= 2 ? 5 : normalised >= 1 ? 2 : 1) * magnitude;

  const ticks: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) {
    ticks.push(Number(v.toPrecision(12)));
  }
  return ticks;
}
```

- [ ] **Step 6: 实现 `src/training/dashboard/types.ts`**

```ts
export interface LogEntry {
  gen: number;
  ts: number;
  best: number;
  mean: number;
  median: number;
  worst: number;
  std: number;
  mu: number[];
  sigma: number[];
  bestWeights: number[];
  maxPieces: number;
  medianPieces: number;
  gamesPerCandidate: number;
  elapsedMs: number;
}
```

- [ ] **Step 7: 实现 `src/training/dashboard/useTrainingLog.ts`**

```ts
import { useEffect, useState } from 'react';
import type { LogEntry } from './types';

export const LOG_URL = '/ai/training-log.jsonl';

const NUMBER_FIELDS = ['gen', 'best', 'mean', 'median', 'worst'] as const;
const ARRAY_FIELDS = ['mu', 'sigma', 'bestWeights'] as const;

/**
 * The trainer appends to this file while we read it, so a truncated final line
 * is routine rather than an error. Skip anything that does not parse.
 */
export function parseLog(text: string): LogEntry[] {
  const entries: LogEntry[] = [];

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;

    let value: unknown;
    try {
      value = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (typeof value !== 'object' || value === null) continue;

    const e = value as Record<string, unknown>;
    if (NUMBER_FIELDS.some((f) => typeof e[f] !== 'number')) continue;
    if (ARRAY_FIELDS.some((f) => !Array.isArray(e[f]))) continue;

    entries.push(value as LogEntry);
  }

  return entries.sort((a, b) => a.gen - b.gen);
}

/**
 * Full re-fetch every poll. The log is one line per generation, so even a
 * multi-day run is a few hundred kilobytes — an incremental protocol would be
 * complexity with nothing to buy.
 */
export function useTrainingLog(pollMs = 1000): { entries: LogEntry[]; error: string | null } {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const response = await fetch(LOG_URL, { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const parsed = parseLog(await response.text());
        if (cancelled) return;
        setEntries(parsed);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      }
    };

    poll();
    const timer = window.setInterval(poll, pollMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [pollMs]);

  return { entries, error };
}
```

- [ ] **Step 8: 实现面板外壳**

新建 `src/training/dashboard/App.module.css`：

```css
.page {
  min-height: 100vh;
  padding: 32px;
  background: #0a0e1a;
  color: #cfe8f5;
  font-family: 'Fira Code', 'JetBrains Mono', 'Courier New', monospace;
}

.title {
  margin: 0 0 4px;
  font-size: 18px;
  letter-spacing: 3px;
  text-transform: uppercase;
  color: #00f0ff;
  text-shadow: 0 0 10px rgba(0, 240, 255, 0.5);
}

.subtitle {
  margin: 0 0 24px;
  font-size: 12px;
  color: #4488aa;
}

.metrics {
  display: flex;
  flex-wrap: wrap;
  gap: 28px;
  margin-bottom: 28px;
}

.metricLabel {
  font-size: 11px;
  letter-spacing: 2px;
  text-transform: uppercase;
  color: #4488aa;
}

.metricValue {
  font-size: 24px;
  color: #00f0ff;
  text-shadow: 0 0 10px rgba(0, 240, 255, 0.35);
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(420px, 1fr));
  gap: 20px;
}

.card {
  padding: 16px;
  background: #0d1220;
  border: 1px solid #1a1e3a;
  border-radius: 4px;
  overflow-x: auto;
}

.cardTitle {
  margin-bottom: 12px;
  font-size: 12px;
  letter-spacing: 2px;
  text-transform: uppercase;
  color: #4488aa;
}

.empty {
  padding: 80px 0;
  text-align: center;
  font-size: 14px;
  color: #4488aa;
}
```

新建 `src/training/dashboard/App.tsx`：

```tsx
import { useTrainingLog } from './useTrainingLog';
import styles from './App.module.css';

function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export default function App() {
  const { entries } = useTrainingLog();

  if (entries.length === 0) {
    return (
      <div className={styles.page}>
        <h1 className={styles.title}>Tetris AI — Training</h1>
        <p className={styles.subtitle}>public/ai/training-log.jsonl</p>
        <div className={styles.empty}>尚未开始训练 —— 运行 <code>npm run train</code> 后曲线会自动出现</div>
      </div>
    );
  }

  const latest = entries[entries.length - 1];
  const bestEver = Math.max(...entries.map((e) => e.best));
  const totalMs = entries.reduce((s, e) => s + e.elapsedMs, 0);

  const metrics: [string, string][] = [
    ['Generation', String(latest.gen)],
    ['Best lines', Math.round(bestEver).toLocaleString()],
    ['Median lines', Math.round(latest.median).toLocaleString()],
    ['Piece cap', latest.maxPieces.toLocaleString()],
    ['Elapsed', formatDuration(totalMs)],
  ];

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Tetris AI — Training</h1>
      <p className={styles.subtitle}>{entries.length} generations · live from public/ai/training-log.jsonl</p>

      <div className={styles.metrics}>
        {metrics.map(([label, value]) => (
          <div key={label}>
            <div className={styles.metricLabel}>{label}</div>
            <div className={styles.metricValue}>{value}</div>
          </div>
        ))}
      </div>

      <div className={styles.grid}>
        <div className={styles.card}>
          <div className={styles.cardTitle}>Charts</div>
          <div className={styles.empty}>图表在 Task 15 接入</div>
        </div>
      </div>
    </div>
  );
}
```

这一版刻意不 import `./charts` —— 该模块要到 Task 15 才存在，现在引用会让本任务的提交无法构建。Task 15 会把这块占位换成四张图。

新建 `src/training/dashboard/main.tsx`：

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import '../../index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 9: 运行测试与构建确认通过**

Run: `npm test -- src/training/dashboard && npm run build`
Expected: 测试全过；构建成功并在 `dist/` 下同时产出 `index.html` 与 `training.html`。本任务的提交必须是可构建的。

- [ ] **Step 10: Commit**

```bash
git add training.html vite.config.ts src/training/dashboard/
git commit -m "feat: add training dashboard shell and log polling"
```

---

## Task 15: 四张图 —— 阶段④的里程碑

**Files:**
- Create: `src/training/dashboard/charts.tsx`
- Test: `src/training/dashboard/charts.test.ts`
- Modify: `src/training/dashboard/App.tsx`（把 Task 14 留下的占位卡片换成四张图）

**Interfaces:**
- Consumes: `linearScale` / `niceTicks` / `extent`（Task 14）、`LogEntry`（Task 14）、`FEATURE_NAMES`（Task 3）
- Produces: `<FitnessChart entries>`、`<WeightEvolutionChart entries>`、`<SigmaHeatmap entries>`、`<BestWeightsChart entry>`、`sigmaColor(t: number): string`、`SERIES_COLORS: string[]`

- [ ] **Step 1: 先读配色与图表规范**

Use the `dataviz` skill. 下面代码里的配色是与游戏本体霓虹主题对齐的起点；若 skill 给出的分类色板在深色背景上区分度更好，以 skill 为准替换 `SERIES_COLORS` 与 `sigmaColor` 的色标，其余结构不变。

不引图表库是刻意的：项目运行时依赖只有 react/react-dom/zustand 三个，为四张图引入 recharts 不划算，且手写 SVG 才能和游戏的霓虹风格统一。

- [ ] **Step 2: 写会失败的测试**

新建 `src/training/dashboard/charts.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { SERIES_COLORS, sigmaColor } from './charts';
import { FEATURE_NAMES } from '../../ai/features';

describe('SERIES_COLORS', () => {
  it('has one distinct colour per feature', () => {
    expect(SERIES_COLORS).toHaveLength(FEATURE_NAMES.length);
    expect(new Set(SERIES_COLORS).size).toBe(FEATURE_NAMES.length);
  });

  it('are all valid hex colours', () => {
    for (const c of SERIES_COLORS) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe('sigmaColor', () => {
  it('returns a valid rgb string across the whole range', () => {
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      expect(sigmaColor(t)).toMatch(/^rgb\(\d{1,3}, ?\d{1,3}, ?\d{1,3}\)$/);
    }
  });

  it('clamps out-of-range input instead of producing garbage', () => {
    expect(sigmaColor(-5)).toBe(sigmaColor(0));
    expect(sigmaColor(5)).toBe(sigmaColor(1));
  });

  it('gets brighter as sigma grows', () => {
    const brightness = (c: string) =>
      c.match(/\d+/g)!.map(Number).reduce((s, x) => s + x, 0);
    expect(brightness(sigmaColor(1))).toBeGreaterThan(brightness(sigmaColor(0)));
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npm test -- src/training/dashboard/charts.test.ts`
Expected: FAIL —— `Failed to resolve import "./charts"`

- [ ] **Step 4: 实现 `src/training/dashboard/charts.tsx`**

```tsx
import { FEATURE_NAMES } from '../../ai/features';
import { linearScale, niceTicks, extent } from './scales';
import type { LogEntry } from './types';

const W = 460;
const H = 260;
const M = { top: 12, right: 12, bottom: 28, left: 52 };
const PLOT_W = W - M.left - M.right;
const PLOT_H = H - M.top - M.bottom;

const AXIS = '#1a1e3a';
const AXIS_TEXT = '#4488aa';
const BEST = '#00f0ff';
const MEDIAN = '#00ff60';
const WORST = '#ff0040';

/** One colour per feature; tuned for separation on the #0d1220 panel. */
export const SERIES_COLORS = [
  '#00f0ff', '#ff6ec7', '#f0f000', '#00ff60', '#ff8000',
  '#b000ff', '#ff0040', '#4d9fff', '#8fffd0',
];

/** Sequential ramp for the sigma heatmap: near-background at 0, hot cyan at 1. */
export function sigmaColor(t: number): string {
  const clamped = Math.min(1, Math.max(0, t));
  const stops: [number, number, number][] = [
    [13, 18, 32], [0, 60, 90], [0, 150, 170], [0, 240, 255],
  ];
  const pos = clamped * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(pos));
  const f = pos - i;
  const [r0, g0, b0] = stops[i];
  const [r1, g1, b1] = stops[i + 1];
  const mix = (a: number, b: number) => Math.round(a + (b - a) * f);
  return `rgb(${mix(r0, r1)}, ${mix(g0, g1)}, ${mix(b0, b1)})`;
}

const fmt = (v: number) =>
  Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k`
  : Math.abs(v) >= 10 ? v.toFixed(0)
  : v.toFixed(2);

function Axes({ xTicks, yTicks, x, y }: {
  xTicks: number[];
  yTicks: number[];
  x: (v: number) => number;
  y: (v: number) => number;
}) {
  return (
    <g>
      {yTicks.map((t) => (
        <g key={`y${t}`}>
          <line x1={M.left} x2={M.left + PLOT_W} y1={y(t)} y2={y(t)} stroke={AXIS} />
          <text x={M.left - 8} y={y(t) + 4} textAnchor="end" fontSize="10" fill={AXIS_TEXT}>
            {fmt(t)}
          </text>
        </g>
      ))}
      {xTicks.map((t) => (
        <text key={`x${t}`} x={x(t)} y={H - 8} textAnchor="middle" fontSize="10" fill={AXIS_TEXT}>
          {fmt(t)}
        </text>
      ))}
    </g>
  );
}

const path = (points: [number, number][]) =>
  points.map(([px, py], i) => `${i === 0 ? 'M' : 'L'}${px.toFixed(1)},${py.toFixed(1)}`).join(' ');

export function FitnessChart({ entries }: { entries: LogEntry[] }) {
  const [g0, g1] = extent(entries.map((e) => e.gen));
  const [, yMax] = extent(entries.map((e) => e.best));
  const x = linearScale(g0, g1, M.left, M.left + PLOT_W);
  const y = linearScale(0, yMax, M.top + PLOT_H, M.top);

  const band = [
    ...entries.map((e): [number, number] => [x(e.gen), y(e.best)]),
    ...entries.slice().reverse().map((e): [number, number] => [x(e.gen), y(e.worst)]),
  ];

  return (
    <svg width={W} height={H} role="img" aria-label="Fitness per generation">
      <Axes x={x} y={y} xTicks={niceTicks(g0, g1, 5)} yTicks={niceTicks(0, yMax, 5)} />
      <path d={`${path(band)} Z`} fill={BEST} fillOpacity={0.1} stroke="none" />
      <path d={path(entries.map((e) => [x(e.gen), y(e.worst)]))} fill="none" stroke={WORST} strokeWidth={1} opacity={0.7} />
      <path d={path(entries.map((e) => [x(e.gen), y(e.median)]))} fill="none" stroke={MEDIAN} strokeWidth={1.5} />
      <path d={path(entries.map((e) => [x(e.gen), y(e.best)]))} fill="none" stroke={BEST} strokeWidth={2} />
      <g fontSize="10">
        {([['best', BEST], ['median', MEDIAN], ['worst', WORST]] as const).map(([label, color], i) => (
          <text key={label} x={M.left + 6 + i * 58} y={M.top + 12} fill={color}>{label}</text>
        ))}
      </g>
    </svg>
  );
}

export function WeightEvolutionChart({ entries }: { entries: LogEntry[] }) {
  const [g0, g1] = extent(entries.map((e) => e.gen));
  const [lo, hi] = extent(entries.flatMap((e) => e.mu));
  const bound = Math.max(Math.abs(lo), Math.abs(hi), 0.1);
  const x = linearScale(g0, g1, M.left, M.left + PLOT_W);
  const y = linearScale(-bound, bound, M.top + PLOT_H, M.top);

  return (
    <svg width={W} height={H} role="img" aria-label="Weight evolution">
      <Axes x={x} y={y} xTicks={niceTicks(g0, g1, 5)} yTicks={niceTicks(-bound, bound, 5)} />
      <line x1={M.left} x2={M.left + PLOT_W} y1={y(0)} y2={y(0)} stroke={AXIS_TEXT} strokeDasharray="2 3" />
      {FEATURE_NAMES.map((name, d) => (
        <path
          key={name}
          d={path(entries.map((e) => [x(e.gen), y(e.mu[d])]))}
          fill="none"
          stroke={SERIES_COLORS[d]}
          strokeWidth={1.5}
        >
          <title>{name}</title>
        </path>
      ))}
      <g fontSize="9">
        {FEATURE_NAMES.map((name, d) => (
          <text key={name} x={M.left + 4} y={M.top + 10 + d * 11} fill={SERIES_COLORS[d]}>{name}</text>
        ))}
      </g>
    </svg>
  );
}

export function SigmaHeatmap({ entries }: { entries: LogEntry[] }) {
  const [, sMax] = extent(entries.flatMap((e) => e.sigma));
  const cellW = Math.max(1, PLOT_W / entries.length);
  const cellH = PLOT_H / FEATURE_NAMES.length;

  return (
    <svg width={W} height={H} role="img" aria-label="Sigma contraction heatmap">
      {entries.map((entry, gi) =>
        entry.sigma.map((s, d) => (
          <rect
            key={`${entry.gen}-${d}`}
            x={M.left + gi * cellW}
            y={M.top + d * cellH}
            width={Math.ceil(cellW)}
            height={Math.ceil(cellH)}
            fill={sigmaColor(sMax === 0 ? 0 : s / sMax)}
          />
        )),
      )}
      {FEATURE_NAMES.map((name, d) => (
        <text key={name} x={M.left - 6} y={M.top + d * cellH + cellH / 2 + 3}
              textAnchor="end" fontSize="8" fill={AXIS_TEXT}>
          {name.slice(0, 9)}
        </text>
      ))}
      <text x={M.left} y={H - 8} fontSize="10" fill={AXIS_TEXT}>gen {entries[0].gen}</text>
      <text x={M.left + PLOT_W} y={H - 8} textAnchor="end" fontSize="10" fill={AXIS_TEXT}>
        gen {entries[entries.length - 1].gen} · max sigma {sMax.toFixed(2)}
      </text>
    </svg>
  );
}

export function BestWeightsChart({ entry }: { entry: LogEntry }) {
  const bound = Math.max(...entry.bestWeights.map(Math.abs), 0.1);
  const x = linearScale(-bound, bound, M.left, M.left + PLOT_W);
  const barH = PLOT_H / FEATURE_NAMES.length;

  return (
    <svg width={W} height={H} role="img" aria-label="Best weights">
      <line x1={x(0)} x2={x(0)} y1={M.top} y2={M.top + PLOT_H} stroke={AXIS} />
      {FEATURE_NAMES.map((name, d) => {
        const value = entry.bestWeights[d];
        const left = Math.min(x(0), x(value));
        return (
          <g key={name}>
            <rect
              x={left}
              y={M.top + d * barH + 2}
              width={Math.abs(x(value) - x(0))}
              height={barH - 4}
              fill={SERIES_COLORS[d]}
              fillOpacity={0.75}
            />
            <text x={M.left - 6} y={M.top + d * barH + barH / 2 + 3}
                  textAnchor="end" fontSize="8" fill={AXIS_TEXT}>
              {name.slice(0, 9)}
            </text>
            <text x={value >= 0 ? x(value) + 4 : x(value) - 4}
                  y={M.top + d * barH + barH / 2 + 3}
                  textAnchor={value >= 0 ? 'start' : 'end'} fontSize="8" fill={AXIS_TEXT}>
              {value.toFixed(2)}
            </text>
          </g>
        );
      })}
      <text x={M.left} y={H - 8} fontSize="10" fill={AXIS_TEXT}>
        gen {entry.gen} · {Math.round(entry.best).toLocaleString()} lines
      </text>
    </svg>
  );
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npm test -- src/training/dashboard/charts.test.ts`
Expected: all passed

- [ ] **Step 6: 把四张图接进 `App.tsx`**

Task 14 在 `App.tsx` 里留了一张占位卡片。现在加上 import：

```tsx
import { FitnessChart, WeightEvolutionChart, SigmaHeatmap, BestWeightsChart } from './charts';
```

并把整个 `<div className={styles.grid}>…</div>` 块替换为：

```tsx
      <div className={styles.grid}>
        <div className={styles.card}>
          <div className={styles.cardTitle}>Fitness per generation</div>
          <FitnessChart entries={entries} />
        </div>
        <div className={styles.card}>
          <div className={styles.cardTitle}>Weight evolution (mu)</div>
          <WeightEvolutionChart entries={entries} />
        </div>
        <div className={styles.card}>
          <div className={styles.cardTitle}>Distribution contraction (sigma)</div>
          <SigmaHeatmap entries={entries} />
        </div>
        <div className={styles.card}>
          <div className={styles.cardTitle}>Best weights so far</div>
          <BestWeightsChart entry={entries.reduce((a, b) => (a.best >= b.best ? a : b))} />
        </div>
      </div>
```

- [ ] **Step 7: 全量检查**

Run: `npm test && npm run build`
Expected: 均通过；`dist/` 下同时产出 `index.html` 与 `training.html`

- [ ] **Step 8: 人工验证 —— 阶段④的里程碑**

先确认空状态：临时移走日志再打开面板。

```bash
mv public/ai/training-log.jsonl public/ai/training-log.jsonl.bak 2>/dev/null || true
npm run dev
```

浏览器打开 `http://localhost:5173/training.html`
Expected: 显示「尚未开始训练」，不是空白页也不是报错。

再恢复日志并同时开训练：

```bash
mv public/ai/training-log.jsonl.bak public/ai/training-log.jsonl 2>/dev/null || true
npm run train
```

Expected：
- 四张图都渲染出来，坐标轴刻度是整数
- 训练进行中，页面每秒自动追加新的一代，**无需刷新**
- σ 热力图随代数推进整体变暗（分布收敛）
- 权重演化图里 `holes`、`colTransitions` 应稳定落在 0 以下

- [ ] **Step 9: Commit**

```bash
git add src/training/dashboard/charts.tsx src/training/dashboard/charts.test.ts src/training/dashboard/App.tsx
git commit -m "feat: add hand-rolled SVG charts for the training dashboard"
```

**阶段④里程碑达成**：`training.html` 实时显示四张图。

---

## 收尾：长训练与模型提交

- [ ] **Step 1: 跑一次真正的训练**

```bash
npm run train
```

同时开着 `http://localhost:5173/training.html` 观察。跑到 fitness 曲线明显走平，或达到你愿意投入的时长为止，然后 Ctrl-C。

- [ ] **Step 2: 复评最终权重**

```bash
npm run bench -- --weights public/ai/best-weights.json --games 50 --depth 2 --max-pieces 20000
```

Expected: mean 显著高于 Task 8 记录的手调权重基线。若没有，看第 13 节的风险 1。

- [ ] **Step 3: 在网页里确认**

`npm run dev`，打开游戏页，AI 控件的权重来源切到 **trained**，开 Autoplay。Expected: 明显比 bundled 手调权重稳。

- [ ] **Step 4: 提交模型**

```bash
git add src/ai/trained-weights.json
git commit -m "chore: publish trained weights"
```

---

## Self-Review

**Spec coverage** —— 逐节对照 `2026-07-27-tetris-ai-training-design.md`：

| Spec 节 | 覆盖任务 |
|---|---|
| §4.1 `generateBag` 可注入 | Task 2 |
| §4.2 `Game.tsx` 挂载 | Task 10 |
| §4.3 新增依赖 | Task 1（vitest/@types/node/tsx） |
| §5.1 `rng.ts` | Task 2 |
| §5.2 `features.ts` 九项特征 | Task 3 |
| §5.3 `weights.ts` | Task 4 |
| §5.4 `placements.ts` BFS + 去重 | Task 5 |
| §5.5 `search.ts` 1/2 层 | Task 6 |
| §5.6 `simulate.ts` | Task 7 |
| §6.1 CEM 算法 | Task 12 |
| §6.2 适应度 + 共同随机数 + 渐进局长 | Task 13（局长判据按评审 #10 修正） |
| §6.3 并行、按局分发 | Task 11 |
| §6.4 断点续训 | Task 13 |
| §6.5 最优权重复评 | Task 13 |
| §6.6 CLI 与 `config.ts` | Task 8、11、13 |
| §7 数据格式（两份权重文件） | Task 4、13 |
| §7.2 `training-log.jsonl` | Task 13（增加 `medianPieces` 字段） |
| §7.3 `checkpoint.json` | Task 13 |
| §8.1 网页托管 + 自愈回放 + 权重加载 | Task 9、10 |
| §8.2 面板、第二入口、四张图、空状态 | Task 14、15 |
| §9 错误处理表 | worker 崩溃→Task 11；`bestPlacement` null→Task 6/7；Ctrl-C→Task 13；权重文件损坏→Task 4/10；面板读不到日志→Task 14；规划超时→Task 9 |
| §10 五类测试 | Task 3、5、7、2、4 |
| §12 四个阶段里程碑 | Task 8、10、13、15 结尾各一个 |

无遗漏。

**Type consistency** —— 跨任务引用的符号已核对一致：`FEATURE_NAMES` / `FEATURE_COUNT`（Task 3 定义，4/12/15 使用）、`Placement` / `AiMove`（Task 5 定义，6/9 使用）、`Decision`（Task 6）、`SimTask` / `SimTaskResult`（Task 11 定义，worker 与 train 共用）、`CemState`（Task 12 定义，13 使用）、`LogEntry`（Task 14 定义，15 使用）、`Weights` / `WeightsFile`（Task 4 定义，10/13 使用）。`nextMaxPieces` 的第二个参数在 Task 12 与 Task 13 中都是「中位存活方块数」。

---

## 已知风险

沿用 spec §13，并补充实施期间发现的两条：

1. **权重可能收敛到「苟活但不消行」的局部最优**（堆平不清行）。适应度已经用消行数而非分数来缓解。若仍出现：把适应度改成「每方块消行率」（`lines / pieces`），或给 `linesCleared` 一个正的先验均值而非从 0 开始。
2. **2 层前瞻在浏览器里的耗时**：实测单核约 115 步/秒，即每步约 8.7ms，远低于最快等级的 100ms 重力间隔，观感应无问题。若某些局面下变慢，Task 9 的自愈式回放会自动重规划，不会卡死；实在需要时可在控件里切到 1 ply，但要注意 §5.5 的深度—权重绑定问题（此时应另训一套 1 层权重）。
3. **差分测试的覆盖度依赖随机序列**。Task 7 的测试已把「至少发生过消行、多行同消、踢墙旋转」写成断言而非假设，避免覆盖不足被静默放过。
4. **训练时长随局长上限指数增长**：局长翻倍一次，单代耗时就翻倍。默认上限 `maxPiecesCap = 100000`，实际跑之前先用 Task 8 记下的吞吐估算，必要时调低 `population` 或 `gamesPerCandidate`。
5. **训练器会写 `src/ai/trained-weights.json`**，若此时 `npm run dev` 正开着，Vite 会热更新游戏页面。属预期行为，只是训练中途页面可能自己刷新一下。
