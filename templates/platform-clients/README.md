# 按需选择的客户端模板

客户网站、员工门店 Web、微信客户和微信员工是四个独立入口；选择一个端不启用其他端，零 Core 底座不加载这些模板。公共合同来自 `@rental-os/platform-client-contracts`，Web 外壳来自 `@rental-os/platform-client-web`，微信使用原生 App/Page/WXML/WXSS。租赁页面、API、授权和业务规则继续位于独立 Rental 仓库。

本目录已接入正式 Rental 贡献工厂，提供运输、凭据槽及生命周期适配。当前候选尚缺普通页面的服务端启用/发布准入和真实宿主证据，不能据此宣称 A03 完成。未配置宿主时显示不可用；已配置且原登录成功后，缺普通页准入仍显示不可用，不用历史读取权限补足。

## 固定来源与选装

Zelo 基线是 `d6ccb0dcad63ee2e06043b71c2651f326c7e8e3a`，客户端候选在 [PR #14](https://github.com/JinPen-G/Zelo/pull/14)。运行组合必须再锁定所选 PR 提交的完整 SHA。业务依赖固定为 [Rental e078ec95b5fbdd2c8be126665ddd3de073a29c67](https://github.com/JinPen-G/Zelo-rental-core/commit/e078ec95b5fbdd2c8be126665ddd3de073a29c67)，基于 Rental main `1ca7374a64db65bada538254cc95aba7950ea588`；对应 [Rental PR #4](https://github.com/JinPen-G/Zelo-rental-core/pull/4)。

| 选择 | 独立入口 | 在已准备锁定依赖的组合中构建 |
| --- | --- | --- |
| 客户网站 | [customer-web](customer-web/main.tsx) / `assembleCustomer` | `npm run build:client-customer-web` |
| 员工门店 Web | [staff-web](staff-web/main.tsx) / `assembleStaff` | `npm run build:client-staff-web` |
| 微信客户 | [wechat-customer](wechat-customer/app.ts) / `assembleCustomer` | `npm run build:client-wechat-customer` |
| 微信员工 | [wechat-staff](wechat-staff/app.ts) / `assembleStaff` | `npm run build:client-wechat-staff` |

所选宿主显式提供同版 `platform-contracts`、`core-contracts`、`platform-client-contracts` 构建产物。Web 再选择 `platform-client-web`；微信再选择 [原生适配](wechat/src/index.ts)，两者不互相依赖。UIArc 配色与字体从 `platform-admin` 正式窄出口复用，不采用管理员会话。微信产物不引入 React 或浏览器 DOM。

首个业务接线使用 [rental](rental/package.json) 的 `@rental-os/client-template-rental/browser` 或 `/wechat`。它以**可选 peer `@rental-os/rental-core@0.2.1`** 声明组合要求；单独准备零 Core 底座不会因此安装 Rental。选择这份接线时，由组合宿主提供上述固定 SHA 的 Rental 源码包及其正式出口 `@rental-os/rental-core/clients/contribution`。版本号 `0.2.1` 本身不能证明包含该出口，不能去注册表猜测包或用浮动分支替换来源。此候选不构成已发布发行资产。

原 Rental 工厂曾按 Zelo 合同 `63340342ae46ef545f0078f2a035dfdc62703874` 编写；本候选已用其固定源码核对后继合同、Runtime、Operations 和四端运输的兼容性。源码消费沿正式出口，未把 Rental Controller、DTO 或业务实现复制到 Zelo。

## 宿主设置与运行

每端的 `connection.ts` 是明确的非敏感连接设置，默认 `undefined`。在获授权独立宿主填入可信 HTTPS API 来源、原 tenantCode、品牌名；微信客户还需原应用 AppID。不要填密码、token、任意用户提供的 URL 或本地推测的主体范围。例如设置的结构如下，地址和租户只是格式示意，不能当可用环境：

```ts
import type { RentalClientHostConfiguration } from '@rental-os/client-template-rental/config';

export const connection: RentalClientHostConfiguration = {
  apiOrigin: 'https://approved-host.example',
  tenantCode: 'approved-tenant',
  brand: { name: '已核租户品牌', primaryColor: '#0f766e' },
  // 仅微信客户需 appId: 原已授权 wx 应用 ID
};
```

各端 `assembly.ts` 调用真实 `createRentalWebAssembly` / `createRentalWechatAssembly`，不自行实现业务。工厂的第四个参数 `currentPageAccess?: ClientAccessPort` 只能来自原服务的正式当前页面准入适配，检查当前 Core 启用及本端发布，并服从原身份和对象范围。缺失时普通页面保持 `unavailable`。这个接点和下方 Rental 待补内容相对应；禁止传入恒真实现、把配置字段当许可或把原动作权限当所有页面的读许可。若改接其他 Core，只替换 `assembly.ts` 的正式贡献、会话和准入，外壳合同保持通用。

所有模板使用 `envDir: false`，构建不读 `.env`；没有默认服务器或 HTTP 代理。Web build 输出各模板 `dist/`，由实际宿主托管。跨来源时由原 API 明确允许该网站来源及 `Authorization` / `Idempotency-Key`，不能让模板代理绕过服务端策略。Web hash 只携带登记路由与对象定位，不携带身份。

微信 build 输出独立 `dist/app.js`、`dist/pages/client/index.js`、共享代码及原生视图资产。用微信开发者工具分别导入 `wechat-customer` 和 `wechat-staff`，两份 `project.config.json` 均指向自己的 `dist/`。在本机 `project.private.config.json` 配置各自真实 AppID，合法域名校验保持开启，并在原应用配置所用 API 的 request 合法域名。客户连接设置的 AppID 必须与导入的应用一致。客户、员工是两个独立应用/会话，不用管理员登录替代。

微信深链只使用登记定位，例如 `pages/client/index?route=rental.my-order&orderId=<原订单ID>`；员工服务页使用 `route=rental.service-occurrence&orderId=<原订单ID>&occurrenceId=<原发生项ID>`。原服务仍校验每个参数。微信启动等待安全随机源和正式装配完成，隐藏/卸载页面不采用迟到启动结果；缺少 `wx.getRandomValues` 时保持不可用，开发者须选择支持该 API 的基础库并在真机核对。

客户端源码未进入固定基线的零 Core 归档白名单。最终选装制品需安装/生成器组合按所选端收集包/模板及依赖闭包，投影 workspace、锁与单端命令；不能把八个客户端 workspace 全部强加给零 Core。此片未改发行白名单、生成器或公共 CI。

## 原业务链与隔离

正式工厂 `createRentalCustomerClient` / `createRentalStaffClient` 返回 `session`、`access`、`contribution`；宿主将单个贡献装为 `contributions: [contribution]`。两条代表链均不要求 AI 或企业身份：

| 身份 | 页面与动作 | 原 HTTP 与收据 |
| --- | --- | --- |
| 客户 `client` | 我的订单 → 订单详情 → 取消订单 | `/api/client/v1/orders`；原 `POST /orders/:id/cancel/preview`、`POST /orders/:id/cancel`；`GET /orders/:id/cancel-receipt` 携带原键 |
| 员工 `staff` | 订单服务 → 订单服务明细 → 服务执行 → 开始服务 | `/api/staff/v1/rental/v1/orders`；原 `POST /orders/:id/services/:occurrenceId/execution`，固定 `{action: 'start'}`；同级 `GET /execution-receipt` 携带原键 |

客户只读当前空间本人订单；员工沿原订单读/操作权限、workspace、locationScope 和 dataScope。首期列表最多 50 条，当前贡献没有搜索或扫码能力，外壳按贡献隐藏这些入口。费用、取消资格及服务状态由 Rental 决定。顶层导航只接受 `navigation: true`；详情必须由登记目标及参数进入。

原会话工厂负责登录、可信上下文复核、采用与退出；运输不签发凭据、不自动轮换或重放。Web 凭据放独立 `sessionStorage` 槽，微信放独立原生存储槽，均按端、API 来源和 tenantCode 区分。原操作引用另存，只含业务原键、动作和目标，再按 audience/tenant/本人/workspace/location 分区；改变服务器来源不会读到另一个服务器的待核引用。

每次读取和交付前复核当前权限。退出、切身份/范围、失效和后台切换清展示与表单，旧成功和旧鉴权错误不覆盖新会话。授权适配必须在原令牌采用前遵守 `ClientLifetime`。原宿主的撤权/停用事件应更新会话修订或使 Runtime 失效，不能只靠菜单隐藏；真实请求仍由原服务拒绝。

写入前必须持久保存原引用。Web 与微信运输均只发送一次，微信运输超时为 30 秒；超时、取消或断线不能证明未提交。`unknown` 保留原键，仅重读原收据，不换键重试。安全随机源或存储失败时拒绝派发。原收据复权独立于普通页面开关；当前对象状态不替代原收据。

## 待补的 Rental 接点

固定 `e078ec9` 已提供原取消收据、员工服务开始与原收据及生命周期感知会话；不再请求另一套业务工厂。仍需原作者在独立仓处理以下明确事项：

1. **普通页准入与历史收据分开。** `clients/contribution/session.ts` 的 `access.authorize` 目前只有 `action` 使用 `/contribution-access`，`page` 和 `original_receipt` 都读取订单列表。`src/http-access-policy.ts` 把客户/员工订单列表与详情列为 `history`；`src/application-access.ts` 对这类历史处理器明确允许已停用 Core 的当前受权读取。这是原历史能力，不能证明通用普通页面已启用。请提供适用于客户本人读取及只读员工的当前 Core/本端页面发布准入出口，使 `page` 使用该权威，保留 `original_receipt` 的原历史许可；不要用要求 `order:operate` 的员工动作口代替只读页。当前模板以缺 `currentPageAccess` 返回不可用封住此缺口。
2. **可验证的门店范围观察与切换。** `src/client-contribution-context.ts` 目前只返回 workspace；`src/http-staff-auth.controller.ts` 将原 locationScope 编入权限指纹，但没有已选 `locationId/locationName`。`clients/contribution/session.ts` 的选择列表/切换只提供 workspace。请确认本期门店是否直接等于 workspace；若不是，请沿原服务补可选地点、当前已选地点和验证切换的正式投影/方法，再由该原工厂映射公共 `locationId`。不得让通用端根据 URL/手填值推定门店授权。

这两项未在 Zelo 侧补造服务端实现。原贡献修复 `access` 并交付固定后继版本后，直接复用原 `access`、移除临时 `currentPageAccess` 依赖，再锁双仓完整 SHA 接续；本地恒真或离线替身只能用于核对协调逻辑，不能作为此参数的生产来源。合入前还须核已定版组合，当前 `0.2.1` 只用于这次开发接线，不代表最终发行组合。

## 实际验证范围

已核后继合同与固定 Rental 工厂类型兼容，四个实际 Vite 入口可在内存构建；原生产物无 React/DOM 和未解析包引用。必要离线流程使用固定 Rental 源码与显式运输替身，覆盖原登录、页面/动作调用、失应答保留原键、原收据与退出；它不包含真实 Auth/HTTP/数据库。普通页缺准入、停用拒绝与收据独立性另以短命令核对，没有新测试脚本或测试框架。

A03 仍需固定的安装/生成器运行组合、上述当前页面准入、明确门店映射，以及获授权独立宿主和真实客户/员工测试账号。需分别验证真实页面与动作、身份/范围切换隔离、撤权/Core 停用直达拒绝、跨租户拒绝和 unknown 原收据。

Web 桌面、平板触屏、手机窄屏均未取得实页证据；此前 `file:` 离线预览被浏览器策略拒绝，没有换入口绕过。微信还需客户/员工各自已授权 AppID、开发者工具权限、合法域名与测试宿主，分别记录开发者工具及真机证据。`wx` 替身、Web 浏览器和 Vite 构建不能互相代替这些验收。本片没有真实环境调用、迁移、部署、原生 App、收银硬件或离线业务写入。
