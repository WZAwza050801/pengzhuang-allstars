# 大厅、比赛界面与多端前端设计

## 1. 设计原则与平台差异

统一的是信息架构、语义、资产 ID、视图模型和设计 tokens；布局和平台宿主可以不同。不能把“跨端”理解为把一个网页缩小后放进所有环境。

| 环境 | 界面实现 | 必须单独处理 |
|---|---|---|
| Windows/macOS/Linux 浏览器 | React DOM 大厅 + Canvas2D 比赛 | 鼠标/键盘、窗口缩放、DPI、桌面宽布局 |
| Android/iOS 手机浏览器 | 同一 Web 业务页面，移动布局 | 触屏、软键盘、地址栏变化、安全区、音频解锁 |
| 微信小游戏 iOS/Android | 独立 Canvas2D 场景、HUD、弹窗与命中测试 | wx 网络/存储/登录/音频、分包、onHide/onShow、平台分享与生命周期 |
| Android App | Web 页面 + 原生桥接 | 系统返回、Keystore、网络切换、原生权限、进程恢复 |
| iOS App | Web 页面 + 原生桥接 | WKWebView、Keychain、安全区、音频打断、App 状态与商店规则 |

优先检测能力和 viewport/input/safeArea；只有平台接口确有差异时才按系统分支。普通小程序的 WXML/WXSS 页面如单独建设，使用相同 client-model，但不复用 React DOM 或小游戏 Canvas 宿主。

## 2. 大厅信息架构

默认 5 个主入口：比赛、阵容、成长、俱乐部、我的。非付费测试版不把充值作为主入口。历史大厅“商店/成就/俱乐部未开放”等状态应迁移为明确功能开关和说明，不能长期保留无响应入口。

### 大厅主屏

- 顶部：头像、昵称、账号等级、真实余额、连接/维护提示；余额加载中用骨架，不显示假 0 后再闪变。
- 中部：球场展示/当前赛事、模式说明、排位段位/进度；主按钮“开始比赛”，次入口“好友约战”“练习”。
- 辅助区域：公告、任务、邮件、成就；有红点必须来自服务端未领取/未读状态。
- 底部或侧边：主导航、设置。小屏不把所有活动入口堆在可玩区域。
- 未登录：可练习；进入云端资产/联机时引导登录，登录成功回到原操作，不清空本地设置。

PC 建议左侧导航/账号，中央球场与开始按钮，右侧阵容摘要/公告；移动端用顶部账号、中央卡片、底部导航。比赛中 PC 两侧可放球员信息，不改变竖向球场几何。

### 页面与必须状态

| 页面 | 核心内容 | 关键状态 |
|---|---|---|
| 登录/绑定 | 邮箱密码、微信入口、验证/找回、账号冲突解释 | 提交中、验证码失效、限流、网络断开、绑定冲突 |
| 大厅 | 模式、赛事、开始、公告/任务/邮件入口 | 匿名、加载、在线、离线、维护、版本过旧 |
| 阵容 | 持有卡、按位置筛选、属性详情、预设、升级 | 空卡组、无合法阵容、保存冲突、升级余额不足 |
| 匹配 | 模式/规则/阵容摘要、等待、取消 | 排队中、取消中、已匹配、超时、重试 |
| 好友房 | 邀请码/分享、双方阵容摘要、准备/取消 | 等对手、对手离开、准备冲突、开局、版本不兼容 |
| 比赛 | 比分、时钟、回合、连接、出手/弧线、认输 | 我的回合、对手回合、播放、恢复中、暂停输入、结束 |
| 结算 | 比分、原因、奖励、积分变更、再来一局 | 结算处理中、已入账、查询失败可重试、服务器作废 |
| 任务/邮件/成就 | 服务端进度、详情、领取 | 空态、过期、重复领取、领取处理中 |
| 俱乐部 | 创建/加入/退出、成员、角色、活动 | 无公会、申请中、满员、权限不足 |
| 我的/设置 | 账号、设备会话、音量、画质、隐私、反馈、注销 | 保存失败、离线设置、会话撤销 |

账号、资产和结算页面不输出服务器堆栈、内部 ID 密钥、raw JSON；调试信息放开发面板，不进入普通产品操作流程。

## 3. UI tokens 与组件清单

初始风格保留轻松足球/卡牌的轮廓与语义，合法素材确认前可用原创占位资源。新美术需明确命名、尺寸、锚点和授权，不能把提取原图当作默认可商用。

tokens：背景/面板/强调/危险/成功/禁用、正文字号/标题/数字、间距 4/8/12/16/24、圆角、遮罩、焦点、对比度、动画时长、减少动态偏好。字号使用逻辑单位，不把 iPhone 某机型的物理像素当通用值。

组件：Avatar、CurrencyAmount、PrimaryButton、ModeCard、PlayerCard、AttributeBar、LineupSlot、RuleSummary、ConnectionBanner、Countdown、Dialog、Toast、EmptyState、ErrorState、LoadingSkeleton、RewardRow、Pagination/CursorList、SafeAreaContainer。

- 每个组件定义 props、动作、禁用语义、loading/error/empty，列出 Web 与 Canvas 宿主实现。
- Web 使用语义按钮、标签、焦点顺序；不能把可点元素全做无键盘能力的 div。
- 最小触控目标初始取 44 CSS px 或等效逻辑单位，小屏验证后调整。
- 成功/失败不能只靠红绿颜色；数字加单位，货币用同一格式函数处理 bigint 字符串。
- 动画可跳过、可降低；不使操作正确性依赖某个 CSS transitionend 一定触发。

## 4. 业务状态机与关键代码提示

```ts
type LobbyState =
  | { tag: 'loading' }
  | { tag: 'anonymous'; canPractice: true }
  | { tag: 'ready'; profile: ProfileView; activeLineupId: string }
  | { tag: 'queueing'; entryId: string; since: number }
  | { tag: 'room'; room: RoomView }
  | { tag: 'maintenance'; message: string; retryAt?: number }
  | { tag: 'error'; code: string; canRetry: boolean };

interface LobbyActions {
  practice(): Promise<void>;
  createFriendRoom(): Promise<void>;
  joinFriendRoom(code: string): Promise<void>;
  startMatchmaking(mode: string): Promise<void>;
  cancelMatchmaking(): Promise<void>;
}
```

UI-02 实现可取消请求、单次提交、过期响应丢弃与退出清理。后一个页面不能被前一个页面迟到的网络结果覆盖。平台视图只订阅模型和派发动作；不在渲染函数中反复注册 socket/订阅。

React 挂载桥接示意：

```tsx
function MatchScreen({ context }: { context: MatchContext }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const bridge = createWebGameHost();
    let stopped = false;
    void bridge.mount(root.current!, context).catch((e) => {
      if (!stopped) reportMatchMountFailure(e);
    });
    return () => { stopped = true; void bridge.dispose(); };
  }, [context.matchId]);
  return <div ref={root} className="match-host" />;
}
```

这只是生命周期提示：实现必须处理异步 mount 进行中 dispose、StrictMode 双挂载、context 更新、订阅清理、挂载失败后的可恢复页面；不能照抄后留下泄漏。

## 5. 比赛输入与 HUD

- 鼠标：反向拉线、释放出手、Esc 取消、左右键调弧线；文本输入聚焦时不截获游戏快捷键。
- 触屏：单指拖拽和弧线；忽略第二指或明确取消；pointercancel/系统手势/离开屏幕不得误发球。
- 同一逻辑坐标的拖拽在不同 DPI/方向下生成同样意图。瞄准线规则来自 BAL/FLD，不因画面大小改变精准收益。
- 提交后立即进入 pending，收到 seq/错误/恢复后再允许下一次动作；网络慢时不能双发。
- 对手回合、回放、断线恢复中禁用出手；给出原因。UI 倒计时只是显示，超时认定以服务端为准。
- 声音首次用户操作解锁；后台暂停，前台按设置恢复。iOS 音频中断和微信回前台需真实验证。
- 退出对局确认说明规则后执行；杀进程按断线策略处理，不把客户端确认弹窗当服务端认输证据。

## 6. 微信小游戏重做规范

建议场景：BootScene、LoginScene、LobbyScene、LineupScene、MatchmakingScene、RoomScene、MatchScene、ResultScene、ProfileScene、ModalLayer。每个场景有 enter/update/render/resize/leave/dispose；统一命中测试、焦点/触控捕获与滚动容器。

```ts
interface MiniScene {
  enter(input: unknown): Promise<void>;
  resize(v: Viewport): void;
  update(deltaSeconds: number): void;
  render(ctx: CanvasRenderingContext2D): void;
  onTouch(event: GameTouchEvent): void;
  dispose(): Promise<void>;
}
```

类型名称是抽象，不应强制小游戏 ctx 必须满足浏览器完整 DOM lib；应为实际 wx Canvas 能力定义窄接口，避免通过 any 掩盖不支持方法。

- 微信授权/隐私接口按当前官方规则，文案与触发时机合规，不能旧版自动弹授权。
- 手机文本输入使用平台键盘/原生输入接口，不能假设 HTML input 可用。
- onHide 取消未提交瞄准、暂停表现与音频；onShow 刷新会话、重新查询房间、恢复服务端时钟，不能重新本地开局。
- 分享邀请使用短期可验证标识，不能分享 seatToken/access token；过期房间可回大厅。
- 主包只含开屏、登录和最小资源；图集/场地按模式分包或远程加载，预算查当前平台规则并记录日期。
- WX-02 必须在微信开发者工具和至少一台 iOS、一台 Android 真机跑通协议 PoC；缺真机时任务保持未完成。

## 7. App 与桌面

Capacitor PoC 验证：稳定帧率/耗电、纹理内存、音频恢复、键盘、WebSocket、缓存/版本升级、弱网、后台/进程重建。未达预算先定位资源/布局/桥接，明确失败后才启动替代客户端 ADR。

Android 返回按层级处理：关闭弹窗 → 返回上一页 → 比赛退出确认 → 系统退出。iOS 使用页面导航与原生生命周期，不能依赖安卓键。原生凭证插件必须真实使用 Keychain/Keystore，不以 Preferences 冒充安全存储。

桌面安装包只在 WEB-06 选择需要后实现：签名/更新/回滚/协议打开、安装卸载、系统权限。仅把网页装进窗口而没有更新与签名方案，不算成熟桌面交付。

## 8. 适配验收矩阵

Web 视口至少：320×568、360×800、390×844、430×932、768×1024、1280×720、1440×900、1920×1080；DPR 1/2/3；鼠标/触摸；正常/弱网/离线；正常/大字体。Firefox/WebKit/Chromium 按最终支持策略选实测版本，不只跑 Chromium。

原生与微信矩阵至少包含 iOS 刘海/灵动岛、Android 手势/三键导航、高/低性能设备；记录机型、系统、微信或 WebView 版本、构建 hash。模拟器可提前发现问题，不能替代平台最终真机勾选。

所有页面验收：主任务可达、无被裁切操作、软键盘不挡提交、滚动区域不抢出手手势、文字无溢出、请求可取消、异常可恢复、回退正确、循环进入退出无监听器/音频/画布泄漏。AST-06/QA-03 保存截图与交互证据，不只做静态首页截图。
