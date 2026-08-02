# Score-rate 固定复评可观测性设计

**日期：** 2026-08-02
**目标标识：** `score-rate-v1`

## 背景

`score-rate-v1` 已完成 gen 0–9，并在 gen 10 发布门执行了一次固定复评。checkpoint 只保留当前 `bestEver`，逐代日志只记录训练代统计，因此被拒绝候选的固定复评结果和归一化权重没有持久化。事后只能确认“没有发布”，无法从产物还原候选的实际 `meanScore`、差距、裁决原因或复评权重。

独立的 30 局 × 5000 pieces paired benchmark 已确认 post-gen-9 `mu` 没有超过当前已发布权重。下一步应先补齐复评证据链，再决定是否从 gen 10 有界续训；本设计不授权也不启动训练。

## 目标与非目标

目标：

- 每次 fixed reevaluation 都留下可独立审计、可复现 benchmark 的追加式记录；
- 明确记录当前最佳与候选的同赛程指标、权重、差值、容差、裁决和裁决原因；
- 保持现有训练面板对逐代日志的兼容；
- 不改变训练 fitness、CEM 更新、固定复评赛程或发布策略。

非目标：

- 不增加冗余的逐代 `meanScore`；它仍可由 `meanScoreRate × maxPieces` 精确还原；
- 不在本次改动中展示复评事件到训练面板；
- 不修改 benchmark CLI；
- 不回填 gen 10 已丢失的候选复评数值；
- 不训练、续训、发布、归档或修改现有 `public/ai/score-rate-v1` 产物。

## 方案比较

### 方案 A：给每代记录增加 `meanScore`

改动最小，但不能补回 fixed reevaluation 的候选指标、权重和发布原因，也不能解决当前审计缺口。不采用。

### 方案 B：新增 `reevaluation-log.jsonl`

职责清楚，但会引入第三个运行产物，并要求 fresh-run/resume 路径、归档和运维检查同步理解新文件。对当前数据量而言不划算。

### 方案 C：在现有日志追加带类型的复评事件

采用此方案。训练代记录保持原样；每次固定复评完成后，在同一个 `training-log.jsonl` 追加一条 `kind: "reevaluation"` 的事件。现有 dashboard 解析器要求逐代主指标和数组字段，因而会自然忽略复评事件，不会把它画成额外世代。

## 复评事件结构

事件使用以下稳定结构：

```ts
interface ReevaluationLogEntry {
  objective: 'score-rate-v1';
  kind: 'reevaluation';
  gen: number;
  ts: number;
  schedule: {
    games: number;
    maxPieces: number;
    depth: 1 | 2;
    baseSeed: number;
    seedStrategy: 'fixed-reevaluation-v1';
  };
  currentBest: {
    gen: number;
    weights: number[];
    meanScore: number;
    scoreRate: number;
    meanLines: number;
    meanHeight: number;
  };
  candidate: {
    gen: number;
    weights: number[];
    meanScore: number;
    scoreRate: number;
    meanLines: number;
    meanHeight: number;
  };
  comparison: {
    scoreDelta: number;
    scoreRateDelta: number;
    relativeScoreDelta: number;
    scoreTolerance: number;
    heightDelta: number;
    decision: 'publish' | 'keep-current';
    reason:
      | 'higher-score'
      | 'lower-score'
      | 'lower-height-within-score-tolerance'
      | 'height-not-lower-within-score-tolerance';
  };
}
```

`scoreDelta`、`scoreRateDelta` 和 `heightDelta` 均使用 `candidate - currentBest`。`relativeScoreDelta` 使用 `scoreDelta / max(abs(candidate.meanScore), abs(currentBest.meanScore))`；若双方均为零分，则明确记为 `0`，避免产生 `NaN`。事件保存双方的归一化权重，使未来即使 checkpoint 或已发布权重变化，历史裁决仍可复现。

第一次固定复评先用当前已发布权重建立 `currentBest`，然后与候选比较；同一条事件同时保存这两个结果。后续固定复评使用 checkpoint 中已经在同一固定赛程上评估过的 `bestEver` 作为 `currentBest`。

## 裁决接口

`training/publication.ts` 增加一个纯函数，返回发布布尔值、容差和上述原因；现有 `shouldPublishScoreReevaluation` 保留，并委托给新函数，以避免训练循环重复实现 0.1% 边界逻辑。

裁决语义保持不变：

1. 候选分数高出容差：发布，原因 `higher-score`；
2. 候选分数低出容差：保留，原因 `lower-score`；
3. 位于包含边界的容差带内且候选高度更低：发布；
4. 位于容差带内但候选高度不低：保留。

## 写入时机与兼容性

训练循环在固定复评全部完成并得到裁决后构造事件。若裁决需要发布，先沿用现有流程成功写入两份权重文件，再追加事件，最后保存 checkpoint；事件不会提前声称一次尚未完成的发布。

旧日志无需迁移。现有 gen 0–9 行保持字节不变；gen 10 缺失的复评细节不猜测、不回填。下一次获准续训并到达 gen 20 发布门时，才会自然追加第一条复评事件。

训练面板仍只返回逐代 `LogEntry`。增加一个解析测试，明确证明 `kind: "reevaluation"` 事件会被忽略，且事件前后的世代行仍按 gen 排序。

## 文件边界

- 新建 `training/reevaluationLog.ts`：事件类型与纯构造函数；
- 新建 `training/reevaluationLog.test.ts`：事件字段、差值方向、零分相对差值和权重快照测试；
- 修改 `training/publication.ts` 与 `training/publication.test.ts`：结构化裁决结果及既有布尔接口兼容；
- 修改 `training/train.ts`：固定复评完成后追加事件；
- 修改 `src/training/dashboard/useTrainingLog.test.ts` 及相关注释：锁定忽略事件的兼容行为；
- 不修改 `src/ai/`、权重文件、checkpoint schema 或 dashboard 展示组件。

## 测试与验收

实现严格按红—绿循环完成，先运行最短相关测试，再运行完整验证：

```powershell
npm test -- training/publication.test.ts training/reevaluationLog.test.ts src/training/dashboard/useTrainingLog.test.ts
npm run typecheck:train
npm test
npm run build
```

验收条件：

- 0.1% 包含边界的发布行为与当前完全一致；
- 每种裁决路径都有稳定原因；
- 复评事件包含双方权重、指标、固定赛程身份和可核验差值；
- dashboard 忽略事件且继续解析所有逐代记录；
- 完整测试、训练侧类型检查和构建通过；
- 实现和验证过程不运行 `npm run train`，不触碰现有训练产物。

## 后续授权门

本改动通过验证后仍不自动续训。下一步需重新检查进程、checkpoint、日志尾部、目标和产物，再由用户单独授权是否执行：

```powershell
npm run train -- --resume --generations 20 --workers 8 --output-dir public/ai/score-rate-v1
```

只有 gen 20 固定复评超过当前最佳后，才进入新的独立 paired benchmark；benchmark 通过后仍需单独决定是否发布。
