# ARC-02 · 共享边界契约

日期：2026-11-17。新增 @pengzhuang/contracts，提取实际服务端游戏消息校验到可移植包，旧 server/validation 重导出；协议常量仍共用现有 v1 来源，不改变在用字段/错误顺序。

新增注册/登录、资料、阵容、升级、票据、队列的严格 Zod 请求schema、HTTP错误结构、版本支持声明和类型导出。角色、价格、结果等级等越权附加字段被拒绝，revision 要求安全非负整数，金额以十进制字符串表示。持有权、授权和幂等仍由后续业务service负责，schema通过不等于授权通过。

`npm run docs:contracts` 从真实schema生成 docs/engineering/contracts.openapi.json，`--check` 检查文档漂移；文档明确controller尚未实现，不把接口规格冒充已上线API。旧WebSocket字段、消息大小限制和26个错误码也进入文档。

现有shot数值合法性继续由权威规则检查，不能用新Zod边界提前改变bad-number/bad-power等错误顺序。

验证：4个契约测试覆盖额外字段、非有限数、精度、重复卡、旧版本、Unicode昵称、ready和seat-token；check、文档一致性、server构建和原176项联机回归通过。HTTP真实业务端点在ACC/DAT/NET任务实现，未在此任务宣称完成。
