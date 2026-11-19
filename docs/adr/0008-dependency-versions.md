# ADR-0008 · 依赖版本与升级

- 日期：2026-11-17
- 状态：工程实施默认，可凭实测和用户明确要求修订；不冒充平台审核或产品商业批准。
- 影响任务：FND、ARC、UI、APP

## 决策

Node24.22.1/npm11.9.0固定；旧Planck/Colyseus先保持；Zod4.6.7、Vitest5.1.0等实际引入均精确锁定。AntDesign6.7.1与Capacitor8.6.2替代旧规划候选。

## 备选与取舍

采用FND-02查得的发行/engines/peer数据，不以latest漂移安装。AntDesign/Capacitor只是更新候选，未视为实测可用。

## 验证与修订

新增依赖必须有使用点和相关测试；工具链升级独立提交；FND-05已实测Lint/格式/类型/unit兼容，UI/原生另测。

AST-06 的局域网 HTTP 兼容使用精确锁定的 @noble/hashes 2.4.0（Node >=20.19.0、MIT、无运行时依赖）。只在 WebCrypto 不可用时动态加载 sha2.js 的 sha256；用途为公开资源内容完整性校验。官方用法见 [2.4.0 README](https://github.com/paulmillr/noble-hashes/blob/2.4.0/README.md#sha2-sha256-sha384-sha512-and-others)，浏览器限制见 [Crypto.subtle](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/subtle)。空串/abc/1MiB 输入与 Node 原生实现交叉校验，另外验证真实 HTTP 非安全上下文；不自写哈希算法或跳过校验。

如果该默认无法通过验证，记录硬件/平台/版本、失败证据、替代项、迁移任务和回滚方法；先更新ADR及依赖，不静默改框架或玩法。
