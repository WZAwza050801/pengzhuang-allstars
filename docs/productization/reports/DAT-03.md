# DAT-03 · 阵容持有权、等级与参赛快照

2026-11-18，Windows / Node 24.22.1 / npm 11.9.0 / PostgreSQL 17.12 / Chromium。API、位置证据及 NET 接入边界见 [lineups.md](../../engineering/lineups.md)。本轮未使用远端服务器。

| 验证 | 实际结果 |
|---|---|
| `npm run test:integration` | 10 文件 / 107 项通过，0 跳过；阵容 11 项，实际 HTTP、数据库、行锁及运行时挂载。 |
| `npm run check` | 122 单元 / 8 契约，工具链、边界、lint、204 文件格式、类型、配置、规划及生成契约/数据校验通过。 |
| `npm run build` | 生产客户端及服务端通过。 |
| `npm run test:e2e` | 18 PASS / 0 SKIP / 0 FAIL，console error/pageerror 均 0。 |

HTTP 验证真实初始阵容读取/保存和卡 UUID 顺序、独立阵容/卡/定义 ID；外人及不存在阵容同为 404；他人卡、未知卡、重复卡、四卡、定义 ID 代替 ownedCardId、额外等级/角色/用户/模式拒绝。同一旧 revision 并发保存只有一项 200，另一项 409，数据库五槽等于获胜整套。插入槽位时实际 SQL trigger 故障使 revision 和旧槽全部回滚，解除故障后可重试。

快照从锁定库存读取真实 1/4/7/9/10 级：growth 使用持有等级，ranked/friend 固定 Lv5，并将这两套等级送入真实 createMatch，十个棋子的等级与模式一致。快照深冻结，后续数据库升级不会改变旧快照，新快照携带新等级/卡版本。实际卡 UPDATE 未提交时，构建器在 FOR UPDATE 上等待，通过 pg_stat_activity 验证阻塞；提交后得到新等级 9/新版本，而非等待前的旧读值。

卡禁用后保存 400、正式快照 409，库存 API 返回 disabled，存储槽未被暗改；恢复状态后的新快照取新版本。未实现源技能卡可保留 friend 行为，growth/ranked 拒绝。快照与 MatchDataRepository 同事务组合时，外层故障回滚比赛和参与者；旧阵容版本、伪造 Principal、账户封禁均不能构建。分页每次两组完整遍历五预设，无重复或外人 ID；生产 startRuntime 实际挂载并可保存。

首轮三项纯规则测试揭示“职业必须绑定阵型角色”的错误假设：starter 的 p07/p06/p08 是 GK/DF/DF，而槽位是 DC/CM/CM。核对旧 valid/place、parseSetLineup/createMatch，已有玩法允许跨职业落位，ROLE_POS 只作默认推荐。因此撤回新增硬限制，保持五槽完整/顺序/唯一占用；跨职业回归通过。没有改初始卡、经济参数、职业元数据、场地或模式。位置口径已补入领域规范，未用特例为新手卡组绕过校验。

新增 owned_cards active/disabled 迁移；原卡默认 active，down 会失去禁用标志，仅隔离测试可用。新增阵容服务暴露内部 snapshotInTransaction，未来 NET 必须在同一事务持久化票据并在消费/重连查即时状态；当前没有冒称入局鉴权/房间票据已完成。新服务出现第四份相同业务身份检查时，提取 requireActivePrincipal，原会话/生命周期/云存档复用同样的锁顺序和拒绝语义，完整既有回归通过。

无新增外部依赖，临时 PostgreSQL 正常停止，SMTP 套件亦包含在全量回归并正常关闭。真实微信/设备、素材授权、平衡放量及已有依赖审计门槛保留。完成后 47/112，下一项 DAT-04；第 50 项按用户规则同步 GitHub。
