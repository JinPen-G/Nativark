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

[注册页](src/pages/register/index.ts)在取得验证证明后，只在当前页面保留完整注册输入和原请求键。注册提交失应答时，再次提交核对原注册结果，不重新验证已消费的验证码；明确重新获取验证码、改变手机号或服务范围、卸载页面会隔离旧提交。证明和密码不写入本地存储，后续自动登录使用该次原注册资料。

[登录页](src/pages/login/index.ts)按当前页面、本人代次和服务采用会话，隐藏或离开页面、改变手机号／登录方式会隔离旧响应。短信登录没有按证明回放会话的接口，失应答显示结果未确认并提供原密码入口，重复点击不重新验证原验证码。密码登录的原服务回退使用该次固定输入。

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

页面共 22 个（`src/app.json`）。底部 4 个 Tab 为首页 `home`、分类 `catalog`、订单 `orders`、我的 `me`，其余为 splash、item、checkout、pay、order、extend、exchange、login、register、closure、profile、qualifications、benefits、favorites、coupons、locations、addresses、legal。

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

原构建脚本在本树任务临时目录私有编译当前 Shared 声明和完整 Rental Native 客户端，按正式 `dist-clients/` 出口将七组业务工厂、原 16 方法认证、time 及其相对运行时和原许可带入 `dist/vendor/rental-core/`。原 API 薄入口继续供给同一客户会话与运输，退出时释放私有编译产物。[原生编译步骤](../../packages/rental-core/clients/miniprogram/README.md#原生编译与微信打包) · [构建实现](scripts/build.cjs)

3. 用微信开发者工具导入 `apps/miniprogram`（工程根含 `project.config.json`，代码目录 `dist/`）。没有正式 AppID 时选「测试号」，并在「详情 → 本地设置」勾选不校验合法域名（`libVersion 3.4.0`）。真机调试时 `localhost` 指手机本身，连不到开发机 API。

## 发布构建

发布前由受控发行和安装准备流程提供本树内的完整 Rental 标准包目录与正式 `CoreDeploymentLock`。构建工具使用已构建的公共合同与 Rental 宿主正式出口，复用原 `requireCorePackagePin` 和宿主逐条旧路径许可，校验包摘要、来源、版本及三个 Native 的 JS／声明入口。包选择与锁必须同时提供，缺失或不一致时在清理输出前拒绝。

```bash
npm run build -w @rental-os/miniprogram -- --release --rental-package <待部署目录> --rental-lock <组合锁.json>
```

同一选择也可用于 `--check` 或本机联调。Native 声明直接定位到安装包的 `dist-clients/`，微信输出按原正式出口复制同一 JS 闭包与 MIT 许可。Shared 公共声明保持任务内私有编译，企业收据匹配函数取锁定包的已编译实现。实例、会话、公开配置、页面资源与微信 I/O 继续由本端供给。

标准包模式的 AI 合同从正式 `./contracts`、`./client-contracts` 和 `./enterprise-order-delegation` JS 出口及其已编译相对依赖打包，读取文件须在锁定清单内。原 Shared 白名单、公开出口、资源上限和无宿主全局变量的运行检查继续生效。发布收尾重新校验安装包摘要，失败时清理本次输出与私有声明。

发布构建强制 `apiOrigin` 为 HTTPS 根地址（任何 `http`、含回环一律拒绝），且不带 `allowLocalApi`。换租户或正式发布时，修改 `src/config/public.ts` 的 `tenantCode`、`apiOrigin`、`appId`，或用环境变量 `MINIPROGRAM_TENANT_CODE` / `MINIPROGRAM_API_ORIGIN` / `MINIPROGRAM_APP_ID`（仅在显式设置时覆盖，供 CI 批量打包）。

## 配置与安全

- `src/config/public.ts` 是包内唯一配置，且全部公开：`{ apiOrigin, tenantCode, appId, allowLocalApi, builtAt }`。API 前缀 `/api/client/v1` 在 `core/http.ts` 拼接。
- 密钥不进包：AppSecret、商户私钥、`session_key`、口令等只在服务端加密保存。构建期硬门禁会拒绝以下情况：编译产物在运行时 `require("@rental-os/shared")`（只允许 `import type`）、出现密钥形态字符串、页面缺少 js/json/wxml/wxss、tabBar 图标缺失。
- 正文解析器和企业原申请/结束收据匹配函数使用受管声明适配。构建从 Shared 正式出口追到当前平台／Core 原函数并生成小程序运行文件，来源缺失、歧义或引入未审核运行依赖时停止构建。最终所有 CommonJS 依赖须落在本包 JS/JSON，未知、动态或越界依赖均拒绝。
- [客户会话](src/core/session.ts)记录本人及本包租户归属，[请求出口](src/core/http.ts)在返回和重放前核对会话代次。换本人、租户或退出后，旧登录态响应以 `STALE_CONTEXT` 丢弃。同本人/租户切服务仍可读取租户级结果，匿名公开读取沿原范围处理。旧缓存未记录租户时按本包配置补齐，已记录其他租户的缓存清除，授权仍由服务端校验。
- 401 刷新按本人/租户及原刷新令牌单飞，同账号重新登录后的旧刷新或重放 401 无权覆盖、清空新会话。企业 `replayAfterRefresh: false` 继续禁止自动重放，unknown 写入仍由原消费者用原操作键读取结果。

## 测试

业务请求沿 [Rental 客户小程序工厂](../../packages/rental-core/clients/miniprogram/README.md)维护，原 `src/api` 七组业务入口注入同一 `core/http.request` 并窄委托。认证入口通过同一正式出口供给原 16 个认证与会话采用方法，注入公开渠道配置、原错误转换、会话保存和退出清理。[认证端口与用法](../../packages/rental-core/clients/miniprogram/auth/README.md)

宿主继续供给公开渠道配置、客户会话、页面寿命及原操作键。六个原 AI 预约请求通过 orders 工厂消费原运输，能力观察、接受、提交和结果读取保留原请求选项；原预约宿主负责绑定及读取寿命。微信支付沿原支付宿主消费。[订单入口](src/api/orders.ts) · [原预约宿主](src/components/ai-native/booking-host.factory.ts)

```bash
npm run test:miniprogram
```

先构建再运行静态与宿主替身测试：页面、Tab 与组件结构，WXML/WXSS 语法，数据绑定与组件属性 AST 核对，无密钥，构建模式，401 刷新，切换丢弃，清单幂等，支付单复用与 JSAPI 校验，时区，状态分组，以及已交付契约与 OpenAPI 对账。

## 相关文档

- 平台整体说明：仓库根 [README](../../README.md)
- 业务工厂与宿主端口：[客户业务客户端](../../packages/rental-core/clients/miniprogram/README.md)
- 客户端 API 边界：[客户公开合同](../../packages/rental-core/src/client-contracts.ts)、[客户 HTTP 入口](../../packages/rental-core/src/http-client.controller.ts)
- 员工端小程序：[apps/staff-miniprogram](../staff-miniprogram/README.md)
