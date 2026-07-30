# 固定赛程得分率训练目标设计

**日期：** 2026-07-30
**目标标识：** `score-rate-v1`

## 背景与目标

当前 CEM 训练使用 `meanLines - heightPenalty * meanHeight`。在固定方块上限下，称职候选的消行数接近数学上限，无法继续区分长期得分能力。本次把训练主目标改为固定赛程得分率：

```text
fitness = meanScore / maxPieces
```

这里的 `maxPieces` 是每局预先规定的赛程上限，不是候选实际存活的方块数。提前死亡不会缩小分母，因此不能借由 `score / actualPieces` 获得虚假的高得分率。

`meanHeight` 不再进入训练 fitness，只保留为诊断指标；发布判定中，它仅在固定长局复评的分数相同或足够接近时作为次级裁决。

## 方案选择

考虑过三种产物隔离方式：

1. 只给 checkpoint 加目标标识，继续写 `public/ai/checkpoint.json` 与 `training-log.jsonl`。改动最少，但一次遗漏 `--resume` 仍可能覆盖旧产物或把日志追加到旧目标。
2. 只改用新的输出目录。默认路径安全，但把 checkpoint 复制到其他目录后，恢复时缺少目标语义校验。
3. 同时使用独立输出目录和目标标识。默认写入 `public/ai/score-rate-v1/`，checkpoint 与每条日志都携带 `score-rate-v1`，恢复时严格校验。

采用方案 3。它同时防止路径级混写与复制后误恢复，并允许用 `--output-dir` 为短跑创建一次性隔离目录。

## 训练统计与目标

`training/cem.ts` 的聚合函数继续按候选、按游戏做等权平均，返回：

- `meanScore`：候选各局 `score` 的算术平均；
- `fitness`：`meanScore / maxPieces`；
- `meanLines`、`meanPieces`、`meanHeight`：诊断数据。

`maxPieces` 必须是正数，并作为聚合函数的显式参数。每个候选共享同一分母。worker 失败结果已经给出 `score = 0`，因此失败局自然得到零分，同时保留最差高度用于诊断。

局长递增仍由精英存活方块数触发，最大上限仍为 2000；这改变不同代的赛程长度，但每一代内部的 rate 都以该代固定上限归一化，因此各代曲线可比较。

## 训练循环、日志与面板

训练目标版本常量为 `score-rate-v1`。新 checkpoint 使用新的 schema 版本并保存该目标标识、CEM 状态、当前赛程上限、配置和 score 语义的 `bestEver`。`--resume` 在创建 worker 或写文件前验证目标标识；旧 checkpoint 没有标识，或标识不同，均明确报错并退出。

默认运行目录改为：

```text
public/ai/score-rate-v1/
  checkpoint.json
  training-log.jsonl
```

CLI 增加 `--output-dir <path>`。未带 `--resume` 时，如果目标目录已经存在 checkpoint 或非空日志，训练拒绝启动，避免覆盖或追加到已有世代。带 `--resume` 时只读取所选目录，并做目标版本校验。

每代日志使用语义明确的字段：`bestScoreRate`、`meanScoreRate`、`medianScoreRate`、`worstScoreRate`、`scoreRateStd`、`medianScore`、`eliteScore`，并继续记录 lines、pieces、height、mu、sigma 和耗时。控制台主列显示 best/median score rate、elite score 和 elite height。

训练面板读取 `/ai/score-rate-v1/training-log.jsonl`，主图与摘要改称 `Score rate`，展示 `Elite score`；`Median lines`、`Median height`、`Elite height` 保留为诊断。解析器要求目标标识及新主指标字段，避免把旧目标日志解释为新曲线。

## 固定长局复评与发布

发布资格只来自固定的 `30` 局 × `5000` 方块复评。所有复评使用同一组、与代数无关的确定性种子，确保当前候选与历史 `bestEver` 在相同赛程上可比。

`bestEver` 保存 `meanScore`、`scoreRate`、`meanLines`、`meanHeight`、权重、代数和复评配置。发布顺序为：

1. 若候选 `meanScore` 比当前最佳高出近似同分区间，发布候选；
2. 若候选 `meanScore` 比当前最佳低出该区间，保留当前最佳；
3. 否则视为近似同分，只在候选 `meanHeight` 更低时发布。

近似同分区间按双方较高 `meanScore` 的 `0.1%` 计算。这样 score 始终是主目标，高度只消解一个很窄的测量差异区间。

旧 lines/height checkpoint 的 `bestEver` 不会恢复到新目标。新目标第一次达到发布复评点时，先在同一组 30 × 5000 固定赛程上重评当前已发布权重，建立 score 基准，再评估当前 CEM 均值；不能用旧 checkpoint 的 lines/height 数字作为发布门槛。只有候选通过上述比较时，才写 `public/ai/best-weights.json` 与 `src/ai/trained-weights.json`。

## Benchmark 输出

`training/bench.ts` 每局输出：

- score；
- score per scheduled piece，即 `score / maxPieces`；
- lines；
- mean height；
- survived pieces；
- 是否活到 piece cap，以及结束原因。

汇总分别给出 score、score per scheduled piece、lines、height 的均值/中位数/最小值/最大值，并报告存活到上限的局数。吞吐仍以实际模拟方块数计算，但只作为性能数据，不参与训练目标。

## 权重文件兼容性

新权重 schema 增加 `objective`、`meanScore` 和 `evalMaxPieces`。新发布文件写入实际的固定长局 `meanScore`。当前第 20 代高度目标权重保留原权重向量，并显式标为旧目标；它没有经过新复评，因此 `meanScore` 记为 `null`，不伪造基准。

`parseWeightsFile` 接受旧文件缺少这些字段的情况，并把 `meanScore` 规范化为 `null`。浏览器继续只消费权重向量，因此旧文件仍能加载；训练发布逻辑不能把 `null` 当成零分基准，而必须执行固定长局重评。

## 测试策略

所有行为变更按红—绿循环实现：

- CEM 聚合测试：校验 `meanScore`、`meanScore / maxPieces`，并证明短命候选不能用实际存活数缩小分母获胜；
- 发布测试：校验固定长局 `meanScore` 优先、超过 0.1% 时高度无权翻盘、落在 0.1% 内时较低高度胜出；
- checkpoint 测试：相同目标允许恢复，缺失或不同目标拒绝恢复；
- 权重解析测试：新 `meanScore` 正常读取，旧文件缺失字段仍兼容；
- 面板日志测试：新 score 字段被规范化，旧目标行不会混入；
- benchmark 的统计/格式逻辑提取为纯函数测试，避免通过执行耗时对局来断言字符串。

最终验证命令为：

```powershell
npm test
npm run typecheck:train
npm run build
```

这些命令不会启动训练。实现阶段也不会归档旧产物、修改现有 `public/ai/checkpoint.json` 或 `training-log.jsonl`，更不会用训练过程覆盖模型。

## 获批后的短跑方案

代码完成并通过验证后，只提供命令，不执行：

```powershell
npm run train -- --generations 2 --workers 4 --output-dir public/ai/score-rate-v1-smoke
```

该短跑不会到达第 10 代发布复评点。预计观察：best/median score rate 能随候选变化；elite score 与 elite height 同时可见；早死候选的 rate 因固定分母保持低值；checkpoint 与日志只出现在 `public/ai/score-rate-v1-smoke/`；根目录旧 checkpoint/log 以及两份已发布权重均不变。
