# Rental OS 租户消费者官网

租户对外经营的前台官网，独立于平台自身的营销官网 [`apps/website`](../website/README.md)。一套部署服务任意多个租户：每个请求先识别当前租户，再根据后端 bootstrap 返回的已发布品类数，自动切换单品类、双品类、多品类三种首页形态。

## 目录

- [背景](#背景)
- [本地预览](#本地预览)
- [多租户识别](#多租户识别)
- [自定义域名接入](#自定义域名接入)
- [数据源与对接](#数据源与对接)
- [已实现与待接入](#已实现与待接入)
- [相关文档](#相关文档)

## 背景

React 19 + Vite 8 的单页应用，后端只有一个服务端口，「当前是哪个租户」在前端每次请求时解析。识别出租户后向客户端公开接口拉取品牌、主色、官网内容与已发布服务，据此渲染首页与商品。租户隔离由后端按 `tenantCode` 保证，前端不持有跨租户数据；定价、押金与订单一律以服务端为准。

## 本地预览

### 演示形态（离线静态数据，看三种布局）

在仓库根目录运行 `npm run dev:tenant-website`，浏览器打开：

- 单品类：`http://127.0.0.1:4186/?tenant=single`
- 双品类：`http://127.0.0.1:4186/?tenant=double`
- 多品类：`http://127.0.0.1:4186/?tenant=multiple`

### 真实租户（消费后端接口）

先起后端 API（默认 `127.0.0.1:3000`），再用 `?tenantCode=` 指定租户：

- `http://127.0.0.1:4186/?tenantCode=demo`（示例：4 个品类，多品类形态）
- `http://127.0.0.1:4186/?tenantCode=demo2`（示例：1 个品类，单品类形态）

Vite 已把 `/api` 代理到本地 API（可用 `VITE_API_TARGET` 覆盖目标）。此外，`npm run build:tenant-website` 做构建检查，`npm run test:tenant-website-resolve` 校验多租户识别逻辑，`node apps/tenant-website/scripts/verify-remote-mapping.mjs demo demo2` 对着真实 API 校验数据映射。

## 多租户识别

租户身份在前端每次请求时由 `src/data/resolveTenant.ts` 解析，优先级如下：

1. `?tenant=single|double|multiple`：参考演示，走本地静态数据。
2. `?tenantCode=xxx`：显式指定真实租户（联调、预览、后台跳转）。
3. 平台子域名：配置 `VITE_BASE_DOMAIN=rentalos.com` 后，`guangying.rentalos.com` 解析为租户 `guangying`（`www`、`api` 等保留子域除外）。前端本地即可判定，无需请求后端。
4. 客户自定义域名：其余公网域名（如 `www.brand.com`）交由后端 `GET /api/client/v1/public/site-resolve?host=<host>` 反查，命中后台绑定的域名则返回 `tenantCode`，未绑定返回 `null`。
5. `VITE_DEFAULT_TENANT`：单租户独立部署的兜底（自定义域名反查不到时也回落到它）。
6. 都不命中：回退演示 `multiple`。

识别出租户编码后，`GET /public/bootstrap?tenantCode=<code>&client=web` 返回品牌、主色、官网特有内容（web 渠道）与已发布服务列表；`services.length` 决定首页形态，`GET /public/catalog?service=<code>` 提供各品类商品。

## 自定义域名接入

一套前端加一个后端端口即可服务任意多个租户的自定义域名，分三层：

1. 绑定（数据）：租户在后台「客户端渠道 → 官网配置 → 官网域名」填写自己的域名（如 `www.brand.com`）。后端 `WebsiteChannelProfile.customDomain` 全局唯一，一个域名只能绑定一个租户。
2. 解析（DNS）：客户在自己的域名服务商为该域名添加一条 `CNAME`，指向平台的官网接入地址（边缘或负载均衡）。
3. 证书与回源（边缘）：边缘按 SNI 为该域名签发 HTTPS 证书（Caddy on-demand TLS、云 LB 托管证书或 ACME），并把请求回源到同一套前端。前端读取访问域名后经 `site-resolve` 反查租户、加载对应官网。新增租户域名无需改代码、无需重新部署。

## 数据源与对接

关键文件：

- `src/data/resolveTenant.ts`：多租户识别（见上）。
- `src/data/apiClient.ts`：客户端公开接口（`/api/client/v1` 的 `bootstrap`、`public/catalog`）的底层调用。
- `src/data/remoteSite.ts`：把 bootstrap 与各服务 catalog 映射成官网的 `Tenant`/`Category`/`Product`；后端暂无的字段（二级分类、评分、押金、精确库存、证言）按占位处理，由页面既有的「以报价为准 / 预约时确认」文案兜底。
- `src/data/siteRepository.ts`：页面唯一的同步数据边界。演示模式读静态 catalog，真实模式由 `SiteProvider` 异步加载后经 `setActiveProducts` 注入。当前演示预约仅写入浏览器 `localStorage`，不提交商家、不锁库存。
- `src/data/catalog.ts`：三套演示租户的品类与商品数据。
- `src/theme.ts` 与 `src/styles.css`：把主辅色映射到 CSS token，并提供与平台官网一致的深浅色模式。首次进入跟随系统偏好，用户切换后保存到 `rental-os-theme`。
- `src/i18n.ts`：中英文界面文案与演示数据的英文映射，语言选择保存在 `rental-os-tenant-language` 并作用于所有路由；真实租户可通过 `*En` 字段提供英文名称、描述与规格。
- `src/types.ts`：`Tenant`、`Category`、`Product` 与演示订单的数据契约。

## 已实现与待接入

已接入：租户识别（含自定义域名）、品牌/主色/官网内容（bootstrap `client=web`）、已发布品类导航与首页形态、商品列表与详情（public catalog）；登录态全链路——短信/密码/注册登录（令牌按租户隔离、401 自动续期）、库存与档期（`/availability`）、服务端报价与押金（`/quotes`）、下单（`/orders`，自动切换到商品所属经营空间）、我的订单与详情（`/my/orders`、`/orders/:id`）、在线支付入口（`/payment-intents`，按 `/payment/capabilities` 显示可用方式，未开通则提示线下）、账户中心（配送地址簿 `/profile/addresses`、优惠券 `/coupons`、通知 `/notifications`）。演示模式（`?tenant=`）不连后端，下单仍走本地 localStorage。

仍依赖后端能力：真实在线支付需租户在后台启用收单平台并通过 live 连接测试——境内租户用支付宝/微信（结算 CNY），境外主体租户用 Stripe（HKD/SGD/USD/EUR 等，收银台内可含卡与支付宝/微信付款方式）；demo 租户仍为 offline/simulation。可用币种与方式由 `/payment/capabilities` 按租户配置返回，前端据此渲染，未开通则提示线下。后端暂无商品评价、二级分类结构与营销区块 CMS，这些位置前端按占位处理。

联调脚本（对本地 dev API）：`node apps/tenant-website/scripts/verify-remote-mapping.mjs demo demo2`（品牌 + 品类 + 商品映射）、`node apps/tenant-website/scripts/verify-order-flow.mjs demo`（注册 → 登录 → 报价 → 下单 → 订单全链路）。

## 相关文档

- 平台整体说明：仓库根 [README](../../README.md)
- 平台自身的营销官网：[apps/website](../website/README.md)
- 平台业务规则：[多品类租赁平台需求说明](../../docs/多品类租赁平台需求说明.md)
