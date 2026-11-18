# 租户寄件中心

`TenantDispatchPage` 使用已有 UIArc Table / ListFilterBar / Segmented 适配器组成寄件目录，`DispatchDetail` 使用 UIArc Drawer / Tabs 及隔离邮件预览。记录来自原 `NotificationSendLog`、空间 `RentalNotificationLog` 和认证短信 `ExternalAdapterLog`，不建立镜像流水。

视觉来源：[UIArc sortable data table](https://uiarc.dev/components/sortable-data-table)、[Drawer](https://uiarc.dev/components/drawer)、[Tabs](https://uiarc.dev/components/tabs)，原源码与许可保存在 [本地组件库](../../../../../packages/ui-arc/README.md)。列表按渠道、状态及标题/脱敏收件人筛选，查看操作留在记录行，顶栏不增加无用途主动作。

服务端要求基础租户角色具备 `system:integration:manage` 与完整租户数据范围，不使用当前空间的权限覆盖获得跨空间记录。列表和详情只投影原脱敏目标及发送内容，认证验证码不保留，邀请预览移除真实令牌/激活链接。邮件 `srcDoc` 使用空 sandbox 和限制 CSP，禁止脚本、表单、图片请求与外部导航。

SMTP `sent` 仅表示邮件服务器受理，不代表送达或阅读。断线后未知结果不自动重发，缺失历史正文保持明确缺失。
