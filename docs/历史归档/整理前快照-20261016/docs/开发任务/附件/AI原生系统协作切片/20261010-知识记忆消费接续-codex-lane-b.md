# Codex B：知识与记忆消费接续（2026-10-10）

## 归属与同步

施工树 `codex-ai-native-lane-b`，分支 `ai/codex-ai-native-lane-b-20261007`。从 `93107343` 同步固定主线 `b852cb54015a6a5aef44315392ecf5274b33897c`。继承的五个知识消费 WIP 文件与主线 `72774773` 内容完全一致，逐文件验证后快进，不重复提交，不清理 output。

## 实际功能

- `HumanKnowledgeConsumptionService.readDocument`：沿当前人类门面读取元数据与有界预览，等待后再次核对版本、ACL、正文动作与观察内容。撤回/删除只返回受权元数据，不返回旧正文。
- `readMemory`：关联当前偏好与实际确认记录的 ID、revision、内容、scope、audience、ACL 与期限；确认读取等待后再读当前偏好。撤销、失效或变化不继续复用旧值。
- `recoverMemoryChange`：按原 operationId 和原修改/删除载荷读取收据，缺收据保持 unknown。删除提交应答丢失不换键、不复活数据。
- 入口复用已有 persistent composition / 人类模块，无新增 HTTP、worker 或生产开关。

现有实际场景链已核对：`composeKnowledgeFileApplication.sceneKnowledge` → 主线 `composeOriginalSceneKnowledge` / `composeAiOriginalSceneModel` → collect/revalidate → 原模型输入发布与计划 → Gateway 派发前复验。主线负责冻结与派发，本片不重复实现或宣称复验与派发原子一致。

## 快检证据

环境：固定无效 DATABASE_URL；本树绝对 AI_OFFLINE_AUDIT/TEMP；`prisma-offline-preload.cjs` 拦截网络/环境读取；`lane-b-local-runtime.cjs` 使用本树源码及私有 Prisma。

命令 `node -r ./tests/fixtures/ai-native/lane-b-local-runtime.cjs --test tests/ai-native-knowledge-lane-b-input-composition.test.cjs`：3 pass / 0 fail / 0 cancelled / 0 skip / 0 todo，退出码 0。驱动现有服务与 Prisma 事务替身，覆盖跨等待版本变化、撤回、确认撤销、删除提交成功但应答丢失、原键异载荷及切空间拒绝。

冒烟构造最初直接撤回 draft 被正式 guard 拒绝，后改成实际 parse/index/publish/withdraw；最初全事务应答失败替身同时影响读取，后仅在删除提交完成时抛错。这些是测试准备失败，不报为生产缺陷。

同步后 source-mapped noEmit 初次失败：830 文件、8 诊断，均为本树私有 Prisma 尚缺已同步报价字段。运行既有 `scripts/ai-native-generate-local-prisma.cjs` 成功，guardViolations=0、sharedArtifactsUnchanged=true；保留私有 backup 与生成临时目录。随后 compiler API 使用 API 原严格选项、noEmit/incremental=false、仅内存映射本树 shared 源码与私有 Prisma，根入口 `human-knowledge.module.ts`：830 文件、0 诊断、退出码 0。没有修改 tsconfig 或共享生成物。

`git diff --check` 退出码 0。普通 tsc 先前存在 shared/rootDir 问题，不能把上述受保护源码映射检查称作普通构建通过。

## 边界

当前身份不等于动作许可：正式 KnowledgeAuthorization、MemoryAuthorization、文件业务归属与有界读取仍由真实注入端口提供；缺依赖拒绝。没有连接 DB/文件存储/模型，没有迁移执行或 MySQL 锁验收；单进程观察不代表分布式缓存失效。作者冒烟不计 AIN 整项验收，不修改完成率。
