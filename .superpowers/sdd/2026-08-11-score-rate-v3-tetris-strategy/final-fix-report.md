# Score-rate-v3 final fix report

- Date: 2026-08-11
- Review base: `61f27a17ee073396acdee828e89bbe4c800828eb`
- Scope: final whole-branch review 的 3 个 Important 与 2 个 Minor finding
- Status: 5 项 finding 已修复；未运行训练、benchmark、paired benchmark、真实产物 resume、发布或浏览器 runtime

## 修复结果

1. `training/runArtifacts.ts` 现在保留每条 generation 中已验证的 `mu`/`sigma`，并要求最后一条 generation 的优化器状态与 checkpoint 完全一致。`training/train.ts` 同步把更新后的 CEM 状态写入既有 generation `mu`/`sigma` 字段，使新产物能够满足同一恢复契约；未新增 schema 字段。
2. `training/cem.ts` 在任何策略诊断进入聚合、日志、checkpoint 或 candidate 之前，逐字段拒绝非有限值以及 `0..4` 之外的值。
3. README、AI 训练交接和 score-rate-v3 设计文档的 paired CLI 均加入 `--seed <independent-integer>`，并明确该 seed 不得复用训练或固定复评 seed，且在一次基线/候选配对中固定。
4. v4 preflight 不再读取已删除的 `bestEver`，改为检查 `publishedBaseline`、`bestQualifiedCandidate` 及 candidate 文件一致性。
5. dashboard parser 只接受恰好 `FEATURE_COUNT` 个有限数值的 `mu`、`sigma` 和 `bestWeights`。

## TDD 证据

### RED

- `npm test -- training/runArtifacts.test.ts`：退出 1；新增 checkpoint `mu`/`sigma` 漂移用例 2 个按预期失败，原实现没有抛错。
- `npm test -- training/cem.test.ts`：退出 1；新增 `NaN`、`Infinity`、负值和大于 4 用例 4 个按预期失败，原实现没有抛错。
- `npm test -- src/training/dashboard/useTrainingLog.test.ts`：退出 1；三类向量的错误长度、非 number、非有限数共 9 个用例按预期失败，原 parser 接受坏记录。
- 在尾状态解析修复后，`npm test -- training/train-cli.test.ts`：退出 1；“产出后可自恢复”集成用例失败，定位到 generation 写更新前状态而 checkpoint 写更新后状态。
- 首轮 `npm run typecheck:train`：退出 1；TypeScript 不对 `forEach` 回调内的可空尾状态赋值做外层控制流收窄。改为收集已验证状态并显式读取最后一项。

### GREEN

- `npm test -- training/runArtifacts.test.ts`：退出 0，61/61 通过。
- `npm test -- training/cem.test.ts`：退出 0，43/43 通过。
- `npm test -- src/training/dashboard/useTrainingLog.test.ts`：退出 0，21/21 通过。
- `npm test -- training/train-cli.test.ts`：退出 0，29 通过、2 个环境能力用例跳过。
- 最终 focused 命令 `npm test -- training/runArtifacts.test.ts training/cem.test.ts src/training/dashboard/useTrainingLog.test.ts`：退出 0，3 个文件、125/125 通过。

## 最终完整门禁

以下命令在最后一次代码调整后逐条独立运行：

- `npm test`：退出 0；26 个文件通过，456 个测试通过，2 个环境能力用例跳过。
- `npm run lint`：退出 0。
- `npm run build`：退出 0；TypeScript build 与 Vite production build 完成，71 modules transformed。
- `npm run typecheck:train`：退出 0。

## 影响文件

- `README.md`
- `docs/ai-training-handoff.md`
- `docs/superpowers/specs/2026-08-11-score-rate-v3-tetris-strategy-design.md`
- `training/runArtifacts.ts`
- `training/runArtifacts.test.ts`
- `training/cem.ts`
- `training/cem.test.ts`
- `training/train.ts`
- `src/training/dashboard/useTrainingLog.ts`
- `src/training/dashboard/useTrainingLog.test.ts`
- `.superpowers/sdd/2026-08-11-score-rate-v3-tetris-strategy/final-fix-report.md`

## 自审与边界

- checkpoint schema 仍为 version 4，generation schema 未新增字段；scalar fitness 仍严格为 `meanScore / scheduled maxPieces`。
- 三处 paired 命令均包含独立 seed 要求；历史 `bestEver` 叙述未改，只有当前 v4 preflight 字段被替换。
- `src/ai/trained-weights.json` 与 `public/ai/best-weights.json` 无 Git diff；没有 weight 或其他 `public/ai` 路径进入改动清单。
- 未创建分支/worktree，未 push，未训练，未运行 `npm run bench` 或 `npm run bench:paired`，未读取或改写真实 run artifact。
- 全量测试的 2 个跳过项是需要显式 UNC/mapped-drive 环境别名的既有能力测试；无失败项。
- 无未解决 concern。
