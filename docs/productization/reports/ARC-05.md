# ARC-05 · 配置版本、完整性与单局快照

日期：2026-11-17。

## 实现

- game-core提供canonical有限JSON和深度不可变快照，拒绝循环、非有限数、类实例、getter及过深输入，避免调用者后续改值污染快照。
- ConfigPackage包含schemaVersion、版本、协议范围、SHA-256和payload。VersionedRegistry先验证元数据/完整性/兼容，再调用注入的领域schema；相同版本不同hash拒绝，旧快照保留，可激活旧版本回退。
- 第一个实际领域是完整PhysicsConfig schema；GameData解析器从已验证物理版本和当前静态表构建快照，对缺失的其它领域历史版本明确拒绝，不按新表静默重算。
- 资源manifest schema校验资源ID、hash、尺寸/字节数、路径和重复项；真实资源生产与准入仍属AST任务。
- bundled-game-manifest覆盖完整GameData（不只物理）的SHA和协议/版本标签；启动拒绝数据与清单不一致。check:game-config检查漂移；export:game-config拒绝同版本更换内容hash，要求先升级变更组件版本。
- DEFAULT_DATA是隔离冻结快照；MatchRoom每次创建绑定自己的GameData和计时参数。新配置只影响新房间，原房间不读取可变全局数据。

## 验证

新增4项unit：canonical/不可变边界，hash/schema/版本冲突/协议不兼容/旧版本回退，资源manifest坏路径/重复/hash，大版本切换前后两个真实Colyseus房间的配置隔离。现为15项unit和4项契约通过。

真实命令：check、完整build、physics18/18、net176通过；构建后的服务和Chromium9项通过，0skip/0JS错误。清单hash被临时篡改后，检查和源码启动均失败；同标签重写hash被export命令拒绝，恢复后检查通过。

## 边界

Hash是完整性校验，不是发布者认证。本轮没有开放远程配置发布入口，没有以校验和替代管理员授权/签名。领域的更强数值语义在FLD/BAL扩展；持久归档及跨重启旧版本接管在NET-05完成。当前默认只激活随应用交付的已验证版本。
