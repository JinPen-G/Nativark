# Rental 治理后台

[页面贡献](index.tsx)提供品类与业务规则的单一入口。[页面描述](pages.ts)复用原 `/rental/settings` 地址、页名与入口权限，页签内的保存、发布及历史读取继续使用原业务权限。

## 接入

宿主从 `@rental-os/rental-core/admin/governance` 导入 `createRentalGovernanceAdminContribution`，传入实现版本和当前上下文 Hook，再将贡献合入同一 Rental 页面注册表。[上下文工厂](page-context.tsx)接收原已验证会话、当前范围读取、原请求 Runtime、会话刷新和列表身份。范围变化时更换宿主的 `lifetimeKey`，请求派发前与返回后均复验同一身份。

宿主提供真实 `getSession`、`refreshSession` 和 `currentScopeKey`，经营空间、租户、用户、权限及 epoch 沿原身份投影。治理页引用商业页的正式描述定位价格入口，商业页须在同一受权注册表中。

- `admin/governance` 导出页面贡献、上下文工厂和语言资源。
- `admin/governance/pages` 导出页面、聚合入口权限和原权限码。
- `admin/governance/context` 导出当前会话与组件插槽合同。
- `admin/governance/client` 导出治理和品类准备客户端。
- `admin/governance/logic` 导出原 AI / Copilot 使用的权限、字段映射、选项及兼容关系编辑器。

公共 UI、表单和页头来自 platform-admin，SettingsGroups 与 WorkspacePageActions 沿公共 shell 同源出口消费。按钮、回车和确认入口共用已有公共 Core 表单驱动，保存中保护原编辑对象。宿主将 [rentalGovernanceMessages](messages.ts) 合入同一个 LocaleProvider。

## 调用链

[RentalGovernancePage](RentalGovernancePage.tsx)按同一权限对象生成页签，分别进入 [CategoryTab](CategoryTab.tsx)、[RulesTab](RulesTab.tsx)、[CalendarTab](CalendarTab.tsx)、[MembershipRewardRulesTab](MembershipRewardRulesTab.tsx)和 [NotificationsTab](NotificationsTab.tsx)。[治理客户端](client.ts)委托原 Rental HTTP，金额、版本生效、日历冲突与投递结果继续由原服务端裁定。整体 business-settings 保存由最近的服务端快照合并当前页签补丁，未保存分区保持各自草稿。

规则编辑与向导共用 [ruleSections](ruleSections.tsx)的原字段和映射。恢复从原版本生成新草稿，发布沿原预览、生效时点和原因。日历的月历、全年及列表共用原日期对象，范围覆盖保留预览与确认、已选字段、时分秒和 expectedRevision。

## 品类准备与恢复

[CategoryPreparationDialog](CategoryPreparationDialog.tsx)使用 [品类准备客户端](category-preparation-client.ts)读取候选、实体及原批次。已保存批次、采用操作、损坏引用和 unknown 继续沿 [原批次 Hook](useCategoryPreparationSave.ts)、[原采用 Hook](useCategoryAdoption.ts)与 [原引用记录](categoryAdoptionPending.ts)处理。

采用引用的稳定存储键仍按租户、用户、经营空间三元组构造，epoch 单独绑定当前视图。确认收据后先刷新真实会话，再核当前 profile 的 adoptionRevision 和 targetVersion，最后刷新原查询。保存或采用已确认、页面刷新失败时保留 saved_unread / adopted_unread，继续读取原结果。

[兼容关系编辑器](CategoryCompatibilityRelationsEditor.tsx)接收实际读取 API、原 scopeKey 和父级禁用状态，供治理与原品类助手共用。读取保持当前实体范围与取消信号，编辑只更新原本地草稿。[AI / Copilot 插槽](page-context.tsx)由宿主按实际接线提供，原宿主注入 CategoryAssistFlow、RuleSourceEntry、CalendarSourceEntry 和 CopilotSection，沿原任务、字段投影和批准链运行。

## 兼容与验证

原 [治理路由](../../../../apps/admin/src/features/settings/RentalGovernancePage.tsx)和 [会话适配](../../../../apps/admin/src/features/settings/legacy-governance-context.tsx)消费同一正文。[旧 Rental API](../../../../apps/admin/src/api/rentalCore.ts)的 30 项治理请求委托同一客户端，URL、方法、载荷和原操作键保持。原 AI 的字段、权限和关系编辑入口保留薄适配。

既有验证从 [治理表单](../../../../tests/admin-governance-forms.test.cjs)、[日历视图](../../../../tests/admin-calendar-views.test.cjs)、[准备字段与原批次](../../../../tests/category-preparation-admin-fields.test.cjs)、[采用恢复](../../../../tests/category-adoption-ui.test.cjs)、[安全规则](../../../../tests/rental-security-rule-form.test.cjs)和 [品类对齐](../../../../tests/rental-category-core-alignment.test.cjs)进入。必要类型检查覆盖页面贡献、旧入口及直接消费者。浏览器、真实服务和完整标准装配按各自环境验证。
