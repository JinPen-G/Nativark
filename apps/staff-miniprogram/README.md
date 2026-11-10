# Rental OS 员工小程序（微信原生）

面向租户门店、仓库、现场交付人员以及店长/管理员的微信小程序（原生 + TypeScript）。一套包服务所有租户，租户编码在登录页输入；包内只含公开配置、不含任何密钥。需求见 [docs/租户端小程序需求说明.md](../../docs/租户端小程序需求说明.md)。

> 当前是可编译的前端联调版本，尚未满足需求文档的安全验收、未达发布标准（见[后端前置](#后端前置)）。这是员工端；客户使用的是 [`apps/miniprogram`](../miniprogram/README.md)。

## 目录

- [与客户小程序的区别](#与客户小程序的区别)
- [背景](#背景)
- [功能](#功能)
- [多品类兼容](#多品类兼容)
- [目录结构与页面](#目录结构与页面)
- [本地开发与预览](#本地开发与预览)
- [发布构建](#发布构建)
- [配置与安全](#配置与安全)
- [后端前置](#后端前置)
- [相关文档](#相关文档)

## 与客户小程序的区别

| | 客户小程序 `apps/miniprogram` | 员工小程序 `apps/staff-miniprogram` |
| --- | --- | --- |
| 使用者 | 租赁客户 | 租户运营账号（与 Web 后台同一套账号与权限） |
| 租户绑定 | 每租户一个包（`tenantCode` 打进包） | 一套包服务所有租户，租户编码在登录页输入 |
| 认证 | 客户令牌 `/api/client/v1` | 独立员工会话 `/api/staff/v1/auth/*`，业务走员工白名单门面 `/api/staff/v1/*` |
| 品牌 | 租户 Logo 与主题色 | 平台统一 Rental OS 标识，深浅色跟随系统 |

## 背景

原生微信小程序（不使用框架），TypeScript 编译到 `dist/`。员工账号与权限和 Web 运营后台是同一套。业务请求经 `/api/staff/v1` 员工门面：白名单映射到既有 Rental Core 处理器，同时执行独立会话受众、员工权限与履约地点范围校验，并对字段脱敏，员工端拿不到超出授权地点或权限的数据。

## 功能

- 登录与会话：租户编码 + 账号 + 密码登录（独立员工会话）、经营空间切换、改密、登出。
- 工作台：按权限聚合的待办（`GET /rental/v1/workbench/todos`：订单、资金、工单、通知）。
- 订单履约：列表与详情、报价加建单、处理动作（确认/取消/逾期/爽约/恢复领取）、配货（候选/自动/手动）、交接领取与归还（现场签字）、部分归还、续租与退款复核、检查异常复核、订单内部备注；交接受操作锁（`x-operation-token`）保护。
- 扫码：扫码 Tab 一级页为入口，点击后进入摄像头取景；受限时用系统扫码或手动输入。
- 资产：列表、详情、台账、新建（字段按品类动态渲染）。
- 客户：列表、详情、编辑（复用平台与会员接口）。
- 上传与线下收款：检查照片、工单证据、交接签字、线下收款凭证走已签名上传会话；线下收款先登记待确认，具结算权限者确认后才入资金账本。

## AI 检查宿主边界

交付/归还页通过[原页面绑定](src/components/ai-native/inspection-page-binding.ts)接入[检查辅助](src/components/ai-native/inspection-host.ts)；页面参数、缓存开关及模型内容不能注入宿主或扩大员工权限。当前检查草稿与历史原收据分别绑定，读取历史不授予编辑、再次识别或检查提交权限。

绑定既核对当前账号、租户、空间、订单和适用模板，也核对本次页面挂接身份。同一页重新挂接、切换到原收据模式、清除或卸载后，旧回调永久失效；即使资源和会话 ID 相同也不能复活。隐藏时仍沿原组件代次停止迟到展示，unknown 不被解释为未提交，不换键重做。

验证入口复用[既有 B11 宿主测试](../../tests/ai-native-b11-workbench.test.cjs)；离线页面/组件替身不代替实际微信宿主、指定真机、弱网、相机录音上传或正式业务收据验收。

## 多品类兼容

页面不写死任何品类名词。`src/core/context.ts` 进入经营空间后从 `GET /rental/v1/categories` 取品类定义（与 Web 后台同一事实源），暴露 `terms()`（`assetLabel / itemLabel / itemGroupLabel / fulfillmentLabel / pickupLabel / returnLabel / identifierLabel / usageMetricLabel / collectionLabel`）与 `assetFields`（资产详情与新建表单据此动态渲染）；检查项来自 `GET /rental/v1/inspection-templates?stage=`。新增品类只需在服务端补一条品类定义；小程序中唯一按品类码分支的地方是 `categoryIcon()`，因为图标是客户端资源。

## 目录结构与页面

```text
apps/staff-miniprogram
├─ src/
│  ├─ app.json / app.ts / app.wxss / staff.wxss / theme.json / sitemap.json
│  ├─ config/public.ts   # 公开配置：apiOrigin、appId（无租户编码、无密钥）
│  ├─ core/              # session（会话 + 权限 can/canTenant）、http、context（术语/地点）、scan、labels、presenters、page、ui、theme…
│  ├─ api/               # auth、context、orders、assets、workOrders、customers、workbench、reviews、uploads
│  ├─ components/        # nav-bar（Logo + 地点切换）、ui-icon、state-view、status-tag、sheet、money-text
│  └─ pages/             # 页面
├─ scripts/              # build.cjs、generate-assets.cjs、sync-components.cjs
└─ project.config.json
```

页面共 27 个（`src/app.json`），底部 4 个 Tab：工作台 `workbench`、订单 `orders`、扫码 `scan`、我的 `me`；其余为 login、workspace、scanner、order、order-new、allocate、reviews、pickup、return、work-orders、work-order、scan-result、scan-manual、assets、asset、asset-ledger、asset-new、customers、customer、customer-edit、password、history、about。视觉参考 `apps/设计图/` 的员工端设计图。

## 本地开发与预览

```bash
npm run build:staff-miniprogram          # 本机联调构建（允许 http://localhost:3000，产物不可上传）
npm run test:staff-miniprogram           # 构建 + 静态/沙箱测试
```

用微信开发者工具导入 `apps/staff-miniprogram/dist`（构建脚本已把 `project.config.json` 复制进 dist、代码根设为当前目录，`libVersion 3.4.0`）。本机联调构建会关闭开发者工具的合法域名校验，仅供模拟器访问本机 `localhost`（真机上 `localhost` 指手机自身，连不到电脑 API）。修改 API 地址改 `src/config/public.ts` 的 `apiOrigin`，或构建时设 `STAFF_MINIPROGRAM_API_ORIGIN`。

## 发布构建

```bash
npm run build:staff-miniprogram:release  # apiOrigin 必须为 HTTPS，并重新开启合法域名校验
```

发布构建强制 HTTPS API 域名并开启 `urlCheck`。可用 `STAFF_MINIPROGRAM_API_ORIGIN` / `STAFF_MINIPROGRAM_APP_ID` 在构建时覆盖（无租户编码，租户在登录页输入）。

## 配置与安全

- `src/config/public.ts` 仅含公开配置 `{ apiOrigin, appId, allowLocalApi, builtAt }`，无 `tenantCode`、无密钥。API 前缀 `/api/staff/v1` 在 `core/http.ts` 拼接。
- 密钥不进包：AppSecret、账号口令、租户密钥只在服务端保存。构建门禁与客户端同一套（禁运行时依赖 `@rental-os/shared`、拒密钥形态字符串、校验页面结构与图标完整性）。

## 后端前置

员工门面把白名单请求映射到既有 Rental Core 处理器，并执行会话受众、权限与地点范围校验。以下闭环已接入代码，但仍需部署迁移、配置真实对象存储并完成开发者工具与真机验收才算上线（需求 §11）：

- STAFF-BE-01/02 履约地点数据范围 + 员工独立会话：接口按已授权地点过滤；地点选择器只影响显示，不扩大数据范围。
- STAFF-BE-03 上传凭证：检查照片、工单证据、线下收款凭证走签名上传；领取与归还引用已完成上传的文件 ID；现场签字绑定订单、交接地点、操作员、阶段与批次，无签字不能推进交接。
- STAFF-BE-04 线下收款：先登记待确认，具结算权限者确认后才写资金账本，待确认项出现在工作台。
- STAFF-BE-08 订单内部备注：仅订单操作权限可添加，写入审计日志，客户侧不暴露。
- STAFF-BE-09 操作锁人工解除：仅具资源改配权限的主管可解他人未过期的交接锁，须填原因，锁状态、修订历史与审计在同一事务更新。
- STAFF-BE-07 客户扫码确认交接：并行跨端任务，仍需员工端令牌 + 客户端确认页 + 服务端单次令牌校验；完成前以现场签字为准。

部署前置：上传与下载域名须加入微信合法域名；文件平台启用真实 provider；按迁移清单部署地点范围、会话受众、线下收款权限与待确认登记表。`local_mock` 仅供开发预览，不显示真实图片、不可用于生产收款或留证。构建或静态测试通过，不代表数据库迁移、对象存储、网络域名或真机能力已验证。

## 相关文档

- 平台整体说明：仓库根 [README](../../README.md)
- 需求说明：[docs/租户端小程序需求说明.md](../../docs/租户端小程序需求说明.md)
- 客户端小程序：[apps/miniprogram](../miniprogram/README.md)
