# 场景资源、缓存和构建包

`packages/platform/src/assets.ts` 提供可注入传输/digest/字节存储的 AssetManager、AssetScene 和有界内存缓存。引用只接受目录 ID、别名或目录内路径；不从素材源目录加载。每个新目录建立一个 manager，存量场景保留原目录，hash 是缓存键，新版不会覆盖旧 hash。当前 Web 会话冻结启动目录；刷新会重新读取，新版本接入可显式创建新 manager。

AssetScene.load/preload 加载资源；preload 去重且返回 loaded/failed，由宿主选择重试或降级；dispose 取消当前消费者。多个场景的同一 hash 共用请求，最后一个消费者离开才取消底层传输；单个离开不会破坏另一场景。晚到响应不能重新填充已离开的场景。所有请求合计最多四个并行传输。

缓存与失败策略：

- 内存按最近访问淘汰，默认 8 MiB，过大的条目不缓存；给消费者的是副本，不能改坏共享缓存。
- Web 持久缓存只操作 `pz-verified-assets-v1`，默认 32 MiB，写入串行并按存入顺序淘汰；读不重新插入，避免与并发写入争用容量。不可用/满额时仍可使用经过验证的网络结果。
- 读持久缓存先核对字节数与 SHA-256，损坏则删除重取；CDN 可选且默认关闭，只允许无凭据的 HTTPS 基地址。远程失败/内容不匹配回到本地目录 URL，本地最多重取一次。
- Web fetch 不附带账号凭据，单次 10 秒超时、响应上限按条目字节数限制，单资源最多 16 MiB。目录本身上限 1 MiB、10 秒超时，是多个场景共用的启动请求。

`client/src/assets.ts` 的 WebAssetScene 管理 JSON 数据和已解码图片。bind/wait/data/source/release/dispose 分别负责绑定、预载完成、JSON、语义源路径、单图释放和场景释放；Blob URL 解码后立即撤销，场景最多 64 张图、声明的解码 RGBA 总和最多 64 MiB。取消或释放会清除 src 并拒绝晚到完成。统计是本管理器持有的资源，不声称测得浏览器或设备 GPU 总内存。

实际比赛 Renderer 的头像、场地、全景与弹簧已经接入；当前场地预载等候真实解码，换画质释放旧场地图，退出释放场景。缺图继续使用程序化球场/棋子，不阻塞出手。Card/UI 图集加载器要求调用方传入 WebAssetScene，JSON 映射和图片也经过验证；三个预览页退出时会释放。旧 Demo 大厅的静态 CSS/DOM 图片仍由浏览器 HTTP 加载，后续 UI 壳逐步替换；没有宣称这部分已经迁移成小游戏加载器。

`npm run assets:variants` 导出十张最长边 768 的 WebP，保留整图纵横比和场地裁切语义，不改几何。来源 hash、原尺寸、目标尺寸和生成器指纹在 assets/fields/low/manifest.json；校验由总目录执行。流畅画质通过 low.<asset-id> 别名加载，精细/均衡仍可用原纹理。

`npm run assets:package` 导出按引用的资源报告，`check:asset-package` 检查一致。Vite 构建关闭 public 全量复制，改为发出过滤后的目录和所有引用文件，拆出 boot/lobby/matchCommon/matchLow/matchHigh 的 packs 索引。这里只是 Web 按场景下载的包索引，实际微信分包属于 WX；公共图片不是全部在启动时预载。

引用入口共用 runtimeReferencedPaths：TS/CSS/HTML 显式 URL、有限 UI 命名、QUALITY_FRAME 的配置枚举、player_catalog 的技能图标，以及全部已校验的 manifest 别名。新动态拼接必须列举输入域；缺失会阻断构建。发布过滤保留 106 张旧卡牌详情用的 69 个技能图标和四种卡框，不因缺少字面 URL 被误裁；raw/cutout 等未引用资源不发出。

当前为本地工程验证包，所有商业批准仍为 0。`npm run check:asset-release` 在含未批准资源时退出失败；不把“裁掉未用图片”等同于取得素材许可。REL-01 负责权利证据和替换，平台主包预算与真机内存由 AST-06/WX/APP 审查。

`test:assets-browser` 实测持久缓存损坏、离线、换 hash、加载取消、容量、低纹理和无图出手；还对真实构建产物逐张打开 106 张卡牌详情，验证所有实际图片可解码。包体报告分别统计公共资源与应用 JS/CSS/worker，按实际构建文件核对，避免重复计算图片。
