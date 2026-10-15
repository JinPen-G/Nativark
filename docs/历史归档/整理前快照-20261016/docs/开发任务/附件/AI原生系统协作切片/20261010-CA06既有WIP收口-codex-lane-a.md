# CA06 既有 WIP 收口与固定基线同步准备

施工树 codex-ai-native-lane-a，分支 ai/codex-ai-native-lane-a-20261007。开始 HEAD 2012a8c1，index、MERGE_HEAD、CHERRY_PICK_HEAD 均空。三份已知 WIP 为 opening-action-list.service.ts、business-tools.composition.ts、second-differences 测试；全部 output 保留、不提交。

固定主线 b852cb54015a6a5aef44315392ecf5274b33897c 已通过 72774773 收录同一开业分区实现，不重复计新功能。本次先保全既有 WIP：补齐 readSection 的 key 校验，使其与固定主线一致，再提交并安全合入固定基线。不追移动 HEAD。

入口 composeAiAuthorizedBusinessTools().openingSection({key}) 复用当前受权 read，返回单个已知分区的安全事实、依据、材料、人工入口和候选字段；未持久化、未发布、未授予操作权限。成功检查仅 ready_for_human_review，非真实连接已验。

上一轮定向用例实际出现 5 pass/1 fail：路径式 key 未拒绝。本次修复后执行：

`node -r ./tests/fixtures/ai-native/prisma-offline-preload.cjs -r ./tests/fixtures/ai-native/lane-b-local-runtime.cjs --test tests/ai-native-lane-a-second-differences.test.cjs tests/ai-native-lane-a-second-batch.test.cjs`

结果 6 pass / 0 fail / 0 skip / 0 todo，exit 0。实际组合入口与权限拒绝、差异准备被调用；数据库/业务数据为离线替身。

API TypeScript Compiler API 读取 apps/api/tsconfig.json；noEmit、incremental:false、rootDir 本树，paths 指向本树 shared 源码和私有 Prisma 声明：523 roots，0 diagnostics，exit 0。未执行生产构建。

Node 环境：DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline；AI_OFFLINE_WRITE_ROOT 本树，AI_OFFLINE_AUDIT 本树 output/ca06-section.audit 或 ca06-section-types.audit；TEMP/TMP 本树 output/ca05-tmp。未安装、读取环境文件、连真实服务或生成共享产物。

未验真实 DB/HTTP/凭据/模型/设备；不宣称 AIN 整项验收。本入口不耦合 Runtime/Provider SDK，后续替换不改变原授权和只读事实来源。
