# Zelo 公共 MCP 包

本包提供标准 MCP 运输、OAuth、当前授权与持久计量端口。`@rental-os/mcp-server/work-center-read` 使用 `@rental-os/platform-contracts/ai-work-center` 构造 Task 摘要、Task 结果、会话摘要、会话原结果四类只读候选；`original-task-recovery-read` 保留旧原请求引用和恢复状态。宿主须逐项供原读者、当前权限、已持久目标和目的地字段政策。构造工具不会发布、授权、创建或恢复执行 Task。

这个包不依赖 Rental、混合 shared 或混合 AI Native 服务。Rental 历史会话的业务结果以及报价、选单、提案和订单由独立 Rental MCP 参加者供给；这些结果不能当作公共工作中心的文本诊断结果。报价原收据仍需明确登记、同一原键和当前善后权限。

`data-contribution.json`、`data-capability` 与 `mysql-data` 对应同一套五份原 SQL 和原迁移身份。宿主须核固定归档来源、物理结构和原账后才能启用；包或清单存在不代表已经迁移。分类率桶仍使用宿主原表 `client_api_rate_buckets`。
