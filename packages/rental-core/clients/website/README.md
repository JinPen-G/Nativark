# Rental 官网客户端

[工厂与合同入口](index.ts)提供 `createRentalWebsitePublicClient(apiBase)`。宿主传入网关前缀，空字符串使用同源 `/api/client/v1`，末尾斜杠沿原规则处理。原网站[apiClient](../../../../apps/tenant-website/src/data/apiClient.ts)供给 `VITE_API_BASE`，继续导出原 `API_BASE`、`clientApi`、`ApiError` 和兼容类型。

## 按用途接入

四组工厂均从 `@rental-os/rental-core/clients/website` 正式出口导入。

| 工厂与宿主输入 | 接入资料 |
| --- | --- |
| `createRentalWebsitePublicClient(apiBase)` | [公开目录、文档与域名解析](#请求与调用链) |
| `createRentalWebsiteAuthClient(ports)` | [认证与退出](auth/README.md#认证接入) |
| `createRentalWebsiteAccountClient(ports)` | [本人资料与空间切换](auth/README.md#本人资料接入) |
| `createRentalWebsiteSessionClient(authedJson)` | [登录态业务与原结果读取](session/README.md#接入) |

## 请求与调用链

| 方法 | 原 HTTP 路径与参数 |
| --- | --- |
| `bootstrap(tenantCode)` | GET `/public/bootstrap`，查询 `tenantCode`、`client=web` |
| `publicCatalog(tenantCode, service)` | GET `/public/catalog`，查询 `tenantCode`、`service` |
| `publicAvailability(tenantCode, service, payload)` | POST `/public/availability`，查询 `tenantCode`、`service`，原门店／时段／型号数量载荷为 JSON |
| `publicDocument(tenantCode, kind)` | GET `/public/documents/{kind}`，查询 `tenantCode`，kind 沿原三种文档类型 |
| `resolveHost(host)` | GET `/public/site-resolve`，查询原 `host` |

[SiteContext](../../../../apps/tenant-website/src/SiteContext.tsx)和[remoteSite](../../../../apps/tenant-website/src/data/remoteSite.ts)读取商户归属、品牌及公开目录，[ProductsPage](../../../../apps/tenant-website/src/pages/ProductsPage.tsx)消费可用性行，[DocumentPage](../../../../apps/tenant-website/src/pages/DocumentPage.tsx)核对商户与文档类型后安全渲染。原页面通过 effect 清理的取消标记隔离迟到响应，运输继续使用原 fetch 行为。

工厂 → [客户 Controller](../../src/http-client.controller.ts) → [客户应用](../../src/mysql-client-application.ts) → 原渠道、空间及 Core 公开投影。bootstrap 使用 web 渠道配置，目录使用已发布有效空间和原白名单，域名反查核已启用官网与有效商户，文档来自原商户渠道配置。字段类型从 [Rental 客户合同](../../src/client-contracts.ts)单源消费。

## 错误与兼容边界

HTTP 错误继续抛 `ApiError(status, 请求失败文案)`，网络与 JSON 解析错误原样向调用方传播。响应沿原 `body?.data ?? body` 同时消费包装与裸值，商户／空间／文档核对沿上述页面和映射层执行。

公开 `publicCatalog()` 与登录态 `catalog()` 共用[目录结构门禁](catalog.ts)，返回正式 `ClientCatalogResponse`。空目录、缺失品类码和已声明但不支持的展示结构会拒绝；省略 `categoryMetadata` 继续兼容旧合同。`assertSupportedCatalogVersion` 同时由正式网站客户端出口提供，只用于当前目录，不改变历史订单和原报价收据读取。

原官网消费的 `/public/availability` 当前在 Controller 和 [OpenAPI](../../../../apps/api/src/contracts/openapi-document.ts)尚未登记，现有 `/availability` 使用本人会话。原公开请求路径、省略门店和宽松可用性行保留为兼容边界，行字段从 [Core 可用性合同](../../src/contracts.ts)派生。正式公开路由、DTO、公开字段和完整响应须按真实 HTTP 核定。请求失败或缺行时，原页面继续提示下单时核验可用性。

包装／裸响应兼容与可用性宽松类型的实际服务端支持范围同样须在真实 HTTP 中核验。当前类型与原消费者冒烟覆盖客户端委托及映射，真实 HTTP、渠道发布、数据库与浏览器证据按对应环境取得。
