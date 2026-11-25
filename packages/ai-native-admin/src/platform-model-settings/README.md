# 平台 AI 配置

[页面入口](PlatformModelSettingsPage.tsx)保留原平台模型配置、平台预算和额度申请三个页签。选定 Profile 后继续使用连接设置、费率审阅和能力证据三个原视图。目录读取不会选择、启用或验证配置，首次保存仍须明确准备修订零并保持停用。[正式出口](index.ts)

## 宿主与权限

页面位于所选 [AiAdminHostProvider](../host.tsx) 内。宿主供给同一已验证主体、原 `AdminRuntime`、会话订阅、范围代次和请求通道；[页面适配](runtime.ts)不创建凭据、查询缓存、模型或第二套认证状态。旧组合后台的 [页面薄适配](../../../../apps/admin/src/features/ai-native/PlatformModelSettingsPage.tsx)继续绑定[原宿主](../../../../apps/admin/src/features/ai-native/legacy-host.tsx)。

SaaS 平台读取使用 `system:ai-provider:view`，保存配置、发布预算和费率、审批额度使用 `system:ai-provider:manage`。原租户额度与 BYOK 费率消费者继续使用 `system:params:manage` 及原租户、经营空间范围。请求发送前和返回后重新核对同一身份、代次、取消信号和权限，服务端继续独立授权。[请求边界](request.ts)

## 直接消费者与原收据

| 页面或视图 | 实际客户端 | 原状态与恢复 |
| --- | --- | --- |
| [Profile 目录、连接与保存](PlatformModelSettingsPage.tsx) | [平台设置](platformAiSettings.ts) | [原配置会话](platform-model-settings-session.ts)；保持 Profile、修订、原操作编号和原存储键，密钥不回显或写入恢复引用 |
| [平台与 BYOK 费率](PlatformPriceReview.tsx) | [预算管理](aiBudgetSettings.ts) | [原费率会话](platform-price-review-session.ts)；配置修订、场景、不可变费率版本、时区和六位小数不变 |
| [平台预算](PlatformBudgetSettings.tsx) | [预算管理](aiBudgetSettings.ts) | [平台政策会话](platform-budget-settings-session.ts)复用[原预算字段](budget-settings-session.ts)；金额、Tokens、calls 分别校验，缺失不当作零或不限额 |
| [能力证据](PlatformCapabilityObservation.tsx) | [只读能力接口](platformAiSettings.ts) | 区分白名单、历史记录和当前核验；切换 Profile、撤权或隐藏后撤下旧证据，不发起探测或模型调用 |
| [额度申请、分配与审批](AiCreditSettings.tsx) | [额度接口](aiCredit.ts) | [原引用助手](credit-operation-reference.ts)；原请求、分配和审批收据不互相替代，unknown 不换编号重发 |

原会话、金额与引用算法单源迁入本目录，旧路径只再导出。Profile、预算和费率的当前配置均不证明旧操作已提交；只用原操作的正式收据核对。按实际动作区分读写：只读 POST 保留原认证刷新，写请求禁止认证刷新后的自动重发；保存成功后的界面和权限仍由原会话及服务端决定。

## 合同、呈现与验证

客户端使用 [shared/ai-admin 窄出口](../../../shared/src/ai-admin.ts)中的原平台设置、预算管理和额度合同；它们来自 [AI 使用与平台设置](../../../shared/src/ai-usage-draft.ts)、[预算管理](../../../shared/src/ai-budget-management-http-draft.ts)及[额度](../../../shared/src/ai-credit.ts)。类型、端点和金额结构沿原声明，不在界面重新定义业务 DTO。

全部原字段、枚举、限制、确认文案、页签与表单布局沿原实现；[共同样式](../ai-native/AiManagement.module.css)、[中英文词条](../ai-native/management-locale.ts)、[安全文本](../ai-native/safe-display.ts)和[时间格式](../ai-native/formatters.ts)与工作台共用。UI 与表单仍来自公共 `platform-admin` 的正式出口，不修改 vendor。

必要检查复用[所选类型检查器](../../../../scripts/check-selected-prisma-types.cjs)、[原设置恢复用例](../../../../tests/ai-settings-recovery-review.test.cjs)和[原目录/能力呈现用例](../../../../tests/ai-native-b10-workbench.test.cjs)。宿主路由、标准发行、真实 HTTP 与同版浏览器由所选组合核收；源码迁移和离线检查不表示供应商能力、模型调用或部署验收已通过。
