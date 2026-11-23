# Rental 客户端与官网配置

本模块提供客户端品牌、协议与发布服务、微信小程序凭证和官网配置。三个独立表单复用公共 `CorePage`、UIArc 和表单保存接点，页面、菜单与标题从同一声明读取。宿主供给当前会话、认证请求、资产基址和登录默认文案。[页面贡献](index.tsx) · [页面声明](pages.ts) · [完整配置页面](ClientChannelPage.tsx)

## 页面接入

1. 使用已验证的会话、实时会话读取器、原查询范围和 `AdminRuntime` 创建页面上下文。配置请求在派发与返回时核对同一账号、租户、经营空间和会话代次，品牌应用回调也核对当前范围。[上下文工厂](page-context.tsx) · [会话身份](../orders/page-context.tsx)
2. 将上下文钩子传给 `createRentalChannelsAdminContribution`，与其他 Rental 页面合入同一贡献。页面使用 `channel:manage` 声明，兼容宿主沿原 `system:integration:manage` 核对准入。[贡献工厂](index.tsx) · [兼容权限](pages.ts)
3. 将本模块语言资源合入宿主的同一个 `LocaleProvider`。页名与菜单沿原中英文词条，租户自定义文案与图片继续由当前配置提供。[语言资源](messages.ts)

客户端、微信和官网页签按首次访问加载并保留已访问表单。顶部保存随当前页签登记，顶部按钮与回车共用 `useCoreForm` 的校验及真实保存 Promise。保存保留原版本、FAQ 过滤、官网动态列表转换和品牌缓存刷新，读取失败与保存失败沿所属表单呈现。[表单与页签](ClientChannelPage.tsx) · [公共保存接点](../../../platform-admin/src/core/CorePage.tsx)

设置分组和隐藏分区校验定位从 `@rental-os/platform-admin/forms` 使用同一 `SettingsGroups`、`revealSettingsValidation`，完成与新增图标从 `/ui` 使用。现有分组、字段和保存回调继续由原页面供给。[表单出口](../../../platform-admin/src/forms.ts) · [UI 出口](../../../platform-admin/src/components/ui/index.ts)

## 请求与业务来源

客户端请求工厂同时提供登录前的公共 bootstrap 和登录后的配置、凭证及连接测试方法。登录入口直接使用宿主公共传输创建请求工厂，配置页面使用绑定当前会话的上下文。bootstrap 保留原租户编码及 Web 客户端参数。[客户端请求](client.ts) · [旧请求入口](../../../../apps/admin/src/api/clientChannel.ts)

官网请求工厂保留配置读取、保存及图片上传。上传使用原 `FormData` 的 `scene`、`file` 字段和取消信号，图片控件将返回的公开 URL 写入当前表单。草稿预览读取 Form 值，正式配置通过原保存接口提交。[官网请求](website-client.ts) · [草稿预览](ClientBrandPreview.tsx)

三个原 Controller 通过渠道应用接点调用同一业务服务。品牌和登录配置沿原渠道服务同步公共外观档案，发布空间、协议版本、微信身份绑定与官网内容由 Rental 维护。AppID 身份绑定锁、密钥加密与留空保持、连接测试结果继续由服务端裁定。[HTTP 入口](../../src/http-channels.controller.ts) · [渠道应用](../../src/http-channel-applications.ts) · [渠道数据接点](../../src/client-channel-ports.ts) · [客户端服务](../../src/mysql-client-channel-profile.ts) · [微信服务](../../src/mysql-mini-program-channel.ts) · [官网服务](../../src/mysql-website-channel-profile.ts)

## 原宿主与验证入口

原后台页面通过薄适配提供 `adminRuntime`、会话、查询范围、品牌应用及登录默认文案。原 API 与预览出口继续消费本模块同一实现。[旧宿主适配](../../../../apps/admin/src/features/channel/legacy-channels-context.tsx) · [旧页面](../../../../apps/admin/src/features/channel/ClientChannelPage.tsx) · [旧官网请求](../../../../apps/admin/src/api/websiteChannel.ts)

现有定向用例覆盖品牌与圆角归属、原版本和载荷、登录文案及事务 fixture。类型和离线行为、浏览器表单、真实微信与资产服务的证据按各自入口记录。[外观与品牌用例](../../../../tests/admin-appearance-settings.test.cjs) · [渠道契约用例](../../../../tests/client-channel.test.cjs) · [登录准入用例](../../../../tests/client-channel-login-gates.test.cjs)
