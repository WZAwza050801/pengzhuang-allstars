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

### AST-04

- 状态：完成
- 开始：2026-11-17 Asia/Shanghai
- 负责人：Codex desktop
- 分支与起始提交：docs/productization-roadmap / 0f973a1
- 范围：从 ui-tokens 单一输入生成 Web CSS 与 Canvas 数据；实现可复用语义组件和隔离样例页，列明 props/状态/动作；用同一状态模型验证 Web/Canvas 语义、对比度、焦点和失败重试。业务账号/资产接入仍按 UI/ACC/DAT 依赖推进。
- 计划：生成一致性和状态/大整数格式边界测试；共享展示语义；Web 组件与窄 Canvas 绘制适配；真实浏览器组件交互、空错加载/禁用、模态焦点、亮暗与大字体验收；独立提交可回滚。
- 实现：单源 Web CSS/Canvas 数据、构建时生成一致性检查；19 类组件目录/可操作样例和共享状态；卡品质色接入同一输入，PNG 不变；修复非可操作状态颜色和模态反向焦点循环。
- 验证：完整 check（单元 86/86、契约 5/5）；build；19 类/六状态 DOM-Canvas 像素与资格、焦点循环/恢复、重试、卡牌、分页、亮暗/200%/DPR1/2/3；卡牌与 UI 图集浏览器回归通过；游戏 Chromium 15/15，0 SKIP/FAIL/JS 错误。
- 证据：本提交（git log -- docs/productization/reports/AST-04.md 可定位）；reports/AST-04.md、reports/components/browser.json 与六张截图，实看联系表与暗色 Canvas；docs/engineering/ui-components.md。
- 风险与剩余：演示数据仅用于组件验收；微信实际组件/输入适配、React 业务壳和真实账号/资产仍按后续依赖实施。
- 回滚：独立提交；保留旧 Demo 兼容入口。
- 下一项：AST-05。

### AST-05

- 状态：完成
- 开始：2026-11-17 Asia/Shanghai
- 负责人：Codex desktop
- 分支与起始提交：docs/productization-roadmap / 91b2651
- 范围：按场景取消/释放、基于 hash 的有界内存/持久缓存、损坏重取与远程失败回退；接入实际比赛图片加载，保留程序化降级；低分辨率场地档与按引用过滤构建资源，生成场景包体报告。商业发布批准仍遵守 REL-01。
- 计划：先验证去重/取消/损坏/版本/容量；实现可注入字节管理与 Web 适配，比赛宿主释放；导出低分辨率资源及过滤发布目录；真实浏览器注入缓存损坏/离线/取消与游戏回归。
- 实现：共享/取消的 hash 字节管理与 Web 有界缓存、比赛与新图集场景接入、原有程序化降级、十张低纹理、有限动态引用枚举、过滤构建和五类包索引；修复包体统计重复计图和裁剪遗漏旧动态卡框/属性/技能图标。
- 验证：完整 check（单元 92/92、契约 5/5）；build/最终过滤客户端重建；真实 CacheStorage 损坏/离线/版本/取消/容量、低纹理和断图出手；真实构建逐张检查 106 张详情、864 次图片解码、0 控制台错误/警告；卡牌/UI/组件浏览器回归通过；游戏 E2E 16/16，0 SKIP/FAIL/JS 错误；商用资源门槛按预期退出 1。
- 证据：本提交（git log -- docs/productization/reports/AST-05.md 可定位）；reports/AST-05.md、reports/asset-cache/browser.json 与实看截图、reports/asset-packages.json；docs/engineering/asset-loading.md。
- 风险与剩余：过滤去掉 72 项/17,188,681 B，批准仍为 0；逻辑 Web 场景包不等于微信分包或真机预算通过；旧大厅静态 HTTP 资源由后续 UI 壳迁移。
- 回滚：独立提交；取消过滤可恢复原全量本地包，旧兼容入口与物理数据不变。
- 下一项：AST-06。

### AST-06

- 状态：Web 子集已验证；真机依用户要求暂缓，整项未完成
- 开始：2026-11-17 Asia/Shanghai
- 负责人：Codex desktop
- 分支与起始提交：docs/productization-roadmap / 99b04b2
- 范围：Web 多视口/DPR/引擎资源检查、许可清单与平台预算审查。用户随后更正：仅有 iPhone 15 Pro、没有 Android，明确暂时搁置真机验收；不启动手机验收服务，不将桌面模拟器记作真机。
- 计划：补已发现的普通局域网 HTTP 缺少 WebCrypto 的资源 hash 兼容并按官方资料锁定依赖；测试真实非安全上下文；导出三引擎 Web 矩阵与当前资源批准/预算状态。真机部分依用户要求暂缓，复选框保持未完成；继续后续可独立开发任务。
- 实现：三引擎资源矩阵、许可/包体清单；无 WebCrypto 的 SHA-256 动态回退；头像预载等待、解码状态和 WebKit 模态焦点修正；动态模块改写之后核对最终包体。
- 验证：check（单元 93/93、契约 5/5）；build/最终客户端重建；三引擎 144 视图、432 几何组、每引擎 117 原头像与卡片、0 错误/警告；真实非安全上下文加载；资产故障浏览器与游戏 E2E 16/16。
- 证据：本提交（git log -- docs/productization/reports/AST-06.md 可定位）；reports/AST-06.md、reports/asset-matrix/browser.json 与截图、reports/asset-readiness.json。
- 剩余：iOS/Android 真机及平台实际包预算未验收；批准为 0；WebKit 冷缓存批量写入需后续性能量化。按用户更正不开展真机工作，不勾选 AST-06。
- 下一项：UI-01（不依赖 AST-06）。

### UI-01

- 状态：完成
- 开始：2026-11-17 Asia/Shanghai
- 负责人：Codex desktop
- 分支与起始提交：docs/productization-roadmap / 205d315
- 范围：五主入口的信息架构、内部页面意图/视图模型、访问与功能开关语义、页面流程/线框。保留 BAL-06 的游客练习/均衡好友赛；正式持有卡/排位要求账号。原型明确为演示，不冒充业务 API 已实现。
- 计划：纯 client-model 页面定义与导航准入；匿名登录回跳、关闭功能、离线/维护/版本边界验证；交互线框与跨端差异/API权限对照；Web 浏览器走读后独立提交。
- 实现：无平台依赖的 client-model、封闭内部意图与准入、12 页状态/返回/路径、五主入口；登录回跳/取消/失败重试、功能开关及离线/维护；交互线框、流程图和 API/权限/平台差异对照。复用既有 ModeId/Queue schema。
- 验证：完整 check（96/96 单元、5/5 契约）、build、游戏 E2E 16/16（含生产隔离）；最终导航/线框迭代经 lint/typecheck/38 文件边界检查、导航单测和桌面1280/手机390/320走读通过。0 业务写请求、0 控制台错误/警告，实看手机截图。
- 证据：本提交（git log -- docs/productization/reports/UI-01.md 可定位）；reports/UI-01.md、reports/workflow/browser.json 与三张截图；docs/engineering/client-navigation.md。
- 风险与剩余：原型模拟状态明确标记；现有服务器未挂完整账号/资产服务，默认新壳功能关闭；前端准入不能代替服务端鉴权。AST-06 真机继续按用户要求暂缓。
- 回滚：独立提交，旧可玩 Demo 保持原入口。
- 下一项：UI-02。

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

### UI-02

- 状态：完成
- 开始：2026-11-17 23:58 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / 632693c1a1b90178d6821be832dd0de32fe49b9b
- 范围：增量建立 React 19 + React Router 7 Web 页面壳、路由状态机与 Canvas 对战宿主，保留既有 DOM 入口直到新路径闭环。
- 实现：引入 React 19 + React Router 7 页面壳和响应式安全区布局；client-model 管理可取消的视图请求与内部路径；练习赛经 HostBridge 挂载既有 Canvas GameView，退出时释放订阅、音频、宿主和本地 Host。账号、资产及在线比赛保持后续任务接入，未伪造远端数据。
- 验证：完整 `npm run check` 通过（100 单元、5 契约）；完整 build 通过；navigation 与 web-shell 单元 7 项通过；web-shell Chromium 覆盖 1280/390/320、禁止入口和连续两次进入/退出，0 console error，并注入一次 Canvas 挂载失败后确认可重试；既有 Chromium E2E 16/16 通过，包含出手、触屏弧线、前后台、画质、资源预算、双端好友赛与宿主释放。
- 证据：本提交；docs/productization/reports/UI-02.md；docs/productization/reports/UI-02-browser.json。
- 风险与剩余：账号、资产、正式匹配和结算 API 由后续 ACC/DAT/NET/UI 任务接入；本任务不伪造远端业务数据。React Router 已升至 7.18.5 并消除本次新增依赖的审计高危项；审计余下 Express/Colyseus 传递高危项需要跨主版本迁移，留待独立架构任务处理。
- 回滚：独立任务提交可回退；保留旧入口以便恢复。
- 下一项：选择依赖已满足的未完成任务；UI-03 待 ACC-04、DAT-02。

### ACC-01

- 状态：进行中
- 开始：2026-11-18 00:40 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / 738bf39
- 范围：建立长期用户、身份、密码凭据、验证令牌和会话的 PostgreSQL schema、数据字典与账户仓储；不提前实现注册登录 API 或密码派生。
- 实现：新增 users/auth_identities/password_credentials/verification_tokens/sessions migration、账户仓储和数据字典；身份全局唯一按 provider/appId/subject，账户状态有单向删除终态，所有 credential/token/session hash 均不作为仓储输出返回。
- 验证：format/lint/typecheck 通过；真实 PostgreSQL 用例已覆盖迁移、状态迁移、并发身份唯一、一次性令牌、会话撤销和外键反例，但 `npm run test:integration` 因本机没有 Docker 而失败。获授权远程工作区也未发现 Docker 或 psql，未创建容器或安装服务。
- 证据：本提交中的 packages/persistence/migrations/202611180001_accounts.mjs、tests/accounts.integration.test.ts、docs/engineering/accounts.md；真实运行证据待补。
- 风险与剩余：任务仍未完成，必须在隔离 PostgreSQL 17 上运行 integration 测试并验证 migration up/down 后才可勾选。ACC-02 才引入 Argon2id、邮件和令牌流程；不得把 seatToken 当作登录会话。
- 回滚：独立 migration 和提交可回退；migration down 只允许本地/测试显式执行。
- 下一项：ACC-02（待 ACC-01）。

### WEB-01

- 状态：完成
- 开始：2026-11-18 00:52 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / 07186dd
- 范围：完善 React Web 大厅的桌面三栏与移动布局，覆盖安全区、dvh、大字体、软键盘可见区域和 320–1920px 主操作不裁切；不接入尚未实现的账号、资产或远端数据。
- 实现：桌面大厅采用左侧主导航、中央本地练习球场和右侧辅助面板；移动端保留顶部状态与底部主导航。以 visualViewport 高度驱动应用壳，安全区内边距、dvh 回退、大字体缩放和可滚动内容区均不改变 Canvas 比赛几何。云端内容明确标注为待接入，未伪造账号、资产、公告或阵容数据。
- 验证：`npm run test:web-layout` 通过；Chromium 覆盖 320x568、360x800、390x844、430x932、768x1024、1280x720、1440x900、1920x1080，均无横向溢出、球场预览/主操作/导航可见，桌面辅助面板仅在 >=1024px 显示；1.4 倍大字体和 420px 软键盘可见视口均通过。`npm run test:web-shell` 通过；完整 `npm run check` 通过（100 单元、5 契约）；完整 `npm run build` 通过；`npm run test:e2e` 16/16 通过。
- 证据：本提交；docs/productization/reports/WEB-01.md；docs/productization/reports/web-01/browser.json 与同目录规范视口截图。
- 风险与剩余：本任务验收完成。WEB-02 负责比赛输入与双方视角；WEB-03 再做多引擎可访问性兼容。真实账号/公告/阵容摘要依赖 ACC/DAT/UI 后续任务。
- 回滚：独立任务提交可回退；保留 UI-02 Canvas 桥接和旧入口兼容路径。
- 下一项：选择依赖已满足的未完成任务；WEB-02 仍待 FLD-02。

### WEB-02

- 状态：完成
- 开始：2026-11-18 01:14 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / 733db3f
- 范围：在既有 FLD-02 相机/手势数学与 Canvas 宿主上补齐鼠标、触摸、键盘输入边界和 side 1 视角验收；不改变物理、球场几何或线上权威规则。
- 实现：GameView 只接收首个主指针；输入框/选择框/文本域/可编辑节点获得焦点时不截获 Esc 或方向键。Esc、pointercancel、pointerleave、lostpointercapture、窗口失焦和 viewport 变动均取消瞄准并释放捕获；释放已丢失的捕获安全忽略。补充 Chromium 场景，实际鼠标、CDP touch、文本焦点、多指、失捕获、离场、缩放和双方联机视角均由真实 Canvas/服务端通路验收。
- 验证：`npm run format` 通过；`npm run test:e2e` 18 PASS / 0 SKIP / 0 FAIL（桌面 DPR 1 side 0 鼠标、移动 390x844 DPR 3 side 1 CDP touch）；`npm run check`、`npm run build` 与 `node tools/check-plan.mjs` 在本提交前通过。
- 证据：本提交；`docs/productization/reports/WEB-02.md`；`tools/e2e-browser.mjs`。FLD-02 已验证 4 视口 × 2 视角 × 3 DPR × 2 布局的 48 组统一坐标/手势矩阵，本任务未改动该数学。
- 风险与剩余：本任务验收完成。WEB-03 承担 Firefox/Safari/辅助技术矩阵；真机与 App/WebView 验收不以本任务 Chromium 自动化替代。
- 回滚：独立任务提交可回退；保持 FLD-02 相机与输入数学接口兼容。
- 下一项：WEB-03（待 WEB-02、UI-07）。

### WEB-04

- 状态：完成
- 开始：2026-11-18 01:45 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / bcc5f5e
- 范围：在 AST-05 的可校验有界资源缓存和 FLD-02/WEB-02 的 Canvas 实现上，补齐首屏/比赛运行性能观测与必要的无玩法变更优化；不改变球场几何、瞄准、物理或线上权威规则。
- 实现：练习赛 React 路由改为 Suspense 动态导入，比赛视图成为独立 chunk；大厅初始加载不请求比赛 chunk 或 `assets/fields` 场地资源。新增性能 Chromium runner，记录弱网首屏、帧时间和热身后连续 10 局的 JS 堆增量；既有质量档继续限制 Canvas DPR（1/1.5/2.5）且 Renderer 静态场地缓存不变。资源浏览器回归固定使用遗留比赛入口，使真实缓存损坏、离线、取消、低清纹理与断图出手验证不再因页面壳路由漂移而失效。
- 验证：`npm run test:web-performance` 通过：390x844 DPR 3、150ms 延迟、200KiB/s 下载下首屏 3933ms，初始资源 592583B，比赛 chunk/场地资源均未预取，帧 p50/p95 16.7ms，10 局热身后堆增长 884920B。`npm run test:assets-browser` 与 `npm run test:web-shell` 通过；`npm run check`、`npm run build`、`npm run test:e2e` 与 `node tools/check-plan.mjs` 在本提交前通过。
- 证据：本提交；`docs/productization/reports/WEB-04.md`；`docs/productization/reports/web-04/browser.json`；`tools/web-performance-browser.mjs`。AST-05 的资源 hash、失败回退、持久缓存/内存上限与低清资源矩阵继续生效。
- 风险与剩余：本任务验收完成。数据为本机 Chromium 头显仿真，非物理移动设备、Safari 或微信小游戏性能结论；这些平台矩阵由 WEB-03、AST-06、WX/APP 后续任务处理。
- 回滚：独立任务提交可回退；保留 AST-05 资源 hash/失败回退协议和既有性能质量档。
- 下一项：选择依赖已满足的未完成任务；WEB-03 仍待 UI-07。

### QA-01

- 状态：完成
- 开始：2026-11-18 02:18 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / c3c2fc5
- 范围：稳定本地基础测试的端口、临时存储、构建产物与进程清理；补充可重复 runner 和不依赖生产数据的基础 CI。不覆盖真实 PostgreSQL、真实设备或后续业务集成验收。
- 实现：测试环境唯一允许 `PORT=0` 交由系统分配；E2E 从服务端 `server_started` 事件读取实际端口，静态服务也默认使用临时端口。E2E 截图和模式诊断改写入忽略的 `work/e2e-artifacts`（可由 `E2E_ARTIFACT_DIR` 覆盖），并等待子服务退出后再清除临时房间存储。新增 `test:qa`：构建后连续两轮单元/契约、每轮两个并行 E2E，另保留端口验证失败非零及清理。GitHub Actions 基础作业固定 Node 24.22.1、Chromium、静态检查和同一 runner。
- 验证：先补 `APP_ENV=test, PORT=0` 配置用例（6/6 通过）。`npm run typecheck`、`npm run lint`、`npm run build` 通过。`npm run test:qa` 通过：两轮单元与契约、每轮两个并行 E2E 均通过；占用 Web 端口的 E2E 按预期非零退出，runner 断言未留下 `allstars-e2e-*` 临时房间目录。E2E 独立单跑为 18 PASS / 0 SKIP / 0 FAIL。
- 证据：本提交；`tools/qa-runner.mjs`；`.github/workflows/ci.yml`；`docs/productization/reports/QA-01.md`。CI 工作流未在本地伪称已运行，等待远端 GitHub 触发。
- 风险与剩余：真实 PostgreSQL integration 仍因本机没有 Docker 而属于 ACC-01/QA-02 的外部阻塞；真机/跨引擎矩阵留给 QA-03、AST-06、APP/WX 任务。构建仍含第三方 React Router/Zod 的既有 Rollup 注释提示，无新增构建错误。
- 回滚：独立任务提交可回退；常规运行端口下限和生产配置约束不变，端口 0 只在 test 模式有效。
- 下一项：QA-03（依赖满足）；APP-01、ACC-01、AST-06 分别仍受原生工具链、PostgreSQL、真机条件限制。

### QA-03

- 状态：完成
- 开始：2026-11-18 02:40 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / 9d1dc2b
- 范围：定义当前 Web 的支持/验收矩阵并实际运行 Chromium、Firefox、WebKit 代表路径；提供 iOS/Android/微信后续真机记录模板。真实设备、原生壳和微信环境均不在本轮冒充完成。
- 实现：新增兼容策略、物理设备记录模板和 `test:compatibility`。该 runner 使用构建后的静态 Web 客户端，在 Chromium、Firefox、WebKit 的桌面 1280×720 DPR 1 与移动 390×844 DPR 3 真实引擎中走“大厅→练习赛→退出”；捕获 page error 与页面 console error/warning。Firefox 的 `chrome://juggler` 自动化内部 warning 单独保留在报告，不与应用页面错误混同。默认结果写入忽略的 `work/compatibility`，显式环境变量才写入验收快照。
- 验证：PowerShell 下 `$env:COMPATIBILITY_REPORT='docs/productization/reports/QA-03/browser.json'; npm run test:compatibility` 通过，Chromium 159.0.8154.6、Firefox 159.0、WebKit 27.2 共 6/6 代表用例通过；所有页面 error 列表为空。既有 WEB-01 的 8 视口/大字体/软键盘证据、WEB-02 的鼠标/真实 CDP touch/键盘输入边界和 WEB-04 的弱网/资源恢复证据已纳入策略，未重新标记为物理设备。
- 证据：本提交；`docs/productization/COMPATIBILITY.md`；`docs/productization/reports/QA-03.md`；`docs/productization/reports/QA-03/browser.json`；`docs/productization/reports/QA-03-device-template.md`；`tools/compatibility-browser.mjs`。
- 风险与剩余：Playwright WebKit 不是 iPhone Safari 真机。iPhone 15 Pro、Android Chrome/WebView、微信双系统和 App 仍为未测；解除条件和记录字段已写入模板，对应 WX-06/APP-05/AST-06 不得使用此报告代替真机结果。
- 回滚：独立任务提交可回退；不改变游戏、资源、网络协议或生产支持范围。
- 下一项：选择依赖满足的未完成任务；APP-01 仍需原生构建工具链，ACC-01 仍需真实 PostgreSQL，AST-06 仍需真机资源验收。

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
