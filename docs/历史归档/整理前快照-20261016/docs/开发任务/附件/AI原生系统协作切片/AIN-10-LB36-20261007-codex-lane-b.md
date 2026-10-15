# LB36 第一批最终验证与交接

修复点：LB34预览在超过limit时曾将正常截断误报unavailable；现在由原Prisma读取适配器返回有界chunk窗口和truncated标志，仍只在parsed当前head、read_body授权下可用，不改变published检索链。

最终定向组合命令（固定无效DATABASE_URL、双offline preload、本树绝对AI_OFFLINE_AUDIT）：
`node --test tests/ai-native-knowledge-lane-b-preparation.test.cjs tests/ai-native-knowledge-lane-b-publication-readiness.test.cjs tests/ai-native-memory-lane-b-change-preview.test.cjs tests/ai-native-knowledge-lane-b-citations.test.cjs tests/ai-native-knowledge-lane-b-input-composition.test.cjs`
结果：6 pass / 0 fail / 0 skip / 0 todo，退出0。

API隔离noEmit compiler API：`API_ISOLATED_DIAGNOSTICS=0`，退出0；`git diff --check`退出0。真实服务和Prisma仓储使用离线持久替身，未执行真实迁移/数据库/文件/HTTP/模型。

本批累计交付：02144b90（B1/B3/B4/B11入口）、86c9525b（B5发布准备）、本提交（预览截断修复及最终证据）。此前6d1142bb/edc5620e等引用与组合继续保留。B2/B6/B7/B8/B9/B10/B12复用已有提交并由本次组合入口覆盖，不重造第二套状态机。

仍然明确阻塞：正式Knowledge/Memory动作政策、附件业务归属及有界bytes生产者；可靠历史分页；同Memory ID续期合同；失败索引/未知解析重试政策；多实例缓存失效。未宣称生产或原28项完成。
