# FLD-06 验收记录

拆静态场地/阴影/轨迹/棋子/表现层；画质菜单和能力默认档实际生效，只改DPR背板/阴影/拖尾/特效预算。只读samplePlayback接入实际GameView；后台恢复跳到最新权威终态，不补播过期效果。Renderer缓存有界并幂等释放，GameView取消订阅/RAF/持有定时器并释放Renderer。

实际验证：`npm run check` 通过（34 unit/4 contract），`test:field`新增真实模拟录制在30/60/120/144Hz冻结帧下终态一致。完整build通过。最终菜单接入后重新typecheck、build及Chromium：12 PASS/0 SKIP/0 FAIL/0JS错误，含真实画质切换、中途后台恢复和退出。

`tools/field-capture.mjs` 重新生成18格叠加和资源报告。DPR3下三档各5次、每次切换九皮肤并加载40头像，合计15次循环。缓存最大32头像/4场地图/4底色/2画布，释放后所有缓存及背板为0。390×700三档背板273000/614250/1706250像素。GC前后JS heap差419272字节，原始观测在field-calibration/resources.json；这是本机浏览器观测，不是GPU或长期内存担保。

原图网络分辨率变体由AST-05承接，目前低档降低实际绘制纹理；没有降低预测/物理质量。详见 `docs/engineering/field-geometry.md`。
