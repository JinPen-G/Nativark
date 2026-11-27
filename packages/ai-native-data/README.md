# 公共 AI Native 数据

公共运行 SDK 为 `0.2.1`；数据能力发行与原迁移身份保持 `0.2.0`。公共数据发行提供 74 个 AI 模型和 15 个枚举，包括模型配置、用量账、任务、会话、审批、知识和保留记录。它支持公共数据 `0.1.8` 至 `<0.1.10`，无需安装业务 Core。以公共数据 `0.1.9` 为底，组合 schema 共 115 个模型。

- `@rental-os/ai-native-data/public-data` 从 `prisma-public/` 的固定字节读取贡献，给公共 `Tenant` 添加四条关系。`createPublicAiDataPreparation` 返回 `prepared / pending` 的 schema 和迁移材料，使用宿主自己的 Prisma Client。
- `@rental-os/ai-native-data/public-data-package` 的 `createPublicAiDataRelease` 从同一固定源码构建取得三个公共 JS 和类型入口、三份数据材料、`README.public.md` 与 `LICENSE`，返回完整文件集合、确定性归档和部署锁发行资料。`source` 指向实际构建提交。`readPublicAiDataPackage` 和 `requirePublicAiDataPackage` 分别核固定字节快照和已安装目录。
- `@rental-os/ai-native-data/public-mysql-data` 只从固定迁移解析表、列、索引及约束，使用宿主 SQL 连接读取 `information_schema`。宿主须将它与 `platform-capability.ai-native.20261126000000-public-initial` 的原 Prisma 收据一起核对。迁移中的原额度回填不在结构观察时执行。

公共迁移名称用于新安装。已存在的混合 AI 安装保留原锁、原执行账和在途原结果，不能把原收据当成该公共 initial 已执行，也不能在已有 AI 表上再次执行 initial。安装、更新和实测由宿主的部署入口办理。选择数据贡献本身不会注册 HTTP、发布工具或启用作业。

- `@rental-os/ai-native-data/public-data-admission` 的 `createZeroCorePublicAiDataAvailability` 核同一所选锁、公共归档、原迁移收据及物理结构。调用者可传原 Client 或同一 Native 事务，等待后继续由服务端复核当前权限。

[package.json](package.json) 与 [package.public.json](package.public.json) 使用同一 SDK 身份和显式公共出口，根入口也是 `public-data`。[tsconfig.json](tsconfig.json) 和 [tsconfig.public.json](tsconfig.public.json) 从相同4个源码根编译。[公共保留清单](public-source-files.json) 同时保留 schema、initial SQL 及 provenance 三份固定资产，摘要与迁移字节沿 [public-data.ts](src/public-data.ts) 核定。

直接消费者是 [公共 API 数据准入](../../apps/platform-api/src/ai-data.ts)及固定独立 Rental 的公共数据组合。正式打包沿服务端 [public-package.cjs](../ai-native-server/public-package.cjs)，默认导出只含公共贡献。原86模型、58份迁移和旧混合包完整性检查由[独立 Rental 仓库](https://github.com/JinPen-G/Zelo-rental-core)的固定兼容包保存；现有安装按原迁移账和所选包前进。
