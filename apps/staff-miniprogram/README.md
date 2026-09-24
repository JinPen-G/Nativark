# Rental OS 租户员工小程序

面向租户门店、仓库、现场交付人员以及店长/管理员的微信小程序（原生 + TypeScript）。需求见 [docs/租户端小程序需求说明.md](../../docs/租户端小程序需求说明.md)。当前是可编译的前端联调版本，**不是已满足该需求文档安全验收的发布版本**。

## 与客户小程序的区别

| | 客户小程序 `apps/miniprogram` | 员工小程序 `apps/staff-miniprogram` |
| --- | --- | --- |
| 使用者 | 租赁客户 | 租户运营账号（与 Web 后台同一套账号与权限） |
| 租户绑定 | 每租户一个包（`tenantCode` 打进包） | **一套包服务所有租户**，租户编码在登录页输入 |
| 认证 | 客户令牌 `/api/client/v1` | 独立员工会话 `/api/staff/v1/auth/*`；业务走员工白名单门面 `/api/staff/v1/*` |
| 品牌 | 租户 Logo / 主题色 | 平台统一 Rental OS 标识，深浅色跟随系统 |

## 多品类兼容

页面不写死任何品类名词。`src/core/context.ts` 在进入经营空间后从 `GET /rental/v1/categories` 取该空间品类定义（与 Web 后台同一事实源），暴露 `terms()`：

- `assetLabel / itemLabel / itemGroupLabel / fulfillmentLabel / pickupLabel / returnLabel / identifierLabel / usageMetricLabel / collectionLabel`
- `assetFields`（品类属性字段：资产详情与新建表单按此动态渲染）
- 检查项来自服务端检查模板 `GET /rental/v1/inspection-templates?stage=`

新增品类只需服务端补一条品类定义；小程序唯一按品类码分支的地方是 `categoryIcon()`（图标是客户端资源）。

## 目录

```
src/
  app.json / app.ts / app.wxss / staff.wxss / theme.json
  config/public.ts      公开配置：apiOrigin、appId（无租户编码、无密钥）
  core/                 session（会话+权限 can/canTenant）、http、context（术语/地点）、scan、labels、presenters、page、ui、theme…
  api/                  auth、context、orders、assets、workOrders、customers、workbench
  components/           nav-bar（Logo + 地点切换胶囊）、ui-icon、state-view、status-tag、sheet、money-text
  pages/                login、workspace、workbench、orders、scan、scanner、me、order、order-new、pickup、return、work-orders、work-order、
                        scan-result、scan-manual、assets、asset、asset-ledger、asset-new、customers、customer、customer-edit、password、history、about
```

页面视觉参考 `apps/设计图/` 的四张租户端员工小程序设计图。扫码 Tab 一级页是操作入口，点击“开始扫码”后才进入摄像头取景页；摄像头受限时可使用微信系统扫码或手动输入。设计图里的摄影商品和个人资料是示例，界面继续使用当前经营空间、订单和客户的真实数据；缺少商品封面时显示通用图标。

## 构建与调试

```bash
npm run build:staff-miniprogram            # 本机联调构建（允许 http://localhost:3000，产物不可上传）
npm run build:staff-miniprogram:release    # 发布构建（apiOrigin 必须为 https）
npm run test:staff-miniprogram             # 构建 + 静态/沙箱测试
```

开发者工具导入 `apps/staff-miniprogram/dist`（构建脚本已把 `project.config.json` 复制进 dist 并把代码根设为当前目录）。修改 API 地址改 `src/config/public.ts` 的 `apiOrigin`，或构建时设置 `STAFF_MINIPROGRAM_API_ORIGIN`。
本机联调构建会关闭开发者工具的 request 合法域名校验，仅供模拟器访问本机 `localhost`；发布构建会重新开启校验且要求 HTTPS API 域名。修改项目配置后需重新编译，必要时重新打开开发者工具项目。真机上的 `localhost` 指手机自身，不能用来连接电脑上的 API。

## 后端前置（见需求 §11）

员工 API 门面会把白名单请求映射到既有 Rental Core 业务处理器，同时执行独立会话受众、员工权限和地点范围校验。以下闭环已接入代码，但仍需部署迁移、配置真实对象存储并完成开发者工具/真机验收后才能视为上线：

- 履约地点数据范围与员工独立会话（STAFF-BE-01/02）：接口按已授权地点过滤；地点选择器只影响显示，不会扩大服务端数据范围。
- 员工上传凭证（STAFF-BE-03）：检查照片、工单证据和线下收款凭证走已签名上传会话；领取/归还提交引用已完成上传的文件 ID。现场客户签字图绑定订单、当前交接地点、操作员工、交接阶段和批次，无签字时员工端不能推进交接。
- 线下收款（STAFF-BE-04）：员工先登记待确认金额；只有具备结算权限的人确认后才写入既有资金账本，待确认项出现在工作台。
- 订单内部备注（STAFF-BE-08）：仅有订单操作权限的员工可添加；备注写入订单审计日志，订单查看权限可读，客户侧接口不暴露。
- 操作锁人工解除（STAFF-BE-09）：仅有资源改配权限的主管可解除他人未过期交接锁；必须填写原因，锁状态、订单修订历史与审计日志在同一事务内更新。
- 客户扫码确认交接（STAFF-BE-07）：需求定义的并行跨端任务，仍需员工端令牌、客户端确认页和服务端单次令牌校验；完成前员工交接以现场签字为准。

**部署前置**：应用上传和下载域名须加入微信小程序合法域名；文件平台需启用真实 provider；数据库需按迁移清单部署新增的员工地点范围、会话受众、线下收款权限和待确认登记表。当前 `local_mock` 仅供开发预览，不会显示真实图片，也不可用于生产收款/交接留证。构建或静态测试通过不代表数据库迁移、对象存储、开发者工具网络域名或真机能力已验证。

订单创建使用现有服务端“报价 → 创建订单”接口；客户新增与基础资料编辑复用现有平台/会员接口。服务端业务规则或权限拒绝会直接回显，不在小程序内伪造报价或绕过门禁。上线前仍须按上面的部署前置完成环境配置和真实设备验收。
