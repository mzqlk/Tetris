# Tetris — 项目指令

浏览器俄罗斯方块 + Node 端 CEM 训练器，共用 `src/ai/` 里的同一份纯逻辑。

## 状态不在这个文件里

已发布的是哪个模型、当前训练契约、跑过哪些实验、哪些假设已经关闭、哪些测试本来就红——
全是**活状态**，只记在 `docs/ai-training-handoff.md`。动 `src/ai/`、`training/`、
任何 checkpoint 或权重之前先读它。

读完还要**现场核实**：`git status` / `git log`、`public/ai/` 下的实际产物、运行中的进程、
trainer lock。任何文档（包括那份交接文档和本文件）里写死的哈希、代数、测试数都是快照，
不是当前事实。`public/ai/` 与 `training-archive/` 已 gitignore——git 干净不代表产物没变。

## 代码不变量

- 浏览器 AI 与训练器共用 `src/ai/`。**不要**为训练单独写第二份实现。
- `src/ai/` 里不得出现 Node API、DOM、文件系统或模块级可变状态。唯一例外是
  `src/ai/loadWeights.ts`（浏览器专用，用 `fetch`，已在 `tsconfig.train.json` 排除）。
- `FEATURE_NAMES` 的**顺序**是权重文件契约的一部分。改顺序会让所有已存权重静默失效。
- 不要原地修改棋盘行数组——引擎操作会共享行引用。
- 落点枚举必须走引擎的 `rotatePiece`（含 SRS 踢墙），不要另写一套旋转。
- `training/` 仅在 Node 下运行，可用 `node:` 导入。worker 需要它的 TypeScript loader
  配置，那不是冗余，不要清理掉。
- 权重文件解析失败是**静默**的：`parseWeightsFile` 返回 `null` 时代码直接回退到内置权重，
  界面不报错。任何涉及权重文件的验收都必须显式确认没有走回退。

## 验证命令（有坑）

`npm run build` 与 `npm run typecheck:train` 直接跑，没有陷阱。

`npm test` 在默认并发下会 OOM（`FATAL ERROR: Zone Allocation failed`）。改用：

```bash
npx vitest run --maxWorkers=4
```

约 12 分钟，60 个文件、1569 个用例。

`npm run lint`（`eslint .`）在**已有工作区**上会失败，但这不是仓库的错：`.superpowers/sdd/`
下堆着 gitignore 的 SDD 任务草稿（`.ts` / `.cjs`），而 `eslint.config.js` 没有配 `ignores`，
于是 `eslint .` 走了进去。新 clone 上没有这些文件。只想看仓库自己的代码：

```bash
npx eslint src training
```

**失败集合每轮都不一样，不要按失败数量对账。** 稳定的既有失败只有两个，都不要修；其余是满载下
撞 5 s 默认超时的 flake，单独跑那一个文件就会过。怀疑某个失败是自己改出来的，隔离重跑它，
不要数数。清单见 `docs/ai-training-handoff.md` §7。

## 需要单独授权的动作

每一项都是独立的门，**不能合并**，也不能因为拿到上一道门的授权就顺手做下一道：

- 启动训练或诊断运行（小时级 CPU）。训练由操作者执行，助手不代跑。
- 归档、删除、覆盖或移动 `public/ai/` 与 `training-archive/` 下的产物。
- 删除 trainer lock。PID 会被复用，所以**绝不自动删**；需要刷新过的 PID / 进程 / lock
  证据加上明确授权。
- 改写已发布权重（`src/ai/trained-weights.json`、`public/ai/best-weights.json`）。
- stage / commit / push。

没有 `--resume` 而输出目录非空时，训练命令会被拒绝。**不要**靠删除或移动产物绕过它。
训练可能覆盖 tracked 的 `src/ai/trained-weights.json`——每次 smoke 后检查 `git diff`，
不要无意中留下生成的模型。

## 判据

- 固定复评只是候选发布门，**不能**扩写成"已完成独立验收"。相对基线的优劣必须来自独立的
  paired benchmark（相同 seeds、depth、piece cap），不能用训练日志里的 `bestScoreRate` 代替。
- 判读训练效果看 score-rate 的分布和 sigma，不要只看某一代的 `bestScoreRate`。
- 消行数会饱和：能活到 piece cap 的候选都接近算术上限，排不出优劣。**不要**靠抬 piece cap
  "解决"饱和——这条已经栽过一次。
- 花几小时训练之前，先用一次短跑确认目标函数的行为。
- 校准（`npm run calibrate:search`）是独立的只读门，既不是训练，也不是 benchmark 或
  浏览器验收。

## 不要复活的东西

- `meanLines - heightPenalty * meanHeight`（已退役的 `lines-height-v1` 目标）。不要恢复
  它的 checkpoint，也不要把它描述成当前 fitness。
- 历史 `score-rate-v1`~`v4` 的 checkpoint 与 log 是归档产物，当前训练器既不恢复也不追加。
