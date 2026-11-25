# 通知与适配日志台账

从 `@rental-os/platform-server/notifications` 使用 [NotificationLedgerApplication](notification-ledger.ts) 和同文件的 `NotificationLedgerRepository`。它们提供当前租户的默认模板、通知记录、模拟通知与外部适配日志；实际短信/邮件投递继续使用所属服务的提供者和原回执。

## Core 接入

1. 用宿主的唯一数据库创建 `NotificationLedgerRepository`，供给本业务的 `defaultTemplates(tenantId)` 和操作者名称。模板 ID 必须在数据库内唯一，模板更新仍按租户与编码定位。
2. 将仓储和宿主的存储模式函数传给 `NotificationLedgerApplication`。在已有 Guard 验证后的同一公共 ALS 中调用，租户来自可信请求上下文。
3. 业务消息、收件人及字段释放由 Core 裁定；需要真实投递时调用原提供者，再按原操作记录结果。`sendMockNotification` 只登记模拟事实，生产 SMS 仍拒绝。

```ts
import {
  NotificationLedgerApplication,
  NotificationLedgerRepository,
} from "@rental-os/platform-server/notifications";

const storage = new NotificationLedgerRepository(database, {
  defaultTemplates: businessTemplates,
  defaultOperator: operatorName,
});
const notifications = new NotificationLedgerApplication({
  storage,
  usePersistentStorage: host.usePersistentStorage,
  defaultOperator: operatorName,
});
```

模板与日志字段沿 [公共合同](../../../../platform-contracts/src/notifications.ts) 单源定义。持久查询始终按租户限定，通知日志取最新 80 条，适配日志取最新 120 条。通知登记和随后适配日志分别提交；后一步失败向上传播，已登记的通知事实保留。

## HTTP 接入

原模板目录、日志和发送三项接口由 [NotificationsController](notifications.controller.ts) 提供。[NotificationsHttpModule](notifications-http.module.ts) 接收宿主的真实应用工厂，以 `NOTIFICATIONS_HTTP_APPLICATION` 注入同一 [NotificationHttpApplication](notifications-http.application.ts)。原组合宿主提供 `IntegrationsService`，独立宿主沿自己的数据库和默认模板接入公共台账。

宿主从 [HTTP 声明](notifications-http-policy.ts) 登记原路由、operationId 与 `system:integration:manage`，从 [OpenAPI](notifications-openapi.ts) 组合字段说明，并继续使用当前租户的原 Guard 和 ALS。Controller 将原请求对象传入应用，字段校验与原错误继续由应用处理，`operator` 沿原标签保存，授权身份来自服务端。

原发送接口沿 `sendMockNotification` 登记模拟事实和适配日志，生产 SMS 继续由原门禁拒绝。实际短信与邮件使用所属服务的正式发送和原回执。已有 Controller 和公共模块由宿主选择一个登记入口。

[公共 schema](../../../../../apps/platform-api/prisma/schema.prisma) 包含模板、发送日志和已存在的适配日志表；[通知迁移](../../../../../apps/platform-api/prisma/migrations/20261118020000_public_notifications/migration.sql) 只补前两表，旧组合库沿原链运行。公共缺省不植入 Rental 内容，原 Rental 宿主继续提供自己的三份模板；已有模板 ID 保持，新默认模板按租户派生 ID。

原 [IntegrationsService](../../../../../apps/api/src/modules/integrations/integrations.service.ts) 与 [仓储](../../../../../apps/api/src/modules/integrations/integrations.repository.ts) 已委托本模块，原 HTTP/Guard 保持同一接线。验证入口是已有 [安全用例](../../../../../tests/integrations-security.test.cjs) 和 [租户隔离用例](../../../../../tests/integrations-memory-scope.test.cjs)，执行前按 [公共规则](../../../../../AGENTS.md#修改验证与交付) 核对产物和环境范围。
