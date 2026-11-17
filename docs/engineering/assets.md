# 资源清单与引用规则

`client/public/assets/catalog.json` 为运行时可读取的版本目录；schema 是 contracts 的 AssetCatalogSchema。`npm run assets:catalog` 生成，`npm run check:assets` 全量核对，`build:client` 在构建前运行后者。以资源/绑定内容hash产生 assets-版本，无时间戳。改变资源、程序化绘制或音效代码后先审查，再重新生成并刷新 `node tools/audit-assets.mjs --write`；不能把变化隐藏在同版本缓存中。

文件 ID 由公共相对路径将 `/` 换为 `.`，便于追溯；player.<id>.portrait、field.<skin>.art/scene/generated、lobby.stadium.<n> 和 audio.<effect> 为语义绑定。跨端资源管理器应按 ID 获取条目，不将原始 materials/art 源目录拼接为运行时 URL。当前旧 UI 路径保持兼容，AST-05 承接缓存/加载迁移与发布包过滤。

每条包含 hash/字节数、尺寸、锚点、类别、优先级、来源、授权、目标几何版本。图像尺寸从PNG/JPEG/WebP/ICO头读取，锚点使用归一化或像素空间；完整比赛场景额外标注可玩矩形两角。程序化音效和场地引用源代码hash，无图片路径/尺寸，不伪造音频文件。图像字段、越界锚点、重复ID/路径、缺失绑定和无凭据的发布批准由严格schema拒绝。

扫描覆盖所有公共图像，以及client/src中TS/CSS/HTML的显式资源路径、UI图标字符串、全部117球员头像、九套场地、五张大厅场地图、九种程序音效的动态绑定。任意静态拼接无法普遍自动证明；新增动态命名必须同时在生成器中列举合法输入域，不能用“目录有一张图”充当完整引用检查。data/fields和portrait_map保留source信息；前端只读取已复制的public资源。

保留并显式排除三项：自引用的catalog.json、历史带时间戳art/manifest.json、空遗留文件assets/players/g03。具体原因在config/asset-catalog-policy.json；没有删除原文件。现有public/art/raw/cutout是公开目录副本，当前标为optional，发布精简由AST-05负责。

当前所有资源的商业再分发授权均未核实，releaseAllowed=false；不能将原版、重建或自行编写代码描述为已经获得完整商业发行授权。REL-01取得证据或替换后再修改来源策略。缺凭据不阻止本地工程验收。

程序化场地hash还包含quality、field-art和camera的源文件hash，避免这些绘制依赖变化时目录版本不变；bytes为这些源文件字节数之和，不是网络图片尺寸。source.evidence列出完整纳入列表。

卡牌规范见 [card-atlas.md](card-atlas.md)。player.<id>.cardPortrait、card.frame.<quality>.<state> 与 card.atlas 绑定原创占位图集；旧 portrait 绑定保留。图集 JSON 为 data 条目，有路径/hash/字节数、没有图像尺寸；身份或稀有度元数据变化也改变总目录版本。不得把 JSON 当图像解码或因图片 hash 未变而复用旧映射。

UI 资源见 [ui-assets.md](ui-assets.md)，ui.pack 与 ui.surface/ui.icon/ui.stadium 别名绑定可缩放程序化占位；pack 包含九种既有 audio 别名对应的音源指纹。大厅/比赛宿主应在用户操作后解锁声音，并遵守静音与生命周期。
