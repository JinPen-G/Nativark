# Rental OS 客户小程序（微信原生）

面向租赁客户的微信小程序：浏览商户目录、查看服务端报价、下单与支付、管理租赁订单、续租、处理押金与费用，以及会员、资质、优惠券、地址等个人中心功能。原生微信小程序 + TypeScript，一个租户一个包，包内只含公开配置、不含任何密钥。

> 这是客户端小程序；租户员工使用的是 [`apps/staff-miniprogram`](../staff-miniprogram/README.md)。

## 目录

- [背景](#背景)
- [功能](#功能)
- [目录结构与页面](#目录结构与页面)
- [本地开发与预览](#本地开发与预览)
- [发布构建](#发布构建)
- [配置与安全](#配置与安全)
- [测试](#测试)
- [相关文档](#相关文档)

## 背景

原生微信小程序（不使用框架），TypeScript 编译到 `dist/` 后由微信开发者工具加载。定价与金额一律由服务端计算，小程序本身不做任何计价。一个租户一个包：`tenantCode` 在构建时打进包内（默认演示租户 `demo`），商户品牌、客服、协议、帮助等展示内容由服务端「客户端渠道」配置下发。后端接口走 `/api/client/v1`，使用独立的客户会话，不复用运营令牌。

## 功能

首期已接通的主要客户端能力：

- 登录与账号：微信手机号一键登录、短信验证码登录、账号密码登录与注册、在线注销、绑定微信（用于小程序内支付）。
- 目录与报价：游客公开目录、目录与服务端参考起价、库存与档期校验、服务端报价与优惠券。
- 下单与订单：幂等下单、统一本人订单索引（`GET /my/orders`）、取消预览与取消、续租、检查费用确认与异议、资金状态。
- 本次租赁清单：单品类空间、单租期、单取还地点的临时清单（`core/cart`）。从商品详情「立即预约」进入确认页下单；不同品类、不同租期或不同取还地点分别预约、分别下单，不做跨品类合并结算。
- 支付：小程序内微信 JSAPI 支付（`instrument: "rental"`，服务端返回 JSAPI 参数后调 `wx.requestPayment`；openid 只来自服务端可信绑定，不从请求体或 Native code_url 推导），同时展示线下现金、转账等方式。
- 个人中心：资料、会员方案与权益、资质类型与提交（签名上传/下载）、收藏、优惠券、地址簿。

## 目录结构与页面

```text
apps/miniprogram
├─ src/
│  ├─ app.json / app.ts / app.wxss / theme.json / sitemap.json
│  ├─ config/public.ts     # 包内唯一部署配置，全部公开（apiOrigin/tenantCode/appId/allowLocalApi）
│  ├─ core/                # http、会话、支付、租赁清单、目录缓存、流程、主题、导航、金额…
│  ├─ api/                 # 客户端 API 封装（auth/catalog/orders/payments/profile/addresses/merchant）
│  ├─ components/          # nav-bar / lazy-image / money-text / sheet / state-view / status-tag / ui-icon
│  ├─ pages/               # 页面
│  └─ contracts/planned.ts # 已交付契约清单（静态对账）
├─ scripts/                # build.cjs（tsc + 拷贝 + 校验）、generate-assets.cjs、sync-components.cjs
├─ dist/                   # 构建产物（导入开发者工具的目录）
└─ project.config.json
```

页面共 21 个（`src/app.json`），底部 4 个 Tab：首页 `home`、分类 `catalog`、订单 `orders`、我的 `me`；其余为 splash、item、checkout、pay、order、extend、login、register、closure、profile、qualifications、benefits、favorites、coupons、locations、addresses、legal。

## 本地开发与预览

1. 起后端并灌入演示数据（仓库根目录）：

```bash
npm run dev            # 起 API（:3000）与管理端
npm run db:seed:demo   # 造演示租户 demo
```

2. 构建小程序（本机联调）：

```bash
npm run build:miniprogram
```

默认按 `src/config/public.ts` 常量打包（演示租户 `demo` + `http://localhost:3000`），产物在 `apps/miniprogram/dist`，并写入 `allowLocalApi: true` 放宽回环地址（仅供开发者工具本地预览）。

3. 用微信开发者工具导入 `apps/miniprogram`（工程根含 `project.config.json`，代码目录 `dist/`）。没有正式 AppID 时选「测试号」，并在「详情 → 本地设置」勾选不校验合法域名（`libVersion 3.4.0`）。真机调试时 `localhost` 指手机本身，连不到开发机 API。

## 发布构建

```bash
npm run build:miniprogram:release
```

发布构建强制 `apiOrigin` 为 HTTPS 根地址（任何 `http`、含回环一律拒绝），且不带 `allowLocalApi`。换租户或正式发布时，修改 `src/config/public.ts` 的 `tenantCode`、`apiOrigin`、`appId`，或用环境变量 `MINIPROGRAM_TENANT_CODE` / `MINIPROGRAM_API_ORIGIN` / `MINIPROGRAM_APP_ID`（仅在显式设置时覆盖，供 CI 批量打包）。

## 配置与安全

- `src/config/public.ts` 是包内唯一配置，且全部公开：`{ apiOrigin, tenantCode, appId, allowLocalApi, builtAt }`。API 前缀 `/api/client/v1` 在 `core/http.ts` 拼接。
- 密钥不进包：AppSecret、商户私钥、`session_key`、口令等只在服务端加密保存。构建期硬门禁会拒绝以下情况：编译产物在运行时 `require("@rental-os/shared")`（只允许 `import type`）、出现密钥形态字符串、页面缺少 js/json/wxml/wxss、tabBar 图标缺失。

## 测试

```bash
npm run test:miniprogram
```

先构建再运行静态与宿主替身测试：页面、Tab 与组件结构，WXML/WXSS 语法，数据绑定与组件属性 AST 核对，无密钥，构建模式，401 刷新，切换丢弃，清单幂等，支付单复用与 JSAPI 校验，时区，状态分组，以及已交付契约与 OpenAPI 对账。

## 相关文档

- 平台整体说明：仓库根 [README](../../README.md)
- 需求蓝图：[客户端小程序需求说明](../../docs/小程序/客户小程序-需求.md)
- 客户端 API 边界：[客户端 API 接口说明](../../docs/公共技术资料/接口说明/客户端-API说明.md)
- 员工端小程序：[apps/staff-miniprogram](../staff-miniprogram/README.md)
