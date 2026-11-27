# Rental 后台宿主

Rental 后台的统一页面贡献通过一个宿主供给器取得订单、工单、能力、地点、商品资产、商业、治理、会员客户、工作台报表、渠道、开业和支付对账上下文。公共应用继续负责登录、外壳、登记路由、主题、语言和查询缓存。[统一页面贡献](index.tsx) · [宿主工厂与正式输入](host-context.tsx) · [公共应用](../../platform-admin/src/application.tsx)

退出的 `logout()` / `signOut()` 返回原撤销 Promise，公共请求客户端提供独立于业务取消信号的撤销接点；本地凭据立即清空，桌面回执和账户菜单等待服务端原结果。刷新失应答保留失败，不能当成已确认完整退出。[会话API](browser-api.ts) · [原身份存储](browser-auth-store.ts) · [宿主组合](browser.ts)

## 装配

在受控宿主模块中创建一次工厂，把 `contexts` 交给同一份 Rental 页面贡献。注册通过后，用返回的 `Provider` 包住消费这些页面的应用。下列代码中的 `rentalPorts` 来自当前宿主的真实实现，`manifest` 来自所选 Rental 标准包。

```tsx
import { registerCoreAdminPages } from "@rental-os/core-contracts";
import { createPlatformAdminApplication } from "@rental-os/platform-admin/application";
import {
  createRentalAdminContribution,
  createRentalAdminHost,
} from "@rental-os/rental-core/admin";

import { rentalAdminMessages } from "@rental-os/rental-core/admin/messages";

const rentalHost = createRentalAdminHost(rentalPorts);
const contribution = createRentalAdminContribution(manifest.version, rentalHost.contexts);
const registered = registerCoreAdminPages([{ manifest, contribution }]);
if (!registered.ok) {
  throw new Error(registered.issues.map(issue => `${issue.field} ${issue.message}`).join("\n"));
}
const App = createPlatformAdminApplication({
  brandName,
  brand,
  session,
  pages: registered.pages,
  messages: rentalAdminMessages,
  getCoreContainer: currentRentalContainer,
});
const RentalProvider = rentalHost.Provider;

export function RentalAdminApplication() {
  return <RentalProvider><App /></RentalProvider>;
}
```

`rentalPorts.runtime` 与公共应用的 `session.runtime` 使用同一对象。`currentRentalContainer(coreId, pageId)` 来自原宿主当前已验证的业务投影；按页面返回原 Rental 容器或租户范围，不能从地址参数或本地缓存授予范围。宿主采用服务端新范围后，同步调用 `session.invalidateBusinessScope()`，让同一请求、缓存及页面代次失效。工厂提供上下文和登记目标导航，各页面及服务端继续核验自己的准入和业务条件。[标准路由范围](../../platform-admin/src/core/CoreRoutes.tsx) · [组合输入](../../platform-admin/src/application-context.ts) · [登记位置解析](../../core-contracts/src/admin.ts)

## 语言资源

`rentalAdminMessages` 汇集原组合宿主和六组业务模块的词条。原后台语言入口及两个标准宿主从同一 `/admin/messages` 正式出口取资源，通过公共应用的 `messages` 接点供给同一 `LocaleProvider`。语言状态和变量翻译由公共提供器维护，业务录入事实由原页面展示。[词条资源](messages.ts) · [原宿主薄适配](../../../apps/admin/src/app/locale.tsx) · [公共语言提供器](../../platform-admin/src/AdminUiProvider.tsx)

## 真实输入

字段和签名以 `RentalAdminHostOptions`、`RentalAdminHostState` 及引用的各组类型为准。

| 输入 | 宿主来源与约束 |
| --- | --- |
| `runtime` | 原公共 `AdminRuntime`，复用已验证会话、订阅、代次、取消信号及唯一 JSON 请求 |
| `getState` | 当前 Rental 会话及业务范围投影，包含实际 `hasPermission`、租户级 `hasTenantMembershipPermission`、工单四项权限投影和显式品类治理开关 |
| `scopeKey` | 原经营空间身份键，覆盖当前租户、用户、经营空间、会话代次及受权范围，缺经营空间时可以缺失 |
| `queryScope` | 原列表查询身份，包含当前身份与范围变化，租户级会员和渠道也使用自己的有效查询身份 |
| `requestImage`、`requestText` | 原已鉴权的图片和 CSV 文本读取，复用原缓存、取消和失败语义 |
| `refreshSession` | 原真实会话刷新，能力保存后刷新可以合法改变会话代次 |
| `CustomerPreview` | 同一客户预览组件，供订单与工作台使用 |
| 两项组织权限回调 | 当前已验证的组织读取和地点映射权限，保留原 dataScope、location 和组织限制 |
| `channels` | 公开资产基址、原登录品牌默认文案和真实租户品牌更新入口 |

`runtime.getSession` 在状态未变化时保持引用稳定。`getState` 可以返回新的投影对象，变化时通过同一 `runtime.subscribe` 通知。Provider 同时订阅公共稳定快照和 Rental 身份、范围、权限投影的稳定值，经营空间单独变化也会更新上下文。Rental 用户、租户及权限投影须与当前公共会话一致，失配时保持未验证状态。

## 可选接点

- `OrderFactsEntry` 提供订单 AI 展示。缺失时保留普通订单正文。
- `membership` 可提供原头像、申请附件、管理附件读取及姓名、通知草稿组件和管理文案。缺文件 reader 时沿用会员工厂明确的 unavailable 拒绝。
- `governance` 可提供原 Copilot、品类辅助、规则和日历来源组件及文案。缺 Copilot 时沿用原普通配置区。
- `accounts` 提供已授权的公共账号入口。缺失时开业页沿原表示处理。
- `governanceNavigationTarget` 来自当前宿主已登记的业务目标，仅用于定位。

可选组件持有自己的真实依赖。动态文案回调从宿主当前语言读取。业务权限、AI 权益、批准与正式执行仍由原入口核验。[订单接点](orders/page-context.tsx) · [会员接点](membership/page-context.tsx) · [治理接点](governance/page-context.tsx) · [开业接点](setup/page-context.tsx)

## 范围与导航

`rentalCorePageIcon(coreId, pageId)` 提供原 Rental 页头图标，宿主通过 `getCorePageIcon` 交给公共路由。映射沿原 `APP_ROUTES` 路径和 `routeIconName` 的 AnimatedIcon，订单、工单、会员、价格版本及对账详情保留各自原符号。其他 Core 或未知页面 ID 返回 `undefined`，页面授权仍由原路由宿主核验。[页头图标](browser-page-icons.tsx) · [公共图标接点](../../platform-admin/src/core/CoreRoutes.tsx)

租户级会员与渠道允许当前经营空间缺失。经营空间组使用宿主原 `scopeKey`，工厂在原范围键上附加当前会话一致性检查，复用各组请求前后的范围复验。工单沿原请求工厂，补齐同一范围的请求前后检查。未知结果继续通过原操作和原收据核对。

订单和工单导航钩子在已登记的 `CorePageHostProvider` 内执行。目标须存在于当前注册表，当前页面与目标均须满足当前 `canAccess`，路径由 `resolveCorePageLocation` 生成。订单快捷动作保留原类型化 `action` 查询参数，离页或会话变化后拒绝旧导航。Provider 放在应用外层时可以先完成上下文供给，导航会在实际页面渲染时取得对应路由宿主。

订单照片直接复用原 `ItemGroupPhoto` 和同一个 `RentalCatalogPageProvider`，图片查询、身份键及对象 URL 释放沿原实现。[原照片组件](catalog/ItemGroupPhoto.tsx) · [商品接点](catalog/page-context.ts) · [工单请求](work-orders/client.ts)

## 浏览器与多个 Core

浏览器宿主创建一次 `createRentalBrowserAdminSession`，把 Rental 与其他 Core 的页面贡献交给同一注册表。`createRentalNavigation(registered.pages, session)` 提供原深链接、通知目标和 `getCoreContainer`；`createRentalShell` 向公共壳提供原经营空间选择与消息。两个工厂从 `@rental-os/rental-core/admin` 或精确子出口 `/admin/browser-navigation`、`/admin/browser-shell` 导入。[同一会话](browser.ts) · [导航工厂](browser-navigation.ts) · [壳工厂](browser-shell.tsx)

选装原 Agent/Copilot 的 Web 宿主使用 `createRentalAssistantShell({ assistant, session, ...原RentalShellOptions })`，传入已经创建的同一个 assistant 和 Rental 会话。该组合沿 `assistant.Provider → CopilotProvider → OperatorProvider → createRentalShell` 各挂一次，通过正式 `PlatformShellProps.layout` 接回原 Agent/Admin 切换、导航、面包屑、内容类及 Copilot 布局。上次 Admin 地址在当前会话范围保存，切换时重新经过原 `useNavigation` 的 `canAccess` 和 `resolve`；未登记、撤权或没有获权回退页时停止导航。宿主直接使用该组合的 Provider 树，页面正文继续消费同一上下文。[Web 主壳组合](assistant-shell.tsx) · [原 assistant 接点](assistant/README.md) · [正式 layout slot](../../platform-admin/src/PlatformShell.tsx)

完整浏览器组合使用 `createRentalAssistantBrowserHost`，同时接回会员姓名/通知草稿、规则/日历来源、品类助手及原翻译 Hook。先准备同一页面 Map 和公共 `App.navigation` 的延迟回调，再把 `createRentalAssistantAdminContribution(...).pages` 与通知工厂的 `page` 合入一份 Rental 贡献；注册成功后填入该 Map，最后创建公共应用。消息中心和铃铛传入同一通知实例。具体可直接照两个 Web 的入口，Core 作者无需修改公共后台内部。[浏览器组合](assistant-browser.tsx) · [三个 AI 页面](assistant-pages.tsx) · [原页面导航](assistant-navigation.ts) · [单 Rental 入口](../../../apps/rental-admin/src/main.tsx)

SaaS 的原品类治理与能力目录在原开发预览开关启用时，通过该工厂返回的 `saasPages` 挂载；使用当前 SaaS 身份与原品类权限，无经营空间要求。AI 设置页缺少或无权访问任务中心时保留设置正文，仅隐藏不能定位的原任务链接。

公共应用、Rental Provider 和其他 Core 复用这一份会话与 QueryClient。工单使用自己的租户范围，Rental 页面按当前服务端目录和已验证会话取得经营空间；未选经营空间不影响获权工单和公共设置。Core、成员授权或会话变化后，原请求和导航继续复验当前范围。

宿主按当前页面传入 `contextSwitcher`。`undefined` 使用 Rental 原经营空间选择器，`null` 显式留空，也可传入自己的公共上下文组件。同一个 Shell 和通知 Provider 持续挂载，切换页面或撤销其他 Core 时保留当前正文的原操作状态。完整双 Core 装配只需宿主入口、薄壳和固定部署锁。[独立双 Core 示例](https://github.com/JinPen-G/Zelo-rental-core/blob/main/workspace/apps/example-multi-core-admin/README.md) · [单Rental宿主](../../../apps/rental-admin/README.md)

## 验证入口

`admin/tsconfig.json` 直接复用公共 `platform-admin` 包的配置，覆盖十二组页面、统一宿主、浏览器会话与通知。源码宿主同时准备公共 UI 使用的 `ui-arc` 和 `ui-motiq` 保留源码，入口与取出范围见独立应用导读。[类型配置](tsconfig.json) · [独立应用](../../../apps/rental-admin/README.md#源码取出范围)

直接依赖沿 Rental 包的可选 peer 声明及宿主实际依赖准备。使用这些后台出口的宿主声明与 Core 同版本的 `@rental-os/shared`，供给原运行协议。日期使用 `dayjs`，订单列表使用 `@tanstack/react-table`，HTTP 兼容处理使用 `axios`，保留的卡片与报表动效使用 `motion`。[正式包声明](../package.json)

必要类型检查覆盖宿主源码和统一页面贡献。定向离线验证沿实际 Provider 与页面钩子，核对必需输入、租户与经营空间差异、当前会话一致性、取消及迟到响应、登记导航、图片供给和真实刷新委托。内存构建从实际应用入口解析页面、公共组件和样式，依赖与安装包 fixture 在对应证据中明确。浏览器、真实 HTTP、数据库、支付和完整标准装配分别按宿主授权取得证据。
