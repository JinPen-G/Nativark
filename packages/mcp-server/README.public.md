# Zelo 公共 MCP 包

本包提供标准 MCP 运输、OAuth、当前授权与持久计量端口，以及 `@rental-os/mcp-server/original-task-recovery-read`。Task 工具使用 `@rental-os/platform-contracts/ai-original-result` 的原请求引用和恢复状态。已有原结果的读取仍需要宿主供给当前权限、原请求与 Task 关联、已持久目标和目的地字段政策。构造工具不会发布、授权、创建或恢复执行 Task。

这个包不依赖 Rental、混合 shared 或混合 AI Native 服务。会话与 Rental 销售的旧组合候选由其合同所有者分别供给。要读报价原收据，仍需 Rental 宿主的明确登记、同一原键和当前善后权限。

`data-contribution.json`、`data-capability` 与 `mysql-data` 对应同一套五份原 SQL 和原迁移身份。宿主须核固定归档来源、物理结构和原账后才能启用；包或清单存在不代表已经迁移。分类率桶仍使用宿主原表 `client_api_rate_buckets`。
