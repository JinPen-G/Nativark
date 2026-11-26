# Zelo 公共 AI 后台

此源码包提供原 SaaS 模型设置页、财务页和原请求会话。宿主使用自己的稳定 `AdminRuntime`，将 `createPublicPlatformModelSettingsPage(session.runtime)` 传入已有 `platformAiPage`。同一宿主已经登记 `PublicPlatformFinanceModule` 及其 Guard 政策时，传入 `{ finance: true }`，在原页显示费率、预算和额度申请。所有调用使用同一当前会话；保存和决定失应答后按原键读取。

按 `package.public.json` 和服务包的 `assemblePublicAiPackage` 取公共页面源文件、原样式及直接依赖。浏览器宿主继续用公共后台的构建与主题。租户的申请、空间分配和调用记录仍按其业务宿主选择。
