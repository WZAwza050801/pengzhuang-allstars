# 持有阵容与参赛快照（DAT-03）

阵容服务使用 [真实云存档](player-data.md) 的 ownedCard UUID，不把静态 playerDefId 或客户端等级当作持有权。身份校验在业务事务内复用 requireActivePrincipal，按用户→会话→阵容→按 UUID 排序的持有卡取锁。所有变更和校验失败均在同一事务处理。

| API | 请求/响应 data |
|---|---|
| `GET /api/v1/me/lineups` | 可选 limit 1–50（默认 20）、UUID cursor；返回 lineups/nextCursor。 |
| `GET /me/lineups/:id` | 本人的 id/name/revision/按槽排序的 ownedCardIds；他人及不存在同为 404。 |
| `PUT /me/lineups/:id` | 仅 `{ownedCardIds:[五个UUID],expectedRevision}`，成功返回新 revision 和阵容。 |

省略的前缀均为 `/api/v1`。注册后的默认阵容由 DAT-02 创建；本任务不增加创建/删除预设或重命名入口，后续产品页面如需新增须使用有界配额和相同权限校验。读取能呈现至多五个已存槽，缺少五槽的历史/内部空阵容不能构建参赛快照。

服务端检查五个槽位、卡唯一、定义唯一、真实持有者、active 状态及 1–10 级。拒绝未知/他人卡及客户端提交等级、球员定义、角色、模式、目标用户等额外字段。阵容 revision 必须匹配；并发同一旧版本只一项成功，另一项 409。更新 revision、删除旧槽、插入新五槽全部原子提交；任一插入失败恢复原 revision 和整套阵容。网络结果不明确时先 GET 核对，不盲重发旧 revision。

## 位置规则与证据

当前五槽是 DC/CM/CM/ST/ST，但**职业只是展示/推荐，不硬绑定槽位**。旧 client/src/lineup.ts 的 valid/place 可把任意目录卡放入任意槽；ROLE_POS 仅用于默认和随机选卡推荐。shared parseSetLineup/createMatch 同样接受任意五个唯一合法定义。固定 starter-v1 的 p07/p06/p08 是 GK/DF/DF，在 DC/CM/CM 槽正常使用。

因此位置校验指五个固定槽的边界、完整性、顺序和唯一占用，不能悄悄改成“中场槽必须 MF”导致既有新手卡组不可参赛。API 用数组顺序生成 slot 0–4，不接收额外坐标、slot 编号或职业覆盖。快照同时保留 slotRole/cardPosition，分别表达场上位置和球员元数据。未来如需职业限制，应版本化规则并给出存量卡组/授予迁移及用户确认。

## 卡状态、模式与快照

迁移 202611180009 为 owned_cards 增加 active/disabled，旧卡默认 active；GET/cards 返回状态供 UI 显示。没有玩家切换状态的 HTTP 入口；未来 ADM/DAT 的状态变更应同样先锁用户，再锁卡并提升版本。禁用卡不自动删除阵容槽，但保存与参赛都会拒绝，恢复状态后重新读取可用。迁移 down 丢失禁用标志，仅限隔离测试。

保存通用持有阵容不提前按某个模式删卡。参赛时由服务端 Lineups.snapshotInTransaction 接受可信 Principal/lineupId/expectedRevision/mode，并重新读锁卡状态，使用冻结的 GameData 与 rulesForMode/resolveModeLineup：growth 取真实持有等级；ranked/friend 固定 Lv5；practice 的该云端入口按既有默认 Lv5，离线练习的自由选卡/等级仍走原通道。正式 growth/ranked 拒绝未实现技能；friend 保留既有源卡能力，不声称未实现效果已实现。

快照深拷贝冻结，包含 schemaVersion、内部 userId、lineupId/revision、完整模式/数据/技能版本规则，以及五张 slot/slotRole/cardPosition/ownedCardId/playerDefId/cardVersion/ownedLevel/effective level 和实际 pieceStats。属性与技能解锁复用 BAL-02 纯规则，不复制另一套映射。之后库存升级/禁用不会修改已有快照；新的入局必须再读并校验。卡查询单表 FOR UPDATE，不用等待前的 joined 凭据/等级快照；等待卡锁后会取得已提交版本。

NET-01/03 必须把 snapshotInTransaction 与签发/持久化票据放在**同一事务**，绑定用户/session、模式及配置，在消费/重连再检查即时状态。保存或获得一个快照不构成入局授权。本任务提供可组合构建器，没有开放客户端上传快照/等级或比赛票据接口；本局 pieceId 仍由未来房间分边后生成，不混用 ownedCardId。

实际 HTTP/数据库、失败注入、等待锁后的新等级与冻结快照证据见 [DAT-03 报告](../productization/reports/DAT-03.md)。

UI-04 已接持有卡筛选、五槽点选、旧偏好草稿与 revision 冲突比较；未知保存结果先 GET 核对，保留原草稿。客户端页面和可选账号目标头见 [owned-inventory.md](owned-inventory.md)，不新增职业限制或预设创建配额。

NET-01 已使用同事务快照签发一次性票据并接入独立账号房，消费/重入复查即时权限；见 [account-rooms.md](account-rooms.md)。本页此前“未来票据接口”的描述是 DAT-03 当时的交付边界。
