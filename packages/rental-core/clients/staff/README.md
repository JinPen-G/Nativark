# Rental 员工客户端

本入口提供订单、资产与库存、养护工单与归还处置、客户主档与会员、工作台、经营目录和会员审核七组工厂，以及认证、业务附件、原 Action、AI 检查任务、检查运输与场景目录工厂。每个真实员工宿主创建自己的客户端实例，传入同一员工请求函数，页面继续调用原业务方法。业务类型单源消费 Rental 合同，宿主的 shared 兼容出口引用同一份定义。[客户端入口](index.ts) · [业务合同](../../src/contracts.ts)

## 接入

`request` 由员工宿主供给，使用 `/api/staff/v1`、原鉴权和信封解包。订单工厂还接收原 `withStaffAction`，资产工厂接收原会话 `contextVersion` 和 `STALE_CONTEXT` 错误工厂。宿主在会话刷新、登录、退出及空间变化事件中调用 `invalidateAssets()`。这些端口均为必需接点。[端口](ports.ts) · [员工运输](../../../../apps/staff-miniprogram/src/core/http.ts) · [业务准入](../../../../apps/staff-miniprogram/src/core/subscription-access.ts) · [会话事件](../../../../apps/staff-miniprogram/src/core/session.ts)

```ts
import {
  createRentalStaffOrdersApi,
  createRentalStaffAssetsApi,
  createRentalStaffWorkOrdersApi,
  createRentalStaffCustomersApi,
  createRentalStaffWorkbenchApi,
  createRentalStaffDirectoryApi,
  createRentalStaffReviewsApi,
} from "@rental-os/rental-core/clients/staff";

const orders = createRentalStaffOrdersApi({ request, withStaffAction });
const assets = createRentalStaffAssetsApi({
  request,
  contextVersion,
  staleContext: () => new ApiError("STALE_CONTEXT", "经营空间已切换，该结果已作废"),
});
const workOrders = createRentalStaffWorkOrdersApi({ request });
const customers = createRentalStaffCustomersApi({ request });
const workbench = createRentalStaffWorkbenchApi({ request });
const directory = createRentalStaffDirectoryApi({ request });
const reviews = createRentalStaffReviewsApi({ request });
sessionEvents.on(assets.invalidateAssets);
```

示例中的运输、会话、错误类和准入函数来自真实宿主。原微信宿主在模块生命周期内持有一组实例，七个业务 API 路径各自导出同一实现的方法。其他宿主按自身生命周期绑定会话失效事件。[订单适配](../../../../apps/staff-miniprogram/src/api/orders.ts) · [资产适配](../../../../apps/staff-miniprogram/src/api/assets.ts) · [工单适配](../../../../apps/staff-miniprogram/src/api/workOrders.ts) · [客户适配](../../../../apps/staff-miniprogram/src/api/customers.ts) · [工作台适配](../../../../apps/staff-miniprogram/src/api/workbench.ts) · [目录](directory/README.md) · [审核](reviews/README.md)

认证使用 `createRentalStaffAuthApi`，宿主传入原请求、refresh token 读取、会话保存与退出清理。附件使用 `createRentalStaffUploadsApi`，宿主传入原键、观察校验与固定路由、微信读文件和 PUT 字节能力。页面生命周期和阶段回调沿原宿主，未知结果保留原引用，不能重传文件。[认证接入](auth/README.md) · [附件接入](uploads/README.md)

## AI 请求接入

[Action 工厂](ai-entry-actions.ts)接收原员工 request、同一会话对象、上下文版本、`can`、服务器时钟及原生成 [Action 合同值](../../../../apps/staff-miniprogram/src/components/ai-native/entry-action-runtime.d.ts)。[原适配](../../../../apps/staff-miniprogram/src/api/ai-entry-actions.ts)窄导出捕获、API 创建及原动作码；[动作会话](../../../../apps/staff-miniprogram/src/components/ai-native/entry-action-session.ts)继续管理展示寿命。完整 user 投影、会话对象引用、令牌、租户、空间及当前订单查看权限继续前后复验，宿主须返回原会话对象。

[检查任务工厂](ai-inspection-tasks.ts)接收原 request、调用方 `current`、[同一生成注册表](../../../../apps/staff-miniprogram/src/components/ai-native/inspection-wire-schemas.ts)的 `taskContracts/taskHttp` 和[原校验函数](../../../../apps/staff-miniprogram/src/components/ai-native/inspection-wire.ts)。注册表类型沿 Shared 正式导出声明，校验器由真实宿主提供。[原任务适配](../../../../apps/staff-miniprogram/src/api/ai-inspection-tasks.ts)供给这些原值，[原页面绑定](../../../../apps/staff-miniprogram/src/components/ai-native/inspection-task-page-binding.ts)及[检查任务组件](../../../../apps/staff-miniprogram/src/components/ai-native/ai-inspection-task/index.ts)消费。

检查任务路径须属于原 `staff/v1/`，任务写入使用原注册表的 120 秒超时，读取及其他检查请求保留原 15 秒超时。请求及结果沿原 JSON clone，await 前后均核对当前寿命与原校验。`submitAndContinue` 保持原明确保存并继续语义，POST 不在刷新后重放，unknown 保留原引用。正式业务提交和原收据仍由原订单及检查宿主处理。

[检查运输](inspection-transport.ts)提供原历史、只读收据宿主及当前检查宿主工厂，宿主注入同一员工 request、原会话、上下文版本及生成注册校验。原输入绑定、完整字段投影、能力组合、写入重放选项和原操作收据匹配均在 Core 单源执行。[原运输适配](../../../../apps/staff-miniprogram/src/components/ai-native/inspection-transport.ts)保留原调用类型，组件和页面继续管理显示、人工意图、挂接及读取寿命。

[场景目录](ai-scene-catalog.ts)沿原员工目录请求和真实生成校验器，捕获同一会话与当前空间，保留目录字段、时间及范围复验。[原目录组件](../../../../apps/staff-miniprogram/src/components/ai-native/ai-scene-catalog/index.ts)只在明确点击后调用工厂，继续管理分页、隐藏、卸载、过期展示与原人工出口。

## 独立 Native SDK 构建

准备项目锁定依赖后，从仓库执行本包入口。

```bash
npm run build:native-clients -w @rental-os/rental-core
```

[共享生产编译器](../../../../scripts/miniprogram-shared-types.cjs)按[原生配置](../../tsconfig.native-clients.json)同时编译客户、员工与时间模块。正式出口为 `@rental-os/rental-core/clients/miniprogram`、`@rental-os/rental-core/clients/staff` 和 `@rental-os/rental-core/clients/time`，均对应本包 `dist-clients/` 的 CommonJS 与同名声明。构建只读取当前 Core、Shared 和公共合同源码，私有编译产物集中到本树任务临时目录，退出时清理。

发行目录包含三个出口的实际相对 JS 闭包、经真实解析重定位的原生成声明和原 MIT 许可。声明中的 Shared/Core 定义引用同一份生成文件，Zod 类型沿本包已有依赖解析。出口、语法、相对依赖或声明缺失时构建失败；声明中的任务临时路径在发行前改为包内相对路径。原生成校验器、request 和会话由真实宿主注入，AI 合同值的必需端口保持。

隔离构建在同一命令后传 `-- --out-dir <本树 output/.tmp/任务/dist-clients>`，创建者负责交付或清理目标。`lint:native-clients` 使用同一编译器的 `--check`，退出时清理本次私有产物。构建完成校验后替换目标，目标占用锁避免并行写入，替换失败恢复原生成目录。

## 原生编译与微信打包

准备项目锁定依赖后，使用原微信宿主构建入口。

```bash
npm run build:staff-miniprogram
npm run typecheck -w @rental-os/staff-miniprogram
```

[原生配置](../../tsconfig.native-clients.json)定义 `dist-clients/` 的 CommonJS 和声明。业务合同导入均为 `import type`，员工运行时使用已登记的七组业务、认证、附件、原 Action 和 AI 检查任务工厂及其相对依赖，正式包名定位到 `dist-clients/clients/staff/index.js` 和同名声明。原收据读取与其他订单方法由同一工厂提供。

员工微信构建从本树源码与实际包声明在单一任务临时目录编译当前 Shared 声明和完整 Native 工厂。公共打包函数将已声明入口的相对 CommonJS 闭包及原 MIT 许可带入 `dist/vendor/rental-core/`，原宿主的包导入改为该发布包内路径。最终所有 JS 的 `require` 均须解析到本包 JS/JSON，缺出口、缺文件、外部或动态依赖会停止构建。构建和 `--check` 退出时释放私有编译产物。[打包实现](../../../../scripts/miniprogram-shared-types.cjs) · [微信构建入口](../../../../apps/staff-miniprogram/scripts/build.cjs)

发布仍用 `npm run build:staff-miniprogram:release`，沿原公开 API 与 AppID，租户在登录时选择。隔离验证可在原命令后传 `--out-dir`，目标限于本树 `output/.tmp/<任务>/<员工端>`；失败清除本次输出，成功产物由创建者按交付用途保留或清理。原 AI webpack 沿受控源闭包生成动作及目录运行时。[AI 运行时](../../../../scripts/miniprogram-ai-runtime.cjs)

## 调用链

员工页面 → 原 API 薄入口 → 本组工厂 → 宿主员工运输 → Rental 员工 HTTP → 原领域应用与仓储。员工 audience、租户、经营空间、地点及字段投影由原授权与服务端复核。客户主档和会员请求显式使用原 `tenant` 范围，其他业务使用原运输的空间范围。[员工门面](../../../../apps/api/src/common/staff-api-routing.ts) · [Rental HTTP](../../src/http.module.ts) · [原业务导读](../../../../apps/api/src/modules/rental-core/README.md)

订单工厂保留原数组或分页响应处理、查询字段、对象 ID 编码、请求正文、幂等键和操作令牌。报价、建单与续租请求经宿主原准入函数执行。检查、直接交接与分批归还使用 `replayAfterRefresh: false`。线下收款登记的幂等键继续随原正文投递，原资金、资格、计价和执行收据由业务服务提供。[订单客户端](orders.ts)

AI 检查原收据读取由订单工厂提供，原员工订单入口供给同一 request 并窄导出。原输入、原操作引用、版本、执行声明和精确结果字段校验保持，`committed` 校验原订单及检查引用，`unknown` 保留空收据；原错误与 `replayAfterRefresh: false` 保持。原未知结果、取消和认证失效按宿主原操作与收据处理。[订单客户端](orders.ts) · [原收据入口](../../../../apps/staff-miniprogram/src/api/orders.ts)

## 资产缓存

每个资产工厂持有独立的 30 秒缓存，缓存记录真实会话版本。缓存命中、列表读取、详情回退和保存的异步返回边界均核对当前版本。会话事件使缓存失效，保存成功也沿原失效点清缓存。[资产客户端](assets.ts)

请求代次只控制缓存写入。较早读取返回时，较新请求或保存已经推进代次，旧读取结束自身调用并放弃缓存提交。详情在缓存中找不到资产时沿原强制读取回退，保存保留原新建 POST 和更新 PUT。[资产客户端](assets.ts)

## 直接消费者与验证

订单列表、详情、新建、配货、领取和归还，资产列表、详情、登记和库存流水，客户列表、详情与编辑，工单列表与执行页、工作台和扫码均通过原薄入口消费本实现。页面权限和原操作键由既有宿主供给。[员工页面](../../../../apps/staff-miniprogram/src/pages) · [扫码入口](../../../../apps/staff-miniprogram/src/core/scan.ts)

必要类型检查覆盖已声明工厂、原薄入口及直接页面。原员工测试中的现场新增与编辑场景验证报价、建单、客户写入和持久幂等键，定向缓存冒烟核会话失效、并发读取及保存后的缓存提交。原测试加载器与微信发布构建须使用正式客户端闭包，类型、离线宿主替身、微信构建和真实服务分别核验。[原员工测试](../../../../tests/staff-miniprogram-static.test.cjs)
