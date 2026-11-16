# 前端方案：先让一杆球从输入走到同一份结果

玩家按住棋子后，前端把手指位置换成球场坐标，显示方向和力度；松手后发给服务器。服务器返回球与棋子的位置，前端播放这些位置、碰撞声音和比分。这条流程通了，再做卡包和成长界面。

## 建议采用的技术

| 职责 | 建议 | 选择原因 |
|---|---|---|
| 构建与类型 | Vite＋TypeScript | 前后端和校准脚本共享数据类型；前端产物可静态托管 |
| 球场画面 | PixiJS 8，WebGL优先 | 本作是少量圆盘和贴图的2D场景，图层和纹理足够表达 |
| 大厅、人物、卡牌、房间 | DOM＋CSS | 表单、列表、筛选、弹窗用浏览器控件更易维护；首版无需再引入界面框架 |
| 物理 | 独立Planck.js包 | 浏览器与Node均可运行，圆形刚体及高速碰撞可用；不绑定渲染场景 |
| 联机 | Colyseus客户端SDK | 与服务端房间和状态对应；客户端SDK与服务端必须选择兼容版本 |
| 验证 | Node内的轨迹检查＋Playwright双浏览器 | 前者核查物理，后者核查完整联机与触摸流程 |

这是一套**待实施的选型**。PixiJS 8、Planck、Colyseus文档能力已核对，不代表这些包已组合安装或性能达标。实施时读取当前官方安装说明，锁定兼容版本，提交lockfile及实际Node版本；不能从不同大版本教程复制接口拼接。

官方依据（2026-11-14查阅）：[Vite构建](https://vite.dev/guide/build)、[PixiJS 8渲染器](https://pixijs.com/8.x/guides/components/renderers)、[Planck项目](https://piqnt.com/)、[Colyseus状态同步](https://docs.colyseus.io/state)。官方文档说明能力；上表如何组合是本项目建议。更多来源类型和限制见08目录。

## 游戏画面与页面

| 页面 | 玩家能做什么 | 最小完成条件 |
|---|---|---|
| 入口／大厅 | 设置昵称、创建房间、输入房号、快速匹配 | 显示网络状态与当前连接地址，不要求注册社交账号 |
| 阵容 | 看头像、原版五属性、技能，选择5人 | 卡牌和人物区分，闪卡不重复生成头像；数据来源版本可查看 |
| 房间 | 分享链接、准备、选择场地 | 双方看到同一名单与准备状态；满员拒绝加入 |
| 比赛 | 选择棋子、瞄准、力度与弧线、出手 | 只有行动方可操作；服务器接受前不扣回合 |
| 结算 | 看比分、再来一局、回大厅 | 双方同一结果；重复消息不重复写战绩 |
| 训练 | 回放样例球、比较原图／重绘头像 | 和正式对战使用同一份物理；不另写“简化版碰撞” |

第一版优先竖屏。桌面用居中球场及旁侧资料区，手机在上下安全区安排控制。不要把30个技能按钮挤在球场上；核心是棋子、球和瞄准的可读性。

## 建议工程目录

```text
apps/web/src/
  screens/LobbyScreen.ts
  screens/LineupScreen.ts
  screens/RoomScreen.ts
  match/MatchView.ts
  match/AimInput.ts
  match/WorldToScreen.ts
  online/RoomConnection.ts
  assets/PortraitCatalog.ts
apps/server/src/
  rooms/SoccerRoom.ts
  rooms/MatchmakingQueue.ts
  storage/MatchRepository.ts
packages/match/src/
  types.ts
  createMatchWorld.ts
  stepMatchWorld.ts
  applyShot.ts
  detectGoal.ts
  resolveTurn.ts
  sampleAimTrajectory.ts
packages/data/
  original/                   # 从资料包复制的原值，禁止手改
  resolved_roster.json         # 本次复刻选择哪版、哪张表
  attribute_mapping.json      # 属性点如何换成速度／质量
  physics.json
  rules.json
tools/calibration/
  runCalibration.ts
  recordTrajectory.ts
  compareTrajectories.ts
```

这是目录草案，没有声称相应代码已实现。`packages/match`独立是为让服务器、预览和自动校准调用同一段计算，避免每改一次碰撞要改三处。

## 浏览器里容易踩的具体问题

- 用Pointer Events统一鼠标和触摸。按住棋子后捕获指针，处理pointercancel；点进菜单或失焦取消瞄准，不偷偷出杆。
- 屏幕像素不等于球场坐标。先减掉canvas位置与留黑，再按缩放换算；窗口缩放后重新计算。红蓝视角可以旋转显示，但发给服务器的坐标始终只有一套。
- CSS尺寸、画布分辨率和设备像素比独立处理；先将DPR上限设为2作为实现建议，实测后调整。缩放只改显示，不改变圆盘半径、力量和边界。
- 瞄准线从当前服务器停稳快照的副本开始计算，碰到第一件物体后可截断。预览不提前泄露隐藏技能触发或随机结果。
- 切到后台只暂停画面。服务器持续计算已经出手的球；回来先应用完整快照再恢复插值，禁止用本机积压时间补算整场。
- 先加载当前阵容与球场；人物总览按需加载缩略图。使用本地素材清单与版本化URL，不依赖历史图片站运行时可用。
- 显示昵称用textContent或框架的默认转义，不拼接HTML；服务器也检查长度。涉及浏览器构建变量，`VITE_*`属于公开配置，不能放服务器密钥。依据：[Vite环境变量](https://vite.dev/guide/env-and-mode)。

接口草案见`data_contracts.ts`。它只定义形状，不能替代服务器运行时校验。
