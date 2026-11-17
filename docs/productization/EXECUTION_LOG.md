# Agent 执行与交接记录

任务完成状态只维护在 [TASKS.md](TASKS.md)。这里记录过程和证据，不另做一份状态表。

## 当前交接

- 2026-11-16：建立产品化规划、112 项任务、专项规范与清单检查器；功能任务均未勾选。
- 起始代码基线：`70a8df4e134eb3051b35e9343b875a80c39efb9c`。
- 本变更是规划交付，不代表 FND-01 或任何功能任务已由后续实施完成。
- FND-01 已完成本次独立验证；下一可领取 FND-02/FND-03/FND-06。远端同步仍受 403 阻塞。
- 历史会话测试见 BASELINE；后续实施不得重复引用为新代码的测试证据。

## 初始规划交付验证（b60b10e，历史记录）

- `node tools/check-plan.mjs`：112 项、18 工作包、0 项勾选；依赖无环、编号唯一、文档本地链接存在；首个可领取任务为 FND-01。
- `node --check tools/check-plan.mjs`：JavaScript 语法检查通过。
- 内存夹具验证 8 个检查器场景：正常规划、循环依赖、未知依赖、无完成证据、依赖未完成、错误复选框格式、重复编号、合法完成并解锁后续任务，均符合预期。夹具没有改动真实任务状态。
- 本次只变更规划、入口文档及检查器，不修改游戏功能或配置；因此没有把旧游戏测试重复运行当作本次文档的必要验证。
- 提交前 `git diff --cached --check` 通过，无空白错误；后续实施新增代码时需按任务重新验证。
- 已在本地分支 `docs/productization-roadmap` 提交。GitHub 插件创建分支返回 `403 Resource not accessible by integration`；现有 HTTPS Git 连接推送也返回 403。因此本次没有写入远端或创建 PR，交付文档包及可导入补丁；恢复仓库写权限后可提交同一变更。

## 任务执行记录

### 本地验证恢复（BAL-06 前置）

- 状态：完成
- 开始：2026-11-17 Asia/Shanghai
- 负责人：Codex desktop
- 分支与起始提交：docs/productization-roadmap / 1eb0cc4
- 范围：修复 Windows 端口占用测试的地址族不一致，并让 Lint 排除 Git 已忽略的历史临时脚本；不提前勾选 QA-01。
- 复现：上轮实跑单元测试 60/61，端口占用场景未拒绝；npm run check 在 .qwen 和 runs/_*.cjs 报 113 个 Lint 错误。
- 实现：占用端口的测试夹具使用与运行时相同的通配监听地址；增加两个对应的 Lint ignore。资源来源策略升级 v3，排除 .gitignore 已列明的美术生成中间目录与 Python 缓存；原有 987 项资源的 hash、来源与权利状态均未改变。
- 验证：Node 24.22.1/npm 11.9.0；server.test.ts 2/2；完整 npm run check 退出 0，单元 61/61、契约 4/4、资源与数值/经济检查全部通过。
- 证据：本提交（git log -- tests/server.test.ts 可定位）；未改游戏规则或提前勾选任何产品任务。
- 下一项：BAL-06。

### BAL-06

- 状态：完成
- 开始：2026-11-17 Asia/Shanghai
- 负责人：Codex desktop
- 分支与起始提交：docs/productization-roadmap / 6878ab0
- 范围：四模式版本化规则、共享摘要契约、权威等级/持有权校验、隔离榜单及奖励资格、房间摘要与恢复、先后手配对实验。游客只开放练习与均衡好友赛；不代替 ACC/DAT/NET 的账号、事务结算或 MM 的排行榜。
- 计划：contracts/modes 定义 DTO；config/modes 固定工程默认；game-core/modes 提供纯规则；房间与 Host 共用；补契约/边界/真实 SDK 测试和 ADR、报告。回滚采用独立任务提交，旧游客房间缺少 mode 时保持练习语义。
- 实现：modes-1 与共享 DTO/纯规则接入房间、等待室和本地 Host；统一好友等级、验证正式模式持有权并隔离结果资格；冻结/恢复摘要，修正 OnlineHost 的第二座位视角；浏览器联机夹具使用独立临时存档。
- 验证：Node 24.22.1/npm 11.9.0；完整 check（单元 70/70、契约 5/5）；build；physics 18/18、net 176/0；真实 Chromium 15/15，0 SKIP、0 FAIL、0 JS 错误；8 场固定种子配对实跑完成。
- 证据：本提交（git log -- docs/productization/reports/BAL-06.md 可定位）；reports/BAL-06.md、reports/mode-pairs.json、reports/mode-lobby.png。
- 风险与剩余：游客不能进入正式排位/成长模式；正式账号、可靠结果与账本留给 ACC/DAT/NET/MM。8 场不是充分平衡证据。
- 回滚：独立任务提交；旧协议可选字段和旧练习存档继续兼容，不改物理配置。
- 下一项：BAL-07。

### BAL-07

- 状态：完成
- 开始：2026-11-17 Asia/Shanghai
- 负责人：Codex desktop
- 分支与起始提交：docs/productization-roadmap / b524d9e
- 范围：1000 场固定种子配对实验、可复现报告与敏感性分析；发布校验器；基于现有配置注册表的差异、按服务端分组灰度、停用/回滚和旧局回放验证。保留已确认的物理、技能和奖励默认，不为过门槛修改玩法。
- 计划：先复用 8 场实验器扩展批次与统计；为注册表增加灰度和停用，房间使用服务端生成的 cohort；验证旧快照/历史回放不变并保存基线配置档案。发布校验失败会如实记录，不作为自动调参授权。
- 实现：1000 场/500 seed 配对 + 40 场敏感性、配置指纹及真实历史重放校验；稳定服务端 cohort 灰度、停用/回滚、完整 diff、物理与模式基线归档。修正 test:balance 在 Windows 上不展开 shell 通配符导致漏跑的问题。
- 验证：完整 npm run check 退出 0（单元 77/77、契约 5/5）；test:balance 31/31；build；physics 18/18、net 176/0；Chromium PASS=15/SKIP=0/FAIL=0。实验报告校验退出 0；严格发布检查按预期退出 1。
- 证据：本提交（git log -- docs/productization/reports/BAL-07.md 可定位）；reports/BAL-07.md、reports/balance-experiment.json、reports/BALANCE_REPORT_TEMPLATE.md；docs/engineering/balance-release.md。
- 风险与剩余：先手半分得分率 57.3%，近似 95% 区间 54.30%–60.30%，未达到 5pp 放量门槛。保持现有参数与灰度关闭；正式账本及跨重启控制留给 DAT/OPS，未声称平衡或生产灰度完成。
- 回滚：独立任务提交；register 不激活、activate 旧版会清灰度、disable 不删除历史包；旧局及回放继续原快照。
- 下一项：AST-02。

### AST-02

- 状态：完成
- 开始：2026-11-17 Asia/Shanghai
- 负责人：Codex desktop
- 分支与起始提交：docs/productization-roadmap / 39c93e6
- 范围：全部 117 名球员的原创程序化占位图、五品质三状态卡框、带 2px 留边的图集与严格映射；资源来源记录及全卡联系表/DPR 加载验收。保留旧 Demo 的原版头像入口，本项新增可供后续组件和发布替换使用的资源。
- 计划：contracts 的图集契约与纯布局；可复现导出器；与目录校验器绑定；Canvas 卡片绘制与独立验收页；输出尺寸/锚点/裁切规格及实际加载证据。名字、等级及位置标签动态绘制，不烘焙进纹理。
- 实现：严格图集与身份契约、原创程序化导出器、Canvas 绘制与隔离验收页；目录增加 data 类型使元数据变更参与缓存版本，来源/权利状态显式保留；修复 Node 单元测试传输与并发配置。
- 验证：完整 check（单元 80/80、契约 5/5）；build；cards-browser 全量 117 卡/15 框/3 页、528 留边采样、DPR1/2/3、断图重试；游戏 Chromium 15/15，0 SKIP/FAIL/JS 错误；房间/重启连续 30 次通过。
- 证据：本提交（git log -- docs/productization/reports/AST-02.md 可定位）；reports/AST-02.md、reports/card-atlas/browser.json 与三张已检查截图；docs/engineering/card-atlas.md。
- 风险与剩余：新增图是明确标记的原创几何占位；商用批准仍为 0，未替代 REL-01；运行时缓存与发布裁剪留给 AST-05，真机留给 AST-06。
- 回滚：独立任务提交；旧头像入口和玩法数据保持兼容。
- 下一项：AST-03。

### AST-03

- 状态：完成
- 开始：2026-11-17 Asia/Shanghai
- 负责人：Codex desktop
- 分支与起始提交：docs/productization-roadmap / 2fdde64
- 范围：按现有足球/卡牌语义建立亮暗 tokens、无文字九宫格按钮/面板、原创图标与五套球场展示缩略图；复用九种程序音效，记录源码指纹与来源。不给占位资源虚构商业许可，不更改碰撞几何或原版 Demo 入口。
- 计划：严格资源包契约、纯布局/九宫格切片与边界测试；浏览器程序化导出；目录绑定与设计索引；隔离预览验证亮暗、状态、大字体、资源失败重试和音频解锁。
- 实现：亮暗 tokens、39 个带留边图形、九宫格切片、导出/校验器与总目录绑定；原始音源指纹、动态文字、隔离的可操作预览和设计索引。
- 验证：完整 check（单元 83/83、契约 5/5）；build；UI 浏览器四组亮暗/字号/DPR、键盘、音频手势/静音、断图重试通过，0 控制台错误/警告；游戏 Chromium 15/15，0 SKIP/FAIL/JS 错误。
- 证据：本提交（git log -- docs/productization/reports/AST-03.md 可定位）；reports/AST-03.md、reports/ui-assets/browser.json 与四张截图；docs/engineering/ui-assets.md。
- 风险与剩余：原创占位不等于最终美术或商业批准；平台音频中断与真机视觉留给跨端验收。
- 回滚：独立提交；旧 Demo 入口兼容，不改玩法。
- 下一项：AST-04。

### FND-01

- 状态：完成
- 开始：2026-11-16 22:26 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / b60b10eed31715daf54dde8150526f5c81e2df8f
- 范围：从已提交代码导出隔离副本，按锁文件安装，重新核实环境、类型、构建、物理、联机、真实浏览器与双客户端恢复；更新基线和持久验证报告。暂不改游戏玩法或完成后续任务。
- 实现：全新归档副本与锁定安装，更新 BASELINE、旧文档差异及持久证据；测试生成的四个已跟踪文件均留在副本，玩法代码与锁文件未改。
- 验证：npm ci/typecheck/build 退出 0；physics 18/18；net PASS=176/FAIL=0；Chromium PASS=7/SKIP=0/FAIL=0；双 SDK 客户端 17 项 PASS/0 failure。环境和每条命令见报告，本次未沿用旧测试结果。
- 证据：本提交（git log -- docs/productization/reports/FND-01.md 可定位）；reports/FND-01.md、reports/FND-01/results.json 和 8 份原始文本日志。
- 风险与剩余：本地验收无阻塞。GitHub 写入仍为 403，远端未同步；既有构建体积提示、未覆盖错误码与 SDK 警告已在报告记录，后续按相关任务处理。
- 回滚：本任务只修改基线、报告、执行记录与对应复选框，可独立回退。
- 下一项：FND-02/FND-03/FND-06；未执行或勾选后续任务。

### FND-02

- 状态：完成
- 开始：2026-11-17 12:13 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / 03b550bc971c45045dac31ea005ac2e8899c789f
- 范围：锁定运行时与包管理器、记录依赖兼容元数据、全新安装并验证现有核心命令。
- 实现：锁定Node/npm及安装前校验；核查候选依赖元数据，现有游戏依赖不变。
- 验证：全新npm ci、工具链正反例、typecheck/build、physics18/18及net176均通过。
- 证据：本提交（git log -- docs/productization/reports/FND-02.md 可定位）；docs/productization/reports/FND-02.md
- 风险与剩余：本任务验收完成；远端同步权限与后续产品任务按各自记录处理。
- 回滚：独立任务提交可回退；不覆盖其它任务。
- 下一项：按任务依赖选择。

### FND-03

- 状态：完成
- 开始：2026-11-17 12:16 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / 57e3b8966c92607f068ee40707fa7b120dd0896b
- 范围：扫描全部运行时及源素材，形成可重复生成的来源、哈希、许可证与发布范围盘点。
- 实现：生成985项来源/哈希/发行范围盘点，记录public与私有描述冲突及许可证缺口。
- 验证：全量扫描和确定性复查通过；新增未登记文件反例被拒绝，移除后通过。
- 证据：本提交（git log -- docs/productization/reports/FND-03.md 可定位）；docs/productization/reports/FND-03.md
- 风险与剩余：本任务验收完成；远端同步权限与后续产品任务按各自记录处理。
- 回滚：独立任务提交可回退；不覆盖其它任务。
- 下一项：按任务依赖选择。

### FND-04

- 状态：完成
- 开始：2026-11-17 12:18 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / db5a3662c7e98ac1a1fdcb0e1f0a0d70627a8fcf
- 范围：实现分环境配置校验、生产弱密钥与开发绕过防护、启动接入和脱敏错误。
- 实现：实现分环境schema、脱敏错误及服务端启动校验；测试库独立选择，生产禁止开发绕过。
- 验证：5项配置行为测试、typecheck、server构建通过；真实生产错误启动拒绝且脱敏，本地health200。
- 证据：本提交（git log -- docs/productization/reports/FND-04.md 可定位）；docs/productization/reports/FND-04.md
- 风险与剩余：本任务验收完成；远端同步权限与后续产品任务按各自记录处理。
- 回滚：独立任务提交可回退；不覆盖其它任务。
- 下一项：按任务依赖选择。

### FND-05

- 状态：完成
- 开始：2026-11-17 12:23 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / aa7c348911590d6e73f9493c82a75bacb1bcfc22
- 范围：接入真实lint、格式检查、Vitest单元测试与check聚合，验证错误会使检查失败。
- 实现：真实ESLint/Prettier/Vitest与check聚合，明确增量格式范围和精确旧工具例外。
- 验证：check全通过，5项配置单测通过；类型/格式/lint/未知依赖四类反例均非零。
- 证据：本提交（git log -- docs/productization/reports/FND-05.md 可定位）；docs/productization/reports/FND-05.md
- 风险与剩余：本任务验收完成；远端同步权限与后续产品任务按各自记录处理。
- 回滚：独立任务提交可回退；不覆盖其它任务。
- 下一项：按任务依赖选择。

### FND-06

- 状态：完成
- 开始：2026-11-17 12:29 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / 502d5f34e17a47db926177f6a8ce09cf32578a32
- 范围：建立平台、认证、公平模式、持久化、客户端、几何、运营及依赖版本ADR，区分工程默认与外部待定。
- 实现：建立8份ADR和默认实施路线，记录真实凭证/设备/权利等外部边界。
- 验证：ADR编号、链接和架构/任务交叉复核通过；不以默认设计冒充真实平台验收。
- 证据：本提交（git log -- docs/productization/reports/FND-06.md 可定位）；docs/productization/reports/FND-06.md
- 风险与剩余：本任务验收完成；远端同步权限与后续产品任务按各自记录处理。
- 回滚：独立任务提交可回退；不覆盖其它任务。
- 下一项：按任务依赖选择。

### ARC-01

- 状态：完成
- 开始：2026-11-17 12:29 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / d09dc938bfaee29a4d5eabd7c5b238970f853f7e
- 范围：提取纯TypeScript游戏核心到workspace，旧shared路径重导出；增加依赖方向检查并回归原命令。
- 实现：建立私有game-core workspace，迁移实际RNG实现并保留shared重导出；AST检查可移植边界。
- 验证：workspace链接、check/6项unit、build、physics18/18和net176通过；node:fs边界反例被拒绝。
- 证据：本提交（git log -- docs/productization/reports/ARC-01.md 可定位）；docs/productization/reports/ARC-01.md
- 风险与剩余：本任务验收完成；远端同步权限与后续产品任务按各自记录处理。
- 回滚：独立任务提交可回退；不覆盖其它任务。
- 下一项：按任务依赖选择。

### ARC-02

- 状态：完成
- 开始：2026-11-17 12:33 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / 702c774b98ff06fb44e7a4d730af63b6c572346d
- 范围：提取共享消息校验，新增严格HTTP DTO、稳定错误码/版本和可校验接口文档，保留v1网络行为。
- 实现：共享v1消息校验和严格HTTP DTO/错误/版本，自动生成OpenAPI并保持旧入口兼容。
- 验证：4项契约、check、OpenAPI一致性、server构建和176项原联机回归通过。
- 证据：本提交（git log -- docs/productization/reports/ARC-02.md 可定位）；docs/productization/reports/ARC-02.md
- 风险与剩余：本任务验收完成；远端同步权限与后续产品任务按各自记录处理。
- 回滚：独立任务提交可回退；不覆盖其它任务。
- 下一项：按任务依赖选择。

### ARC-03

- 状态：完成
- 开始：2026-11-17 12:38 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / 10c2a442844fba210d347309d848cf6fc089504d
- 范围：实现平台接口、Web存储/网络/生命周期/viewport适配及可取消宿主桥，接入实际比赛暂停和释放。
- 实现：新增Web平台存储/网络/viewport/生命周期和异步宿主桥，实际GameView接入暂停恢复及完整释放。
- 验证：check含11项unit/4项契约通过；真实HTTP/WS文本二进制、build和Chromium9项（0skip/0error）通过。
- 证据：本提交（git log -- docs/productization/reports/ARC-03.md 可定位）；docs/productization/reports/ARC-03.md
- 风险与剩余：本任务验收完成；远端同步权限与后续产品任务按各自记录处理。
- 回滚：独立任务提交可回退；不覆盖其它任务。
- 下一项：按任务依赖选择。

### ARC-04

- 状态：完成
- 开始：2026-11-17 12:50 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / ae8d2d4ce6882f1ed68cc6f54dcb0ab7a1710b90
- 范围：接入真实PostgreSQL17、参数化SQL与跨repository事务、受控并发迁移和隔离数据库集成测试。
- 实现：真实PostgreSQL17与pg事务/repository、advisory并发迁移和隔离集成runner，生产禁止隐式down。
- 验证：check通过；真实PG17的并发迁移、跨repo回滚、SQL参数/精度、DDL失败回滚和down/up共5项通过。
- 证据：本提交（git log -- docs/productization/reports/ARC-04.md 可定位）；docs/productization/reports/ARC-04.md
- 风险与剩余：本任务验收完成；远端同步权限与后续产品任务按各自记录处理。
- 回滚：独立任务提交可回退；不覆盖其它任务。
- 下一项：按任务依赖选择。

### ARC-05

- 状态：完成
- 开始：2026-11-17 13:00 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / 5d4b947e67be719eeb116653041d1735733bdeed
- 范围：实现版本化配置/资源manifest、内容hash验证和不可变快照，新旧版本共存与明确兼容策略。
- 实现：实现领域schema注入的版本/hash注册表、资源manifest及全GameData清单，实际房间绑定不可变版本。
- 验证：15项unit/4契约、build、physics18/net176、Chromium9通过；hash篡改和同版本替换/源码启动反例被拒绝。
- 证据：本提交（git log -- docs/productization/reports/ARC-05.md 可定位）；docs/productization/reports/ARC-05.md
- 风险与剩余：本任务验收完成；远端同步权限与后续产品任务按各自记录处理。
- 回滚：独立任务提交可回退；不覆盖其它任务。
- 下一项：按任务依赖选择。

### ARC-06

- 状态：完成
- 开始：2026-11-17 13:17 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / bc06086589b3b68b671ec15a659b24e109caa800
- 范围：整理服务装配、注入模块边界、HTTP错误与requestId、API404和健康/就绪及优雅关闭。
- 实现：拆出实际游客/配置目录/对战服务与组合根，注入仓储时钟和结果端口，补API错误及完整关闭。
- 验证：check含17unit/4契约、server构建和net176通过；关闭等待调整后2项真实HTTP/启动清理测试再通过。
- 证据：本提交（git log -- docs/productization/reports/ARC-06.md 可定位）；docs/productization/reports/ARC-06.md
- 风险与剩余：本任务验收完成；远端同步权限与后续产品任务按各自记录处理。
- 回滚：独立任务提交可回退；不覆盖其它任务。
- 下一项：按任务依赖选择。

### FLD-01

- 状态：完成
- 开始：2026-11-17 13:27 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / 0a25539eec144f8a279e4838efb5e459b8fccd7b
- 范围：校验唯一球场几何，提取边界生成和严格schema，保留原尺寸及皮肤共享约束。
- 实现：提取唯一纯几何入口及严格数据schema，补来源字典并拒绝皮肤私有碰撞尺寸。
- 验证：check含19unit/4契约、physics18/18及完整build通过，原配置hash未变。
- 证据：本提交（git log -- docs/productization/reports/FLD-01.md 可定位）；docs/productization/reports/FLD-01.md
- 风险与剩余：本任务验收完成；远端同步权限与后续产品任务按各自记录处理。
- 回滚：独立任务提交可回退；不覆盖其它任务。
- 下一项：按任务依赖选择。

### FLD-02

- 状态：完成
- 开始：2026-11-17 13:29 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / b315b53f07eddb14e7e8b31b261eccc91c2e56f7
- 范围：统一相机、内容布局、DPR与拖拽数学，接入渲染/输入/HUD并验证双视角。
- 实现：相机/布局/DPR和拖拽数学统一并实际接入渲染、HUD与输入，保留原手感常数。
- 验证：48种布局4800点误差与意图一致；check21unit/4契约、build、Chromium10项0skip/0error通过。
- 证据：本提交（git log -- docs/productization/reports/FLD-02.md 可定位）；docs/productization/reports/FLD-02.md
- 风险与剩余：本任务验收完成；远端同步权限与后续产品任务按各自记录处理。
- 回滚：独立任务提交可回退；不覆盖其它任务。
- 下一项：按任务依赖选择。

### FLD-03

- 状态：完成
- 开始：2026-11-17 13:37 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / 7525887f50e2ecaf412f76c14e7070be539c11d6
- 范围：核实唯一碰撞体与合法球门整体越线，补门线/柱/斜墙/高速/多接触回归。
- 实现：统一墙柱网与渲染轮廓，修复既定整体越线判定缺少合法门口/新越线检查的缺口。
- 验证：field7/7、check24unit/4契约、physics18/net176、server构建通过，数据参数未改。
- 证据：本提交（git log -- docs/productization/reports/FLD-03.md 可定位）；docs/productization/reports/FLD-03.md
- 风险与剩余：本任务验收完成；远端同步权限与后续产品任务按各自记录处理。
- 回滚：独立任务提交可回退；不覆盖其它任务。
- 下一项：按任务依赖选择。

### FLD-04

- 状态：完成
- 开始：2026-11-17 13:39 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / 33723aa337edfd9864a78bf971305396c738129d
- 范围：验证四角弹簧、低速/足球/固定体组合与门后合法移位，补事件去重与无重叠约束。
- 实现：补弹簧单步去重、合法移位与确定搜索失败路径，完善特殊事件契约和组合验证。
- 验证：field11/11、check28unit/4契约、physics18/net176、server构建通过，原参数保持。
- 证据：本提交（git log -- docs/productization/reports/FLD-04.md 可定位）；docs/productization/reports/FLD-04.md
- 风险与剩余：本任务验收完成；远端同步权限与后续产品任务按各自记录处理。
- 回滚：独立任务提交可回退；不覆盖其它任务。
- 下一项：按任务依赖选择。

### AST-01

- 状态：完成
- 开始：2026-11-17 13:43 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / afa2b2204b522d5f19997a9f346a1b3e66f55726
- 范围：作为FLD-05前置统一资源ID/哈希/尺寸/锚点/来源/授权/优先级，建立真实引用及构建校验。
- 实现：统一322条资源与145条语义绑定，校验尺寸锚点来源授权优先级并在构建前验证真实引用。
- 验证：check30unit/4契约及build通过；真实缺图/重复ID构建均失败后恢复；Pillow独立复核319张尺寸。
- 证据：本提交（git log -- docs/productization/reports/AST-01.md 可定位）；docs/productization/reports/AST-01.md
- 风险与剩余：本任务验收完成；远端同步权限与后续产品任务按各自记录处理。
- 回滚：独立任务提交可回退；不覆盖其它任务。
- 下一项：按任务依赖选择。

### FLD-05

- 状态：完成
- 开始：2026-11-17 13:48 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / a920673bd97d850b5b22577ba1d363638609afb2
- 范围：统一crop/rotate/source-world变换与比赛/大厅用途，制作所有皮肤双视角数值及几何叠加证据。
- 实现：统一裁切旋转标定与整场/HUD映射，修复4.52mm显示偏差，区分大厅等距图并生成实际叠加证据。
- 验证：field13/13、check32unit/4契约、build、Chromium10通过；18格双视角叠加已查看、最大变换误差2.22e-16m。
- 证据：本提交（git log -- docs/productization/reports/FLD-05.md 可定位）；docs/productization/reports/FLD-05.md
- 风险与剩余：本任务验收完成；远端同步权限与后续产品任务按各自记录处理。
- 回滚：独立任务提交可回退；不覆盖其它任务。
- 下一项：按任务依赖选择。

### FLD-06

- 状态：完成
- 开始：2026-11-17 13:53 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / a228cf4f9ad5422cce6ea91c2e0a103d5dc49f26
- 范围：拆静态/棋子/轨迹/表现层，画质仅影响表现，提取只读回放并验证缓存释放与暂停恢复。
- 实现：拆渲染层与画质菜单，接入只读回放和后台跳终态，缓存与生命周期释放有界。
- 验证：check34unit/4契约、build及最终Chromium12项通过；15次DPR3资源循环释放为0，heap差419272字节已记录。
- 证据：本提交（git log -- docs/productization/reports/FLD-06.md 可定位）；docs/productization/reports/FLD-06.md
- 风险与剩余：本任务验收完成；远端同步权限与后续产品任务按各自记录处理。
- 回滚：独立任务提交可回退；不覆盖其它任务。
- 下一项：按任务依赖选择。

### FLD-07

- 状态：完成
- 开始：2026-11-17 14:00 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / 348baeeba92f4cfe1f43e1b7526ee4914be2ff70
- 范围：完善开发几何/法线/锚点/相机工具，补规范视口矩阵与拖拽场景，验证生产关闭调试入口。
- 实现：完成开发几何/法线/锚点/相机与拖拽工具，144项视口矩阵和生产调试隔离验收。
- 验证：check34unit/4契约、field15、physics18、build、Chromium13通过；8截图逐一查看，144项最大误差1.8763e-14。
- 证据：本提交（git log -- docs/productization/reports/FLD-07.md 可定位）；docs/productization/reports/FLD-07.md
- 风险与剩余：本任务验收完成；远端同步权限与后续产品任务按各自记录处理。
- 回滚：独立任务提交可回退；不覆盖其它任务。
- 下一项：按任务依赖选择。

### BAL-01

- 状态：完成
- 开始：2026-11-17 14:06 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / 76cc9f8e47128f2a48d19bd0ddd4ac4cfe61e8d0
- 范围：核实117球员/106原表/11重建数据，建立完整数值schema、引用与来源校验及损坏输入反例。
- 实现：完整数值schema与跨表/概率/时序校验接入实际加载，逐值核对2250源记录和117球员来源并澄清旧说明。
- 验证：check36unit/4契约、physics18/net176、build及Chromium13通过；源码数值和hash未改。
- 证据：本提交（git log -- docs/productization/reports/BAL-01.md 可定位）；docs/productization/reports/BAL-01.md
- 风险与剩余：本任务验收完成；远端同步权限与后续产品任务按各自记录处理。
- 回滚：独立任务提交可回退；不覆盖其它任务。
- 下一项：按任务依赖选择。

### BAL-02

- 状态：完成
- 开始：2026-11-17 14:18 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / 30776ded3c7091421417583f3fa1d1801614ec8b
- 范围：提取纯等级/属性/状态/倍率/出手公式，保存旧实现全表对照并输出1170行版本化映射快照。
- 实现：集中纯等级/状态/物理映射并冻结1170行快照，隔离可变副本，保留旧入口与现有手感。
- 验证：2340组对照逐值相等；check38unit/4契约、physics18/net176、build通过，同版本替换反例被拒绝。
- 证据：本提交（git log -- docs/productization/reports/BAL-02.md 可定位）；docs/productization/reports/BAL-02.md
- 风险与剩余：本任务验收完成；远端同步权限与后续产品任务按各自记录处理。
- 回滚：独立任务提交可回退；不覆盖其它任务。
- 下一项：按任务依赖选择。

### BAL-03

- 状态：完成
- 开始：2026-11-17 14:31 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / 716c043ca9c5b96af33d2b76a146808ba6030bbd
- 范围：规范13个已实现技能的触发/持续/叠加/额外行动，补结束态防重触发及真实重连不重抽验证。
- 实现：集中技能策略和时序契约，补终局保护/权威输入验证、组合及真实重连不重抽验证。
- 验证：check46unit/4契约、技能8项、physics18/net176、build通过；seed42一万次2022触发可复现并给出置信区间。
- 证据：本提交（git log -- docs/productization/reports/BAL-03.md 可定位）；docs/productization/reports/BAL-03.md
- 风险与剩余：本任务验收完成；远端同步权限与后续产品任务按各自记录处理。
- 回滚：独立任务提交可回退；不覆盖其它任务。
- 下一项：按任务依赖选择。

### BAL-04

- 状态：完成
- 开始：2026-11-17 14:41 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / 5179e6bf14af0c0366c8174e7ded2b83019d9065
- 范围：以正式ShotRunner核实校准，测AI耗时分位并接入可取消、超预算降级和不阻塞交互的真实路径。
- 实现：校准目标保留并接入真实可取消AI预算/Worker截止/回退，旧输出一致且阻止过期作业污染状态。
- 验证：check54unit/4契约、physics18/net176、build/Chromium13通过；10校准目标通过；27旧输出一致，真实Worker截止1501ms仍响应。
- 证据：本提交（git log -- docs/productization/reports/BAL-04.md 可定位）；docs/productization/reports/BAL-04.md
- 风险与剩余：本任务验收完成；远端同步权限与后续产品任务按各自记录处理。
- 回滚：独立任务提交可回退；不覆盖其它任务。
- 下一项：按任务依赖选择。

### BAL-05

- 状态：完成
- 开始：2026-11-17 15:21 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / 2a8d71047943242d7b9d09efed87c1195fcab9da
- 范围：设计非付费初始卡组/升级/奖励/重复转碎片配置与纯规则，验证幂等边界并模拟7/30天成长经济。
- 实现：实现非付费经济配置/BigInt纯规则/资格上限/重复转碎片/合成和跨日进度，冻结报价hash并输出7/30天模拟。
- 验证：最终check61unit/4contract、test:balance18项、build通过；4个同版本篡改反例被拒绝；模拟守恒与非负余额通过。
- 证据：本提交（git log -- docs/productization/reports/BAL-05.md 可定位）；docs/productization/reports/BAL-05.md
- 风险与剩余：本任务验收完成；远端同步权限与后续产品任务按各自记录处理。
- 回滚：独立任务提交可回退；不覆盖其它任务。
- 下一项：按任务依赖选择。

## 记录模板

复制模板时将示例 ID 改成真实任务。完成记录标题用 `### TASK-ID`，检查器据此核对已勾选任务的完成证据。

```markdown
### TASK-ID

- 状态：进行中 / 阻塞 / 完成（只能保留一个）
- 开始：YYYY-MM-DD HH:mm Asia/Shanghai
- 负责人：Agent/人员标识
- 分支与起始提交：...
- 范围：本次完成什么、相关文件与必要关联修改
- 实现：具体行为和接口/配置/数据迁移
- 验证：实际命令、环境、结果数量；未执行的明确标注
- 证据：提交/PR、仓库内报告或日志路径、真机信息等可复查位置
- 风险与剩余：没有则写“无已知阻塞”；有阻塞不得标完成
- 回滚：代码/配置/迁移如何恢复
- 下一项：依赖满足的任务 ID
```

在同一次提交中记录证据可写“本提交（git log -- <file> 可定位）”及报告路径，避免为填写尚不存在的 commit hash 制造自引用循环。日志文件若不入库，应上传到用户授权的 CI/artifact 服务或把关键命令/输出摘要写入仓库报告，不能只留其他人访问不到的临时绝对路径。

## 阻塞记录规范

明确缺少什么（凭证/设备/产品选择/外部依赖）、已完成什么、复现方式、解除后运行哪条验证。相关任务保持未勾选。不要把“等待批准”当成所有普通实现工作的默认状态；已有授权内继续完成不依赖该条件的部分。

## 完成勾选规范

1. 确认前置任务已勾选且相应代码在当前分支可用。
2. 完成该任务所有验收，写实际验证与证据，状态改为完成。
3. 只改对应任务 `- [ ]` 为 `- [x]`，不勾选整包或其它未验证任务。
4. 运行 `node tools/check-plan.mjs`，审阅 diff，提交实现和记录。
5. 若后续回归发现任务验收失效，取消该勾选，并说明受影响后续任务；不能只保留绿勾掩盖失败。
