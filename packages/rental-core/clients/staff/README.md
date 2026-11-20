# Rental 员工客户端

本入口提供订单、资产与库存、养护工单与归还处置、客户主档与会员、工作台、经营目录和会员审核七组工厂，以及认证、业务附件、原 Action、AI 检查任务、检查运输与场景目录工厂，以及检查表字段转换。每个真实员工宿主创建自己的客户端实例，传入同一员工请求函数，页面继续调用原业务方法。业务类型单源消费 Rental 合同，宿主的 shared 兼容出口引用同一份定义。[客户端入口](index.ts) · [业务合同](../../src/contracts.ts)

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

## 业务词条与订单卡片

同一正式入口提供 `createRentalStaffLabels` 和 `createRentalStaffPresenters`。[员工词条](labels.ts)接收原 `terms` 函数，每次沿当前空间术语读取，保留原订单页签、状态、色调、资产／工单词条与未知值。宿主初始化时绑定一次实例，[原词条入口](../../../../apps/staff-miniprogram/src/core/labels.ts)继续导出原名称。

[卡片投影](presenters.ts)供给原订单字段、手机号脱敏、有效归还时间、数量、金额与媒体来源。宿主传入同一词条实例的状态函数及原目录 `itemGroupImagePath`，时间直接复用[同源 Core 时间](../time.ts)。原零金额、缺金额、未知状态及封面选择保持，[原展示入口](../../../../apps/staff-miniprogram/src/core/presenters.ts)绑定一次工厂。

订单、客户和资产页面继续消费原入口。实际媒体地址、下载、令牌和失败占位沿[原图片宿主](../../../../apps/staff-miniprogram/src/core/images.ts)，页面展示和业务操作仍经原会话、准入及服务端裁定。[原员工定向断言](../../../../tests/staff-miniprogram-static.test.cjs)核对页签和词条，卡片定向冒烟核对原字段、脱敏、媒体路径及下载失败。

## 检查表字段

同一正式入口提供 `inspectionRows`、`inspectionResults` 与 `InspectionFieldRow`。[字段转换](inspection-form.ts)沿服务端原模板生成空输入，并核对必填、可选值、有限数值及照片资产 ID。原字段类型、单位、默认值、错误文案和结果映射保持。

旧[检查表入口](../../../../apps/staff-miniprogram/src/core/inspection-form.ts)窄再导出同一实现，[领取页](../../../../apps/staff-miniprogram/src/pages/pickup/index.ts)与[归还页](../../../../apps/staff-miniprogram/src/pages/return/index.ts)消费字段和结果，[原人工检查表](../../../../apps/staff-miniprogram/src/components/ai-native/inspection-human-form.ts)复用字段类型。照片采集、上传、签字和页面寿命由宿主维护，结果只传已经上传的资产 ID，检查准入、提交和履约沿原订单服务校验。

原[员工定向断言](../../../../tests/staff-miniprogram-static.test.cjs)覆盖必填、数值和照片字段，严格类型与正式 Native 构建核对旧入口和页面消费者。

## 经营空间上下文

同一正式入口提供 `createRentalStaffContext`。[上下文工厂](context.ts)接收原会话上下文、品类和地点 API，同一 `currentWorkspace/currentWorkspaceId/contextVersion/applySessionContext`、会话订阅和 `contextEvents`，以及原地点存储键与本机时钟。[微信上下文入口](../../../../apps/staff-miniprogram/src/core/context.ts)持有一次绑定实例，原页面继续订阅同一个事件对象。

术语、资产字段、检查字段、能力、履约方式及地点来自当前真实 API。未加载前沿原通用术语展示，实际加载缺品类定义明确失败。原缓存命中、single-flight、force 并行代次、地点读取失败和迟到拒绝保持，租户范围的 `sessionContext` 在应用会话权限前核对本次代次，旧读取也无法清除新 inflight。

当前地点沿真实 API 启用集合和当前会话 `locationScope` 重核，`selected` 取两者交集，缺省沿正式合同的旧成员兼容范围。原按空间保存的键和空选择保持，失权或停用的已存地点归空，非法新选择保留当前选择。地点只影响本机筛选，实际数据范围与业务操作仍由员工运输和服务端校验。

`resetContextForTest` 释放当前实际会话订阅并只重绑本实例的一条订阅，保持重置后继续加载的原入口。宿主卸载时调用 `dispose()`，幂等释放自身订阅并作废旧读取。其他宿主和页面监听者沿原事件对象独立管理，通用主题、页面生命周期、品类图标及首页配图在[微信宿主](../../../../apps/staff-miniprogram/src/core/context.ts)维护。

原[员工上下文断言](../../../../tests/staff-miniprogram-static.test.cjs)核对品类术语、字段、地点筛选与切换，必要迟到和生命周期冒烟核对旧会话权限、缺品类、当前地点撤权及订阅解除，正式 Native SDK 和 Staff 类型入口核对工厂与原页面消费。

## 扫码候选与历史

同一正式入口提供 `createRentalStaffScan`。[扫码实现](scan.ts)接收原订单、资产、型号和工单 API 方法，同一宿主的会话、当前空间、上下文版本、术语、历史存储及本机时钟。原[微信扫码入口](../../../../apps/staff-miniprogram/src/core/scan.ts)绑定一次实例，页面继续使用原函数与结果类型。

纯文本依次查询订单号、资产编号或序列号、型号编码和工单号，具名 `rental-os://` 码只查询对应对象。深链 kind 先转小写再映射原四类，保留原前缀匹配。订单候选仍传原 `pageSize: 20`，当前订单 API 沿原查询字段投递，服务端条数按实际响应读取。匹配字段、普通候选读取失败后的顺序和结果投影保持。每次候选派发、异步结果投影和候选返回均复验原租户、本人、经营空间、上下文版本及本次调用代次，切换后通过宿主原 `STALE_CONTEXT` 错误拒绝，阻止继续混读新主体。候选查询沿原员工运输与服务端权限。

结果归属保存在同一工厂内部的 `WeakMap`。宿主用 `assertCurrentResult(result)` 复验原结果，[相机页](../../../../apps/staff-miniprogram/src/pages/scanner/index.ts)在记历史和跳结果页前调用，[手输实际结果页](../../../../apps/staff-miniprogram/src/pages/scan-result/index.ts)在展示、记录和业务跳转前调用，资产找单的 await 返回也复验原结果。外来、克隆、较早调用或主体失效的结果沿同一错误工厂拒绝。当前 `kind=unknown` 保留原未识别展示与零历史写入，手输页继续只传原码到结果页。

历史沿原 `rental-os-staff:scan-history:<tenantId>:<userId>` 键保存，同种对象 ID 去重、最新优先及 50 条上限保持，时间由宿主供给原 `Date.now()`。退出时沿[同一员工会话](../../../../apps/staff-miniprogram/src/core/session.ts)删除本人历史键。相机采集、历史列表、导航及后续业务动作由[原扫码页面](../../../../apps/staff-miniprogram/src/pages/scanner/index.ts)、[结果页](../../../../apps/staff-miniprogram/src/pages/scan-result/index.ts)和原交接页管理。

原[员工扫码断言](../../../../tests/staff-miniprogram-static.test.cjs)覆盖深链、账号隔离、去重、50 条与退出清理，必要顺序及迟到冒烟核对当前主体复验，正式 Native 构建和 Staff 类型入口核对新工厂与旧页面消费。

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
