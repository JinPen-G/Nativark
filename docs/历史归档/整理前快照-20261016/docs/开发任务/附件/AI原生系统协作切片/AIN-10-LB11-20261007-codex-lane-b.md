# AIN-10 Lane B 11：保存提交的 scope 副本隔离

前置 `47c53ee6`。本片针对文档发布等共用 `KnowledgeDocumentService.save` 的写入路径：如果仓储适配器在提交完成后修改传入的 scope 对象，旧实现会污染调用方上下文，导致成功提交后的读回切换到错误 workspace 并返回 unavailable；同一对象别名也可能让适配器影响后续业务判断。

## 实现

- `save` 建立稳定上下文和指纹，在授权、仓储提交后复核调用方与稳定上下文未被改变。
- 授权请求、仓储 scope、文档及 next record 均使用结构化副本；缓存失效和最终读回只使用稳定上下文。
- 提交响应未知或上下文在等待期间变化时保持 fail closed；未改变现有 conflict 语义，也没有增加第二套账本或旁路写入口。

## 红测与验证

- 红测 `node --test tests/ai-native-knowledge-lane-b-save-context.test.cjs`：pass0/fail1/skip0/todo0，退出1；受控仓储在成功提交后修改 scope，旧实现读回 `unavailable`。
- 修复后同一测试：pass1/fail0/skip0/todo0，退出0；实际发布服务、文档服务和内存仓储均参与，确认结果为 published、调用 context 仍为 `space-1`，持久记录仍绑定原 scope。
- 知识目录隔离 TypeScript：`node tests/fixtures/ai-native/knowledge-service.cjs` 输出 zero diagnostics，退出0。
- 本片相关回归：`node --test` 执行 8 个实际知识服务/仓储测试文件，共 71 pass、0 fail、0 skip、0 todo，退出0。
- `git diff --check`：退出0。

## 证据等级与未验项

- 证据：离线实际服务行为、受控内存事务仓储、隔离 TypeScript；固定无效 `DATABASE_URL`、本树 offline preload 和绝对 audit 路径，网络拦截无尝试。
- 未验：真实 Prisma/MySQL 锁与提交应答丢失、分布式缓存、真实文件/ACL/索引服务、HTTP、模型、支付、浏览器/设备及生产部署。
- 正式知识来源与生命周期适配仍由主线装配；缺正式授权/文件/内容端口时继续 unavailable。作者完成待独立复核，不宣称 AIN-10/24 或整体专项完成。
