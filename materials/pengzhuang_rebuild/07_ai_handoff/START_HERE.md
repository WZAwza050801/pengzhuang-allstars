# 给开发AI的入口

把整个`pengzhuang_rebuild`文件夹交给AI，再把`REBUILD_PROMPT.md`全文发给它。

建议先让AI确认它能提供常驻服务器和WebSocket。如果使用的平台只能生成静态网页，要求它同时输出可单独部署的Node服务项目和部署说明；不要把本地双人演示算作线上竞技场完成。

资料阅读顺序：主README → 01/CURRENT_FINDINGS → 02/README与summary、issues → 03/README → 04—06技术方案。人物表和原图较多，不必一次把全部JSON塞进提示词；开发AI应按ID和版本读取文件。

先做`MILESTONES.md`第1—3步，演示一次联网出手和校准报告，再扩展技能与美术。用户后续自行批量生成头像，开发AI负责素材清单、质量检查和替换接入。
