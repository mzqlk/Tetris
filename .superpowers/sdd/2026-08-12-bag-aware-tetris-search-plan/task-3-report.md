# Task 3 handoff report

## 接手说明

接手时真实 HEAD 为 `34e2ede6a940bbe9a53e8b35de94bedbb04905c5`。保留前代理未提交 WIP：`src/ai/search.ts`、`src/ai/search.test.ts`、`src/ai/searchCorpus.test.ts`；未执行 reset、stash、训练、benchmark 或 artifact 操作。先读取 Task 3 brief、Task 1/2 reports 和设计文档，再做受限诊断。

## 卡点根因与处理

前代理在 `vitest run src/ai/search.test.ts src/ai/searchCorpus.test.ts` 的 depth-4 运行中卡住。受限单测试复现后，根因是原 corpus 位于低堆、可达 I 块落点约 17 个，depth-4 精确 chance 展开产生真实指数分支；不是 Vitest deadlock，也不是必须降低搜索深度/机会节点。另有一个 partial-top-out fixture 实际所有未来分支都能存活，断言错误。将 corpus/fixture 收紧为高堆且 reachable placements few 的确定性棋盘，保留 full mask chance 语义和 depth-4 断言。

## RED/GREEN

- RED/诊断：`npx vitest run src/ai/searchCorpus.test.ts --testNamePattern "stable action" --pool=threads --maxWorkers=1 --minWorkers=1` 在 30 秒受限超时；原 depth-4 corpus 分支膨胀。
- 受限回归：修复后的 `npx vitest run src/ai/search.test.ts src/ai/searchCorpus.test.ts src/ai/stateTransitions.test.ts src/ai/placements.test.ts --pool=threads --maxWorkers=1 --minWorkers=1` 通过 4 files / 46 tests。
- 全量 GREEN：`npm test` 通过 29 files / 467 passed / 2 skipped（469 total）。

## 命令输出摘要

- `npx tsc -b --pretty false`：exit 0。
- `npm run lint`：exit 0。
- `npm run build`：exit 0，Vite 73 modules transformed。
- `npm run typecheck:train`：exit 0。
- `git diff --check`：exit 0。
- `git status --short -- public/ai src/ai/trained-weights.json`：空；受保护训练产物未变。
- 未运行 train/bench/paired/browser/runtime。

## 实现自审

- `SearchAction` 仅为 place/hold；Hold 独立于 placement beam。
- decision 先按 survivalProbability、再按 expectedHeuristicValue 比较；placement 按 immediate heuristic 降序、原枚举序稳定 tie-break，并分别使用 root/child beam。
- chance 节点完整枚举 `unseenBagMask`，mask=0 由公开袋逻辑恢复完整七种并等概率平均两个 value 字段。
- depth 1 不展开未知 preview；空 Hold 只对已知 promoted current 做叶评价。
- terminal spawn/no-placement 返回 survival 0；部分坏未来按概率降低 survival，不使用 `-Infinity`。
- cache key 包含 board、pose、next/hold/holdAvailable/mask、remaining depth、root/child beam；只缓存 completed nodes，单次调用局部 Map。
- 未修改 simulator/browser/training；未触碰 public/ai、weights。

## Concerns

完整固定 depth-4 在普通低堆棋盘上仍可能有很高吞吐成本；Task 3 已通过受限确定性 corpus 证明实现可行，但性能 smoke/训练吞吐和浏览器预算属于后续任务/授权门，未在本任务执行。

## 状态

READY_FOR_COMMIT

## Fix round 1 (review findings 1-3)

- HEAD review baseline re-verified: `ef9d74ff88a22ad91f279163ec06a42fbdb34ae6`.
- RED: new abort regressions (placements/chance/Hold/before-first) returned `null` against the pre-fix implementation; beam boundary test failed because no production seam existed. The new four-lock survival corpus was added with a positive survival assertion and exact rerun diagnostics.
- GREEN: abort paths now discard incomplete `NodeResult` values/actions and run an unabortable complete one-ply fallback; fallback diagnostics retain `aborted: true` and `completedDepth: 1`. `selectPlacementBeam` centralizes production sorting and root/child cutoffs (64/32) with enumeration-index tie stability.
- Depth-4 evidence: positive corpus uses a one-mask O-piece state, `completedDepth=4`, `survivalProbability=0.9999999999999997` (asserted `>0`), finite heuristic, stable place action, exact diagnostics `{expandedDecisionNodes:1000, expandedChanceNodes:102, cacheHits:48}`, and identical rerun result. Existing terminal corpus separately asserts `survivalProbability=0` with exact counts.
- Verification: focused search/transition/SRS run passed 4 files / 52 tests in 4.61s; `npm test` passed 29 files / 473 passed / 2 skipped (475 total) in 18.79s; `tsc -b`, lint, build, `typecheck:train`, and `git diff --check` passed. No train/bench/paired/runtime/public-artifact operations; protected artifact status remained empty.
- Commit SHA: pending commit below.

命令：

```powershell
git add -- src/ai/search.ts src/ai/search.test.ts src/ai/searchCorpus.test.ts
git commit -m "feat(ai): add exact bag-aware expectimax search"
```
