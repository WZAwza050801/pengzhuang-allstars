# ARC-03 · 平台能力和宿主生命周期

日期：2026-11-17。新增 @pengzhuang/platform：可移植接口、Web适配器、可取消异步宿主桥；Node环境导入包不访问window/document。

## 实际接入

- 原大厅start经宿主桥创建真实GameView；重复挂载释放旧视图，迟到的异步挂载在取消后被释放，不留活动宿主。
- GameView使用平台viewport和前后台订阅；后台取消瞄准、停止渲染与音效，前台恢复表现；服务端比赛时钟仍为权威，不伪造暂停比赛。
- 退出释放监听、RAF、声音计时器/AudioContext和调试句柄；构造失败也执行清理。sfx不再在导入时读取localStorage。
- Web storage提供异步边界和明确不可用错误；viewport读取DPR/输入类型/安全区；HTTP有Origin白名单、取消、期限、1MiB响应上限和JSON错误；WebSocket支持文本/二进制、出站2048字节、入站2MiB及显式释放。
- 认证provider在ACC之前明确为null，不生成假token；小游戏和App专用API还未实现，由各自任务验收。Colyseus现有SDK仍负责比赛连接，不把通用socket适配器当作已完成微信SDK移植。

## 验证

5个新增平台行为测试：迟到挂载取消、重复挂载/暂停恢复、真实本地HTTP的正常/超时/取消/大包/非法JSON/越源、真实WebSocket文本/二进制/限长/释放、存储和幂等释放。

check包含11项unit和4项契约通过；完整构建和真实Chromium冒烟通过，并新增前后台输入恢复及退出宿主释放两项。浏览器没有JS错误；未以此宣称微信或原生真机验收。
