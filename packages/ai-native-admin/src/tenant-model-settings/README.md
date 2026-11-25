# 租户 AI 服务设置

[页面入口](AiModelSettingsPage.tsx)保留服务配置、平台额度和调用记录三个原页签。宿主在同一 [AiAdminHostProvider](../host.tsx) 中按当前登记与权限传入可选 `taskCenterPath`；缺失时保留设置正文并不呈现任务链接。它只用于原“打开 AI 任务中心”链接，不决定身份、权限或任务准入。[正式出口](index.ts)

## 会话与原业务接点

[页面适配](runtime.ts)与[平台配置适配](../platform-model-settings/runtime.ts)共用唯一 `AdminRuntime` 和已验证会话。租户、人员、当前经营空间和范围代次沿原宿主，设置仍要求 `system:params:manage`；页面不读取凭据、另建查询缓存或选择模型执行器。[请求边界](../platform-model-settings/request.ts)在发送与返回时核对当前身份、权限和取消信号，命令不因认证刷新而自动重发，服务端继续独立授权。

| 原页面职责 | 实际入口与状态 | 服务端来源及恢复 |
| --- | --- | --- |
| 平台统一服务、BYOK、保留/替换/清除密钥、多模型与默认模型 | [原配置卡](AiServiceSettingsCard.tsx) → [原字段转换](ai-service-settings-model.ts)、[提交生命周期](settings-save-session.ts) | [配置客户端](aiModelSettings.ts) → [原配置会话](model-settings-session.ts)；旧配置只审阅来源版本并明确停用替换，不导入旧密钥 |
| 平台额度申请与经营空间分配 | [同一额度组件](../platform-model-settings/AiCreditSettings.tsx) | [原额度客户端](../platform-model-settings/aiCredit.ts)；申请、分配及审批各自读取原收据，金额与修订不改写 |
| 调用记录、时间范围、服务来源、游标与关联任务 | [原调用账呈现](AiCallRecords.tsx) | 读取同一租户调用账；BYOK 显示供应商直接计费，输入计数只列 calls，缺 Token 或金额仍显示待核对 |
| 明确确认后检测连接、继续原检测、核对结果 | [原检测控件](AiConnectionCheck.tsx) → [原持久任务会话](capability-probe-session.ts) | [受控检测客户端](aiCapabilityProbe.ts)；原请求、任务、策略批准、取消、能力记录与计量收据保持独立 |

保存只持久化原操作定位，不保存密钥或编辑草稿。当前配置不能证明失应答的原保存结果；撤权、切换身份或空间后不能继续消费旧响应。只读 POST 保留原认证刷新，写操作禁止自动重发；`readCapabilityReceipt` 会核账并记录能力证据，仍按写操作处理。供应商目录仍是元数据，检测仍需原确认与服务端准入；缺政策、能力或可信计量保持原不可用状态。新的检测必须先核清原任务、结果观察和计量，不能因超时、隐藏页面或更改配置重发。金额、Tokens 与 calls 使用[原单位检查](usage-quantity.ts)，不互相换算。

## 消费者与验证

旧组合后台的[原页面路径](../../../../apps/admin/src/features/ai-native/AiModelSettingsPage.tsx)通过[原宿主](../../../../apps/admin/src/features/ai-native/legacy-host.tsx)转接本模块；页面字段、页签、提示、样式和原恢复算法保持同一来源。[共同样式](../ai-native/AiManagement.module.css)与[中英文词条](../ai-native/management-locale.ts)继续共用。合同由 [shared/ai-admin](../../../shared/src/ai-admin.ts)窄出口再导出原类型与运行值，不在页面复制业务协议。

必要检查复用[原设置字段用例](../../../../tests/ai-native-b14-b-settings.test.cjs)、[原保存生命周期用例](../../../../tests/ai-native-b15-presentation.test.cjs)、[原设置恢复用例](../../../../tests/ai-settings-recovery-review.test.cjs)及[所选类型检查器](../../../../scripts/check-selected-prisma-types.cjs)。原请求映射可用明确的离线运输核对；同版浏览器、供应商元数据、真实检测及部署须分别核收，离线通过不表示执行过模型或实际业务。
