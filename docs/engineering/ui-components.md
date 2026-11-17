# Tokens 与组件目录

`config/ui-tokens.json` 是单一输入；`npm run ui:tokens` 生成 `client/src/ui/generated/tokens.css` 与 `tokens.canvas.json`，`npm run check:ui-tokens` 逐字比较生成结果。CSS 与 Canvas 数据使用相同语义、逻辑单位、亮暗色板、44px 触控目标及减少动态偏好。卡框的品质色也从该输入导出，保留 AST-02 已验收色值；UI 包和卡图集的来源指纹随输入变更，PNG 字节保持一致。

实现入口为 `client/src/ui/components.ts` 和 `semantics.ts`。状态为 ready/selected/disabled/loading/empty/error；前两者可触发动作，其余不能触发主动作。错误重试是 ErrorState 中独立的可用动作。loading 提供 aria-busy，余额未知显示加载状态，不假造 0。选中/禁用/错误同时有文字或符号，不单靠颜色。

| 组件 | Props | 动作与关键状态 |
|---|---|---|
| PrimaryButton（Button + primary） | label/state/primary | onActivate；disabled/loading/empty/error 禁止主动作；set 更新视图 |
| Avatar | name/url? | 缺图/失败显示姓名首字 |
| CurrencyAmount | value: string或null/unit | 整数字符串精确分组；null 加载，不经 Number |
| ModeCard | title/summary/state | onSelect；选中/不可用与理由由调用方提供 |
| PlayerCard | atlas/images/playerId/state | onSelect；复用 AST-02 裁切与身份映射、可访问标签；禁用不能选择 |
| AttributeBar | label/value/max | 数值与 meter；拒绝无效范围 |
| LineupSlot | label/player或null | onSelect；空位可选择，角色文字不藏在图里 |
| RuleSummary | summary | 只展示权威摘要，不能据此修改规则 |
| ConnectionBanner | online/offline/reconnecting | 文本/错误/忙碌语义；输入权限仍由比赛宿主裁定 |
| Countdown | remainingSeconds | 只格式化权威剩余秒；不在组件里结算超时 |
| Dialog | title/body/confirmLabel | open/onConfirm/dispose；取消/Esc、双向焦点循环、关闭恢复触发按钮 |
| Toast | message | polite status，不自动抢焦点；宿主管理展示周期 |
| EmptyState | message | 明确无内容；后续动作由页面提供 |
| ErrorState | message | retry；失败描述，不输出内部堆栈 |
| LoadingSkeleton | label | aria-busy、静态骨架，无动画依赖 |
| RewardRow | value/unit/pending或posted | 展示处理中或已入账；不授予任何资产 |
| Pagination | page/total | onChange；边界按钮禁用 |
| SafeAreaContainer | 子内容 | 宿主安全区留白 |
| CanvasState | theme/state/label/width/height | 同一 statePresentation；窄 box/label 绘制能力与 Web 适配器，返回动作资格供宿主输入适配 |

这些是展示组件，不实现账号、资金、匹配、请求持久化或服务端权限。样例页明确使用演示数据，后续 UI 任务接真实业务并负责请求取消、状态更新和组件生命周期。Web 壳使用 React 的工作仍在 UI-02；这里没有为组件展示引入第二套路由或业务仓库。

`drawCanvasState` 与 Web 按钮使用同一状态模型和颜色；`webUiCanvas` 是当前浏览器适配器。未来小游戏可实现 box/label 能力并复用模型，不要求 wx 对象继承 DOM。PlayerCard 的 Web Canvas 绘制已验证，小游戏实际输入、字体/圆角能力与交互组件实现由 WX 任务负责，不能把该样例记作小游戏全量 UI。

`npm run test:components-browser` 在隔离的 components-debug.html 中验证 19 类样例、六状态 Web/Canvas 像素颜色及资格一致、卡牌切换、错误重试、分页、模态焦点、亮暗、200% 字号与 DPR1/2/3。单元测试校验 tokens 一致、前景/背景对比度≥4.5、焦点/背景≥3、最大 int64 金额格式与非法输入。截图和证据在 reports/components；预览不进入生产包。
