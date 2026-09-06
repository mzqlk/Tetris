# score-rate-v5 D2 sharded held-out listwise diagnostic design

**日期：** 2026-09-02

**设计代号：** `d2-action-conditioned-held-out-listwise-sharded-v1`

**状态：** successor design gate。本文只冻结设计。本文**不**授权 implementation plan、代码、测试/build/typecheck、任何 diagnostic/calibration/training/benchmark/publication/runtime acceptance、artifact/weight/lock 修改，也不授权 stage/commit/push/branch/worktree。

**前置终态：** D1 v1 与 D1 v2 均为终态，绝不重跑。本文不复用 D1 的 seeds、capture、streams 或 exactly-once 授权。

---

## 1. 路线裁决：为什么是 B

### 1.1 现场证据（2026-09-02T02:28:41Z 重新核验）

- HEAD `bd3afea3b49769922941b5f6036337548c6fb451`，`master`，ahead 32 / behind 0；ordinary status 66 条 WIP，staged 0。
- 无 D1/trainer Node 进程；Git/index lock 0；本仓 trainer lock `tetris-trainer-e8bd4f95b4638b0edc32e00052ac16a37dc1a82fad79721cdc7fca1f628f9dbd.lock` 不存在。TEMP 中两把 `tetris-trainer-*.lock` 的 `repositoryIdentity` 分别为 `c:/users/administrator/appdata/local/temp/tetris-task7-repo-ln7p0i/.git` 与 `…-mxlwzd/.git`，与本仓无关，未删除。
- preserved run `public/ai/score-rate-v5-smoke-20260820-200634/` 仅含 `checkpoint.json`（`93B2A63FF221B7E6EE1BD5CBFF8AE8C75B5B96411AD5B2EE4AFFA3806B6C06BD`）与 `training-log.jsonl`（`C86457320694A8C2D85C734D64D9CE6E58166D913974F945370D15FBC7C651BA`）。
- candidate 与默认 `public/ai/score-rate-v5/` 均不存在；`src/ai/trained-weights.json` 与 `public/ai/best-weights.json` 均为 `062552496E7E1101502E62B8570DFDAF2A60B54EF4FEF1EA539723B910550D90`。
- D1 v2 两份日志各 0 字节，SHA-256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`。

现场与 handoff 锚点一致，无未解释漂移。

### 1.2 失败性质的分离

D1 v2 的失败**不是**设计失败、统计失败或 representation 失败：

- corrective design 独立评审 clean；final-refit corrective 独立评审 PASS/APPROVED 0/0/0；
- parent code gate 18 文件 725/725 测试 PASS，14 文件 ESLint、78-module build、79-root safe typecheck 通过，仅余一个**已延期的非阻塞 `state-fingerprint` Minor**（pre-pool 相位当前不可达，但重复 fingerprint 仍在 pool 前 fail closed）；
- 唯一 operational 结果是 `completed no-result / runtime-aborted`：两份日志 0 字节，没有 `resultDigest`、manifest/count/digest、fit/freeze、held-out 或 replay 证据。

根因是**协议形态**：D1 把 1,026,048 个 scheduled pieces 的工作压成一次不可中断的进程，只在末尾输出一行 JSON，且 wrapper exit/duration/end/termination 未持久化。任何中断——信号、会话终止、机器休眠、OOM——都把数小时工作归零，并且**事后无法区分**是崩溃、挂起还是被杀。这是可解决的工程缺陷，不是科学结论。

### 1.3 三条路线的比较

| 判据 | A 退役 | **B 分片 D2** | C 小型 replay/corpus 代理 |
| --- | --- | --- | --- |
| 证据强度 / 外部有效性 | 无新证据；以基础设施崩溃代替裁决 | **最强**：真实 v5 轨迹、按 seed group 隔离的 held-out、预注册确定性门 | 低：人工/固定语料，无法回答 held-out 泛化问题 |
| 再次 all-or-nothing 损失 | 不适用 | **被消除**：最大损失 = 在飞 shard（`workerCount ×` 单 shard，见 §13），而非全部工作 | 低（运行短），但换来的证据不支撑裁决 |
| 确定性复现 / 证据可恢复 | 不适用 | **是**：不可变 shard manifest + 原子 receipt + resume | 是 |
| multiple comparisons / post-selection / repeated data | 不适用 | 见 §9；D1 未产生任何 outcome 观测，故 D2 是本问题的**首次** outcome 观测 | 高：B1/B1.1/B1.2 已因 corpus 搜索导致的 post-selection 被终态关闭 |
| 对 active v5 / WIP 的改动 | 零 | 零（diagnostic-only，见 §11） | 零 |
| 期望裁决价值 vs 追加工作 | 关闭但不回答；9.5k 行 WIP 无裁决 | 统计核心已建成并评审通过，增量只是持久化层 | 花真实成本买不足以支撑集成裁决的证据 |

**裁决：B。** 决定性论据是：唯一挡在项目与真实答案之间的是**证据的持久化与恢复**，这是已解决的工程问题，也是剩余增量中最小的一个；而 A 用永久的信息损失去规避一次有界的工程成本。B 在 handoff 判据表里排第一的"证据强度/外部有效性"和排第二的"再次 all-or-nothing 损失"上同时占优。

### 1.4 显式拒绝

- **拒绝重跑 D1（v1 或 v2）**：exactly-once 授权已消耗。D2 使用全新 seeds 与全新 protocol tag，不是 D1 的换名重试（见 §3、§4）。
- **拒绝无证据直接进入 production/training**：D1 未产生 representation 裁决；`FEATURE_NAMES`、schema、CEM、权重与发布物一律不动。
- **拒绝 A**：见 §1.3。若 D2 最终无法产出裁决，§10.3(c) 把退役与否交给用户决定；用户此时选择退役即等价于当初选 A，因此 B 的下行被封顶在 A，而不是无限延长研究线。
- **拒绝 C**：same-state pairwise 中 state-only 项精确抵消、challenge corpus 的 provenance/old13 alias/safety-domain 缺陷，以及"把失败转成 corpus 搜索"的 post-selection 风险，已由 B1/B1.1/B1.2 的终态规则与 D1 设计 §3.2 关闭。

---

## 2. 命题、边界与非目标

D2 检验的命题与 D1 **逐字相同**：

> 在真实 v5 决策轨迹、label-blind 的 variable-cardinality placement subsets、按 seed group 隔离的 train/validation/test split 上，显式 action-conditioned 公共特征（`action24`）能否比旧 13 维 afterstate 表达（`afterstate13`）更好地选择 survival-safe 且 score/Tetris 联合非劣的 placement。

D2 是 representation/protocol diagnostic，不是训练目标、不是 production policy。即使 D2 PASS，也只允许另写 production integration design。

**estimand 保持为**："在每个 captured subset 内、对其预注册的 `K_s` 个候选的 listwise selection 能力"，不是对 placements 加权的全局 action accuracy，也不覆盖完整 legal placement space 或 root Hold ranking。

**非目标：** 不改 active v5；不改 `FEATURE_NAMES`；不改 search/CEM/train/schema/weights/caches；不接入 browser/runtime；不修补或重标 B1/B1.1/B1.2/C0/D1；不扩大 root Hold 或 complete action universe；不增加 budget、piece cap、T4 bonus、curriculum 或 Pareto CEM。

---

## 3. 与 D1 v2 的精确差异

D2 **逐字沿用** D1 v2 corrective design（`docs/superpowers/specs/2026-08-30-score-rate-v5-d1-corrective-design.md`）与 D1 v1 design（`docs/superpowers/specs/2026-08-25-score-rate-v5-action-conditioned-held-out-listwise-design.md`）中的全部统计与语义内容：

- variable cardinality `K_s = min(12, L_s)`，`L_s >= 2`，禁止 padding/重复/替换/跳过/按 label 选择；
- source vectors `gen6-best`（normalized digest `233cc500168fe7258305d87654a640ad9aef3f67092d5e0e016f910b9d660ca9`）与 `gen10-mu`（`b669671a3cf0132db1e2948cc610aef98bf22a0284f182ac248a74fdf3234b1b`），来自同一 immutable preserved run，读取仍复用 C0 的 snapshot validator；
- capture slots `[128, 512]`（1-based scheduled piece），capture 前 gameover/error/abort 即 `invalid-input`；
- state fingerprint、canonical placement id、legal-universe digest 与 selection hash 规则（仅 protocol tag 改变，见下）；
- `afterstate13` 与 `action24` 的精确特征定义、范围与禁止泄漏项；
- label 协议：每 placement 四个 contexts = 两 continuation vectors × 两 frozen streams，128-piece scheduled 分母（提前死亡不缩小分母），256-piece 预生成 stream 与消费规则，survival-first joint front 与均匀 `q`；
- fit 协议：subset 等权 `L=(1/M)Σ_s L_s`，`N=Σ_s K_s` 行归一化，lambda grid `[0.0001, 0.001, 0.01, 0.1, 1]`，冻结的 damped Newton solver、pivot/line-search/收敛规则与全部 digest 规则；
- validation lexicographic selection 与 train+validation final refit；
- corrective design §6.1 的 Labels/Fit/Orchestrator run-bound provenance capability 与 `unconsumed -> in-flight -> materialized|failed` 状态机（在分片模型下的对应见本文 §5.3 与 §7.3）；
- 全部阈值（corrective design §6）与 status precedence（corrective design §8 / D1 design §10.4）；
- 16 个 audit-only replay contexts（test group **endpoints** `[0,11]`，即 ordinal 0 与 ordinal 11 两个 group，× 两 vector × 两 slot × 两 continuation policies = 16；canonical-first placement、stream 0）。

D2 **只**改变以下七项，全部属于执行/证据层，无一属于统计层：

| # | 改变 | 理由 |
| --- | --- | --- |
| 1 | protocol tag：`d1-placement-subset-v2-variable-cardinality` → `d2-placement-subset-v1-sharded` | 使 subset selection digest 与 D1 分离，避免任何 D1 输入被当作 D2 输入 |
| 2 | 全新 seed provenance（§4） | "fresh held-out inputs"；保证 D1 的 exactly-once seed 集合不被复用 |
| 3 | 分片执行 + 不可变 shard manifest（§5） | 消除 all-or-nothing |
| 4 | 原子 per-shard evidence receipts + durable run record（§6） | 证据可恢复；持久化 exit/duration/end/termination |
| 5 | 完成态 shard 的显式 resume 语义 + payload-blind scheduler（§7） | 中断后可续；且续跑不能窥视结果 |
| 6 | 专用 gitignored evidence 目录（§6.1）+ 专用 D2 run lock（§7.1、§7.1.1） | D1 禁止一切文件写入，与"证据必须持久"直接冲突；此处做**受限且显式**的边界放宽 |
| 7 | shard 挂起 watchdog（§6.5）与 §5.4 的互斥退出类 | D1 v2 只能证明"进程消失"，无法区分挂起；且不能让基础设施中断冒充科学裁决 |

**不变的统计协议是刻意的。** D1 v2 未产生任何 outcome 观测，因此在观测到 null 之后修改阈值、特征、lambda grid 或 cardinality 规则不但没有必要，反而会构成 protocol shopping。D2 只改执行层。

---

## 4. 全新 pre-registered 输入

### 4.1 Base seed 与派生

base seed 固定为 `20260902`。派生规则与 D1 §4.1/4.3 完全同构，仅 base 改变：

```text
train[i]      = hashSeed(20260902, 0, i), i = 0..19
validation[i] = hashSeed(20260902, 1, i), i = 0..7
test[i]       = hashSeed(20260902, 2, i), i = 0..11

labelSeed = hashSeed(
  20260902, 3,
  behaviorSeed, behaviorVectorIndex, captureSlotIndex, streamIndex
)
```

规模不变：train 20 groups / 80 subsets，validation 8 / 32，test 12 / 48，合计 40 groups / 160 subsets、320 label seeds。每 group 的四个 subsets 顺序固定为 behavior vector `[gen6-best, gen10-mu]` × capture slot `[128, 512]`。

### 4.2 预注册与不相交性（plan 的第一个任务）

implementation plan 的**第一个任务**必须在任何 capture/label 计算之前完成并冻结：

1. 计算 40 个 behavior seeds 与 320 个 label seeds 的精确值，写入源码常量；
2. 计算 `SHA-256(UTF-8 JSON.stringify({train, validation, test}))` 与 `SHA-256(UTF-8 JSON.stringify(labelSeeds))`，写入源码常量；
3. 用测试断言上述常量逐值正确；
4. 用测试断言 360 个 seeds 全体唯一，且与以下每一个历史 seed 集合**零交集**：gen 0–9 training seeds、30 个 fixed-reevaluation seeds、30 个 historical paired seeds、30 个 C0 seeds、**D1 的 40 个 behavior seeds 与 320 个 label seeds**。

**本设计不预先写出这些 digest 值。** 它们必须由实现计算并在同一任务中冻结；设计文档中臆造哈希会使 pre-registration 失效。任何 collision 或 mismatch 一律 fail closed，**不得换 base seed 补洞**——base seed 已在本设计中固定，且是在未观测任何 D2 outcome 之前固定的。

### 4.3 Post-selection 声明

- base seed `20260902` 在**任何** D2 outcome 被观测之前固定，且不依赖 D1 的任何 outcome（D1 无 outcome）；
- 若 §4.2 的不相交断言失败，唯一允许的动作是停止并回到设计裁决，不得在本轮内改 base seed 或裁剪 seed 集合；
- D2 不复用 D1 的 captures、streams、manifests 或 stdout。D1 的日志只作为历史 operational 证据。

---

## 5. Shard 模型与不可变 shard manifest

### 5.1 相位与 shard 划分

| 相位 | shard 粒度 | shard 数 | 单 shard 工作量（scheduled pieces） |
| --- | --- | ---: | ---: |
| `capture` | 一条 (split, groupOrdinal, behaviorVector) 轨迹，产出 slot 128 与 512 两个 captured state | 80 | 512 |
| `label-train` | 一个 train subset 的全部 contexts | 80 | `4 * K_s * 128`（`K_s<=12` 时 `<=6,144`） |
| `label-validation` | 一个 validation subset 的全部 contexts | 32 | `4 * K_s * 128` |
| `fit` | 一个 representation 在 train 上的五个 lambda fits | 2 | 0（纯计算） |
| `selection` | 两 representation 的 validation lexicographic 选择 | 1 | 0 |
| `final-freeze` | 两 representation 的 train+validation final refit 与 freeze record | 1 | 0 |
| `label-test` | 一个 test subset 的全部 contexts | 48 | `4 * K_s * 128` |
| `replay` | 一个 audit replay context | 16 | 128 |
| `aggregate` | 终局裁决与 canonical result | 1 | 0 |

合计 `80+80+32+2+1+1+48+16+1 = 261` 个 shards。总工作量上界与 D1 相同：`40,960 + 4*Σ_s K_s*128 + 2,048 <= 1,026,048` scheduled pieces（variable `K` 时严格不超过）。

**相位偏序**（严格，不可跳过）：
`capture` → `manifest`（纯计算，不单独成 shard，见 §5.2）→ `label-train` → `label-validation` → `fit` → `selection` → `final-freeze` → `label-test` → `replay` → `aggregate`。

严格说这是一个 DAG 而不是一条链：`label-train` 与 `label-validation` 都只依赖 `manifest`，彼此之间没有计算依赖，因此是兄弟节点，可并行调度；`fit` 只等 `label-train`，`selection` 等 `label-validation` 与 `fit`。把它们列为**两个不同相位**的唯一目的是让 §5.3/§7.2 的 payload capability 能按 split 授予，从而在结构上保持 D1 §6.1 "Fit 只能收到 authenticated train batch" 的边界。`replay` 依赖 `label-test` 的 canonical projection，故排在其后。

### 5.2 不可变 run manifest

run 启动时先构造 `run-manifest.json`，内容全部来自 §3/§4 的冻结输入，**不含任何 outcome**：

- protocol id `d2-action-conditioned-held-out-listwise-sharded-v1`、placement protocol tag `d2-placement-subset-v1-sharded`、schema version；
- runtime identity（Node `24.14.0`、V8 `13.6.233.17-node.41`、`win32-x64`）——写入 manifest 的是**冻结常量**，不是从当前进程读到的值。实际进程的 runtime identity 在 §7.1 step 0 先与该常量比对，不符即 `invalid-input/runtime-identity-mismatch`；因此运行时升级只会 fail closed，绝不会因为 digest 改变而 fork 出一个新 `runId` 和新的 episode 预算；
- source artifact hashes 与两个 vector digests；
- behavior/label seed manifests 与其 digests；
- 完整 `capture` shard id 列表（可在运行前完全确定）。

manifest **不含**任何随机值、时间戳或机器相关字段。同一协议 + 同一输入必须得到同一个 stage-1 manifest digest，因而得到同一个 `runId`；否则 resume 无法定位既有证据目录，重复运行也无法产出逐字节相同的 receipts。receipt 与 run 的绑定由 `manifestDigest` 承担，不引入 salt。

`label-*`、`fit`、`selection`、`final-freeze`、`replay`、`aggregate` 的 shard id 依赖 placement manifest（`K_s` 未知），因此 manifest 分两段冻结：

1. **stage-1 manifest**：capture 阶段之前冻结，含上表全部字段与 80 个 capture shard ids；
2. **stage-2 manifest**：全部 80 个 capture receipts 完整且校验通过后，由它们确定性推导 placement manifest（含 `L_s`/`K_s`/legal-universe digest/selected ids/histograms），随后冻结全部剩余 shard ids 与 context/task-association digests，写为独立的不可变 `run-manifest-stage2.json`。

stage-2 的推导是 capture receipts 的纯函数，因此 resume 后重算必然逐字节相同；不一致即 `invalid-input/manifest-drift`。stage-2 冻结前，`N_placements`/`N_contexts` 未定义，任何依赖它们的 shard 都不可调度。

§3 沿用的 cardinality 规则（完整 legal universe 独立枚举、`L_s >= 2`、`K_s = min(12, L_s)`、selected ids 的 hash 选择与重排）正是在 stage-2 推导中执行；任何 `L_s < 2`、fingerprint 重复、placement 无法重放或 digest/order mismatch 在此返回 `invalid-input`，早于任何 label shard 被调度。（stage-2 推导发生在全部 capture shards 之后，因此这里**不是** pool 之前；判定依据见 §5.4.3。）

两段 manifest 一旦写入即不可变。resume 时必须重新计算并与磁盘上的逐字节比较，不匹配即 fail closed，**绝不覆盖**。

### 5.3 Shard 的纯函数性

每个 shard 的输出必须是 `(不可变 manifest, shardId, 该 shard 被显式授予的 payload capability)` 的确定性纯函数。禁止依赖：wall clock、worker 数量、调度顺序、shard 完成顺序、环境变量、模块级可变状态、未冻结的 RNG。

payload capability **按 (相位, split) 授予**，不是"全部更早相位"：

| shard 相位 | 可读 payload | 明确不可读 |
| --- | --- | --- |
| `capture` | 无 | 全部 |
| `label-train` / `label-validation` / `label-test` | stage-2 manifest | 任何 label payload、任何 fit payload、**任何 model/freeze record** |
| `fit` | `label-train` 全集 | `label-validation`、`label-test` |
| `selection` | `label-validation` 全集 + `fit` 全集 | `label-test` |
| `final-freeze` | `label-train` + `label-validation` 全集 + `selection` | `label-test` |
| `replay` | stage-2 manifest + `label-test` 的 canonical projection | fit/selection/final-freeze 的可变内部量 |
| `aggregate` | `capture` + `label-train`/`label-validation`/`label-test` 全集 + `fit`/`selection`/`final-freeze` receipts（只读，用于在进程内重建 frozen final models） | 在 bundle 重建完成之前读取任何 test projection；写入或覆盖任何既有 receipt |

**`label-test` 不接收模型。** label 的产生与模型无关；把 freeze record 交给一个产生 label 的 shard，正是 D1 §6.1 要让其不可表达的耦合。`label-test` 对 `final-freeze` 的依赖是**调度前置条件**（§7.3），不是 payload 授予。

**held-out scoring 的归属明确为 `aggregate`。** 它按 D1 v1 §9.2 第 2 项完全相同的 dot recurrence 与 tie-break，用两个 frozen final models 对每个 subset 的 test features/outcomes 算出 top placement，进而算出 `survivalBelowSubsetOracle`、`subsetJointFrontHits` 与 selected 聚合量。

> **更正（2026-09-04，code gate 第 8 轮）。** 上表 `aggregate` 行与本段原先写作"不含 normalization、fitter、optimizer 或 refit 入口，**因此在结构上无法重新拟合**"。实现无法满足这个字面表述，原因出在 D1 的授权模型而非本设计的疏忽：`D1FitResult` / `D1AuthenticatedLabeledBatch` / `D1FinalModelBundle` 由 private `WeakMap` 绑定、不可序列化、每次运行一次性（§8.1、D1 §6.1），而 receipt 是惰性 JSON。因此 `aggregate`（以及 `selection`）**必须在进程内重建 fit / selection / freeze 这几环**，fitter 确实落在 `aggregate` 的作用域内。"结构上不可能"这句话不成立，予以撤回。
>
> **取而代之、被实际强制并已在 code gate 中测试的性质是：**
>
> 1. bundle **只由 `capture` + `label-train` + `label-validation` payload 重建**，且严格发生在读取任何 test projection **之前**（`rebuildFrozenBundle` 在触及 test 之前返回）；
> 2. 重建出的每一环**必须逐字节复现它自己的 receipt**，否则以 `shard-nondeterminism` fail closed（`assertRebuildMatchesReceipts`，遇到无法识别的 shard id 同样 fail closed）；
> 3. D1 的 one-shot test attempt 每次运行只能取用一次，重复取用会触发 D1 自己的 duplicate guard；
> 4. 重建对 `fit`/`selection`/`final-freeze` 的 receipt 是**只读**的：`aggregate` 不写、也无法覆盖它们（§6.2 的 write-once 语义）。
>
> 也就是说，防线从"fitter 不在作用域内"换成了"fitter 在作用域内，但它的每一个输出都被已冻结的 receipt 逐字节钉死，而且它在拿到 test 数据之前就已经交出了 bundle"。这条偏离，连同"`capture` 对全部下游相位可读"与"`selection` 可读 `label-train`"，共三条，由 `d2Scheduler.test.ts > pins the whole readable table` 固定，任何放宽都必须是显式决定而不是漂移。

这条表格是 D1 §6.1 "Fit 只能收到 authenticated train batch、test 只在 final freeze 之后 materialize 一次" 在分片模型下的精确对应，必须由同一套 private `WeakMap` capability 机制强制，而不是靠约定。

由此得到 **resume 等价性不变量**：对 shards 的任意完成分割（一次跑完、分 N 次跑完、任意顺序），最终**canonical verdict projection** 逐字节相同。这是 code gate 的强制验收项（§12.2 第 3 项）。

**该不变量的作用域必须精确。** episode 数、`terminationCause` 序列、时长与 `workerCount` 天然随完成分割而变；把它们放进被比较的投影会使不变量与其验收测试互相矛盾，并让 `resultDigest` 依赖机器和中断历史。因此结果分为两块（§10.2）：

- **canonical verdict projection** —— partition-invariant，`resultDigest` 只覆盖它，§12.2 第 3 项只比较它；
- **`runProvenance`** —— 非 canonical，含 episode 数、`terminationCause` 序列、各 episode 时长与 `workerCount`；**不进入 `resultDigest`，不参与字节同一性比较**。

§6.5 的 wall-clock 上限同样不破坏该不变量：超时只能**阻止**一个 shard 完成，永远不能改变一个已完成 shard 的 receipt。完成的 shard 集合可以因机器而异，但每个 receipt 与最终 canonical verdict projection 都只是完整 shard 集合的确定性函数。

### 5.4 Shard 失败语义与互斥退出类

一个 shard 要么写出**完整且合法**的 receipt，要么什么都不写。**不存在失败 receipt。**

设计区分**七个互斥的退出类**（§5.4.0）。混淆它们是 D1 v2 之外最危险的失败模式：一次基础设施打嗝会被读成关闭假设的科学裁决。

#### 5.4.0 退出类总表

| 类 | 写 `result.json`？ | 进入 §10.1 precedence？ | 后续处置 |
| --- | --- | --- | --- |
| **(0) 前置否决** —— 仅 `runtime-identity-mismatch` | 否（尚无目录/`runId`） | 是，`invalid-input` | 修正运行时后重跑；不消耗任何预算 |
| **(1) `episode-incomplete`** —— 非裁决 | 否 | 否 | resume（§7.4 预算内）；若同一 shard 同一 reason 连续第二次失败，则按 §5.4.5(b) 提升为 `runtime-fail` run verdict |
| **(2) 输入可行性否决** | 是 | 是，`invalid-input` | 独立 corrective design gate（§10.3(b)） |
| **(3) 证据完整性否决** —— `manifest-drift`/`receipt-corrupt`/`receipt-regression` | 是 | 是，`invalid-input` | 仅"操作员授权丢弃证据目录 + 新的运行授权"（§10.3(d)） |
| **(4) 首次即终局的 `runtime-fail`** —— `test-before-freeze`、`evidence-dir-out-of-bounds` | 是 | 是，`runtime-fail` | correctness design/fix gate（D1 v1 §10.4），见 §5.4.5 |
| **(5) `aggregate` 裁决** | 是 | 是（`pass-…` / 两个统计 FAIL） | 统计 FAIL 关闭假设（§10.3(a)） |
| **(6) 最后手段** —— 连结构化投影都无法安全形成 | 否 | 否 | stdout 为空、stderr 只给 redacted error；按 (1) 处理，可 resume |

#### 5.4.1 `episode-incomplete`（非裁决）

适用于**一切让 run 仍然可续**的情形：进程被杀、机器休眠、瞬时 worker 崩溃、§6.5 的 shard 超时、`run-locked`、`trainer-lock-present`、预算耗尽。

**SIGKILL / 断电 / 宿主强杀是这一类中唯一不输出投影的子情形**：§6.4 已确认它们不执行任何 handler，因此既写不出 stdout 行也写不出 `episode-end`。这类 episode 由**下一次启动**从"有 `episode-start` 而无 `episode-end`"推断，并追加 `episode-abandoned`（§6.4）。其余情形按下列输出投影：

- stdout 输出一行 canonical JSON，`kind` 固定为 `episode-incomplete`，含 episode ordinal、已完成 shard 数、剩余 shard 数、`terminationCause` 与 canonical reason；
- **绝不写 `result.json`**；
- **不是** `invalid-input`、`runtime-fail` 或任何统计状态；它不进入 §10.1 的 precedence，也不触发 §10.3 的假设关闭；
- exit code 非零，但语义是"本 episode 未完成"，不是"本 run 有答案了"。

#### 5.4.2 前置否决：`runtime-identity-mismatch`

§7.1 step 0 的 identity 检查发生在任何 `runId` 推导之前，因此此时**不存在** `diagnostics/<runId>/`，也就无处写 `result.json`。它是**仅 stdout** 的终局 `invalid-input`：一行 canonical JSON，不创建任何目录、不写任何文件、不消耗任何预算。修正运行时后可重新发起同一次授权运行。

#### 5.4.3 输入可行性否决（写 `result.json`）

定义为：**由冻结输入决定、每次 resume 必以同一 canonical reason 复现**的 `invalid-input`。成员：seed collision、capture 在 slot 前 gameover、`L_s < 2`、fingerprint 重复、placement 无法重放、digest/order mismatch。

seed collision 在 §4.2 是 plan 第一个任务的测试断言，同时**必须在每次 stage-1 manifest 构造时重新执行**（唯一性与六集合零交集），否则它不可能在运行期被检出；两处使用同一份断言实现。

这些之中有几项**必然在 capture shard 执行中或 stage-2 推导时才被检出**（即 worker pool 之后）；判定依据是"由冻结输入决定且必然复现"，**不是**"在 pool 之前"。这一点必须精确，否则 D1 v1 的终局阻塞（`L_s < 2`）会被错分成 `episode-incomplete`，一路循环到预算耗尽，而不是 fail closed 给出裁决——那正是 D1 v1 唯一做对的地方的倒退。

#### 5.4.4 证据完整性否决（写 `result.json`）

成员：`manifest-drift`、`receipt-corrupt`、`receipt-regression`。

它们**不是**由冻结输入决定的，而是证据目录状态的属性；把它们塞进 §5.4.3 是范畴错误。它们对该证据目录是终局的，但**既不是 representation 裁决，也不是输入不可行结论**。唯一处置见 §10.3(d)：操作员授权整体丢弃证据目录 + 一次新的运行授权。

#### 5.4.5 `runtime-fail`：首次即终局 vs. 两次确认

两类 `runtime-fail` 必须分开。

**(a) 首次即终局。** `test-before-freeze` 与 `evidence-dir-out-of-bounds` 在**第一次检出**即写 `result.json`，canonical status `runtime-fail`。二者都是硬不变量的破坏——一个是 selection-leakage 触线（§7.3 的调度违规），一个是写入沙箱越界（§8）——都是逻辑缺陷，不是抖动。对它们套用"再试一次确认"意味着**重新尝试一次越界写入或一次 freeze 前触碰 test**，这是两条规则里唯一会主动制造危害的地方。它们也不属于 §5.4.4：证据目录本身没有损坏，丢弃目录重跑只会原样复现，唯一正确的处置是 D1 v1 §10.4 的 correctness design/fix gate。

**(b) 两次确认后提升。** 其余 `runtime-fail` 类（solver 不收敛、replay mismatch、non-finite、`shard-timeout`、`no-progress-timeout`、`shard-nondeterminism`、`resume-equivalence-violation`）先按 §5.4.1 结束本 episode；**当同一 shard 以同一 canonical reason 连续失败两次**时提升为 run 级 `runtime-fail` 并写 `result.json`。不必等到预算耗尽——§5.4.8 的纯函数性保证第二次已足以确认其确定性。

**"连续"的判定必须可跨进程。** §5.4.1 在任何 shard 失败时结束 episode，因此两次尝试必然跨两个进程；而失败不写 receipt，唯一的持久载体是 `run-record.jsonl`。因此 §6.4 的 `episode-end` **必须**额外记录 `failedShardId` 与 `failureReason`，判定规则精确为：

> 最近一条携带失败的 `episode-end` 的 `failedShardId` 与 `failureReason`，与本次失败完全相同。

期间有其他 shard 完成不影响该判定（比较的是"最近一次失败"，不是"最近一次 episode"）。若不落盘这两个字段，本规则不可实现，`runtime-fail` 就只剩烧完 barren 预算一条路。

#### 5.4.6 `aggregate` 裁决

`aggregate` 的完整裁决产出 `pass-…` 或两个统计 FAIL 之一。

run 级 `runtime-fail`（无论 (a) 还是 (b)）一律按 D1 v1 §10.4 处置：只允许 correctness design/fix gate，不得改冻结 source vectors、seeds、capture points、placement selection、horizon、features 或 thresholds。

#### 5.4.7 `result.json` 是 write-once

- §7.1 step 1（在 lock 裁决**之前**，因为它只读）检查：若 `result.json` 已存在，则本 run 已有答案。此时**不 resume、不调度、不取 lock、不写 run record、不覆盖**，原样重新输出该文件内容到 stdout，并按**从 canonical status 确定性派生**的 exit code 退出（`pass-…` → `0`，其余全部状态 → `1`）。exit code 不是 result 的字段，因此重放不可能与首次不一致；
- `result.json` 的写入路径只有 §5.4.3、§5.4.4、§5.4.5、§5.4.6 四类；
- §6.2 的 rename 写入在这里被显式限制为"仅当目标不存在"，绝不允许后续 episode 用一个失败投影覆盖已完成的裁决。

#### 5.4.8 确定性失败不会被 resume 洗白

因为 shard 是纯函数（§5.3），**确定性失败在每次 resume 都会原样复现**。resume 只能救回**基础设施性**中断已完成的部分工作，不能把一个必然失败的 shard 试成功，也不能把 FAIL 试成 PASS。这正是 resume 与"重试直到通过"的分界线。

---

## 6. 原子 receipt 与 durable run record

### 6.1 Evidence 目录

```text
diagnostics/<runId>/
  run.lock
  run-manifest.json
  run-manifest-stage2.json
  run-record.jsonl
  receipts/<phase>/<shardId>.json
  result.json
```

`runId` = `d2-` 加 stage-1 manifest digest 的前 16 个十六进制字符。目录不存在则新建 run；存在则按 §7 resume。D2 **只**写这个目录，绝不写 `public/ai/`、`training-archive/`、tracked 路径、TEMP 或任何 checkpoint/log/candidate/weight 文件。

`diagnostics/` 必须加入 `.gitignore`（tracked 的单块追加，留到 code gate 执行，本设计不修改任何文件）。

**这是相对 D1 的显式边界放宽。** D1 禁止一切文件写入，与"证据必须在进程死亡后仍然存在"直接冲突；D2 把写入范围收紧到单一 gitignored、run-scoped 目录，并由 code gate 断言无越界写入。

### 6.2 原子写

适用对象：全部 **receipt 文件**、两份 **manifest 文件**与 `result.json`。**不适用于** `run-record.jsonl`（见 §6.4，它是追加流，rename 无法在既有文件末尾追加一行）。

固定序列：写入同目录临时文件 → `fsync` 文件 → `rename` 到最终路径。`rename` 在同一目录内是原子替换，因此不存在部分写入的 receipt：要么是完整合法 receipt，要么根本不存在。残留临时文件不是 receipt，resume 时忽略并可清理。`result.json` 额外受 §5.4.7 的 write-once 约束：仅当目标不存在时才写。

**不做父目录 `fsync`。** 冻结的 `win32-x64` 运行时上 Node 无法为目录取得可 `fsync` 的句柄；把不可实现的步骤写进协议只会制造假保证。

**保证的精确范围：** 本机制保证的是**进程死亡**（信号、崩溃、被杀）下不出现部分写入的 receipt。**断电与文件系统层面的撕裂不在保证范围内**——这与 §6.4 对 SIGKILL 的诚实口径一致。若断电确实造成 `receipt-corrupt` 或 `manifest-drift`，按 §5.4.4 归入证据完整性否决，处置唯一地由 §10.3(d) 规定；协议不提供也不假装提供更强的保证。

### 6.3 Receipt 内容

每个 receipt 是一行 canonical JSON（与 D1 相同的序列化规则：UTF-8、无空白、固定 key 顺序、`-0` 先规范化为 `0`、禁止 `undefined`/NaN/Infinity），至少含：

- `protocolId`、`schemaVersion`、`shardId`、`phase`；
- `manifestDigest`（stage-1；stage-2 相位另含 `stage2Digest`）；
- `payload`：该 shard 的确定性输出投影；
- `payloadDigest`：`SHA-256` over canonical `payload`；
- `receiptDigest`：`SHA-256` over 除 `receiptDigest` 外的全部字段。

receipt **不含**：路径、seed 明文之外的 secret、hidden bag order、RNG state、wall-clock 时长或任何机器相关信息。计时信息只进 run record，不进 receipt——否则 receipt 就不再是纯函数输出，resume 等价性会被破坏。

### 6.4 Durable run record

`run-record.jsonl` 是**只追加流**：`O_APPEND` 打开，每行 canonical JSON，写完即 `fsync` 文件本身。它**不走** §6.2 的 rename 协议。读取时若最后一行不是合法 canonical JSON（进程在写行途中死亡），则**丢弃该行**，以其之前最后一条合法行为准；**绝不重写该文件**。

- `episode-start`：`episodeOrdinal`、UTC ISO-8601 `startedAt`、`pid`、`ppid`、runtime identity、`workerCount`、`manifestDigest`、进入时已完成的 shard 数；
- `heartbeat`：每 30 秒一条，含单调 elapsed ms 与当前已完成 shard 数；
- `episode-end`：`endedAt`、`durationMs`、`exitCode`、`terminationCause ∈ {completed, episode-incomplete, shard-timeout, no-progress-timeout, signal:SIGINT, signal:SIGTERM, uncaught-exception, unhandled-rejection, invalid-input, runtime-fail, resume-budget-exhausted, barren-episode-budget-exhausted}`、退出时已完成的 shard 数，以及——当本 episode 因某个 shard 失败而结束时——`failedShardId` 与 `failureReason`。

`failedShardId` / `failureReason` 是 §5.4.5(b) 两次确认规则的**唯一**持久载体（失败不写 receipt），缺了它们该规则不可实现。非 shard 失败结束的 episode 两字段为 `null`。

写入方式：`try/finally` + `process.on('SIGINT'|'SIGTERM')` + `process.on('uncaughtException'|'unhandledRejection')` + `process.on('exit')`（仅同步 I/O）。**由 diagnostic 进程自己写，不依赖外部 wrapper**——D1 v2 恰恰因为依赖 wrapper 而丢失了全部完成元数据。

若某个 `episode-start` 没有配对的 `episode-end`，下一 episode 启动时必须先追加一条 `episode-abandoned`，记录该 episode 的 ordinal、最后一次 heartbeat 的时间与完成数。

**诚实的限制：** SIGKILL、断电或宿主会话强杀无法执行任何 handler。heartbeat + `episode-abandoned` 只能把未知窗口收敛到最后一次 heartbeat 之后的 ≤30 秒，并证明进程是"在推进中消失"而非挂起；它不能给出精确的终止原因。这是本设计能达到的上界，必须如实报告，不得表述为"总能恢复终止原因"。

### 6.5 挂起检测（watchdog）

§1.2 把"事后无法区分崩溃、挂起还是被杀"列为 D1 v2 的根因。信号 handler、heartbeat 与 `episode-abandoned` 解决了崩溃与被杀，**挂起必须单独解决**——否则一次确定性挂起会在每个 episode 原样复现、heartbeat 一直报告"存活"，最终耗尽预算并在零科学证据下退役研究线。

因此预注册两条 wall-clock 上限：

- **per-shard ceiling**：单个 shard 从派发到完成的墙钟上限。由 §13 的锚点保守推导：`ceiling = 20 × (该 shard 的 scheduled pieces) × 150 ms`，下限 300 秒。20 倍余量吸收机器差异与存活率差异。
- **run-level no-progress ceiling**：触发条件是"连续 `30` 分钟没有任何新 shard 完成"**且**"当前全部在飞 shard 都已超出各自的 per-shard ceiling"。两个条件必须**同时**成立。在飞集合为空时第二个条件按空集为真处理——这正是调度器本身卡死（没有任何 shard 在跑也没有任何 shard 完成）的情形，必须能被这条上限捕获。

第二个条件不可省略。按 §13 的锚点，一个 `K_s=12` 的 label shard 名义耗时已约 `6,144 × 150 ms ≈ 15.4` 分钟，而 §13 也承认 label 的每 piece 成本不必等于 capture 的；在 label 相位尾部或任何比锚点慢的机器上，一个完全健康、仍在自己 ceiling 之内的 shard 会撞上裸的 30 分钟线，于是在 run 已完成 99% 时每个 episode 都被误杀。加上第二个条件后，run-level 上限只在"没有任何 shard 还有合法理由在跑"时才触发，per-shard ceiling 也不再是最大 shard 类的死代码。

任一上限触发：中止该 shard、按 §5.4.1 结束本 episode，`terminationCause` 为 `shard-timeout` 或 `no-progress-timeout`。二者是**非裁决**的 `episode-incomplete` reason，不带 canonical status；只有当同一 shard 连续两次以同一 timeout reason 失败时，才按 §5.4.5 提升为 run 级 `runtime-fail`。

**这两条上限不引入非确定性。** 它们只能阻止一个 shard 完成，永不改写已完成 shard 的 receipt（§5.3）。它们也不是"跑不完就算失败"的隐蔽降级：超时产生的是 §5.4.1 的非裁决 `episode-incomplete`，不是 run verdict。

---

## 7. Resume 语义与 payload-blind scheduler

### 7.1 启动流程

0. **先**比对进程实际 runtime identity 与 §5.2 的冻结常量；不符即 `invalid-input/runtime-identity-mismatch`。这一步必须早于任何 digest 或 `runId` 的推导，否则运行时升级会 fork 出新目录、新预算，形成 fail-open。
1. 若 `diagnostics/<runId>/result.json` 已存在：本 run 已有裁决。按 §5.4.7 原样重新输出（以 §5.4.7 从 canonical status 派生的 exit code 退出），不取 lock、不 resume、不调度、不写 run record、不覆盖。**该检查只读，必须排在 lock 裁决之前**，否则 §7.1.1 会向一个已完结的 run 追加 `episode-abandoned` 并接管它的 lock。
2. 取 `diagnostics/<runId>/run.lock`（`wx` 创建，内容为 `{ownerNonce, pid, startedAt, episodeOrdinal}`）。已存在则按 §7.1.1 的 lock 裁决处理；**绝不无条件自动删除**。
3. 若本仓 exact trainer lock 存在，则 `episode-incomplete/trainer-lock-present`（非裁决——训练器随时可能结束，本 run 仍可续）。D2 自身**不创建、不获取** trainer lock，也绝不删除它。
4. 重新计算 stage-1 manifest。目录存在时：
   - 磁盘上有 `run-manifest.json` → 逐字节比较，不符即 `invalid-input/manifest-drift`；
   - 磁盘上无 `run-manifest.json` 但已有 receipts → `invalid-input/manifest-drift`（证据孤立，不可重建）；
   - 目录或 manifest 缺失且无 receipts → 按新 run 写入（§6.2）。
   `run-manifest-stage2.json` 缺失时**允许重算并写入**，因为它是 capture receipts 的纯函数（§5.2）；存在时逐字节比较。
5. 枚举 `receipts/`；对每个 receipt 校验 schema、`shardId ∈ manifest`、`manifestDigest`、`payloadDigest`、`receiptDigest`。任一失败 → `invalid-input/receipt-corrupt`，整 run fail closed。
   - **不得重算校验失败的 receipt。** §6.2 的原子写使部分写入（在进程死亡下）不可能，因此校验失败意味着真实损坏或篡改；重算等价于选择性重算，会打开结果筛选的口子。
6. 完成数回退检查：取上一 episode 的完成数，字段优先级为 `episode-end` 的退出完成数，其次最后一条 `heartbeat` 的完成数，二者皆无则视为 0。若本次枚举到的已完成 shard 数**低于**该值，则 `invalid-input/receipt-regression`。
7. 追加 `episode-start`，进入调度。

#### 7.1.1 Lock 裁决

§6.4 已承认 SIGKILL 不执行任何 handler，因此**被强杀的 episode 必然留下 `run.lock`**——这恰恰是最常见的 resume 场景。若此时无条件要求另开一个用户授权门，D2 赖以存在的恢复路径就不可达。

因此 `run.lock` 存在时按以下**预注册**证据清单判定（§12.3 一并授权）：

- lock 中的 `pid` 当前不存在，**或**存在但不是 D2 进程（命令行/启动时间不匹配）；
- 无任何 D2 Node 进程在运行；
- lock 的 `episodeOrdinal` 对应一条有 `episode-start` 而无 `episode-end` 的记录。

三条**全部**成立 → 判定为死锁，追加 `episode-abandoned`，接管该 lock 并继续。任一条不成立 → `episode-incomplete/run-locked`（非裁决，§5.4.1），停止并请操作员裁决。清单本身不得放宽，也不得跳过任何一条。

### 7.2 Payload-blind scheduler

调度器的类型签名严格为：

```text
schedule(manifest, completedShardIds: ReadonlySet<ShardId>) -> readonly ShardId[]
```

它**永远收不到 outcome payload**。receipt payload 只能经由 §5.3 表格中按 (相位, split) 门控的 capability 取得，该 capability 只授予 shard 计算，不授予 scheduler。因此：

- 是否继续、调度哪些 shard、是否停止——全部只是 `{manifest, 已完成 shard id 集合}` 的函数；
- 没有任何控制流依赖于 outcome 值；
- "看到部分结果后决定是否继续"在结构上不可表达，而不仅仅是约定上被禁止。

**一处需要精确说明的地方：** scheduler 消费的 stage-2 manifest 本身是由 capture payloads 推导的（§5.2）。blinding 仍然成立，理由有两条且都必须在 code gate 中断言：capture payload 只含被捕获局面自身的公开 state/placement 结构，**不含任何 label、listwise/survival/Tetris outcome、model score 或 freeze record**；且 shard id 按 subset 编制，与 `K_s` 无关，因此**被调度的 shard 集合对任何 outcome 取值都完全相同**。scheduler 看到的是"有多少个 subset"，永远不是"它们表现如何"。

> **更正（2026-09-04，code gate 第 8 轮）。** 本段与 §12.2 第 8 项原先写作"不含任何 label、**score**、survival、Tetris 或 model outcome"。就 `score` 而言这是错的：`D1CapturedState` 携带被捕获局面自身的 `score`/`lines`/`level`，而 `stateFingerprint` 正是对它们连同 board 一起取的摘要（`training/d1ActionConditionedHeldOutListwiseCore.ts`），因此局面 score 是 **subset 身份的组成部分**——是冻结输入，不是本诊断的测量产物。要断言、且实际被断言的性质是"payload 不含 **D2 自身的 outcome**"；写成"不含 score"既与 §5.2 的 subset 身份自相矛盾，也是一条永远无法通过的验收条件。blinding 的论证不依赖被删掉的那个词：无论局面 score 取何值，被调度的 shard id 集合都逐字节相同。

这必须由能力边界（沿用 D1 §6.1 的 private `WeakMap` 模式）强制，并由 code gate 用"payload 无法到达 scheduler"与"改变 payload 值不改变调度序列"两个测试证明。

### 7.3 Freeze 边界在 resume 下的保持

- 任何 `label-test` shard 只有在 `final-freeze` receipt 存在且校验通过时才可调度；
- 若存在任一 `label-test` receipt 而 `final-freeze` receipt 缺失或校验失败 → `runtime-fail/test-before-freeze`；
- 若存在任一 `label-test` receipt，则 `fit`/`selection`/`final-freeze` receipts 一律不可再被调度或写入；试图调度即 `runtime-fail/test-before-freeze`；
- D1 §6.1 的 Labels/Fit 一次性 attestation 状态机在**每个 episode 内**重建，其权威来源是磁盘上的 receipts，而不是跨 episode 的内存状态。

### 7.4 Resume 预算

预注册 `maxProductiveEpisodes = 5`。**预算只对"有产出的 episode"计数**：一个 episode 只有在至少完成 1 个**新** shard 时才消耗预算。零产出的 episode（启动即 OOM、worker 配置错误、`run-locked` 后停止、环境打嗝）记入 run record 但**不消耗预算**——否则一个纯粹的基础设施频率问题就能决定一条研究线的科学结局。

零产出 episode 另设独立上限 `maxBarrenEpisodes = 10`，用于防止无限循环；触发后同样只产生 §5.4.1 的 `episode-incomplete`，并交 §10.3 的操作员裁决。

`maxProductiveEpisodes` 耗尽且仍有未完成 shard → `episode-incomplete/resume-budget-exhausted`，进入 §10.3 的**操作员裁决**，而不是自动关闭假设。

**诚实的定位：** 该预算**不是**统计保护。由于 shards 不可重算且 scheduler payload-blind，重试在数学上无法改变结果。它是运行层的断路器，用来给 route B 的下行风险封顶。

### 7.5 篡改边界

任何本地协议都无法阻止操作员删除证据目录中的文件。D2 的目标是**可检测**而非**不可能**：`run-record.jsonl` 的单调完成计数（§7.1 第 6 步）、`manifestDigest` 绑定、receipt 自摘要与不可变 manifest 共同使删除/替换在下一 episode 被检出并使整 run 失效。

**检测能力的精确边界：** 回退检查的基准来自上一条 `episode-end`，或（强杀时）最后一条 `heartbeat`。因此删除**最后一次 heartbeat 之后、进程死亡之前**那 ≤30 秒内完成的 receipts 是检测不到的（基准本身没记到它们）。这是 §6.4 heartbeat 间隔的直接推论，必须如实陈述，不得表述为"任何删除都会被发现"。

注意 shard 的纯函数性（§5.3）本身就限制了替换攻击的收益：用**同一** manifest 下另一次运行的 receipt 替换本次 receipt 不改变任何结果（二者逐字节相同）；用**不同** manifest 下的 receipt 替换会被 `manifestDigest` 校验拒绝。剩余的真实风险只有"删除后重算以更换结果"，而重算同样受纯函数性约束，无法产生不同结果。这是操作员诚信边界，不是密码学保证，必须如实陈述。

---

## 8. 运行边界

- **只写** `diagnostics/<runId>/`；不写 repository tracked 路径、`public/ai/`、`training-archive/`、TEMP、checkpoint/log/candidate/weight。
- 不创建或获取 repository trainer lock，也绝不删除它；本仓 trainer lock 存在时返回非裁决的 `episode-incomplete/trainer-lock-present`（§7.1 step 3）并停止本 episode。
- 受保护 probe（`training/searchProbe.ts`、`training/searchProbeWorker.ts`、`training/searchProbe.test.ts`）永远不进入任何命令、测试、typecheck、diff 或 review 范围；只允许在 ordinary `git status` 中出现路径名。
- 全部 A+/B1/C0/D1 WIP 与 overlapping `package.json` 予以保留；禁止 broad add、stash、reset、restore、checkout、clean。
- stdout 在产生 run verdict 时恰好一行 canonical JSON，与 `result.json` 逐字节相同，stderr 为空；`episode-incomplete`（§5.4.1）同样是 stdout 一行 canonical JSON，但**不写** `result.json`。无法安全形成结构化投影时 stdout 为空、stderr 只给 redacted error。

### 8.1 D1 模块的复用方式（明确裁决）

§4 要求新的 protocol id、subset tag、base seed 与 seed manifest，而这些在现有 D1 v2 WIP 中是硬编码的模块常量（`training/d1ActionConditionedHeldOutListwiseCore.ts` 的 `D1_PROTOCOL_ID`/`D1_PLACEMENT_SUBSET_TAG`、字面量 behavior seed 数组、base seed `20260825`，以及 `…Labels.ts` 中的同名常量；`historicalSeeds()` 还需增加 D1 的两个 seed 集合以满足 §4.2 的六集合不相交）。因此必须显式裁决，不能两条规则并列。

**裁决：就地参数化（parameterize-in-place），不 fork 第二份实现。**

- 把 protocol id、placement subset tag、base seed、seed manifest 与 `historicalSeeds()` 的集合列表提升为**注入常量**（依赖注入或显式参数），D1 与 D2 各自传入自己的一组；
- **"WIP 原样保留"的准确含义**是：不得 stash/reset/restore/checkout/clean，不得丢弃这些文件，不得改变其在 D1 tag 下的行为——**不是**不得编辑。参数化是允许的编辑；
- 为兜住"行为不得改变"，code gate 必须包含一项 **D1-tag 字节同一性 parity 测试**：在注入 D1 常量时，manifest/selection/context digests 与参数化之前逐字节相同。基线来源必须明确——§8 禁止运行 D1，因此 golden digests 只能**在做参数化编辑之前**从现有 D1 测试 fixtures 中取出并钉成常量，之后不得再生成；
- 禁止另建第二份 training-only 实现（AGENTS.md 的既有约束）。

---

## 9. 泄漏、multiplicity 与有效性

- **repeated data：** D2 使用全新 seeds，与全部历史 seed 集合零交集（§4.2）。D1 v1/v2 未产生任何 outcome 观测，因此 D2 是本命题上的首次 outcome 观测，不存在 alpha 消耗。
- **对 D1 v1 的响应：** D1 v1 暴露的是 *input feasibility*（9 < 12 legal placements），不是 outcome。据此制定的 variable-cardinality 规则不构成 outcome-driven 的 post-selection；该规则在本设计中原样冻结，不再调整。
- **selection leakage：** §7.3 的 freeze 边界在 resume 下逐条保持；test labels 只在两个 final models 冻结后 materialize 一次。
- **multiplicity：** 两 representation × 五 lambda 只经 train/validation 的固定流程；test 一次性评估。阈值不因分片、cardinality 或失败结果放宽或重算。本门是预注册的确定性 acceptance gate，不宣称 p-value 或随机置信区间；若未来要加显著性声明，必须另设计并预注册 multiplicity 控制。
- **estimand 限制：** subset 内 selection，不覆盖完整 legal placement space、root Hold ranking、production search、CEM training、5000-piece fixed reevaluation、paired benchmark 或 publication。
- **K 分层：** 仍按 `K=2..12` 分层报告 hit/survival/front delta；任何层样本不足**不允许**事后合并或删除。

---

## 10. 裁决、失败分类与退役触发

### 10.1 Status precedence

与 D1 逐字相同：

```text
invalid-input -> runtime-fail -> fail-joint-selection-not-shown
             -> fail-representation-gain-not-held-out
             -> pass-action-conditioned-listwise-supported
```

两个 fail 状态的定义与 `invalid-input`/`runtime-fail` 的相位归属沿用 D1 design §10.2–§10.4 与 corrective design §8。

**`pass-…` 的十项条件沿用 D1 design §10.1，但条件 1 必须按 corrective design §4/§5 与本设计重述。** D1 design §10.1 条件 1 的原文要求"160 subsets、每 subset **12** placements、全部 **7,680** contexts"；corrective design §4/§5 已经把它替换为 manifest 推导的总数（"`N_placements=1920` 或 `N_contexts=7680` 不再是有效性条件"）。逐字照抄 D1 条件 1 会在第一个 `L_s<12` 的 state 上重现 D1 v1 的终局 `invalid-input`，烧掉整次授权运行。D2 的条件 1 精确为：

> provenance 有效；40 seed groups、每 group 四个 subset、共 160 subsets；每 subset `2 <= K_s <= 12` 且 `K_s = min(12, L_s)`；manifest 推导的 `N_placements = Σ_s K_s` 与 `N_contexts = 4 * N_placements` 全部完整有效；除 `aggregate` 自身外的 260 个 receipts 全部存在且校验通过（`aggregate` 在写出自己的 receipt 之前评估该条件）；两份 manifest byte-stable；solver 与 16 replays 完整有效。

条件 2–10 逐字沿用 D1 design §10.1。D2 新增的 canonical reasons 归类如下：

下表的三列必须分开读：**reason** 是 canonical 原因串，**projection** 决定它写不写 `result.json`，**status** 只在该 reason 实际成为 run verdict 时才存在。

| reason | projection | canonical status |
| --- | --- | --- |
| `runtime-identity-mismatch` | 前置否决（§5.4.2，仅 stdout，不建目录） | `invalid-input` |
| `manifest-drift`、`receipt-corrupt`、`receipt-regression` | 证据完整性否决（§5.4.4，run verdict） | `invalid-input` |
| `test-before-freeze`、`evidence-dir-out-of-bounds` | **首次检出即 run verdict**（§5.4.5(a)） | `runtime-fail` |
| `shard-timeout`、`no-progress-timeout`、`shard-nondeterminism`、`resume-equivalence-violation` | 默认 `episode-incomplete`（§5.4.1）；同一 shard 同一 reason 连续两次后按 §5.4.5(b) 提升 | 仅在提升后为 `runtime-fail` |
| `run-locked`、`trainer-lock-present`、`resume-budget-exhausted`、`barren-episode-budget-exhausted` | 永远只是 `episode-incomplete`（§5.4.1） | 无 |

`evidence-dir-out-of-bounds` 与 `test-before-freeze` 都归 `runtime-fail` 且**首次检出即终局**：它们描述的是 D2 自身的运行时行为，不是输入不可行（按 corrective design §8 的 phase matrix，运行时行为归 `runtime-fail`；归成 `invalid-input` 会因优先级更高而改变上报状态）。它们也**不适用** §5.4.5(b) 的两次确认——重试一次越界写入或一次 freeze 前触碰 test 本身就是危害，而不是取样。

`shard-nondeterminism` 与 `resume-equivalence-violation` 在 code gate 中由注入 fake 证明（§12.2 第 3–4 项）。运行期没有组件会重算已完成 shard（§7.1 step 5 明确禁止），因此**运行期唯一可达的探测器是 16 个 replay contexts**；这一点必须如实记录，不得暗示运行期会做全量重算校验。

### 10.2 Aggregate

`aggregate` shard 只有在其余 260 个 shards 全部存在且校验通过时才可运行。它按 §5.3 授予的 capability 用两个 frozen final models 对 test features/outcomes 打分（D1 v1 §9.2 第 2 项的 dot recurrence 与 tie-break），再执行确定性裁决。它对 fit/selection/freeze 这几环的处理见 §5.3 的更正：这些链接在进程内重建，但每一环都必须逐字节复现其 receipt，且 bundle 在任何 test projection 被读取之前就已冻结。

输出**分为两块，边界是硬的**：

**(1) canonical verdict projection —— partition-invariant。** 含 D1 design §11 要求的全部字段，另加与完成分割无关的 shard/receipt 证据：shard 总数、每相位 shard 数、stage-1/stage-2 manifest digests、receipt digest 的聚合摘要。`resultDigest` 是且只是 SHA-256 over 这一块；§12.2 第 3 项的字节同一性比较也只比较这一块。

**(2) `runProvenance` —— 非 canonical。** 含 episode 数、`terminationCause` 序列、各 episode 的时长与 `workerCount`。它**不进入 `resultDigest`**，**不参与**任何字节同一性比较。

这条分割是必需的：episode 数与 `terminationCause` 序列必然随完成分割而变，若把它们放进被比较的投影，§5.3 的 resume 等价性不变量、§12.2 第 3 项的验收测试与 §12.3 的 digest 复核就三者互斥。分割之后，`resultDigest` 只依赖冻结输入与完整 shard 集合，与机器和中断历史无关；而 durable 的终止元数据仍然完整保留在 `runProvenance` 与 `run-record.jsonl` 中。

### 10.3 假设关闭与退役条件

五种情形必须严格区分，混淆会让一次基础设施故障冒充科学结论：

**(a) 假设关闭 —— 只由统计 FAIL 触发。** `fail-joint-selection-not-shown` 或 `fail-representation-gain-not-held-out` 关闭 action-conditioned representation 假设：不得事后改 placements、subsets、splits、features、lambda grid、cardinality 或 thresholds 去追求 PASS。

**(b) 输入可行性否决 —— 终局但不是统计结论。** §5.4.3 的 `invalid-input` 是 run verdict，但它只说明冻结输入不可行，**不是** representation 裁决。后续只能走独立的 corrective design gate，不得解释为 FAIL。

**(c) 预算耗尽 —— 交操作员裁决，不自动退役。** `maxProductiveEpisodes` 或 `maxBarrenEpisodes` 耗尽时产生 `episode-incomplete`（非裁决）。此时向用户报告完成的 shard 数、剩余 shard 数与全部 `terminationCause` 序列，由**用户**在下列之间裁决：追加 episode 预算；把某个反复以同一 canonical reason 失败的 shard 记为 run 级 `runtime-fail`（随后按 D1 v1 §10.4 只走 correctness design/fix gate）；放弃并按 route A 退役；或另开 corrective gate。**不得由 diagnostic 自行退役研究线**——那会把一个纯基础设施频率问题变成科学结局。

注意 §5.4.5 已允许在同一 shard 同一 reason 连续失败两次后**直接**提升为 run 级 `runtime-fail`，因此正常情况下确定性 `runtime-fail` 不需要先烧完 10 个 barren episode；(c) 里的这一项只是兜底。

**(d) 证据完整性否决 —— 唯一处置是丢弃证据目录后重新授权。** §5.4.4 的 `manifest-drift` / `receipt-corrupt` / `receipt-regression` 对该证据目录终局，但**既不是** representation 裁决，**也不是**输入不可行结论。唯一允许的路径是：向用户报告证据、由用户显式授权**整体丢弃** `diagnostics/<runId>/`、并**另行授权一次新的运行**（§12.3 的原授权不覆盖它）。不得就地修复、不得删除单个 receipt、不得把它解释为 FAIL 或 PASS。

**(e) 首次即终局的 `runtime-fail` —— 只走 correctness gate。** §5.4.5(a) 的 `test-before-freeze` 与 `evidence-dir-out-of-bounds`，以及 §5.4.5(b) 提升而来的 `runtime-fail`，一律按 D1 v1 §10.4 处置：只允许 correctness design/fix gate。**不得**丢弃证据目录重跑——那对逻辑缺陷无效，只会原样复现并白烧一次授权运行。

route B 的下行风险因此封顶为 route A 的结果：最坏情况下用户选择 (c) 中的退役，与直接选 A 等价，只是多花了一次运行的时间。

---

## 11. 保持不变的 active v5 合同

逐字保持：`score-rate-v5`、checkpoint schema 6、13 项 `FEATURE_NAMES` 及顺序、`bag-expectimax-hold-v2`、depth 4、root/child beams 64/32、`maxWorkUnits=3584`、`budget-corpus-v1`、caches 65536/16384、标准 Hold、精确七袋 public state、SRS、survival-first ordering、deterministic tie-breaks、board-row immutability，以及 fitness 精确为 `meanScore / scheduled maxPieces`。

published version 3 权重、preserved run artifacts 与全部历史产物原地不变。`src/ai/` 保持无 Node/DOM/filesystem/模块级可变状态（AGENTS.md 记载的唯一例外仍是浏览器专用的 `loadWeights.ts`，D2 不触及它）；D2 的全部文件系统与分片逻辑只存在于 `training/`。D2 extractor 仍是独立 pure diagnostic 边界，不被 `searchBudgeted`、browser AI、simulator、trainer、CEM、weight loader 或 checkpoint 调用。

---

## 12. 后续独立门与可测试验收条件

各门相互独立；前一门 PASS 不授权下一门。

### 12.1 Implementation plan gate

只规划 diagnostic-only 的 D2 实现。禁止包含 production integration、训练、benchmark、publication 或 runtime acceptance。第一个任务必须是 §4.2 的 seed 预注册与不相交断言。

### 12.2 Code gate（必须用 fake/injected dependencies 证明）

1. §4.2 的 seed 常量、digests、唯一性与对全部六个历史 seed 集合的零交集断言全部通过；
2. stage-1/stage-2 manifest 对重复运行 byte-identical；stage-2 是 capture receipts 的纯函数；manifest 漂移在任何 shard 调度前 fail closed；
3. **resume 等价性**：对 shards 的至少三种不同完成分割（一次跑完、逐相位分割、随机分割）产出逐字节相同的 **canonical verdict projection** 与 `resultDigest`；同时断言 `runProvenance` 被排除在该比较与 digest 之外，且它在三种分割下确实不同（证明排除是必要而非装饰）；
4. **worker-count 不变性**：不同 worker 数产出逐字节相同的 receipts 与 canonical verdict projection；
5. **原子性**：注入在 `rename` 前后崩溃的 fake fs，证明不存在部分写入的 receipt，且崩溃后 resume 正确；证明未调用父目录 `fsync`；
6. **§5.4.0 的七个退出类逐类可测**：失败 shard 不写任何 receipt；`runtime-identity-mismatch` 只写 stdout、**不建目录也不写 `result.json`**；输入可行性否决（capture 在 slot 前 gameover、`L_s<2`、digest mismatch）与证据完整性否决各自写出 run verdict；`episode-incomplete` **不写** `result.json`；`result.json` write-once——已存在时直接原样重放并以 §5.4.7 从 canonical status 派生的 exit code 退出，任何后续 episode 都无法覆盖；仅注入的瞬时基础设施失败可在下一 episode 成功；
7. **`runtime-fail` 的两条路径**：(a) `test-before-freeze` 与 `evidence-dir-out-of-bounds` **首次检出**即写 run verdict，且证明不会被重试；(b) 其余 `runtime-fail` 类在同一 shard 同一 canonical reason 连续失败两次后提升——该用例**必须跨两次独立启动**执行，第二个进程只能从磁盘上的 `run-record.jsonl` 读取 `failedShardId`/`failureReason` 来判定，不得依赖进程内状态；失败一次、或两次 reason 不同、或两次 shard 不同，则仍为 `episode-incomplete`；
8. **scheduler payload-blindness**：类型/能力层面证明 outcome payload 无法到达 scheduler；改变 payload 值不改变调度序列；capture payload 不含任何 **D2 自身的 outcome**（label、listwise/survival/Tetris outcome、model score、freeze record）——注意它**确实**含被捕获局面自身的 `score`/`lines`/`level`，那是 subset 身份的一部分，见 §7.2 的更正；
9. **payload capability 按 (相位, split) 授权**：`fit` 拿不到 `label-validation`/`label-test`；`selection`/`final-freeze` 拿不到 `label-test`；**`label-test` 拿不到任何 model/freeze record**；`aggregate` 拿得到 frozen final models 与 test features/outcomes 以执行 held-out scoring——逐项以类型或运行时能力测试证明。**更正（2026-09-04）：** 本项原先还要求证明 `aggregate` "没有 normalization/fitter/optimizer/refit 入口"，该要求已按 §5.3 的更正撤回，并替换为四条同样可测的性质：bundle 只从 `capture`+train+validation payload 重建且严格早于任何 test projection 的读取；每一环重建必须逐字节复现其 receipt，否则 `shard-nondeterminism` fail closed；one-shot test attempt 每次运行只能取用一次；重建对 fit/selection/final-freeze receipt 只读；
10. **freeze 边界**：`label-test` 在 `final-freeze` receipt 之前不可调度；存在 test receipt 时 `fit`/`selection`/`final-freeze` 不可再调度；两种情形均返回 `runtime-fail/test-before-freeze`；
11. **篡改检测**：删除一个 receipt 导致完成数下降时返回 `invalid-input/receipt-regression`；损坏 receipt 返回 `invalid-input/receipt-corrupt` 且不重算；并断言检测基准的字段优先级（`episode-end` → 最后 `heartbeat` → 0）；
12. **run record**：正常完成、SIGINT、SIGTERM、uncaught exception、unhandled rejection 五条路径都写出带 `endedAt`/`durationMs`/`exitCode`/`terminationCause` 的 `episode-end`；无配对 end 的 episode 在下次启动被记为 `episode-abandoned`；heartbeat 按期写出；截断的末行在读取时被丢弃且文件不被重写；
13. **watchdog**：注入永不返回的 fake shard，证明 per-shard ceiling 与 no-progress ceiling 各自触发、写出对应 `terminationCause`、并产生 `episode-incomplete` 而非 run verdict；另有一例证明**一个长但健康、仍在自身 per-shard ceiling 之内的 shard 不会被 run-level ceiling 抢先中止**；
14. **runtime identity 与 runId**：identity 校验发生在任何 digest/`runId` 推导之前；identity 不符返回 `invalid-input/runtime-identity-mismatch` 且**不**创建新目录；
15. **manifest 持久化**：两份 manifest 走 §6.2 原子写；stage-1 缺失但有 receipts → `manifest-drift`；stage-2 缺失 → 重算写入且与原值逐字节相同；
16. **lock 裁决**：§7.1.1 的三条证据齐备时可接管死锁并继续；任一条不成立时返回 `episode-incomplete/run-locked`；
17. **预算语义**：零产出 episode 不消耗 `maxProductiveEpisodes`；两种预算耗尽都产生 `episode-incomplete`，都不自动关闭假设；
18. **写入边界**：证明不存在 `diagnostics/<runId>/` 之外的写入，且未创建/获取 trainer lock；
19. **D1 parity**：§8.1 的就地参数化在注入 D1 常量时产生与参数化之前逐字节相同的 manifest/selection/context digests；
20. D1 v2 code gate 的全部 variable-cardinality 验收条件（corrective design §9 第 1–5 项）在 D2 tag 下继续成立；
21. safe code gates（focused tests、完整 `npm test`、`npm run lint`、`npm run build`、`npm run typecheck:train`、`git diff --check`）fresh 通过；独立 whole-change review 无未处理 Critical/Important；受保护 probe 永不进入命令。

### 12.3 Operational gate

fresh 的进程/lock/artifact/weight/index 预检查、独立 whole-change review clean 之后，由用户显式授权**一次** D2 运行。运行后核验 stdout/`result.json`/digests/replay/post-flight。

该授权**一并预授权**以下两项，无需再开门：

- 在 `maxProductiveEpisodes` / `maxBarrenEpisodes` 预算内对**缺失** shard 续跑；
- 按 §7.1.1 的三条证据清单接管**证据齐备的死 `run.lock`**。这是必要的：§6.4 已确认 SIGKILL 不执行 handler，因此强杀必然留下 lock，若不预授权则 D2 赖以存在的恢复路径不可达。清单不齐时仍必须停下来请操作员裁决。

禁止：重算已完成 shard、换 seed、改 K、裁剪 contexts、改阈值、依据 partial result 调整任何东西，或删除本仓 trainer lock。

**本授权不覆盖**证据完整性否决后的丢弃重跑。若出现 §5.4.4 的任一 reason，必须停止并按 §10.3(d) 请用户单独授权"丢弃 `diagnostics/<runId>/` + 新的运行授权"两件事。

### 12.4 更后续的门

Production integration design 仅在 D2 PASS 时 eligible，且不自动实现。Signal / fixed reevaluation / paired / publication / browser-runtime acceptance 各自需要新的 plan、fresh evidence 与独立授权；D2 的 128-piece labels 与 36/48、+8 阈值**不是** candidate 或 publication 门。

---

## 13. 成本

- 工作量上界与 D1 相同：`<= 1,026,048` scheduled pieces（capture 40,960 + labels `4*Σ_s K_s*128` + replay 2,048）。
- 唯一可用的时间锚点，**且它是保守上界而非 capture 阶段的实测值**：D1 v1 整条命令的墙钟为 `6,158,141 ms`，其中包含启动、artifact 校验、全部 80 条 capture 轨迹与部分 manifest freeze，随后才 fail closed。除以 40,960 pieces 得 ≈150 ms/piece，因此这个数只能当作**每 scheduled piece 的成本上界**。label contexts 从 128/512 手的中局盘面起步，单 piece 成本与 capture 不必相同。
- **本设计不承诺任何总时长。**
- **中断损失的正确上界是 `workerCount × 最大在飞 shard`，不是一个 shard。** 一次中断会丢掉全部在飞 shard 的部分工作：8 个 worker 跑 `label-*` 时最多丢 `8 × 6,144 = 49,152` scheduled pieces，而不是 6,144。`workerCount` 因此是操作员在吞吐与中断损失之间的调节旋钮。相对 D1 的全有全无（一次丢掉全部 1,026,048 pieces）这仍是数量级的改善，但必须按实际值陈述。
- 已完成 shard 的工作 100% 可恢复。
- receipt I/O 相对搜索成本可忽略（261 个 shard，每个一次原子写）。

---

## 14. 本轮停止点

本设计不实现、不运行任何命令、不修改 active v5 或任何 artifact/weight/lock、不 stage/commit/push、不读取或哈希受保护 probe。完成 self-review 与作者独立 review、并把 Critical/Important 修订至零后，在 `claude-code-successor-handoff.md` 追加 successor status，然后停止，等待用户批准下一门（implementation plan gate）。

successor status 中**必须显式点出 §8.1 对 handoff "Preserve all A+/B1/C0/D1 WIP" 的重新界定**（"不得 stash/reset/restore/checkout/clean、不得丢弃、不得改变 D1-tag 行为，但允许为参数化而编辑"）。这是本设计对 handoff 原文措辞的一处收窄解释，必须让用户在 plan gate 之前就看到并有机会反对，而不是在实现中才发现。

Design clean **不**代表 D2 可运行，更不代表 statistical PASS、production integration、训练、发布或 runtime acceptance。
