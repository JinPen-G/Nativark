# Rental OS 租户员工小程序

面向租户门店、仓库、现场交付人员以及店长/管理员的微信小程序（原生 + TypeScript）。需求见 [docs/租户端小程序需求说明.md](../../docs/租户端小程序需求说明.md)。当前是可编译的前端联调版本，**不是已满足该需求文档安全验收的发布版本**。

## 与客户小程序的区别

| | 客户小程序 `apps/miniprogram` | 员工小程序 `apps/staff-miniprogram` |
| --- | --- | --- |
| 使用者 | 租赁客户 | 租户运营账号（与 Web 后台同一套账号与权限） |
| 租户绑定 | 每租户一个包（`tenantCode` 打进包） | **一套包服务所有租户**，租户编码在登录页输入 |
| 认证 | 客户令牌 `/api/client/v1` | 运营令牌 `/api/auth/*`，业务走 `/api/rental/v1/*`、`/api/platform/*` |
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
  pages/                login、workspace、workbench、orders、scan、me、order、order-new、pickup、return、work-orders、work-order、
                        scan-result、scan-manual、assets、asset、asset-ledger、asset-new、customers、customer、customer-edit、password、history、about
```

## 构建与调试

```bash
npm run build:staff-miniprogram            # 本机联调构建（允许 http://localhost:3000，产物不可上传）
npm run build:staff-miniprogram:release    # 发布构建（apiOrigin 必须为 https）
npm run test:staff-miniprogram             # 构建 + 静态/沙箱测试
```

开发者工具导入 `apps/staff-miniprogram/dist`（构建脚本已把 `project.config.json` 复制进 dist 并把代码根设为当前目录）。修改 API 地址改 `src/config/public.ts` 的 `apiOrigin`，或构建时设置 `STAFF_MINIPROGRAM_API_ORIGIN`。
本机联调构建会关闭开发者工具的 request 合法域名校验，仅供模拟器访问本机 `localhost`；发布构建会重新开启校验且要求 HTTPS API 域名。修改项目配置后需重新编译，必要时重新打开开发者工具项目。真机上的 `localhost` 指手机自身，不能用来连接电脑上的 API。

## 后端前置（见需求 §11）

当前直接复用现有运营 API。以下能力当前**不存在**，不能仅凭构建通过就上传或向员工开放：

- 履约地点数据范围（STAFF-BE-01）：当前地点切换只是本机筛选，服务端仍按整空间返回。
- `/api/staff/v1` 员工门面与独立会话受众（STAFF-BE-02）：就绪后只需改 `core/http.ts` 的 `API_PREFIX` 与 `api/*` 路径常量。
- 员工上传凭证（STAFF-BE-03）：必填照片检查项在小程序中阻止提交并提示去运营后台办理；工单附件暂不上传，`attachments` 传空。
- 线下收款窄权限与两段式（STAFF-BE-04）：本期未放收款页。
- 客户扫码确认交接（STAFF-BE-07）：尚未实现；当前只有员工确认交接，不能视作客户签字或客户确认。

订单创建使用现有服务端“报价 → 创建订单”接口；客户新增与基础资料编辑复用现有平台/会员接口。服务端业务规则或权限拒绝会直接回显，不在小程序内伪造报价或绕过门禁。现场上传与独立员工门面仍需后端专项实现和真机验收。
