# Rental 员工客户端

本入口提供订单、资产与库存、养护工单与归还处置、客户主档与会员、工作台五组工厂。每个真实员工宿主创建自己的客户端实例，传入同一员工请求函数，页面继续调用原业务方法。业务类型单源消费 Rental 合同，宿主的 shared 兼容出口引用同一份定义。[客户端入口](index.ts) · [业务合同](../../src/contracts.ts)

## 接入

`request` 由员工宿主供给，使用 `/api/staff/v1`、原鉴权和信封解包。订单工厂还接收原 `withStaffAction`，资产工厂接收原会话 `contextVersion` 和 `STALE_CONTEXT` 错误工厂。宿主在会话刷新、登录、退出及空间变化事件中调用 `invalidateAssets()`。这些端口均为必需接点。[端口](ports.ts) · [员工运输](../../../../apps/staff-miniprogram/src/core/http.ts) · [业务准入](../../../../apps/staff-miniprogram/src/core/subscription-access.ts) · [会话事件](../../../../apps/staff-miniprogram/src/core/session.ts)

```ts
import {
  createRentalStaffOrdersApi,
  createRentalStaffAssetsApi,
  createRentalStaffWorkOrdersApi,
  createRentalStaffCustomersApi,
  createRentalStaffWorkbenchApi,
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
sessionEvents.on(assets.invalidateAssets);
```

示例中的运输、会话、错误类和准入函数来自真实宿主。原微信宿主在模块生命周期内持有一组实例，五个原 API 路径各自导出同一实现的方法。其他宿主按自身生命周期绑定会话失效事件。[订单适配](../../../../apps/staff-miniprogram/src/api/orders.ts) · [资产适配](../../../../apps/staff-miniprogram/src/api/assets.ts) · [工单适配](../../../../apps/staff-miniprogram/src/api/workOrders.ts) · [客户适配](../../../../apps/staff-miniprogram/src/api/customers.ts) · [工作台适配](../../../../apps/staff-miniprogram/src/api/workbench.ts)

微信产物须将本入口及其相对运行时依赖编入同一发布包，并为正式包名提供对应类型定位。工厂的业务合同导入均为 `import type`，运行时闭包由五组工厂和纯客户过滤函数组成。具体构建与包出口由宿主装配维护。[原微信构建入口](../../../../apps/staff-miniprogram/scripts/build.cjs)

## 调用链

员工页面 → 原 API 薄入口 → 本组工厂 → 宿主员工运输 → Rental 员工 HTTP → 原领域应用与仓储。员工 audience、租户、经营空间、地点及字段投影由原授权与服务端复核。客户主档和会员请求显式使用原 `tenant` 范围，其他业务使用原运输的空间范围。[员工门面](../../../../apps/api/src/common/staff-api-routing.ts) · [Rental HTTP](../../src/http.module.ts) · [原业务导读](../../../../apps/api/src/modules/rental-core/README.md)

订单工厂保留原数组或分页响应处理、查询字段、对象 ID 编码、请求正文、幂等键和操作令牌。报价、建单与续租请求经宿主原准入函数执行。检查、直接交接与分批归还使用 `replayAfterRefresh: false`。线下收款登记的幂等键继续随原正文投递，原资金、资格、计价和执行收据由业务服务提供。[订单客户端](orders.ts)

AI 检查原收据读取继续位于原员工订单入口，按原键读取并校验 `committed` 或 `unknown` 结果。原未知结果、取消和认证失效按宿主原操作与收据处理。[原收据入口](../../../../apps/staff-miniprogram/src/api/orders.ts)

## 资产缓存

每个资产工厂持有独立的 30 秒缓存，缓存记录真实会话版本。缓存命中、列表读取、详情回退和保存的异步返回边界均核对当前版本。会话事件使缓存失效，保存成功也沿原失效点清缓存。[资产客户端](assets.ts)

请求代次只控制缓存写入。较早读取返回时，较新请求或保存已经推进代次，旧读取结束自身调用并放弃缓存提交。详情在缓存中找不到资产时沿原强制读取回退，保存保留原新建 POST 和更新 PUT。[资产客户端](assets.ts)

## 直接消费者与验证

订单列表、详情、新建、配货、领取和归还，资产列表、详情、登记和库存流水，客户列表、详情与编辑，工单列表与执行页、工作台和扫码均通过原薄入口消费本实现。页面权限和原操作键由既有宿主供给。[员工页面](../../../../apps/staff-miniprogram/src/pages) · [扫码入口](../../../../apps/staff-miniprogram/src/core/scan.ts)

必要类型检查覆盖五组工厂、原薄入口及直接页面。原员工测试中的现场新增与编辑场景验证报价、建单、客户写入和持久幂等键，定向缓存冒烟核会话失效、并发读取及保存后的缓存提交。原测试加载器与微信发布构建须使用正式客户端闭包，类型、离线宿主替身、微信构建和真实服务分别核验。[原员工测试](../../../../tests/staff-miniprogram-static.test.cjs)
