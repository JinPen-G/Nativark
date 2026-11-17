# 公共第三方配置页

[原页面](TenantIntegrationsPage.tsx)保留第三方目录、搜索与分类、卡片和目录切换、配置抽屉、默认选择、服务端表单同步以及保存和测试反馈。短信、支付和云存储目录由原服务端按实际宿主能力与已有配置提供。

[请求工厂](client.ts)消费宿主的 `AdminRuntime.request`，原 Rental API 出口也复用该工厂。查询键沿用 `tenant-integrations`，会话切换和权限变化的取消与缓存清理由原宿主统一执行。表单保存保留空白凭据过滤，服务端继续裁定修订、默认选择与历史依赖。

[原路径与权限](integrationAccess.ts)为 `/tenant/integrations` 和 `system:integration:manage`。页面只对已验证的租户会话开放，沿原平台管理员、明确权限或 `*` 判定。当前主体与租户仍由服务端 Guard 和 ALS 复核。

[公共页头](../../components/PageHeading.tsx)与[紧凑摘要](../../components/InsightMetrics.tsx)共用原呈现和主题。[目录资源](integrations-source/original.css)与[类名](integrations-source/classes.json)保持原字节及动效，[来源](integrations-source/SOURCE.md)记录其出处。

服务端入口、私有存储、供应商与历史恢复边界见[公共集成导读](../../../../platform-server/src/modules/integrations/README.md)。原安全、隔离、连接修订与默认选择用例继续从该入口发现。公共宿主的导航和路由由主装配消费本模块出口。

[公共应用工厂](../../application.tsx)已消费本模块的页面与权限声明，零Core和工单Web无需分别登记这项公共设置。直接访问同一路径仍先通过已验证会话和页面权限判断；服务端继续复验实际租户、当前权限及每次保存/测试。

[公共双语文案](messages.ts)由同一[语言Provider](../../app/locale.tsx)加载。原Rental中86项英文映射已迁入，原键和值保持；补齐18项供应商提示翻译。目录资源仍是原来源单份，公共组件仅适配现有主题和业务接口。

作者的原三个接口、payload、失败Promise和租户权限冒烟，以及公共包、零CoreWeb和原后台类型均通过，证据见[PCH阶段记录](../../../../../docs/平台底座/Core接入/平台Core接入-开发记录.md#core-public-integration-ui-20261118)。当前没有浏览器、真实HTTP/数据库或供应商测试证据。
