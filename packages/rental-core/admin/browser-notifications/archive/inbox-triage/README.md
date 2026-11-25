# Inbox triage

[原分拣组件](InboxTriage.tsx) 保留 Inbox、Snoozed、Archive、筛选、键盘操作、移动撤销与原动画。消息和业务动作由同一通知宿主提供；不自建邮箱或业务状态。

[original.css](original.css) 保留原 UIArc 归档样式，[integration.css](integration.css) 保留原后台主题适配。[MeasuredHeight](../shared/MeasuredHeight.tsx) 沿原尺寸动画与减少动态效果设置。当前消息页使用原业务图标，不加载上游示例头像。

[上游说明](../upstream-inbox-triage.md) 保留来源与许可说明，其中的无参示例对应上游版本；此处组件按原后台的消息与动作 props 使用。
