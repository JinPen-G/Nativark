# AIN-10 Lane B 10：解析输入上下文与文档事实快照

前置 `5b8ea2cb`。本片只修改知识文档解析服务及本片测试。红测证明：文件适配器若直接修改传入的待解析文档 scope，旧实现会把被改写的文档写入当前 scope 的 head，随后读回才失败，形成错误事实已经落库的窗口。

## 实现

- `KnowledgeDocumentService.parseDocument` 在解析开始建立调用方上下文与稳定副本指纹；所有授权、文件读取、提交和最终读回均基于稳定上下文。
- 文件适配器与 parser 只接收稳定上下文/文档/文件的副本，不能通过修改依赖入参改写待持久化文档。
- 每个异步边界复核调用方和稳定副本未被改变；上下文发生变化时 fail closed，不把该异常降级成普通解析失败，也不继续提交解析结果。
- 提交的 scope、next record 和 chunks 使用副本，避免仓储/适配器持有别名后异步改写。

## 红测与验证

- 红测 `node --test tests/ai-native-knowledge-lane-b-file-context.test.cjs`：pass0/fail1/skip0/todo0，退出1；实际观察到解析侧提交次数为3而预期只有 pending 标记后的2次，确认错误 scope 可进入持久化窗口。
- 修复后同一测试：pass1/fail0/skip0/todo0，退出0；实际调用 `KnowledgeDocumentService` 和内存事务仓储，确认解析结果及仓储记录仍绑定 `workspace-1`，文件适配器的修改不会改变持久事实。
- 知识目录隔离 TypeScript：`node tests/fixtures/ai-native/knowledge-service.cjs` 在固定离线 preload 下输出 `knowledge actual TypeScript: zero diagnostics`，退出0。
- 知识/记忆相关回归（实际组件/服务，而非夹具自证）全部通过；本次组合命令输出所有测试均为 `✔`，未出现 skip/todo。新增边界测试与现有知识检索、缓存、解析、持久内容、记忆撤权回归均已运行。
- `git diff --check`：退出0。

## 证据等级与未验项

- 证据：离线函数/服务行为、内存事务替身、隔离 TypeScript 检查；固定 `DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline`，使用本树 `prisma-offline-preload.cjs` 与 `lane-b-local-runtime.cjs`，网络拦截未记录尝试。
- 未运行/未验证：真实文件存储、真实 Prisma/MySQL 事务与并发、真实 ACL/索引服务、HTTP、模型、支付、浏览器/设备、生产部署。
- 发现的跨模块缺口：本片未补正式文件存储、内容 ACL 或生命周期模块接线；缺依赖仍应保持 unavailable。作者完成后待主线独立复核，不宣称 AIN-10/24 或整体专项完成。
