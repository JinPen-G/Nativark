# Zelo 公共 AI 后台

公共 `0.2.1` 源码包提供原 SaaS 模型设置页、财务页、租户模型设置页和原请求会话。宿主使用自己的稳定 `AdminRuntime`，将 `createPublicPlatformModelSettingsPage(session.runtime)` 传入已有 `platformAiPage`。同一宿主已经登记 `PublicPlatformFinanceModule` 及其 Guard 政策时，传入 `{ finance: true }`，在原页显示费率、预算和额度申请。所有调用使用同一当前会话；保存和决定失应答后按原键读取。

公共宿主注册 `PublicTenantModelSettingsModule` 后，可将 `@rental-os/ai-native-admin/tenant-model-settings/public-application` 的 `createPublicTenantModelSettingsPage(session.runtime)` 接入同时受 `system:params:manage` 和完整租户数据范围保护的设置入口。同一个编辑器支持平台服务／BYOK、供应商目录和原保存收据；租户操作引用与原 Rental 空间引用分别保存。额度、调用记录和模型连接测试由各自的选装宿主提供。

按 `package.public.json` 和服务包的 `assemblePublicAiPackage` 取公共页面源文件、原样式及直接依赖。浏览器宿主继续用公共后台的构建与主题。租户的申请、空间分配和调用记录仍按其业务宿主选择。

[package.json](https://github.com/JinPen-G/Zelo/blob/main/packages/ai-native-admin/package.json) 与 [package.public.json](https://github.com/JinPen-G/Zelo/blob/main/packages/ai-native-admin/package.public.json) 登记相同6个正式出口。[公共保留清单](https://github.com/JinPen-G/Zelo/blob/main/packages/ai-native-admin/public-source-files.json) 包含30个 TS／TSX 和1份原 CSS；[tsconfig.json](https://github.com/JinPen-G/Zelo/blob/main/packages/ai-native-admin/tsconfig.json) 只从这些公共根和原 Vite 声明展开依赖。页面通过 `platform-admin` 的原 UI、主题及 `AdminRuntime` 使用已有会话，运行合同来自 `platform-contracts`，React 由宿主提供。

直接消费者为 [start-ai.tsx](https://github.com/JinPen-G/Zelo/blob/main/apps/platform-admin/src/start-ai.tsx)，API 对应[公共服务端](https://github.com/JinPen-G/Zelo/blob/main/packages/ai-native-server/README.md)。原工作台、经营空间设置与 `shared/ai-admin` 兼容合同由[独立 Rental 仓库](https://github.com/JinPen-G/Zelo-rental-core)的固定兼容包承接。公共声明不包含这些旧业务出口。

宿主从同次固定源码调用服务端的 `assemblePublicAiPackage('admin', sources, new Map(), ts)` 收集实际源闭包，随后使用原后台构建和主题。类型检查及源码投影分别验证声明与取源，实页检查由实际 Web 宿主执行。
