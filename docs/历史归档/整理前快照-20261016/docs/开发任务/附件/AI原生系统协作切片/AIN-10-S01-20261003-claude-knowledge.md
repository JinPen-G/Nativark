# AIN-10/S01 文档与版本生命周期

2026-10-03；作者 Claude，负责人转交知识线授权。实际树 `D:/工作文件/rental-OS/.worktrees/claude-ai-native-knowledge-20261003`，分支 `ai/ai-native-knowledge-20261003`；本片起始 HEAD `de6fd4bd900d31569adf1b3276d377e9198fab8d`。

已只读查主专项对话最近两页、派工文件、需求 R08/R17、任务 AIN-10 与 S03/S09/S10/持久化S01记录。适用路径未发现 AGENTS/CLAUDE 指令文件（仅 admin 有 AGENTS，本线不涉及）。主树/网关树在途文件均未写入；公共契约只从 `@rental-os/shared` 导入。平台统一AI与BYOK双轨口径不变。

## 实现

- 文档创建/读取/新版本、解析请求/结果、发布/撤回/删除metadata tombstone。owner来自当前授权端口；scope必须与可信上下文完全一致。
- 每次入口、结果返回和写入前重授权；文件正文另调read_body，只有attachment引用。严格闭合输入拒绝path/URL/key/public/owner/scope。
- repo使用显式read/operation/commit，不含SQL、下载URL或万能库。commit约定原子CAS、操作唯一、版本唯一、不可变chunks与保留历史。测试替身模拟这些条件，不宣称真实数据库保证。
- 解析成功不等于索引成功/已发布。发布要求parsed+indexed且未过期；删除不能复活；解析迟到结果CAS失败不能覆盖tombstone。异常只保留枚举，不记录原始异常。
- 同operation同payload重放返回当前文档，改payload冲突；新版本重新解析，旧版本/正文保留。未实现任何业务事实删除或物理删除。

## 验证

执行（以下命令均以本树绝对路径执行，第三方编译器只读借用根node_modules）：

- `node <root>/node_modules/typescript/bin/tsc -p <本树>/packages/shared/tsconfig.json`：退出0，本树shared产物。
- `node --test <本树>/tests/ai-native-knowledge-lifecycle.test.cjs <本树>/tests/ai-native-knowledge-contracts.test.cjs`：28/28，0失败/跳过。包含真实模块noEmit零诊断（不是transpileOnly）、原C06正负契约。
- 作者自复查：状态/CAS/重授权、解析失败与迟到、相同操作不同内容、不可变历史、受限输入。非独立review。
- fixture在加载任何项目模块前阻断socket/TLS/UDP/fetch/DNS；运行连接尝试0。测试输入合成。

## 未验收与接线

未运行全量API构建（基线Prisma生成客户端漂移、不得修改共享生成物）、真实DB/CAS/事务、HTTP/Guard、文件服务、真实模型/设备/浏览器；没有服务、端口、数据库、迁移、安装依赖或外部调用。自身node_modules为独立目录，第三方只读junction，`@rental-os/shared` realpath明确落在本树packages/shared，未改其他树产物。

生产需主Claude接repository/authorization/files：可信会话解析、当前岗位/地点/客户公开或本人规则、文件扫描与不可变attachment到文档版本的绑定，均不由本测试授权器替代。进程中断留下parseOperationId待核对，不能自动重跑；可经受权newVersion退出，后续运行器需带期限的恢复端口。没有默认MemoryRepository或allow-all生产实现。下一片检索与来源访问继续离线推进。

本片文件：knowledge.ports.ts、knowledge-errors.ts、knowledge-validation.ts、knowledge-document.service.ts、knowledge-publication.service.ts；新lifecycle测试、knowledge-service fixture与本记录。不改变AIN-10整体完成率。
