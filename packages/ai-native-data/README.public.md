# 公共 AI Native 数据

公共数据发行 `0.2.0` 提供 74 个 AI 模型和 15 个枚举，包括模型配置、用量账、任务、会话、审批、知识和保留记录。它支持公共数据 `0.1.8` 至 `<0.1.10`，无需安装业务 Core。以公共数据 `0.1.9` 为底，组合 schema 共 115 个模型。

- `@rental-os/ai-native-data/public-data` 从 `prisma-public/` 的固定字节读取贡献，给公共 `Tenant` 添加四条关系。`createPublicAiDataPreparation` 返回 `prepared / pending` 的 schema 和迁移材料，使用宿主自己的 Prisma Client。
- `@rental-os/ai-native-data/public-data-package` 的 `createPublicAiDataRelease` 从同一固定源码构建取得三个公共 JS 和类型入口、三份数据材料、`README.public.md` 与 `LICENSE`，返回完整文件集合、确定性归档和部署锁发行资料。`source` 指向实际构建提交。`readPublicAiDataPackage` 和 `requirePublicAiDataPackage` 分别核固定字节快照和已安装目录。
- `@rental-os/ai-native-data/public-mysql-data` 只从固定迁移解析表、列、索引及约束，使用宿主 SQL 连接读取 `information_schema`。宿主须将它与 `platform-capability.ai-native.20261126000000-public-initial` 的原 Prisma 收据一起核对。迁移中的原额度回填不在结构观察时执行。

公共迁移名称用于新安装。已存在的混合 AI 安装保留原锁、原执行账和在途原结果，不能把原收据当成该公共 initial 已执行，也不能在已有 AI 表上再次执行 initial。安装、更新和实测由宿主的部署入口办理。选择数据贡献本身不会注册 HTTP、发布工具或启用作业。
