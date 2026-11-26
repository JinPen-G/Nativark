# Zelo 公共 AI 后台

此源码包提供原 SaaS 模型设置页和原请求会话。宿主使用自己的稳定 `AdminRuntime`，将 `createPublicPlatformModelSettingsPage(session.runtime)` 传入已有 `platformAiPage`。入口只在选定公共 AI 服务、数据和对应角色时办理。

按 `package.public.json` 和服务包的 `assemblePublicAiPackage` 取公共页面源文件、原样式及直接依赖。浏览器宿主继续用公共后台的构建与主题，不需要 Rental 或混合 shared。业务页、预算和额度入口按宿主装配单独选择。
