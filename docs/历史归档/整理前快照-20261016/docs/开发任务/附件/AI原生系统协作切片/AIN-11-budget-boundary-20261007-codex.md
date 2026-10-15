# AIN-11 预算 Gateway 输入边界记录

## 范围

补齐 `BudgetGatewayAdapter.reserve` 在调用持久绑定来源前的本地输入边界：`callId`、`model` 必须是受限标识符，`maxOutputTokens` 必须是 1～32768 的整数。该校验只拒绝畸形请求，不授予预算、派发或业务权限。

## 验证

- 新增非法 `callId`、`model`、零值、超上限和小数输出上限的回归测试；断言来源解析和预算写入均不发生。此次记录保留修复后实测结果，未把未单独保存的修复前运行伪称为红测证据。
- 修复后运行 `tests/ai-native-budget-gateway-adapter.test.cjs`，使用离线 Prisma preload；真实数据库、模型、HTTP、支付和生产 Gateway 未运行。
- 该切片不改变 `BudgetGatewayAdapter` 的 workspace 消费范围，不实现平台/租户任务的新公共契约；相关能力仍按现有注释保持 unavailable/需主线正式契约。

## 未验证

真实 Gateway HTTP、真实模型供应商、MySQL 并发及生产配置未验证；作者测试不代表 AIN-11 或整体专项结项。
