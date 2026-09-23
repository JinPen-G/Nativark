# Rental OS 租户消费者官网

独立于 `apps/website`（Rental OS 平台官网）的租户前台。**一套部署服务任意多个租户**：每个请求先识别当前租户，再由后端 bootstrap 返回的已发布品类数自动切换单/双/多三种首页形态。

## 本地预览

### 演示形态（离线静态数据，看三种布局）

在仓库根目录运行 `npm run dev:tenant-website`，浏览器打开：

- 单品类：`http://127.0.0.1:4186/?tenant=single`
- 双品类：`http://127.0.0.1:4186/?tenant=double`
- 多品类：`http://127.0.0.1:4186/?tenant=multiple`

### 真实租户（消费后端接口）

先起后端 API（默认 `127.0.0.1:3000`），再用 `?tenantCode=` 指定租户：

- `http://127.0.0.1:4186/?tenantCode=demo`（示例：4 个品类 → 多品类形态）
- `http://127.0.0.1:4186/?tenantCode=demo2`（示例：1 个品类 → 单品类形态）

Vite 已把 `/api` 代理到本地 API（可用 `VITE_API_TARGET` 覆盖目标）。

也可以运行 `npm run build:tenant-website` 做构建检查，`npm run test:tenant-website-resolve` 校验多租户识别逻辑，`node apps/tenant-website/scripts/verify-remote-mapping.mjs demo demo2` 对着真实 API 校验数据映射。

## 多租户识别（一个后端端口，多个租户）

后端只有一个服务端口；「当前是哪个租户」在前端每次请求时解析（`src/data/resolveTenant.ts`），优先级：

1. `?tenant=single|double|multiple` —— 参考演示，走本地静态数据。
2. `?tenantCode=xxx` —— 显式指定真实租户（联调、预览、后台跳转）。
3. **平台子域名** —— 配 `VITE_BASE_DOMAIN=rentalos.com` 后，`guangying.rentalos.com` → 租户 `guangying`（`www/api/...` 等保留子域除外）。前端本地即可判定，无需请求。
4. **客户自定义域名** —— 其余公网域名（如 `www.brand.com`）交给后端 `GET /api/client/v1/public/site-resolve?host=<host>` 反查：命中租户在后台「官网配置 → 官网域名」绑定的域名则返回 `tenantCode`，未绑定返回 `null`。
5. `VITE_DEFAULT_TENANT` —— 单租户独立部署兜底（自定义域名反查不到时也回落到它）。
6. 都没有 → 回退演示 `multiple`。

识别出租户编码后，`GET /public/bootstrap?tenantCode=<code>&client=web` 返回品牌、主色、官网特有内容（web 渠道）与已发布服务列表；`services.length` 决定首页形态，`GET /public/catalog?service=<code>` 提供各品类商品。租户隔离由后端按 `tenantCode` 保证，前端不持有跨租户数据。

### 客户自带域名怎么落地

一套前端 + 一个后端端口即可服务任意多个租户的自定义域名，分三层：

1. **绑定（数据）**：租户在后台「客户端渠道 → 官网配置 → 官网域名」填写自己的域名（如 `www.brand.com`）。后端 `WebsiteChannelProfile.customDomain` 全局唯一，一个域名只能绑定一个租户。
2. **解析（DNS）**：客户在自己的域名服务商为该域名加一条 `CNAME`，指向平台的官网接入地址（边缘/负载均衡）。
3. **证书 + 回源（边缘）**：边缘按 SNI 为该域名签发 HTTPS 证书（Caddy on-demand TLS / 云 LB 托管证书 / ACME），并把请求回源到这同一套前端。前端读取访问域名 → `site-resolve` 反查租户 → 加载对应官网。新增租户域名不需要改代码、不需要重新部署。

## 配置与未来对接

- `src/data/catalog.ts`：三套演示租户、品类与商品数据。`tenant.categories.length` 决定首页布局；品牌名、Logo、Hero 内容和主辅色由租户配置提供。
- `src/theme.ts`：统一将主辅色映射到 CSS token。以后后台主题色配置可通过 `Tenant` 数据传入，无须改页面组件。
- `src/i18n.ts`：统一维护中英文界面文案和演示数据的英文映射。顶部右侧按钮与页脚右下角选择器共享 `rental-os-tenant-language`，切换后会同步作用于所有路由；真实租户数据可通过 `*En` 字段提供英文名称、描述和规格。
- `src/theme.ts` 与 `src/styles.css`：提供跟平台官网一致的深浅色模式。首次进入跟随系统偏好，用户切换后保存到 `rental-os-theme`；租户官网顶部右侧的太阳/月亮按钮会同步切换整站背景、卡片、文字、表单和页脚。
- `src/data/apiClient.ts`：租户客户端公开接口（`/api/client/v1` 的 `bootstrap`、`public/catalog`）的底层调用。
- `src/data/remoteSite.ts`：把 bootstrap + 各服务 catalog 映射成官网的 `Tenant`/`Category`/`Product`；后端暂无的字段（二级分类、评分、押金、精确库存、证言）按诚实占位，由页面既有「以报价为准 / 预约时确认」文案兜底。
- `src/data/resolveTenant.ts`：多租户识别（见上）。
- `src/data/siteRepository.ts`：页面唯一的同步数据边界。演示模式读静态 catalog；真实模式由 `SiteProvider` 异步加载后经 `setActiveProducts` 注入。当前演示预约仅写入浏览器 `localStorage`，不提交商家，也不锁库存。
- `src/types.ts`：`Tenant`、`Category`、`Product` 和演示订单的数据契约。

**已接入**：租户识别（含自定义域名）、品牌/主色/官网内容（bootstrap `client=web`）、已发布品类导航与首页形态、商品列表与详情（public catalog）；**登录态全链路**——短信/密码/注册登录（令牌按租户隔离、401 自动续期）、库存与档期（`/availability`）、服务端报价与押金（`/quotes`）、下单（`/orders`，自动切换到商品所属经营空间）、我的订单与详情（`/my/orders`、`/orders/:id`）、在线支付入口（`/payment-intents`，按 `/payment/capabilities` 显示可用方式，未开通则提示线下）、账户中心（配送地址簿 `/profile/addresses`、优惠券 `/coupons`、通知 `/notifications`）。演示模式（`?tenant=`）不连后端，下单仍走本地 localStorage。

**仍依赖后端能力**：真实在线支付需租户在后台启用支付宝/微信并通过 live 校验（demo 租户为 offline/simulation）；后端暂无商品评价、二级分类结构与营销区块 CMS，这些位置前端按诚实占位处理。

**联调验证脚本**（对本地 dev API）：`node apps/tenant-website/scripts/verify-remote-mapping.mjs demo demo2`（品牌+品类+商品映射）、`node apps/tenant-website/scripts/verify-order-flow.mjs demo`（注册→登录→报价→下单→订单全链路）。
