# AIN-10 知识政策准备目标接续

本片承接 `97e7cd1f` 的未提交 WIP，未另建授权状态机。准备目标由已授权的 knowledge/upload 管理政策冻结，随后仅允许绑定同一租户、空间、目标主体、文档和幂等上传会话；绑定不是上传完成，也不是文档创建或发布成功。

实际入口：`createKnowledgePolicyManagementFactory` 暴露 `prepareTarget`、`target`、`bindTarget`。调用方不提交 actor/scope；服务从当前 Auth/Guard 会话取得管理身份，目标规格来自受权政策的 `preparationTarget`。目标创建使用唯一的 scope/manager/operationKey 关系和 revision，事务内锁定政策、重读授权及文件参与者；绑定再次复核政策 hash、目标 revision、文件上传会话、附件归属、业务类型、工作区、操作者、存储提供者和大小/类型，CAS 失败拒绝。提交应答不明返回 `unknown/read_target`，不换 operationKey 重派。

本次修复已复现的组合接线错误：保留 shared 草案要求的显式原 operationKey，补齐绑定返回/重放内部 target 调用及冒烟宿主调用的漏传。bindTarget 在绑定前及重放时都核对 operationKey 与冻结目标一致；错键冲突且不写入。不将字段改成可选，不放宽授权或默认成功。首轮继承现场冒烟 5 pass / 1 fail（invalid_input）；修正调用合同后 6 pass / 0 fail。

验证：`tests/ai-native-knowledge-lane-b-formal-authorization.test.cjs` 6 pass / 0 fail / 0 skip / 0 todo，退出码 0；API 离线 noEmit TypeScript `DIAGNOSTICS=0`，退出码 0；`git diff --check` 退出码 0。测试使用本树离线 Prisma preload 和固定无效 DATABASE_URL；未连接真实 MySQL、文件存储、HTTP、模型或生产模块。

schema validate/datamodel diff 沿既有 `tests/fixtures/ai-native/prisma-offline.cjs` 运行，退出码 0，guard violations 0，差异对应继承的追加迁移 `20261009132000_ai_knowledge_policy_preparation_targets`（新目标表及 authority.preparationTarget）。临时目录在本树；该既有 helper 内部固定无效库名仍为 rental_os_e2e_offline_schema，未连接数据库。`scripts/ai-native-generate-local-prisma.cjs` 退出 0、generated:false；本树 client 所有权和文件指纹检查通过，schemaHash=aae3593aa99e9101d9736ea93877a68db28a63e187f5aba6d9a06049d97fb42f。本轮没有重新生成/写入共享产物。

实际命令：`node -r ./tests/fixtures/ai-native/prisma-offline-preload.cjs -r ./tests/fixtures/ai-native/lane-b-local-runtime.cjs --test tests/ai-native-knowledge-lane-b-formal-authorization.test.cjs`；noEmit 使用现有 TypeScript API、工作树 Prisma 类型及 shared 源码。AUDIT/TEMP/TMP 指向本树 output/inspection-lb05-tmp，旧 output 保留且不提交。

继承的 schema/shared leaf WIP 随包交主线统一整合，不修改 shared 总出口、OpenAPI 或历史迁移。仍需主线核验：迁移部署、可信治理根记录的受审计置备、正式 HTTP/路由装配、真实文件服务和跨实例数据库锁。缺根记录/文件能力仍拒绝；本片不是生产全链路验收。

Runtime/Provider 替换边界：目标/策略/CAS/收据属于知识业务持久事实，不依赖 checkpoint 或 SDK 消息类型；未新增模型调用、派发器、财务账本或后台循环。关闭显式组合入口不删除既有记录、不宣称撤销远端已提交事实。
